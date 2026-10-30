//! Agent command and skill discovery, projected independently of transcripts.
use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Hash, uniffi::Record)]
pub struct AgentCatalogKey {
    pub host: String,
    pub cwd: String,
    pub agent: String,
    pub version: String,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct AgentCatalogEntry {
    pub name: String,
    pub description: String,
    pub argument_hint: String,
    pub terminal_only: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct AgentCatalog {
    pub key: AgentCatalogKey,
    pub commands: Vec<AgentCatalogEntry>,
    pub skills: Vec<AgentCatalogEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct CatalogFile {
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub skill: bool,
}

fn entry(
    name: &str,
    description: &str,
    argument_hint: &str,
    terminal_only: bool,
) -> AgentCatalogEntry {
    AgentCatalogEntry {
        name: name.trim_start_matches('/').to_owned(),
        description: description.to_owned(),
        argument_hint: argument_hint.to_owned(),
        terminal_only,
    }
}

fn names(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().or_else(|| v.get("name").and_then(Value::as_str)))
        .map(str::to_owned)
        .collect()
}

// These supplement the print-mode registry, which omits interactive commands.
fn claude_terminal() -> Vec<AgentCatalogEntry> {
    [
        ("permissions", "Manage permission rules", ""),
        ("rewind", "Choose a checkpoint to restore", ""),
        ("checkpoint", "Choose a checkpoint to restore", ""),
        ("undo", "Choose a checkpoint to restore", ""),
        ("status", "View session and account status", ""),
        ("login", "Sign in to Claude Code", ""),
        ("resume", "Choose a saved session", "[session]"),
        ("model", "Choose the model", "[model]"),
        ("effort", "Set reasoning effort", "[level]"),
        ("config", "Configure preferences", "[key=value]"),
        ("settings", "Configure preferences", "[key=value]"),
        ("mcp", "Manage MCP connections", "[subcommand]"),
        ("usage", "View usage limits", ""),
        ("cost", "View usage limits", ""),
        ("export", "Export the conversation", "[filename]"),
        ("plugin", "Manage plugins", "[subcommand]"),
    ]
    .into_iter()
    .map(|(n, d, a)| entry(n, d, a, true))
    .collect()
}

fn frontmatter(file: &CatalogFile) -> AgentCatalogEntry {
    let mut result = entry(&file.name, "Custom command", "", false);
    let mut lines = file.content.lines();
    if lines.next() != Some("---") {
        return result;
    }
    let mut field = "";
    for line in lines.take_while(|l| *l != "---") {
        if line.starts_with(char::is_whitespace) && field == "description" {
            if !result.description.is_empty() {
                result.description.push(' ');
            }
            result.description.push_str(line.trim());
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        field = key.trim();
        let value = value.trim().trim_matches(['\'', '"']);
        match field {
            "name" if file.skill => {
                result.name = file.name.rsplit_once(':').map_or_else(
                    || value.to_owned(),
                    |(namespace, _)| format!("{namespace}:{value}"),
                );
            }
            "description" => {
                result.description = if ["|", ">", "|-", ">-"].contains(&value) {
                    String::new()
                } else {
                    value.to_owned()
                }
            }
            "argument-hint" => value.clone_into(&mut result.argument_hint),
            _ => {}
        }
    }
    result
}

pub(crate) fn parse_claude(
    host: &str,
    cwd: &str,
    output: &str,
    files: &[CatalogFile],
) -> Result<AgentCatalog, String> {
    let init = output
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|v| v["type"] == "system" && v["subtype"] == "init")
        .ok_or("Claude init catalog unavailable")?;
    let version = init["claude_code_version"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Claude catalog version missing")?;
    let mut commands: BTreeMap<_, _> = names(&init["slash_commands"])
        .iter()
        .map(|n| (n.clone(), entry(n, "Agent command", "", false)))
        .collect();
    // Known help fills gaps; the host registry still decides ordinary availability.
    for (n, d, a) in [
        ("compact", "Summarize the conversation", "[instructions]"),
        ("clear", "Start a fresh conversation", "[name]"),
        ("context", "View context usage", "[all]"),
    ] {
        if commands.contains_key(n) {
            commands.insert(n.to_owned(), entry(n, d, a, false));
        }
    }
    for c in claude_terminal().into_iter().chain(
        names(&init["terminal_slash_commands"])
            .iter()
            .map(|n| entry(n, "Open in terminal", "", true)),
    ) {
        commands.insert(c.name.clone(), c);
    }
    let mut skills: BTreeMap<_, _> = names(&init["skills"])
        .iter()
        .map(|n| (n.clone(), entry(n, "Agent skill", "", false)))
        .collect();
    for file in files {
        let metadata = frontmatter(file);
        if file.skill {
            // Only enrich discovered skills: installed files may be disabled.
            if let Some(skill) = skills.get_mut(&metadata.name) {
                *skill = metadata;
            }
        } else if let Some(command) = commands.get_mut(&metadata.name) {
            *command = metadata;
        }
    }
    // Skills override builtins, including known TUI names.
    commands.retain(|name, _| !skills.contains_key(name));
    Ok(AgentCatalog {
        key: AgentCatalogKey {
            host: host.into(),
            cwd: cwd.into(),
            agent: "claude".into(),
            version: version.into(),
        },
        commands: commands.into_values().collect(),
        skills: skills.into_values().collect(),
    })
}

// Names and argument support checked against the public rust-v0.165.0 command
// registry and dispatch. Descriptions below are our own UI copy. Feature-gated,
// debug and platform-specific commands are omitted; unknown versions get prompts
// only rather than pretending the 0.165.0 registry is universal.
// https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/tui/src/slash_command.rs
fn codex_builtins(version: &str) -> Vec<AgentCatalogEntry> {
    if version.split_whitespace().last() != Some("0.165.0") {
        return Vec::new();
    }
    [
        ("model", "Select model and effort", "[model]", true),
        (
            "permissions",
            "Select a permission profile",
            "[profile]",
            true,
        ),
        ("config", "Configure preferences", "", true),
        ("presets", "Choose a reusable prompt", "", true),
        ("keymap", "Edit keyboard shortcuts", "[binding]", true),
        ("vim", "Toggle Vim input", "", false),
        ("experimental", "Configure experimental features", "", true),
        ("memories", "Configure memory", "", true),
        ("hooks", "Manage lifecycle hooks", "", true),
        ("review", "Review changes", "[instructions]", true),
        ("rename", "Rename this conversation", "[name]", true),
        ("new", "Create a conversation", "[prompt]", true),
        ("archive", "Archive this conversation", "", false),
        ("delete", "Delete this conversation", "", true),
        ("resume", "Choose a saved conversation", "[session]", true),
        ("fork", "Fork this conversation", "[prompt]", true),
        ("worktree", "Choose a conversation worktree", "", true),
        ("init", "Create project instructions", "", false),
        ("compact", "Summarize the conversation", "", false),
        ("recap", "Summarize recent work", "", false),
        ("plan", "Enter plan mode", "[prompt]", false),
        ("goal", "View or set a goal", "[goal]", false),
        ("agents", "Open the agent overview", "", true),
        ("subagents", "Choose a subagent", "", true),
        ("side", "Start a side conversation", "[prompt]", false),
        ("btw", "Start a side conversation", "[prompt]", false),
        ("copy", "Copy conversation text", "", true),
        ("export", "Export this conversation", "[path]", true),
        ("raw", "Toggle raw scrollback", "[mode]", false),
        ("tui", "Choose terminal presentation", "", true),
        ("diff", "View working changes", "", true),
        ("mention", "Choose a file", "", true),
        ("status", "View session status", "", false),
        ("daemon", "Manage the background server", "", true),
        ("warnings", "View session warnings", "", false),
        ("cd", "Change working directory", "<directory>", false),
        ("pwd", "Show working directory", "", false),
        ("usage", "View account usage", "[period]", true),
        ("debug-config", "View configuration sources", "", false),
        ("title", "Configure terminal title", "[items]", true),
        ("statusline", "Configure status line", "[items]", true),
        ("theme", "Choose terminal theme", "", true),
        (
            "mcp",
            "Inspect MCP connections",
            "[verbose | login <name>]",
            false,
        ),
        ("apps", "Manage connected apps", "", true),
        ("plugins", "Manage plugins", "", true),
        ("logout", "Sign out", "", false),
        ("quit", "Exit Codex", "", false),
        ("exit", "Exit Codex", "", false),
        ("feedback", "Send feedback", "", true),
        ("ps", "List background terminals", "", false),
        ("stop", "Stop background terminals", "", false),
        ("clear", "Start a fresh conversation", "[prompt]", false),
    ]
    .into_iter()
    .map(|(n, d, a, t)| entry(n, d, a, t))
    .collect()
}

pub(crate) fn parse_codex(
    host: &str,
    cwd: &str,
    version: &str,
    output: &str,
    files: &[CatalogFile],
) -> Result<AgentCatalog, String> {
    let result = output
        .lines()
        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
        .find(|v| v["id"] == 2)
        .ok_or("Codex skills catalog unavailable")?;
    let data = result["result"]["data"]
        .as_array()
        .ok_or("Invalid Codex skills catalog")?;
    let mut skills = BTreeMap::new();
    for group in data.iter().filter(|v| v["cwd"] == cwd) {
        for skill in group["skills"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| v["enabled"].as_bool().unwrap_or(true))
        {
            if let Some(name) = skill["name"].as_str() {
                skills.insert(
                    name.to_owned(),
                    entry(
                        name,
                        skill["description"].as_str().unwrap_or("Agent skill"),
                        "",
                        false,
                    ),
                );
            }
        }
    }
    let mut commands = codex_builtins(version);
    commands.extend(files.iter().filter(|f| !f.skill).map(frontmatter));
    Ok(AgentCatalog {
        key: AgentCatalogKey {
            host: host.into(),
            cwd: cwd.into(),
            agent: "codex".into(),
            version: version.trim().into(),
        },
        commands,
        skills: skills.into_values().collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_enriches_namespaced_commands_and_skills_override_builtins() {
        let files = [
            CatalogFile { name: "plugin:ship".into(), content: "---\ndescription: >\n  Ship the\n  change safely\nargument-hint: '[branch]'\n---".into(), skill: false },
            CatalogFile { name: "plugin:guide".into(), content: "---\nname: guide\ndescription: Project guidance\nargument-hint: <topic>\n---".into(), skill: true },
        ];
        let output = r#"{"type":"system","subtype":"init","claude_code_version":"2.1.312","slash_commands":["plugin:ship","plugin:guide","permissions"],"skills":["plugin:guide","permissions"]}"#;
        let catalog = parse_claude("host", "/project", output, &files).unwrap();
        let ship = catalog
            .commands
            .iter()
            .find(|c| c.name == "plugin:ship")
            .unwrap();
        assert_eq!(ship.description, "Ship the change safely");
        assert_eq!(ship.argument_hint, "[branch]");
        let guide = catalog
            .skills
            .iter()
            .find(|c| c.name == "plugin:guide")
            .unwrap();
        assert_eq!(guide.description, "Project guidance");
        assert_eq!(guide.argument_hint, "<topic>");
        assert!(
            !catalog
                .commands
                .iter()
                .any(|c| c.name == "permissions" || c.name == "plugin:guide")
        );
    }

    #[test]
    fn codex_skills_prompts_and_versioned_builtins_stay_separate() {
        let files = [CatalogFile {
            name: "prompts:ship".into(),
            content: "---\ndescription: Ship a change\nargument-hint: <branch>\n---\nDo it".into(),
            skill: false,
        }];
        let catalog = parse_codex(
            "host-a",
            "/project",
            "codex-cli 0.165.0",
            include_str!("agent_catalog/fixtures/codex.jsonl"),
            &files,
        )
        .unwrap();
        assert_eq!(
            catalog
                .commands
                .iter()
                .find(|c| c.name == "prompts:ship")
                .unwrap()
                .description,
            "Ship a change"
        );
        assert!(
            catalog
                .commands
                .iter()
                .any(|c| c.name == "permissions" && c.terminal_only)
        );
        assert!(catalog.commands.iter().any(|c| c.name == "presets"));
        assert!(
            !catalog
                .commands
                .iter()
                .any(|c| ["review-helper", "login", "rewind", "skills"].contains(&c.name.as_str()))
        );
        assert_eq!(catalog.skills.len(), 1);
        assert_eq!(catalog.skills[0].name, "review-helper");
        let other = parse_codex(
            "host-a",
            "/project",
            "codex-cli 0.166.0",
            include_str!("agent_catalog/fixtures/codex.jsonl"),
            &files,
        )
        .unwrap();
        assert_ne!(catalog.key, other.key);
        assert!(!other.commands.iter().any(|c| c.name == "presets"));
        let elsewhere = parse_codex(
            "host-b",
            "/elsewhere",
            "codex-cli 0.165.0",
            include_str!("agent_catalog/fixtures/codex.jsonl"),
            &files,
        )
        .unwrap();
        assert_ne!(catalog.key, elsewhere.key);
    }

    #[test]
    fn claude_init_separates_skills_and_marks_terminal_commands() {
        let catalog = parse_claude(
            "host-a",
            "/project",
            include_str!("agent_catalog/fixtures/claude.jsonl"),
            &[],
        )
        .unwrap();
        assert_eq!(catalog.key.version, "2.1.312");
        assert_eq!(
            catalog
                .commands
                .iter()
                .find(|c| c.name == "compact")
                .unwrap()
                .argument_hint,
            "[instructions]"
        );
        assert!(!catalog.commands.iter().any(|c| c.name == "review"));
        assert!(catalog.skills.iter().any(|s| s.name == "review"));
        for name in ["permissions", "rewind", "status", "login", "doctor"] {
            assert!(
                catalog
                    .commands
                    .iter()
                    .any(|c| c.name == name && c.terminal_only),
                "{name}"
            );
        }
    }
}
