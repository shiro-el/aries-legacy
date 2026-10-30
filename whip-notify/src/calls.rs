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
    Ok(CallRecord {
        event: NotificationEvent {
            pane_id: pane.into(),
            workspace_id: workspace.into(),
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
    })
}

fn snapshot(session: &str) -> Result<Value> {
    let mut stream = UnixStream::connect(session)?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    let id = uuid::Uuid::new_v4().to_string();
    writeln!(
        stream,
        "{}",
        json!({"id":id,"method":"session.snapshot","params":{}})
    )?;
    let mut bytes = Vec::new();
    BufReader::new(stream)
        .take(4_194_305)
        .read_until(b'\n', &mut bytes)?;
    if bytes.len() > 4_194_304 || bytes.last() != Some(&b'\n') {
        return Err("invalid snapshot size".into());
    }
    let response: Value = serde_json::from_slice(&bytes)?;
    if response["id"] != id || response["result"]["type"] != "session_snapshot" {
        return Err("invalid snapshot response".into());
    }
    Ok(response["result"]["snapshot"].clone())
}

pub fn record(store: &Store, call: &CallRecord) -> Result<()> {
    let _lock = store.lock()?;
    let path = store.state.join("calls.jsonl");
    let mut lines = Vec::new();
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
            if entry.created_at >= call.created_at.saturating_sub(CALL_LOG_MAX_AGE) {
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
