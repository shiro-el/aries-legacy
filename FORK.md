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

### 7. Host call history and foreground calls

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
