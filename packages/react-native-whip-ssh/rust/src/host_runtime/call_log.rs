//! Foreground call-log catch-up and bounded, generation-guarded tail ownership.
use super::{HostRuntime, HostRuntimeError, notifications::Paths};
use crate::{herdr_connection::ConnectionExecStream, remote_ops::shell_quote};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;

const LIMIT: usize = 1_048_576;

#[derive(Debug, Default)]
struct Buffer {
    pending: Vec<u8>,
    records: Vec<CallRecord>,
    bytes: usize,
    closed: bool,
    seen: HashSet<CallRecord>,
    order: VecDeque<CallRecord>,
}

#[derive(Debug)]
pub(super) struct CallLogStream {
    stream: Arc<ConnectionExecStream>,
    buffer: Arc<Mutex<Buffer>>,
}

fn failure(message: &str) -> HostRuntimeError {
    HostRuntimeError::InvalidConfiguration(message.into())
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
struct CallRecord {
    call_id: String,
    pane_id: String,
    created_at: u64,
    kind: String,
    urgency: String,
    title: Option<String>,
    body: Option<String>,
    requested_urgency: Option<String>,
    ineligible_reason: Option<String>,
    reply: Option<String>,
    reply_status: Option<String>,
}

impl Buffer {
    fn remember(&mut self, record: &CallRecord) -> bool {
        // Remember every observed revision, not just the latest answer: a
        // rotation replays original/claimed/delivered rows for the same call.
        if self.seen.contains(record) {
            return false;
        }
        if self.order.len() >= 16_384
            && let Some(oldest) = self.order.pop_front()
        {
            self.seen.remove(&oldest);
        }
        self.order.push_back(record.clone());
        self.seen.insert(record.clone());
        true
    }
}

fn records(bytes: &[u8]) -> Vec<CallRecord> {
    bytes
        .split(|b| *b == b'\n')
        .filter_map(|line| {
            let record: CallRecord = serde_json::from_slice(line).ok()?;
            (!record.call_id.is_empty()
                && matches!(
                    record.urgency.as_str(),
                    "emergency" | "urgent" | "check" | "record"
                ))
            .then_some(record)
        })
        .collect()
}

impl HostRuntime {
    pub(super) async fn call_log_command(
        &self,
        operation: &str,
        payload: &str,
    ) -> Result<String, HostRuntimeError> {
        match operation {
            "calls-stop" => {
                // Drop outside the state lock: closing an SSH channel may call back.
                let previous = self.inner.state.lock().call_log.take();
                drop(previous);
                Ok("[]".into())
            }
            "calls-read" => {
                let (stream, buffer) = {
                    let state = self.inner.state.lock();
                    let log = state
                        .call_log
                        .as_ref()
                        .ok_or_else(|| failure("Call log is not attached"))?;
                    let stream = log.stream.clone();
                    let buffer = log.buffer.clone();
                    drop(state);
                    (stream, buffer)
                };
                if !stream.is_current() {
                    return Err(failure("Call log stream disconnected; reconnecting"));
                }
                let records = {
                    let mut buffer = buffer.lock();
                    if buffer.closed {
                        return Err(failure("Call log stream disconnected; reconnecting"));
                    }
                    buffer.bytes = 0;
                    std::mem::take(&mut buffer.records)
                };
                serde_json::to_string(&records).map_err(|_| failure("Invalid call log"))
            }
            "calls-open" => {
                let input: Value =
                    serde_json::from_str(payload).map_err(|_| failure("Invalid call log paths"))?;
                let paths: Paths = serde_json::from_value(input["paths"].clone())
                    .map_err(|_| failure("Invalid call log paths"))?;
                if !paths.state.starts_with('/')
                    || paths.state.len() > 4096
                    || paths.state.contains('\0')
                {
                    return Err(failure("Invalid call log path"));
                }
                let path = shell_quote(&format!("{}/calls.jsonl", paths.state));
                let previous = self.inner.state.lock().call_log.take();
                drop(previous);
                // Ordinary writes append; retention compaction replaces the file.
                // Seed deduplication from the snapshot and tail from the start to
                // close the snapshot/subscribe gap without emitting history again.
                let output = tokio::time::timeout(
                    Duration::from_secs(5),
                    self.inner.herdr.execute(&format!(
                        "if test -f {path}; then head -c {} {path}; fi",
                        LIMIT + 1
                    )),
                )
                .await
                .map_err(|_| failure("Call log read timed out"))?
                .map_err(|_| failure("Could not read call log"))?;
                if output.exit_status != Some(0)
                    || output.stdout_truncated
                    || output.stdout.len() > LIMIT
                {
                    return Err(failure("Could not read bounded call log"));
                }
                let initial = records(&output.stdout);
                let mut baseline = Buffer::default();
                for record in &initial {
                    baseline.remember(record);
                }
                let buffer = Arc::new(Mutex::new(baseline));
                let received = buffer.clone();
                let closed = buffer.clone();
                let stream = self
                    .inner
                    .herdr
                    .open_exec_stream(
                        "call-log",
                        &format!("exec tail -n +1 -F -- {path}"),
                        Arc::new(move |bytes| {
                            let mut buffer = received.lock();
                            if buffer.closed {
                                return;
                            }
                            buffer.pending.extend(bytes);
                            if let Some(end) = buffer.pending.iter().rposition(|b| *b == b'\n') {
                                let rest = buffer.pending.split_off(end + 1);
                                let parsed = records(&buffer.pending);
                                buffer.pending = rest;
                                for record in parsed {
                                    if buffer.remember(&record) {
                                        // Count new records, not replayed wire bytes.
                                        buffer.bytes += serde_json::to_vec(&record)
                                            .map_or(LIMIT, |line| line.len() + 1);
                                        buffer.records.push(record);
                                    }
                                }
                            }
                            if buffer.bytes > LIMIT * 2 || buffer.pending.len() > LIMIT {
                                buffer.closed = true;
                                buffer.pending.clear();
                                buffer.records.clear();
                            }
                        }),
                        Arc::new(move |_| closed.lock().closed = true),
                    )
                    .await
                    .map_err(|_| failure("Could not follow call log"))?;
                self.inner.state.lock().call_log = Some(CallLogStream { stream, buffer });
                serde_json::to_string(&initial).map_err(|_| failure("Invalid call log"))
            }
            _ => Err(failure("Unknown call log operation")),
        }
    }
}

// Polled while Calls is open, so look the runtime up without adoption logging.
fn call_log_runtime(runtime_id: String) -> Result<HostRuntime, HostRuntimeError> {
    let inner = super::runtimes()
        .read()
        .get(&runtime_id)
        .cloned()
        .filter(|inner| !inner.state.lock().explicit_disconnect)
        .ok_or_else(|| failure("The host connection closed"))?;
    Ok(HostRuntime { inner })
}

/// Starts following the host's call log and returns what it already holds.
#[uniffi::export]
pub async fn host_call_log_open(runtime_id: String) -> Result<String, HostRuntimeError> {
    let runtime = call_log_runtime(runtime_id)?;
    let discovery: Value = serde_json::from_str(
        &runtime
            .notification_command("discover".into(), "{}".into())
            .await?,
    )
    .map_err(|_| failure("Invalid notification discovery"))?;
    let payload = serde_json::json!({ "paths": discovery["paths"] }).to_string();
    runtime
        .notification_command("calls-open".into(), payload)
        .await
}

/// Rows appended since the last read. Fails once the stream has dropped.
#[uniffi::export]
pub async fn host_call_log_read(runtime_id: String) -> Result<String, HostRuntimeError> {
    call_log_runtime(runtime_id)?
        .notification_command("calls-read".into(), "{}".into())
        .await
}

#[uniffi::export]
pub async fn host_call_log_stop(runtime_id: String) -> Result<(), HostRuntimeError> {
    call_log_runtime(runtime_id)?
        .notification_command("calls-stop".into(), "{}".into())
        .await
        .map(|_| ())
}
