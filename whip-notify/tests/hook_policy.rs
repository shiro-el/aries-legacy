//! Exercise policy through the shipped binary and fixture Herdr/relay endpoints.
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    os::unix::net::{UnixListener, UnixStream},
    path::Path,
    process::{Command, Output},
    thread,
};
use whip_notify::{
    generate_key,
    host::{Registration, Store, renew_lease},
};

fn run(root: &Path, args: &[&str], pane: &str, status: &str) -> Output {
    Command::new(env!("CARGO_BIN_EXE_whip-notify"))
        .args(args)
        .env("HERDR_PLUGIN_CONFIG_DIR", root.join("config"))
        .env("HERDR_PLUGIN_STATE_DIR", root.join("state"))
        .env("HERDR_SOCKET_PATH", root.join("herdr.sock"))
        // Hook routing must come from the event, never the focused pane.
        .env("HERDR_PANE_ID", "sub")
        .env("HERDR_PLUGIN_CONTEXT_JSON", r#"{"focused_pane_id":"sub"}"#)
        .env("HERDR_PLUGIN_EVENT_JSON", json!({"event":"pane_agent_status_changed","data":{"pane_id":pane,"workspace_id":"w1","agent_status":status,"agent":"codex","title":"Review command"}}).to_string())
        .output().unwrap()
}

fn hook(root: &Path, pane: &str, status: &str, agent: &str) -> Output {
    let socket = root.join("herdr.sock");
    let listener = UnixListener::bind(&socket).unwrap();
    let agent = agent.to_owned();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut line = String::new();
        BufReader::new(stream.try_clone().unwrap())
            .read_line(&mut line)
            .unwrap();
        if line.is_empty() {
            return;
        }
        let request: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(request["method"], "session.snapshot");
        writeln!(stream, "{}", json!({"id":request["id"],"result":{"type":"session_snapshot","snapshot":{
            "tabs":[{"tab_id":"later","workspace_id":"w1","number":2},{"tab_id":"first","workspace_id":"w1","number":1}],
            "panes":[{"pane_id":"main","workspace_id":"w1","agent":agent},{"pane_id":"sub","workspace_id":"w1","agent":"claude"},{"pane_id":"split","workspace_id":"w1","agent":"codex"}],
            "layouts":[{"tab_id":"first","panes":[{"pane_id":"main"},{"pane_id":"split"}]},{"tab_id":"later","panes":[{"pane_id":"sub"}]}]
        }}})).unwrap();
    });
    let output = run(root, &["hook"], pane, status);
    // Policies can discard an event before querying Herdr.
    let _ = UnixStream::connect(&socket);
    server.join().unwrap();
    fs::remove_file(socket).unwrap();
    output
}
fn setup(root: &Path) -> (Store, String, TcpListener) {
    let relay = TcpListener::bind("127.0.0.1:0").unwrap();
    relay.set_nonblocking(true).unwrap();
    let store = Store {
        config: root.join("config"),
        state: root.join("state"),
    };
    let id = uuid::Uuid::new_v4().to_string();
    store
        .register(Registration {
            device_id: id.clone(),
            public_key: generate_key().unwrap().public_key.clone(),
            relay_url: format!("https://{}", relay.local_addr().unwrap()),
            route_token: "x".repeat(64),
            session: root.join("herdr.sock").to_str().unwrap().into(),
            end_to_end_encrypted: false,
            envelope_version: 2,
        })
        .unwrap();
    (store, id, relay)
}
fn records(root: &Path) -> Vec<Value> {
    fs::read_to_string(root.join("state/calls.jsonl"))
        .unwrap()
        .lines()
        .map(|s| serde_json::from_str(s).unwrap())
        .collect()
}
#[test]
fn default_main_block_is_logged_as_urgent_approval_before_delivery_failure() {
    let root = tempfile::tempdir().unwrap();
    let (_, _, relay) = setup(root.path());
    let output = hook(root.path(), "main", "blocked", "codex");
    assert!(
        !output.status.success(),
        "unavailable relay must report failure"
    );
    assert!(
        relay.accept().is_ok(),
        "main approval must attempt delivery"
    );
    let log = records(root.path());
    assert_eq!(log.len(), 1);
    assert_eq!(log[0]["kind"], "approval");
    assert_eq!(log[0]["urgency"], "urgent");
    assert_eq!(log[0]["requested_urgency"], "urgent");
    assert_eq!(log[0]["pane_id"], "main");
    assert_eq!(log[0]["workspace_id"], "w1");
    assert_eq!(log[0]["title"], "codex needs you");
    assert!(
        log[0]["body"]
            .as_str()
            .is_some_and(|body| body.ends_with("Review command")),
        "approval body keeps the task title after the host name"
    );
    assert!(
        log[0]["options"].is_null(),
        "approvals have no reply buttons"
    );
    assert!(log[0]["call_id"].as_str().unwrap().len() >= 16);
}

#[test]
fn legacy_setting_restores_all_panes_blocked_and_done_and_can_be_reset() {
    let root = tempfile::tempdir().unwrap();
    let (_, _, relay) = setup(root.path());
    assert!(
        run(root.path(), &["policy", "all-panes"], "", "")
            .status
            .success()
    );
    assert_eq!(
        String::from_utf8(run(root.path(), &["policy"], "", "").stdout)
            .unwrap()
            .trim(),
        "all-panes"
    );
    for pane in ["main", "sub", "split"] {
        for status in ["blocked", "done"] {
            assert!(!hook(root.path(), pane, status, "codex").status.success());
            assert!(
                relay.accept().is_ok(),
                "legacy {pane}/{status} must attempt delivery"
            );
        }
    }
    assert!(
        run(root.path(), &["policy", "main-approval"], "", "")
            .status
            .success()
    );
    assert!(
        hook(root.path(), "sub", "blocked", "codex")
            .status
            .success()
    );
    assert!(relay.accept().is_err());
    assert!(
        !run(root.path(), &["policy", "typo"], "", "")
            .status
            .success()
    );
    assert_eq!(
        String::from_utf8(run(root.path(), &["policy"], "", "").stdout)
            .unwrap()
            .trim(),
        "main-approval"
    );
}

#[test]
fn default_suppresses_done_subpanes_shells_unknown_and_unverifiable_events() {
    let root = tempfile::tempdir().unwrap();
    let (_, _, relay) = setup(root.path());
    for (pane, status, agent) in [
        ("main", "done", "codex"),
        ("sub", "blocked", "codex"),
        ("sub", "done", "codex"),
        ("split", "blocked", "codex"),
        ("split", "done", "codex"),
        ("unknown", "blocked", "codex"),
        ("main", "blocked", ""),
    ] {
        assert!(hook(root.path(), pane, status, agent).status.success());
    }
    assert!(
        run(root.path(), &["hook"], "main", "blocked")
            .status
            .success()
    );
    assert!(
        relay.accept().is_err(),
        "ineligible hooks must never contact relay"
    );
    assert!(!root.path().join("state/calls.jsonl").exists());
}

#[test]
fn active_lease_suppresses_push_but_keeps_approval_log() {
    let root = tempfile::tempdir().unwrap();
    let (store, id, relay) = setup(root.path());
    renew_lease(&store.state, &id).unwrap();
    assert!(
        hook(root.path(), "main", "blocked", "codex")
            .status
            .success()
    );
    assert!(relay.accept().is_err());
    assert_eq!(records(root.path())[0]["kind"], "approval");
}

#[test]
fn malformed_policy_fails_closed_and_is_not_treated_as_legacy() {
    let root = tempfile::tempdir().unwrap();
    let (store, _, relay) = setup(root.path());
    whip_notify::host::atomic_write(&store.config.join("hook-policy.json"), b"\"typo\"").unwrap();
    assert!(
        !hook(root.path(), "main", "blocked", "codex")
            .status
            .success()
    );
    assert!(relay.accept().is_err());
    assert!(!root.path().join("state/calls.jsonl").exists());
}
