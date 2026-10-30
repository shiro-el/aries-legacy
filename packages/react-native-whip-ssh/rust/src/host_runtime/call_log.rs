//! Foreground call-log catch-up and bounded, generation-guarded tail ownership.
use super::{HostRuntime, HostRuntimeError, notifications::Paths};
use crate::{herdr_connection::ConnectionExecStream, remote_ops::shell_quote};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

const LIMIT: usize = 1_048_576;

#[derive(Debug, Default)]
struct Buffer {
    pending: Vec<u8>,
    records: Vec<CallRecord>,
    bytes: usize,
    closed: bool,
}

#[derive(Debug)]
pub(super) struct CallLogStream {
    stream: Arc<ConnectionExecStream>,
    buffer: Arc<Mutex<Buffer>>,
}

fn failure(message: &str) -> HostRuntimeError {
    HostRuntimeError::InvalidConfiguration(message.into())
}

#[derive(Debug, Deserialize, Serialize)]
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
                let state = self.inner.state.lock();
                let log = state
                    .call_log
                    .as_ref()
                    .ok_or_else(|| failure("Call log is not attached"))?;
                let mut buffer = log.buffer.lock();
                if !log.stream.is_current() || buffer.closed {
                    return Err(failure("Call log stream disconnected; reconnecting"));
                }
                let result = serde_json::to_string(&buffer.records)
                    .map_err(|_| failure("Invalid call log"))?;
                buffer.records.clear();
                buffer.bytes = 0;
                Ok(result)
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
                // The log is atomically replaced by the writer; read a bounded snapshot,
                // then replay from the start in tail to close the snapshot/subscribe gap.
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
                let buffer = Arc::new(Mutex::new(Buffer::default()));
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
                            buffer.bytes += bytes.len();
                            if buffer.bytes > LIMIT * 2
                                || buffer.pending.len() + bytes.len() > LIMIT
                            {
                                buffer.closed = true;
                                buffer.pending.clear();
                                buffer.records.clear();
                                return;
                            }
                            buffer.pending.extend(bytes);
                            if let Some(end) = buffer.pending.iter().rposition(|b| *b == b'\n') {
                                let rest = buffer.pending.split_off(end + 1);
                                let parsed = records(&buffer.pending);
                                buffer.records.extend(parsed);
                                buffer.pending = rest;
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
