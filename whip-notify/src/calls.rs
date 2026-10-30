//! Explicit human calls. The host log is authoritative, including suppressed pushes.
use crate::{
    NotificationEvent, Result,
    host::{PREVIEW_BODY_BYTES, PREVIEW_TITLE_BYTES, Store, atomic_write, preview_text},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Read, Write},
    os::unix::net::UnixStream,
    time::{Duration, SystemTime},
};

pub const CALL_LOG_BYTES: usize = 1_048_576;
pub const CALL_LOG_MAX_AGE: u64 = 30 * 86_400;
pub const OPTION_BYTES: usize = 64;

#[derive(Serialize, Deserialize)]
pub struct CallRecord {
    #[serde(flatten)]
    pub event: NotificationEvent,
    pub created_at: u64,
    pub requested_urgency: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ineligible_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reply_status: Option<String>,
}

/// CLI flags deliberately carry only content; routing always comes from Herdr.
pub fn prepare(
    args: impl Iterator<Item = String>,
    pane: &str,
    session: &str,
) -> Result<CallRecord> {
    let mut args = args;
    let (mut urgency, mut title, mut body) = (None, None, None);
    let mut options = Vec::new();
    let mut bytes = 0;
    while let Some(flag) = args.next() {
        let value = args.next().ok_or("missing call argument")?;
        bytes += flag.len() + value.len();
        if bytes > 65_536 {
            return Err("call too large".into());
        }
        match flag.as_str() {
            "--urgency" if urgency.is_none() => urgency = Some(value),
            "--title" if title.is_none() => title = Some(value),
            "--body" if body.is_none() => body = Some(value),
            "--option" if options.len() < 3 => options.push(preview_text(&value, OPTION_BYTES)),
            _ => return Err("invalid call argument".into()),
        }
    }
    let urgency = urgency.ok_or("missing urgency")?;
    if !matches!(
        urgency.as_str(),
        "emergency" | "urgent" | "check" | "record"
    ) || pane.is_empty()
        || pane.len() > 128
        || session.len() > 512
    {
        return Err("invalid call context".into());
    }
    let title = preview_text(&title.ok_or("missing title")?, PREVIEW_TITLE_BYTES);
    let body = preview_text(&body.ok_or("missing body")?, PREVIEW_BODY_BYTES);
    if title.is_empty() || options.iter().any(String::is_empty) {
        return Err("empty call text".into());
    }
    let (workspace, eligible) = main_agent(pane, session);
    Ok(CallRecord {
        event: NotificationEvent {
            pane_id: pane.into(),
            workspace_id: workspace,
            session: session.into(),
            status: "blocked".into(),
            title: Some(title),
            kind: Some("call".into()),
            urgency: Some(if eligible {
                urgency.clone()
            } else {
                "record".into()
            }),
            body: Some(body),
            options,
            call_id: Some(uuid::Uuid::new_v4().to_string()),
        },
        created_at: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)?
            .as_secs(),
        requested_urgency: urgency,
        ineligible_reason: (!eligible).then(|| "자격 없음".into()),
        reply: None,
        reply_status: None,
    })
}

/// Resolve main-agent eligibility from server topology, never focus or hook context.
pub fn main_agent(pane: &str, session: &str) -> (String, bool) {
    let snapshot = snapshot(session).unwrap_or(Value::Null);
    let empty = Vec::new();
    let panes = snapshot["panes"].as_array().unwrap_or(&empty);
    let caller = panes.iter().find(|p| p["pane_id"].as_str() == Some(pane));
    let workspace = caller
        .and_then(|p| p["workspace_id"].as_str())
        .unwrap_or("");
    let first_tab = snapshot["tabs"].as_array().and_then(|tabs| {
        tabs.iter()
            .filter(|t| t["workspace_id"].as_str() == Some(workspace))
            .min_by_key(|t| t["number"].as_u64().unwrap_or(u64::MAX))
    });
    let first_pane = first_tab
        .and_then(|tab| {
            snapshot["layouts"].as_array().and_then(|layouts| {
                layouts
                    .iter()
                    .find(|layout| layout["tab_id"] == tab["tab_id"])
            })
        })
        .and_then(|layout| layout["panes"].as_array())
        .and_then(|panes| panes.first())
        .and_then(|p| p["pane_id"].as_str());
    let eligible = first_pane == Some(pane)
        && caller.is_some_and(|p| p["agent"].as_str().is_some_and(|a| !a.is_empty()));
    (workspace.to_owned(), eligible)
}

fn snapshot(session: &str) -> Result<Value> {
    let response = request(session, "session.snapshot", json!({}))?;
    if response["type"] != "session_snapshot" {
        return Err("invalid snapshot response".into());
    }
    Ok(response["snapshot"].clone())
}

fn request(session: &str, method: &str, params: Value) -> Result<Value> {
    let mut stream = UnixStream::connect(session)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let id = uuid::Uuid::new_v4().to_string();
    writeln!(
        stream,
        "{}",
        json!({"id":id,"method":method,"params":params})
    )?;
    let mut bytes = Vec::new();
    BufReader::new(stream)
        .take(4_194_305)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > 4_194_304 || bytes.last() != Some(&b'\n') {
        return Err("invalid snapshot size".into());
    }
    let response: Value = serde_json::from_slice(&bytes)?;
    if response["id"] != id || response.get("error").is_some() || !response["result"].is_object() {
        return Err("invalid Herdr response".into());
    }
    Ok(response["result"].clone())
}

pub fn record(store: &Store, call: &CallRecord) -> Result<()> {
    let _lock = store.lock()?;
    record_locked(store, call)
}

fn record_locked(store: &Store, call: &CallRecord) -> Result<()> {
    let path = store.state.join("calls.jsonl");
    let mut lines = Vec::new();
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_secs();
    if path.exists() {
        // Read the private file with the same no-symlink policy as other state.
        let file = crate::host::open_private(&path)?;
        let mut bytes = Vec::new();
        file.take((CALL_LOG_BYTES + 1) as u64)
            .read_to_end(&mut bytes)?;
        if bytes.len() > CALL_LOG_BYTES {
            return Err("call log too large".into());
        }
        for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
            let entry: CallRecord = serde_json::from_slice(line)?;
            if entry.created_at >= now.saturating_sub(CALL_LOG_MAX_AGE) {
                lines.push(line.to_vec());
            }
        }
    }
    lines.push(serde_json::to_vec(call)?);
    let mut size: usize = lines.iter().map(|line| line.len() + 1).sum();
    let mut skip = 0;
    while size > CALL_LOG_BYTES {
        size -= lines[skip].len() + 1;
        skip += 1;
    }
    let mut bytes = Vec::with_capacity(size);
    for line in &lines[skip..] {
        bytes.extend(line);
        bytes.push(b'\n');
    }
    atomic_write(&path, &bytes)
}

/// Resolve choices from the private host log, never notification-supplied text.
/// Claim before sending: ambiguous transport/process failures cannot be retried
/// automatically without risking a second Enter in the agent's next turn.
pub fn reply(
    store: &Store,
    id: &str,
    index: usize,
    pane: &str,
    session: &str,
) -> Result<CallRecord> {
    if !crate::valid_id(id) || index >= 3 || pane.len() > 128 || session.len() > 512 {
        return Err("invalid reply".into());
    }
    let _lock = store.lock()?;
    let file = crate::host::open_private(&store.state.join("calls.jsonl"))?;
    let mut bytes = Vec::new();
    file.take((CALL_LOG_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > CALL_LOG_BYTES {
        return Err("call log too large".into());
    }
    let mut original = None;
    for line in bytes.split(|b| *b == b'\n').filter(|line| !line.is_empty()) {
        let entry: CallRecord = serde_json::from_slice(line)?;
        if entry.event.call_id.as_deref() == Some(id) {
            original = Some(entry);
        }
    }
    let mut call = original.ok_or("call unavailable")?;
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)?
        .as_secs();
    if call.event.kind.as_deref() != Some("call")
        || call.event.pane_id != pane
        || call.event.session != session
        || call.created_at > now
        || now - call.created_at > CALL_LOG_MAX_AGE
    {
        return Err("call context changed".into());
    }
    let text = call
        .event
        .options
        .get(index)
        .ok_or("choice unavailable")?
        .clone();
    if text.is_empty() || text.len() > OPTION_BYTES || text.chars().any(char::is_control) {
        return Err("invalid choice".into());
    }
    if let Some(previous) = &call.reply {
        if previous != &text {
            return Err("call already answered".into());
        }
        return Ok(call);
    }
    call.reply = Some(text.clone());
    call.reply_status = Some("unknown".into());
    record_locked(store, &call)?;
    if let Ok(snapshot) = snapshot(session) {
        let exists = snapshot["panes"].as_array().is_some_and(|panes| {
            panes.iter().any(|p| {
                p["pane_id"].as_str() == Some(pane)
                    && p["workspace_id"].as_str() == Some(&call.event.workspace_id)
                    && p["agent"].as_str().is_some_and(|a| !a.is_empty())
            })
        });
        call.reply_status = Some(
            if exists {
                if request(
                    session,
                    "pane.send_input",
                    json!({"pane_id":pane,"text":text,"keys":["enter"]}),
                )
                .is_ok()
                {
                    "delivered"
                } else {
                    "unknown"
                }
            } else {
                "failed"
            }
            .into(),
        );
    } else {
        // No submission was attempted; an unavailable snapshot is a known failure.
        call.reply_status = Some("failed".into());
    }
    record_locked(store, &call)?;
    Ok(call)
}
