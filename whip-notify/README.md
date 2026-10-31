# whip-notify

Independent Rust HPKE protocol library and short-lived Herdr notification plugin. No WhipAir dependency, host daemon or listener.

Aries defaults to automatic urgent approval notifications only when the workspace’s main agent is `blocked`. These approvals are logged before lease/delivery handling and always encrypted without plaintext previews. Use `whip-notify policy all-panes` to restore all-pane `blocked`/`done` notifications, or `policy main-approval` to restore the default. `policy` reads the persistent host setting. See the [hook policy details](../docs/remote-notifications.md#automatic-hook-policy-aries).

For legacy status notifications, E2EE is configurable per saved host on each device. New Whip registrations default to readable previews; existing registrations remain encrypted. With encryption off, the hook sends bounded tab/agent/status and available task text alongside the authenticated encrypted routing envelope. With encryption on, it sends only the envelope and the OS shows a generic update. Plugin 0.1.3 adds the preview capability; upgrading preserves host identity and registrations.

See [installation, protocol, leases, relay deployment and security model](../docs/remote-notifications.md).

Whip offers per-host **Install on host** / **Uninstall from host** controls over its existing SSH connection. Installation downloads a version-pinned GitHub Release binary and verifies its SHA-256 checksum. No Rust compiler, Node or Python is needed on the host. This package is also directly installable without a marketplace listing:

```sh
herdr plugin install --yes --ref whip-notify-install-v0.1.7 shiro-el/aries/whip-notify
herdr plugin uninstall dev.whip.notify
```

The host needs Herdr 0.9.5+, Git, curl and either `sha256sum` or `shasum`. Prebuilt targets are **arm64 Linux** (`aarch64-unknown-linux-musl`), **x86_64 Linux** (`x86_64-unknown-linux-musl`), both statically linked, and **Apple Silicon macOS** (`aarch64-apple-darwin`). Whip checks the host architecture and release availability before starting Herdr. Unsupported platforms fail explicitly; installation never silently falls back to compilation. The installer tag contains only the manifest and download scripts, so Herdr does not fetch the app's source and media. Downloads abort when stalled for twenty seconds; Whip bounds installation to three minutes and clears its busy state on failure. Herdr installs plugins globally for the SSH account across its sessions; device push opt-in remains separate. Uninstall preserves configuration for reinstall. Optional marketplace discovery uses the repository's `herdr-plugin` GitHub topic.

To download and link a local checkout:

```sh
sh build.sh
sh install.sh
```

For developers or hosts without a prebuilt binary, build the independent crate explicitly:

```sh
cargo build --release --locked
WHIP_NOTIFY_BINARY="$PWD/target/release/whip-notify" sh install.sh
cargo test --locked
```

The binary supports `paths`, `identity`, `register` (JSON on stdin), `unregister <device-id>`, `lease renew <device-id>`, `hook`, `policy [main-approval|all-panes]`, `call` and explicit administrator `uninstall`. It uses Herdr's `HERDR_PLUGIN_CONFIG_DIR` / `HERDR_PLUGIN_STATE_DIR`; `--dirs <config> <state>` supplies those same discovered paths for authenticated SSH commands outside a hook. The protocol library builds independently using `--no-default-features`.

## Releasing

Run the **Release notification plugin** GitHub Action on the intended revision, or push a `whip-notify-v<VERSION>` tag. `Cargo.toml` and `herdr-plugin.toml` must have matching versions. The action tests this crate and the installer, builds all three host targets, smoke-tests the binaries, and publishes the binaries, their `.sha256` files and the plugin manifest only after all builds pass. It also publishes `whip-notify-install-v<VERSION>`, a parentless commit containing only `whip-notify/{build.sh,platform.sh,skills.sh,call-human/SKILL.md,herdr-plugin.toml}`. Herdr installs from this small tree while the release/source tag retains the full source. Installer tags are immutable: changed contents require a version bump. It uses the repository's GitHub token; no new secrets are required. The plugin release does not replace the mobile app's latest release.

```sh
gh workflow run release-whip-notify.yml --ref main
```

Published releases are never overwritten by the workflow. Bump both version fields for a new release. The mobile core derives its install tag from this package's `PACKAGE_VERSION`. SHA-256 detects corruption and substitution against the downloaded checksum; authenticity trusts HTTPS, the GitHub repository and its release maintainers. This is not an independent code signature.

## Calling the human from an agent

The managed build hook and local `install.sh` install the single repository
[`call-human/SKILL.md`](call-human/SKILL.md) into both
`~/.claude/skills/call-human/` and `~/.agents/skills/call-human/`.
Use `/call-human` in Claude Code or `$call-human` in Codex. The same instructions
cover the four urgency levels, up to three choices, and the main-agent-only
rule. They discover the plugin's executable/config/state through its `paths`
action before invoking `whip-notify --dirs … call …`; no plugin environment
variables need to be inherited by the agent.

The app removes unchanged plugin-owned skills before unlinking the host plugin,
while retaining host identity, registrations and logs. With the CLI, run
`sh skills.sh uninstall` from the plugin source before
`herdr plugin uninstall dev.whip.notify`. A raw Herdr unlink does not run a
cleanup hook. Reinstall/upgrade refreshes owned skills. Install refuses to
replace an existing custom/edited skill or skill symlink; uninstall preserves
these and any extra user files. Ownership is tracked with a private
`.whip-notify` copy of the installed instructions. Install and uninstall share a
short-lived directory lock; after a killed installer, remove an abandoned
`~/.whip-notify-skills.lock` only after confirming no install is running.
