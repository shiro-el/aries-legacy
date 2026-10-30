# Fork notes: Aries

This fork of [kosumic/whip](https://github.com/kosumic/whip) ships as **Aries**.
Each change records what changed, why, and how, so upstream merges stay easy.

## Name

Aries (the ram). herdr comes from "herder", and whip is the herder's tool; the
fork keeps the herding theme with the ram that leads the flock.

- Reuse this motif for the app icon later (Q26-7 UX redesign). The launcher
  icon is still upstream's whip icon.

## Changes

### 1. Personal application ID and launcher name

- **What:** `applicationId` is `io.github.shiroel.aries`, and the launcher label is
  "Aries".
  - `android/app/build.gradle`: `applicationId`
  - `app.json`: `name`, `android.package`
  - `android/app/src/main/res/values*/strings.xml`: `app_name`
- **Why:** It installs beside the Play Store build of whip. It also needs its own
  Firebase and EAS projects for push.
- **How:** Only `applicationId` changes. `namespace` and the Kotlin package stay
  `io.github.kaminarios.whip`, so native sources match upstream and merge cleanly.
- **Not changed yet:**
  - iOS `bundleIdentifier`: this fork targets Android only.
  - `extra.eas.projectId`, `owner`, and the relay URL.
- **Push needs separate setup:** the relay forwards Expo push tokens, and Expo
  tokens belong to an EAS project. The upstream EAS project has no FCM
  credentials for this package. See change 2.
- **Known side effect:** both apps register the `whip://` scheme, so Android may ask
  which app opens such links.

### 2. Own push stack and signing key

- **What:** Aries uses its own Firebase project, EAS project, notify relay, and
  upload signing key.
  - `app.json`: `slug` is `aries`, `owner` is `jae0406`, and
    `extra.eas.projectId` points to the `@jae0406/aries` EAS project.
  - `notify-relay/cloudflare.config.ts`, `notify-relay/wrangler.jsonc`: the
    account is our own, the Worker is `aries-notify`, the D1 database is
    `aries-notify`, and the domain is `notify.aries.shiroel.com`.
- **Why:** Push from upstream's stack can't reach a different application ID
  (see change 1).
- **How:**
  - Firebase project `aries-1857d` registers `io.github.shiroel.aries`.
  - The service account `aries-expo-push` holds only the
    *Firebase Cloud Messaging API Admin* role. Its FCM V1 key is stored in Expo
    only and is not kept on the build server.
  - Expo's credential flow requires an Android upload keystore, so it holds a
    throwaway placeholder keystore. Aries never signs with it; don't use EAS
    cloud builds without replacing it.
  - Build inputs live outside the repo in `~/.config/aries/` (0700). Source
    `aries.env` before building:
    - `WHIP_GOOGLE_SERVICES_JSON`
    - `WHIP_NOTIFY_RELAY_URL`
    - `WHIP_UPLOAD_KEYSTORE_PROPERTIES`, which points to the `aries-upload.p12`
      signing key. Back this key up: losing it means reinstalling and losing
      app data.

    ```sh
    set -a; . ~/.config/aries/aries.env; set +a
    nix develop -c sh -c 'cd android && ./gradlew assembleRelease -Pwhip.skipR8=true -PreactNativeArchitectures=arm64-v8a'
    ```
  - Relay deploy: `(cd notify-relay && nix develop .. -c npx cf deploy)`. Apply new
    migrations first with `cf d1 migrations apply 4fa5c576-d2e6-4c73-9006-76505724bf36 --dir migrations`.
- **Not changed yet:** the relay's generic E2EE notification title is still
  "Whip" (`notify-relay/src/index.ts`).

### 3. Pane-aware Chat and composer defaults

- **What:** Detected agent panes open Chat View with the composer visible. Shell
  panes open Terminal View. The Chat/Terminal button switches both presentation
  and input in one tap, preserving the pane's draft.
- **Why:** Phone conversations should be ready to type into, while shell panes
  keep direct terminal input. A choice in one pane must not change another pane.
- **How:** The existing target-specific composer store now records an optional
  explicit `inputMode`. Without a choice, agent detection determines the mode,
  including when an agent starts or exits. Existing transcript preload, viewport,
  reconnect and terminal renderer lifecycles remain in use.
  - Composer records use `aries.terminal.composers.v2.<host>`; the Rust app-data
    allowlist accepts this family. Upstream `whip.terminal.composers.v1.<host>`
    records stay on disk but are not read by composer persistence, so old closed
    composer values cannot suppress the new default. This also starts fresh
    drafts under the new key; no old records are deleted or migrated.
  - Explicit Terminal choices persist even with an empty draft. Automatic
    defaults never become explicit preferences, so untouched panes follow agent
    start/exit changes. Notification and Herd navigation share this pane behavior.
- **Validation:** Jest screen coverage exercises defaults, live agent changes,
  one-tap switching, drafts, independent panes and late preference restoration;
  persistence coverage checks restarts and ignoring upstream records.

### 4. Explicit host calls and notification envelope v2

- **What:** `whip-notify call` accepts urgency, title, body and up to three
  choices, and writes a private host call log. Notifications can carry `call`
  or `approval` metadata in envelope v2; the app still decrypts v1 envelopes.
- **Why:** The main agent needs to ask for human attention explicitly, and all
  calls must remain available even when pushes are suppressed or fail.
- **How:**
  - The command reads pane/session identity from Herdr environment variables
    and verifies the first pane of the workspace's first numbered tab through
    `session.snapshot`. Other or unverifiable callers become `record` entries
    marked `자격 없음` (ineligible).
  - `$HERDR_PLUGIN_STATE_DIR/calls.jsonl` retains the newest 1 MiB and 30 days.
    Writes use the existing private, atomic, locked storage path. Recording
    precedes leases and delivery, so a relay error cannot erase a call.
  - V2 adds kind, urgency, body, options and call ID to authenticated plaintext,
    retaining the HPKE suite and authenticated version header. Padding grows
    from 1024 to 2048 bytes; v1 retains its original framing. The relay and
    native reader accept both versions. Calls always omit plaintext previews
    and use the existing visible push path; urgency channels and reply buttons
    are separate work. Legacy preview preferences remain available.
  - App taps reuse authenticated host/pane routing and fresh target resolution.
    See `docs/remote-notifications.md` for the command and log contract.

### 5. Phone-first new task setup

- **What:** Herd's new task action chooses a folder, then Claude Code, Codex, or
  a shell. Agent tasks offer model shortcuts, a custom model ID, and effort.
  The folder name pre-fills the workspace label. Workspace rename keeps its
  existing editor; the old creation editor and operation remain in the code.
- **Why:** Starting work from a phone should not require typing agent commands
  or leave an unused shell beside the main agent.
- **How:** Folder suggestions use all open panes on the selected host plus its
  20 most recent task folders. The existing remote file manager has a folder
  selection mode. Recent folders and each agent's model/effort persist under
  `whip.new-task.v1.<saved-host-id>` in the Rust-owned application database.
  A blank model uses the remote agent's default. React Native passes typed
  argument arrays (`--model`/`--effort` for Claude, `-m`/`-c` for Codex).
  Rust's `create_workspace_with_launch` uses the first pane returned by
  `workspace.create`, with no additional tab or pane. Successful agent tasks
  select Chat and open the composer. Typed partial failure opens the original
  pane and shows the launch error, so retrying setup cannot duplicate the task.
  UniFFI TypeScript/C++ bindings are regenerated from the Rust library.

### 6. Main-agent approval hook policy

- **What:** Automatic host pushes now report only the main agent's `blocked`
  status as an `urgent` `approval`, with a call ID and a retained call-log entry.
  Main-agent `done` and other panes' status changes stay quiet.
- **Why:** Completion and other requests for attention belong to explicit agent
  calls. Routine subagent status changes should not interrupt the phone user.
- **How:** The hook reuses `call`'s Herdr snapshot verification of the first pane
  in the workspace's lowest-numbered tab. Missing/unverifiable topology suppresses
  automatic notifications. Recording precedes lease checks and delivery, so
  active-app suppression and relay failures retain the approval. Approval events
  carry no choices and omit plaintext previews, and taps use the existing
  authenticated host/pane navigation and in-app interaction controls.
  - The previous all-pane `blocked`/`done` path remains behind the persistent
    host setting `whip-notify policy all-panes`; `policy main-approval` restores
    the default. `policy` reads the current setting. The private atomic
    `hook-policy.json` configuration is shared across that installation's
    sessions and survives unregister/uninstall/reinstall, like host configuration.
  - Legacy mode preserves the old event format and preview preferences. Unknown
    or unsafe policy files fail closed rather than enabling legacy delivery.
- **Validation:** Binary tests use fixture Herdr sockets and a local relay endpoint
  to check both policies, suppression, approval records, active leases, failed
  delivery, and resetting/invalid settings. Existing app navigation and screen
  tests cover authenticated taps, fresh pane resolution and pane interaction.

### 7. Shared call-human skill for Claude Code and Codex

- **What:** Both agents receive the same `call-human` skill through the existing
  host notification installer. App uninstall also removes the installed skills.
- **Why:** The main agent needs consistent guidance for explicit human calls,
  urgency and answer choices, while subagents should report to their coordinator.
- **How:** One `whip-notify/call-human/SKILL.md` defines all four urgency levels,
  up to three options, main-agent eligibility, and discovery of the existing
  `paths` action before running `call`. The build hook and local installer copy
  it into `~/.claude/skills` and `~/.agents/skills`. A shared shell lifecycle script
  tracks ownership, preserves custom/edited skills and extra user files, and
  serializes concurrent operations. The app runs its cleanup over authenticated
  SSH before Herdr unlink; host configuration and call logs remain intact.
  - Plugin version 0.1.5 includes the skill and lifecycle script in its immutable
    minimal installer tree. No release, deployment or real-phone use is included.
- **Validation:** Black-box installer tests cover both agent destinations, local
  installation, reinstall, safe removal, custom/edited/symlink preservation,
  concurrent installs and immutable installer packaging. Real-phone delivery
  remains an acceptance check for the provisioned stack.

### 8. Device-local v2 push alerts by urgency

- **What:** V2 envelopes travel as high-priority data pushes and become local
  Android notifications after authentication and durable replay receipt.
- **Why:** Calls and approval requests need different levels of attention while
  keeping their content and urgency inside the encrypted envelope.
- **How:** An Expo notification task loaded from the app entry point handles
  foreground, background and cold JS receipt. It shares the pinned-key,
  registration and replay queue with legacy tap handling. Local alerts carry
  only their authenticated navigation target, so tapping does not decrypt an
  already-received envelope again.
  - Emergency uses the existing persistent/DND channel and native alarm path
    (shake cancellation and 30-second timeout). Urgent uses the high-importance
    brief sound/vibration channel; check uses regular; record stays silent.
    The native arm promise now settles on stop, keeping a cold Expo task/runtime
    alive through the alarm instead of destroying it two seconds after arming.
    Existing foreground alerts still arm without blocking their caller.
  - V2 preview-enabled registrations use the same local rendering path. The
    relay discards v2 readable previews and never receives plaintext urgency.
    V1 and registration verification pushes keep their visible behavior.
  - The existing visible delivery code remains available for v2 with relay
    `VISIBLE_PUSH_FALLBACK=true`. The app skips background rendering of visible
    pushes. No existing feature code was removed.
  - `expo-task-manager` requires a new Android native build. Relay deployment,
    Samsung terminated/Doze receipt, silent/DND emergency behavior and watch
    mirroring remain unverified: this run prohibited deployment and real-device
    use. See `docs/remote-notifications.md` for rollout and fallback details.
- **Validation:** Relay SQLite and Workers runtime tests cover opaque v2 data,
  v1 compatibility and visible rollback. App tests cover urgency channels,
  native alarm arming, replay/concurrent/cold receipt, failure suppression,
  foreground silence and local tap navigation.

### 9. Host call history and foreground calls

- **What:** More → Call log shows each host's retained calls and approvals,
  newest first, with effective urgency, time, pane, title/body, ineligibility and
  reply text. Urgency filters and rows open the recorded pane through fresh host
  state. Connected hosts surface new calls in an in-app banner while foreground.
- **Why:** Lease-suppressed calls and calls received while the phone was offline
  must remain visible without depending on push delivery.
- **How:** The existing authenticated notification runtime discovers the plugin
  state directory. Rust reads a bounded `calls.jsonl` snapshot and owns a
  generation-guarded `tail -n +1 -F` SSH stream, frames JSONL bytes and validates
  records before exposing them through notification commands. Snapshot replay
  closes the subscription gap; call IDs deduplicate rotation/reconnect replay.
  The foreground consumer drains the native buffer each second, pauses in the
  background, cleans up on detach, and retries after failures. Initial history
  stays silent; `record` entries never show banners. No remote log is deleted.
- **Validation:** Jest screens over mockWhipSsh cover history, approval/reply
  display, urgency filtering, host/pane navigation, ineligible records,
  foreground deduplication, background cleanup and reconnect catch-up.

### 10. Agent command catalog and composer autocomplete

- **What:** Agent composers offer command-only `/` completion with descriptions,
  argument hints and a terminal-only label. Choosing a command inserts `/name `;
  sending a terminal-only command opens Terminal after successful delivery.
- **Why:** Phone users can discover commands without mixing them with skills or
  losing access to CLI menus. Shell input and ordinary composer messages retain
  their existing behavior when discovery is unavailable.
- **How:** Rust owns a bounded, per-host cache keyed by cwd, agent and version,
  with typed command and skill projections. Opening a pane reads its cached
  catalog and refreshes it in the background. Discovery uses a separate SSH exec
  channel and an optional Python 3 helper, never the interactive pane channel.
  - Claude uses the read-only `/status` print-mode `system/init` with session
    persistence disabled. Its skills are removed from commands, including skill
    overrides of known builtins. User, ancestor-project and installed-plugin
    frontmatter enriches discovered entries; known interactive commands fill
    omissions in print-mode discovery.
  - Codex uses app-server initialization and `skills/list`, direct user prompt
    files, and a curated command registry for verified version 0.165.0. Other
    versions expose discovered prompts and skills while their builtin commands
    stay hidden until a version-specific registry is verified. The `/skills`
    menu stays hidden from command completion for the separate skill entry.
  - Discovery processes have time, output and file-scan limits and are killed
    after metadata arrives. Missing Python or CLI discovery failures disable
    completion without blocking typing, sending or queued retries. Cache entries
    live only in the owning Rust runtime; no host catalog contents are persisted.
- **Validation:** Rust fixtures cover command/skill separation, namespace-aware
  frontmatter, interactive labels and version keys. Jest screen tests cover
  filtering, caret position, insertion without sending, shell panes, failed/late
  discovery, and successful versus failed terminal-only delivery.
