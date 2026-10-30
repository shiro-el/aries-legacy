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

### 5. Device-local v2 push alerts by urgency

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
