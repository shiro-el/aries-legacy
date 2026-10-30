//! Best-effort discovery over a metadata exec channel, never the pane PTY.
use std::collections::HashMap;
use std::time::Duration;

use serde::Deserialize;

use super::{HostRuntime, HostRuntimeError};
use crate::agent_catalog::{AgentCatalog, AgentCatalogKey, CatalogFile, parse_claude, parse_codex};
use crate::remote_ops::shell_quote;

#[derive(Default)]
pub(super) struct CatalogCache {
    entries: HashMap<AgentCatalogKey, AgentCatalog>,
}

impl CatalogCache {
    fn get(&self, cwd: &str, agent: &str) -> Option<AgentCatalog> {
        self.entries
            .values()
            .find(|catalog| catalog.key.cwd == cwd && catalog.key.agent == agent)
            .cloned()
    }

    fn insert(&mut self, catalog: AgentCatalog) {
        self.entries
            .retain(|key, _| key.cwd != catalog.key.cwd || key.agent != catalog.key.agent);
        if self.entries.len() >= 32 {
            self.entries.clear();
        }
        self.entries.insert(catalog.key.clone(), catalog);
    }
}

#[derive(Deserialize)]
struct Discovery {
    output: String,
    version: String,
    files: Vec<CatalogFile>,
}

impl HostRuntime {
    fn catalog_identity(&self, pane_id: &str) -> Option<(String, String)> {
        let host = self.inner.state.lock().host_state.projection();
        let pane = host
            .snapshot?
            .panes
            .into_iter()
            .find(|pane| pane.pane_id == pane_id)?;
        let agent = pane
            .agent
            .filter(|agent| agent == "claude" || agent == "codex")?;
        let cwd = pane
            .foreground_cwd
            .or(pane.cwd)
            .filter(|cwd| cwd.starts_with('/'))?;
        Some((cwd, agent))
    }
}

#[uniffi::export]
impl HostRuntime {
    pub fn cached_agent_catalog(&self, pane_id: String) -> Option<AgentCatalog> {
        let (cwd, agent) = self.catalog_identity(&pane_id)?;
        self.inner.catalog_cache.lock().get(&cwd, &agent)
    }

    pub async fn refresh_agent_catalog(
        &self,
        pane_id: String,
    ) -> Result<Option<AgentCatalog>, HostRuntimeError> {
        let Some((cwd, agent)) = self.catalog_identity(&pane_id) else {
            return Ok(None);
        };
        let inner = self.inner.clone();
        crate::runtime()
            .map_err(HostRuntimeError::SshTransportFailure)?
            .spawn(async move {
                let _operation = inner.catalog_operation.lock().await;
                let fail = |message: String| HostRuntimeError::InvalidConfiguration(message);
                let script = include_str!("../agent_catalog/discover.py");
                let command = format!(
                    "python3 -c {} {} {}",
                    shell_quote(script),
                    shell_quote(&agent),
                    shell_quote(&cwd)
                );
                let output =
                    tokio::time::timeout(Duration::from_secs(25), inner.herdr.execute(&command))
                        .await
                        .map_err(|_| fail("Catalog discovery timed out".into()))?
                        .map_err(|error| fail(error.to_string()))?;
                if output.exit_status != Some(0) || output.stdout_truncated {
                    return Err(fail("Agent catalog unavailable".into()));
                }
                let discovery: Discovery = serde_json::from_slice(&output.stdout)
                    .map_err(|_| fail("Invalid catalog response".into()))?;
                let catalog = if agent == "claude" {
                    parse_claude(&inner.id, &cwd, &discovery.output, &discovery.files)
                } else {
                    parse_codex(
                        &inner.id,
                        &cwd,
                        &discovery.version,
                        &discovery.output,
                        &discovery.files,
                    )
                }
                .map_err(fail)?;
                inner.catalog_cache.lock().insert(catalog.clone());
                Ok(Some(catalog))
            })
            .await
            .map_err(|error| HostRuntimeError::InvalidConfiguration(error.to_string()))?
    }
}
