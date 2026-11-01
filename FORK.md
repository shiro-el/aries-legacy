# Fork notes: Aries

This fork of [kosumic/whip](https://github.com/kosumic/whip) ships as **Aries**.
Each change records what changed, why, and how, so upstream merges stay easy.

## Name

Aries (the ram). herdr comes from "herder", and whip is the herder's tool; the
fork keeps the herding theme with the ram that leads the flock.

- The app icon uses this motif: a gold ram whose horn spirals from a `>-`
  prompt, with the Aries constellation on its flank (see change 14).

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

### 11. Background answers from call notification buttons

- **What:** Android call alerts expose their one to three choices as background
  buttons. The same notification reports delivery or failure and keeps pane
  navigation. Approval alerts keep no buttons.
- **Why:** Short agent decisions should be answerable without opening the app,
  while approval interactions remain inside the existing app controls.
- **How:** Expo's registered task handles local action responses without opening
  or decrypting a received envelope again. The app rechecks the registered host
  identity/session over SSH, reuses a live runtime or creates a separate bounded
  connection using saved credentials/jump hosts and existing strict key trust.
  Cold key connections respect biometric requirements and never prompt.
  - Plugin 0.1.6 adds `reply CALL_ID INDEX PANE SESSION`. The host resolves choice
    text from its retained private call log, verifies a fresh agent pane, and
    sends ordinary `pane.send_input` text plus Enter. A durable claim and store
    lock prevent duplicate callbacks from submitting twice. Ambiguous sends stay
    unconfirmed without automatic retries. Complete same-ID records carry
    `reply` and `reply_status` for the call history surface.
  - A scoped Android dismissal stops only the answered notification's alarm.
    The result replaces its identifier without actions. Existing body-tap,
    visible-push fallback, host trust and credential policies remain available.
    No feature code was removed. Native app/host plugin rebuilds are required.
- **Validation:** Jest covers cold and active-runtime action responses, result
  replacement, identity/session failures, no foreground actions, approval
  exclusion and existing body navigation. Binary tests cover exact submitted
  text/Enter, log updates, duplicate/conflicting replies, missing/expired/wrong
  calls, closed panes and ambiguous transport. Screen-off Samsung replies remain
  unverified because real-device use and deployment were prohibited by the brief.

### 12. Separate composer skill sheet

- **What:** Claude Code and Codex composers have a Skills button in both compact
  and expanded layouts. The sheet searches skill names and descriptions, shows
  user/project/plugin provenance, and inserts `/name ` or `$name ` at the caret.
- **Why:** Skills need a discoverable entry separate from command completion,
  without sending a message before the user has finished editing it.
- **How:** The sheet consumes ticket 09's Rust-owned catalog, with optional source
  metadata from Claude file roots and Codex skill scopes. Unreported sources stay
  explicitly unknown. Insertion replaces the selected text and restores the
  caret after the token through the existing uncontrolled composer edit path.
  Shell composers have no skill action. Loading, unavailable, failed and empty
  catalogs have visible states; cached skills remain usable on refresh failure.
  Pane/context changes dismiss the sheet; ordinary typing and sending remain
  available when discovery fails. No existing feature code was removed.
- **Validation:** Jest screen tests over mockWhipSsh cover both invocation syntaxes,
  search, sources, compact/expanded insertion, selection replacement, shell panes,
  failures and pane changes. Rust parser tests cover known and unknown sources.
  Native bindings are regenerated for the optional source field.

### 13. Recoverable phone-first workflow behavior

- **What:** Preserve manual composer toggles across resume, migrate legacy drafts
  without old visibility, and reuse command/skill catalogs for five minutes.
  Repair failed-reply retries, installer recovery, device-version compatibility,
  plain hook wording, call-log following and notification-category cleanup.
- **Why:** Lane review found state resets, abandoned installer locks, blocked
  delivery/retries, incompatible pushes and repeated history/category growth.
- **How:**
  - Apply pane defaults only when the effective mode changes. Commit draft-only
    migration into the v2 key before removing obsolete per-host composer keys;
    existing v2 drafts and preferences take precedence.
  - Share pending catalog discoveries and retain fresh cached catalogs for five
    minutes per runtime/identity. The Claude discovery comment now acknowledges
    ephemeral sessions and possible user SessionStart hooks.
  - Retry only known failed replies; delivered and uncertain claims remain
    at-most-once. Skip corrupt log rows, retain dated newer JSON, and warn without
    blocking new push delivery if history cannot be written. Reply claims still
    require durable recording and unreadable matching history fails closed.
  - Recover dead-PID/empty legacy skill locks, preserve live installers, and warn
    and skip custom/edited/symlinked skill destinations independently.
  - Advertise host v2 capability and register device envelope support only when
    understood by the host. Unversioned registrations receive strict v1 event
    projections with authenticated routing and no unsupported choices. Drop the
    title if necessary to fit v1; skip only legacy recipients whose routing alone
    exceeds v1 padding. Keep modern-device delivery and plaintext-preview policy.
    Plain hook events carry their existing alert wording/body inside encryption.
  - Append ordinary log writes; compact atomically for repair/age/size, leaving
    25% size headroom. Native following deduplicates opening/rotation snapshots
    and counts only new records toward its unread budget, with bounded call-revision memory.
  - Serialize category creation/scheduling and prune categories unused by any
    presented notification on receipts, answers, dismissal and alert setup. This
    also reconciles OS dismissals while JavaScript was stopped.
  - Advance the host plugin to 0.1.7 for the changed binary/installer. No existing
    feature was removed; no release, push, deployment or device run occurred.
- **Validation:** Regression tests cover resume toggles, draft migration/failure,
  catalog TTL, failed-choice retries and uncertain/delivered deduplication,
  malformed/unsafe history, incremental tail output, stale locks and custom
  skills, mixed envelope versions/oversized legacy routes, encrypted hook wording,
  and unused versus active notification categories. Rebuilt native app/host
  plugin and physical Android background-delivery checks remain required.

### 14. Aries app icon and logos

- **What:** The launcher icon, splash logo, status-bar notification icon,
  in-app mark (`assets/whip-mark.png`), Expo `assets/icon.png` and the SSH key
  QR center logo now use the Aries artwork. The final SVG set lives in
  `assets/aries/`.
- **Why:** The fork ships as its own app beside whip, so it needs its own
  identity on the home screen and in notifications.
- **How:**
  - `npm run generate:android-icon` rasterizes everything from `assets/aries/`.
    The SVGs use masks and gradients, which Android VectorDrawable can't
    express, so the generator now writes per-density PNGs instead of a vector.
  - Resource names stay upstream's (`ic_launcher_whip_*`, `whip_launch_logo`,
    `ic_notification_whip`) so manifests and native code merge cleanly. The
    upstream vector XMLs `drawable/ic_launcher_whip_foreground.xml` and
    `drawable/ic_notification_whip.xml` are deleted because a bitmap with the
    same resource name can't coexist with them.
  - The adaptive background is the tile color `#2B2724`. The foreground maps
    the 1024 design onto the 72dp visible viewport, so the ram's bleed ends at
    the launcher mask. A circular mask trims the tip of the constellation.
  - The notification icon keeps the ram's dark body as a white silhouette and
    cuts out the horn, prompt and stars.
  - The upstream whip artwork (`assets/whip-cyborg-hand-concept.svg`) stays for
    the upstream install QR script.
- **Not changed yet:** iOS `AppIcon.icon`.


### 15. Dev client signed with the upload key

- **What:** `-Pwhip.debugUploadSigning=true` signs the debug (dev client)
  build with the upload key instead of the debug keystore.
- **Why:** The debug build shares the release `applicationId`. Signed with the
  debug key it can't install over the release app without wiping its hosts,
  SSH keys and push registration. A UI overhaul needs live Metro reloads on
  the real phone, so the dev client has to replace the release app in place.
- **How:** The flag is off by default and falls back to the debug keystore
  when no upload keystore exists. Reinstalling a release APK afterwards goes
  back to the normal app with the same data.

### 16. UI layer removed for a rebuild

- **What:** Deleted every screen and component (`src/components/`, including
  the `ui/` primitives, and the `src/browser/*.tsx` screens), the colour and
  spacing tokens (`src/theme.ts`, `src/lib/theme.ts`, `src/lib/diffColors.ts`,
  `global.css`), the styling toolchain (NativeWind, Tailwind,
  `tailwindcss-animate`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `@rn-primitives/*`, `components.json`, `src/lib/utils.ts`)
  and the 59 tests that rendered those screens. `App.tsx` now only hides the
  launch screen and renders an empty view.
- **Why:** Deleted rather than hidden, against the fork's usual rule. The UI
  is being redesigned from scratch, and the old screens kept pulling the new
  design back toward their structure. Keeping them in the tree, even unused,
  defeated the rebuild. Git history keeps them.
- **How:** `src/hooks`, `src/services`, `src/lib`, `src/billing`, the
  non-UI `src/browser/*.ts` modules, locales and every native package stay.
  They don't import any removed module. `lib/terminalSearch.ts` now declares
  its own `SearchCandidate` type, which used to live in the chat search bar.
  Native UI modules (`@callstack/liquid-glass`, `expo-blur`,
  `@shopify/flash-list`, `react-native-svg`, `react-native-reanimated`,
  `lucide-react-native`, CodeMirror) stay installed until the new UI decides
  whether to use them.

### 17. New task and command/skill entries in the rebuilt UI

- **What:** Herd has a New task button. Its sheet picks a host, a folder
  (recent task folders, folders of open panes, or a remote folder browser),
  the first pane (Claude Code, Codex or Shell), model and effort shortcuts
  with a custom model ID, and the workspace name. An agent task opens its
  chat with the caret in the composer; a shell or a failed agent start opens
  the terminal. The chat composer lists the agent's commands when a message
  starts with `/`, and a separate Skills button opens a searchable sheet that
  inserts `/name` (Claude) or `$name` (Codex) at the caret. Sending a
  terminal-only command opens the terminal.
- **Why:** Brings decisions Q23 and Q22b, built headless in entries 5, 10 and
  12, back onto the new screens.
- **How:** `createWorkspace` takes an optional `onOpen` so the new UI shows the
  pane itself instead of the old terminal handoff. `useAgentCatalog` now takes
  a plain `{ key, paneId, native }` source instead of a terminal render
  target. Model and effort shortcuts come from `claude --help` 2.1.316 and
  `codex debug models` 0.165.0. A blank choice passes no flag. `~` paths are
  resolved against the remote home before browsing or creating.

### 18. Calls tab and alert settings in the rebuilt UI

- **What:** A Calls tab lists every connected host's retained calls and
  approvals, newest first, with urgency filters, reply status and a count of
  calls since the tab was last opened. Rows and a foreground banner open the
  call's pane. Hosts gains a "This phone" section (agent alerts, keep ringing,
  ring duration, Android permission) and a per-host Alerts sheet (host plugin
  install/update/remove, push registration, end-to-end encryption). The
  default relay is now `https://notify.aries.shiroel.com`.
- **Why:** Brings entries 9 and 4–8 back onto the new screens after entry 16
  removed them, and stops new registrations from defaulting to upstream's
  relay, which cannot reach this application ID.
- **How:** `services/callLog.ts` wraps the existing `calls-open`, `calls-read`
  and `calls-stop` notification commands and merges revisions by call ID.
  `ui/calls/useHostCalls.ts` follows every bound notification runtime while
  the app is in the foreground, reopens dropped streams, and announces only
  calls that arrive while following. The core's `more` tab id is the Calls tab.
- **Plugin source:** the in-app installer, `whip-notify/build.sh` and the
  release workflow now use `shiro-el/aries/whip-notify` and this fork's
  releases. Upstream never published 0.1.7, the first version with the call
  log, so hosts on upstream 0.1.4 update from here. The app needs a native
  rebuild to pick up the new source.

### 19. Device speech recognition removed

- **What:** The Android/iOS recognizer path is gone: `expo-speech-recognition`
  and its config plugin, `composerSpeechInput`, `useComposerSpeechInput`, the
  native `ComposerDictation` state machine and `append_composer_dictation`.
  Context-word extraction survives as Rust `transcription_context`.
- **Why:** An exception to keeping upstream code hidden rather than deleted:
  the recognizer misheard Korean mixed with English identifiers, and a second
  microphone path beside Groq Whisper (entry 20) would compete for the same
  button and audio session.
- **How:** `expo-audio`'s config plugin now owns `RECORD_AUDIO`
  (`enableBackgroundPlayback: false`, so no media service is added). The
  read-aloud focus flag `speechInputFocus` stays; recording sets it. UniFFI
  bindings are regenerated. `chatSpeech` is untouched.

### 20. Groq Whisper voice input and Haiku polish

- **What:** The agent composer has a Voice button. Tap to record (AAC, 16 kHz
  mono, ten-minute limit), tap Stop, and the phone sends the file to Groq
  `whisper-large-v3` (`language=ko`). The text lands at the caret and is never
  sent automatically. The latest transcript can be polished by Claude Haiku on
  the pane's host and restored to what was said. Hosts → This phone holds the
  Groq API key.
- **Why:** Round 8 of the design notes (V1–V12): typing on a phone is slow,
  and dictated thoughts carry fillers and misheard identifiers that blur what
  the agent receives.
- **How:** `services/voiceInput.ts` is the record → transcribe state machine;
  a failed transcription keeps its one recording for Retry/Discard, also
  across a detour to the key setting (leaving the chat only closes the
  microphone), and leftover `voice-input-*` files are deleted on the first
  composer of a process. The prompt is the context words of the draft and the
  last ten messages, cut to 224 UTF-8 bytes, which bounds Whisper's 224-token
  window. The
  key lives only in the keychain (`aries.groq-api-key.v1`). Polish runs
  `claude -p --model haiku` in the pane's folder through the login shell with
  `--tools Read,Grep,Glob`, `--strict-mcp-config` and `--setting-sources ''`
  (so user hooks do not report it as an agent turn). The passage, the rest of
  the draft and the last six messages go over stdin through the new
  `HostRuntime.execute_with_input`, which closes its SSH channel when the
  phone gives up (the host also wraps Claude in `timeout 35`). The reply must
  be exactly one `<polished>` block; anything else, a missing `claude`, or 30
  seconds without an answer leaves the transcript unchanged. Editing inside the passage, sending, or
  dictating again withdraws Polish and Original; edits elsewhere move it.
- **Validation:** Jest covers the Groq client, the state machine (fake
  recorder and fetch), the key setting, composer insertion, recording bar,
  key and permission notices, retry/discard, passage tracking, restore and
  polish failures, and runs the polish command through `/bin/sh` with a stub
  `claude`. Three representative dictations were polished by real Haiku
  without being carried out.
