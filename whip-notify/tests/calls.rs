//! The host command's public boundary: environment, Herdr socket, log, and relay.
use serde_json::{Value, json};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    os::unix::net::UnixListener,
    process::{Command, Output},
    thread,
};

fn call(root: &std::path::Path, pane: &str, args: &[&str]) -> Output {
    let socket = root.join("herdr.sock");
    let listener = UnixListener::bind(&socket).unwrap();
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
            "tabs":[{"tab_id":"t2","workspace_id":"w1","number":2},{"tab_id":"t1","workspace_id":"w1","number":1}],
            "panes":[{"pane_id":"main","workspace_id":"w1","tab_id":"t1","agent":"codex"},
                     {"pane_id":"sub","workspace_id":"w1","tab_id":"t2","agent":"claude"},
                     {"pane_id":"split","workspace_id":"w1","tab_id":"t1","agent":"claude"}],
            "layouts":[{"tab_id":"t1","panes":[{"pane_id":"main"},{"pane_id":"split"}]},{"tab_id":"t2","panes":[{"pane_id":"sub"}]}]
        }}})).unwrap();
    });
    let output = Command::new(env!("CARGO_BIN_EXE_whip-notify"))
        .env("HERDR_PLUGIN_CONFIG_DIR", root.join("config"))
        .env("HERDR_PLUGIN_STATE_DIR", root.join("state"))
        .env("HERDR_SOCKET_PATH", &socket)
        .env("HERDR_PANE_ID", pane)
        .arg("call")
        .args(args)
        .output()
        .unwrap();
    // A missing command must fail the assertion without leaving a fixture blocked.
    if !output.status.success() {
        let _ = std::os::unix::net::UnixStream::connect(&socket);
    }
    server.join().unwrap();
    fs::remove_file(socket).unwrap();
    output
}
fn records(root: &std::path::Path) -> Vec<Value> {
    fs::read_to_string(root.join("state/calls.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}
#[test]
fn record_call_keeps_sanitized_content_and_origin_without_sending_push() {
    let root = tempfile::tempdir().unwrap();
    let output = call(
        root.path(),
        "main",
        &[
            "--urgency",
            "record",
            "--title",
            " Result\nready ",
            "--body",
            "Review\tthis",
            "--option",
            "Accept",
            "--option",
            "Revise",
        ],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let log = records(root.path());
    assert_eq!(log.len(), 1);
    assert_eq!(log[0]["kind"], "call");
    assert_eq!(log[0]["urgency"], "record");
    assert_eq!(log[0]["title"], "Resultready");
    assert_eq!(log[0]["body"], "Reviewthis");
    assert_eq!(log[0]["options"], json!(["Accept", "Revise"]));
    assert_eq!(log[0]["pane_id"], "main");
    assert_eq!(log[0]["workspace_id"], "w1");
    assert_eq!(
        log[0]["session"],
        root.path().join("herdr.sock").to_str().unwrap()
    );
    assert!(log[0]["call_id"].as_str().unwrap().len() >= 16);
    assert!(log[0]["created_at"].as_u64().unwrap() > 0);
}

#[test]
fn urgent_call_attempts_delivery_and_remains_logged_when_relay_is_unavailable() {
    use std::net::TcpListener;
    use whip_notify::{
        generate_key,
        host::{Registration, Store},
    };
    let root = tempfile::tempdir().unwrap();
    let relay = TcpListener::bind("127.0.0.1:0").unwrap();
    relay.set_nonblocking(true).unwrap();
    let store = Store {
        config: root.path().join("config"),
        state: root.path().join("state"),
    };
    let device = generate_key().unwrap();
    store
        .register(Registration {
            device_id: uuid::Uuid::new_v4().to_string(),
            public_key: device.public_key.clone(),
            relay_url: format!("https://{}", relay.local_addr().unwrap()),
            route_token: "x".repeat(64),
            session: root.path().join("herdr.sock").to_str().unwrap().into(),
            end_to_end_encrypted: true,
        })
        .unwrap();
    let output = call(
        root.path(),
        "main",
        &[
            "--urgency",
            "urgent",
            "--title",
            "Review",
            "--body",
            "Ready",
        ],
    );
    assert!(
        !output.status.success(),
        "an unavailable relay must report delivery failure"
    );
    assert_eq!(records(root.path())[0]["urgency"], "urgent");
    assert!(
        relay.accept().is_ok(),
        "non-record calls must attempt push delivery"
    );
}

#[test]
fn unverifiable_caller_is_still_recorded_without_push() {
    let root = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_whip-notify"))
        .env("HERDR_PLUGIN_CONFIG_DIR", root.path().join("config"))
        .env("HERDR_PLUGIN_STATE_DIR", root.path().join("state"))
        .env("HERDR_SOCKET_PATH", root.path().join("missing.sock"))
        .env("HERDR_PANE_ID", "main")
        .args([
            "call",
            "--urgency",
            "emergency",
            "--title",
            "Help",
            "--body",
            "API unavailable",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(records(root.path())[0]["urgency"], "record");
    assert_eq!(records(root.path())[0]["ineligible_reason"], "자격 없음");
}

#[test]
fn subagents_are_downgraded_and_leases_suppress_only_push_not_the_log() {
    use whip_notify::{
        generate_key,
        host::{Registration, Store, renew_lease},
    };
    let root = tempfile::tempdir().unwrap();
    let store = Store {
        config: root.path().join("config"),
        state: root.path().join("state"),
    };
    let id = uuid::Uuid::new_v4().to_string();
    store
        .register(Registration {
            device_id: id.clone(),
            public_key: generate_key().unwrap().public_key.clone(),
            relay_url: "https://127.0.0.1:1".into(),
            route_token: "x".repeat(64),
            session: root.path().join("herdr.sock").to_str().unwrap().into(),
            end_to_end_encrypted: true,
        })
        .unwrap();
    let args = [
        "--urgency",
        "emergency",
        "--title",
        "Help",
        "--body",
        "Decision",
    ];
    for pane in ["sub", "split", "unknown"] {
        assert!(call(root.path(), pane, &args).status.success());
    }
    let log = records(root.path());
    assert_eq!(log[0]["urgency"], "record");
    assert_eq!(log[0]["requested_urgency"], "emergency");
    assert_eq!(log[0]["ineligible_reason"], "자격 없음");
    renew_lease(&store.state, &id).unwrap();
    for urgency in ["emergency", "urgent", "check", "record"] {
        assert!(
            call(
                root.path(),
                "main",
                &["--urgency", urgency, "--title", "Ready", "--body", "Review"]
            )
            .status
            .success()
        );
    }
    let log = records(root.path());
    assert_eq!(log.len(), 7);
    assert_eq!(log[1]["urgency"], "record");
    assert_eq!(log[2]["urgency"], "record");
    assert_eq!(log[3]["urgency"], "emergency");
    assert_eq!(log[4]["urgency"], "urgent");
    assert_eq!(log[5]["urgency"], "check");
    assert_eq!(log[6]["urgency"], "record");
    let ids: std::collections::HashSet<_> =
        log.iter().map(|r| r["call_id"].as_str().unwrap()).collect();
    assert_eq!(ids.len(), 7);
}

#[test]
fn unicode_input_is_bounded_and_invalid_arguments_do_not_enter_the_log() {
    let root = tempfile::tempdir().unwrap();
    let long = "🦀".repeat(200);
    assert!(
        call(
            root.path(),
            "main",
            &[
                "--urgency",
                "record",
                "--title",
                &long,
                "--body",
                &long,
                "--option",
                &long,
                "--option",
                "Two",
                "--option",
                "Three"
            ]
        )
        .status
        .success()
    );
    let log = records(root.path());
    assert_eq!(log[0]["title"].as_str().unwrap().len(), 160);
    assert_eq!(log[0]["body"].as_str().unwrap().len(), 320);
    assert_eq!(log[0]["options"][0].as_str().unwrap().len(), 64);
    for extra in [
        vec![
            "--option", "1", "--option", "2", "--option", "3", "--option", "4",
        ],
        vec!["--option", "\n\t"],
        vec!["--unknown", "oops"],
    ] {
        let mut args = vec![
            "--urgency",
            "record",
            "--title",
            "Ready",
            "--body",
            "Review",
        ];
        args.extend(extra);
        assert!(!call(root.path(), "main", &args).status.success());
    }
    let oversized = "x".repeat(65_536);
    assert!(
        !call(
            root.path(),
            "main",
            &[
                "--urgency",
                "record",
                "--title",
                "Ready",
                "--body",
                &oversized
            ]
        )
        .status
        .success()
    );
    assert_eq!(records(root.path()).len(), 1);
}

#[test]
fn log_prunes_old_entries_and_oldest_records_at_the_size_bound() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let args = [
        "--urgency",
        "record",
        "--title",
        "Ready",
        "--body",
        "Review",
    ];
    assert!(call(root.path(), "main", &args).status.success());
    let mut old = records(root.path())[0].clone();
    old["created_at"] = json!(1);
    let mut recent = records(root.path())[0].clone();
    recent["body"] = json!("x".repeat(300));
    let mut seed = format!("{}\n", old);
    while seed.len() + recent.to_string().len() + 1 <= 1_048_576 {
        seed.push_str(&recent.to_string());
        seed.push('\n');
    }
    let path = root.path().join("state/calls.jsonl");
    fs::write(&path, &seed).unwrap();
    assert!(call(root.path(), "main", &args).status.success());
    assert!(fs::metadata(&path).unwrap().len() <= 1_048_576);
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let log = records(root.path());
    assert!(log.iter().all(|r| r["created_at"] != 1));
    assert_eq!(log.last().unwrap()["body"], "Review");
    let mut seed = String::new();
    let line = recent.to_string() + "\n";
    while seed.len() + line.len() <= 1_048_576 {
        seed.push_str(&line);
    }
    let before = seed.lines().count();
    fs::write(&path, seed).unwrap();
    for _ in 0..3 {
        assert!(call(root.path(), "main", &args).status.success());
    }
    let log = records(root.path());
    assert!(
        log.len() < before + 3,
        "oldest records must be evicted at the byte cap"
    );
    assert!(fs::metadata(&path).unwrap().len() <= 1_048_576);
    assert_eq!(log.last().unwrap()["body"], "Review");
}
