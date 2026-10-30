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

### 4. Agent command catalog and composer autocomplete

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
