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
- **Push is not working yet.** The relay forwards Expo push tokens. Expo tokens
  belong to an EAS project, and the upstream EAS project has no FCM credentials
  for this package. Push needs its own Firebase project (`WHIP_GOOGLE_SERVICES_JSON`),
  its own EAS project with FCM V1 credentials, and its own relay (Q25).
- **Known side effect:** both apps register the `whip://` scheme, so Android may ask
  which app opens such links.
