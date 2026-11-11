# Phase 6 report — native Flutter app (Android and iOS)

**Commits:**

- `41f1484`: backend and web admin support for the app (offline mission packs, notifications).
- `a808d03`: the Flutter app (core, offline engine, all 15 modules).
- `77e12fa`: unit and widget tests, plus fixes they found.
- `10cddbf`: end-to-end test of the real app against the real backend.
- `3331af8`: Android and iOS release configuration.

**Stack:**

- Flutter 3.47, Riverpod, Dio, GoRouter.
- SQLite (drift), Flutter Secure Storage, Firebase Cloud Messaging.
- Repository pattern, feature folders.

The app is native Flutter, not a WebView. It uses the same Express API as the website. The only backend additions were general-purpose API features (packs, version check at sync, notifications), with no mobile-only business logic.

| Gate                                     | Result                                                                                       |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `flutter analyze`, `dart format`         | Clean                                                                                        |
| Flutter unit and widget tests            | 42 passing                                                                                   |
| Flutter end-to-end (real app ↔ real API) | 1 passing (Linux desktop build, real MongoDB)                                                |
| Release-mode compile                     | Obfuscated AOT release build succeeds (Linux target)                                         |
| Android APK / AAB build                  | **Not run here:** the Android SDK download host is blocked in this environment; CI job added |
| iOS build                                | **Not run here:** needs macOS; CI job added                                                  |
| Backend tests                            | 253 passing                                                                                  |
| Web tests                                | 27 unit/component and 25 browser tests passing (run with `41f1484`; no web changes since)    |
| Monorepo lint, typecheck, format         | Clean                                                                                        |

## 1. Modules

All 15 requested modules are built and reachable:

1. splash;
2. onboarding (with learner level);
3. authentication (guest, sign-in, registration, guest upgrade, password reset);
4. dashboard;
5. Story Mode;
6. Clinical Challenge;
7. clinical gameplay (online and offline);
8. AI debrief (consent, level, polling, report, flagging);
9. Hospital Commander;
10. country expansion;
11. profile;
12. achievements;
13. learning history;
14. notifications inbox and push;
15. settings (profile, downloads, sync status, connection status).

**Layout.** Phones get a bottom navigation bar; screens 840 px and wider get a side rail.

**Design.** Follows the website's design system:

- the same colours, fonts (bundled, OFL-licensed), kente strip and pop-card style;
- the prototype's hero illustration;
- native page transitions (predictive back on Android, Cupertino on iOS).

## 2. Offline play, and how it keeps the answer key off the phone

**Downloads.**

- An admin marks a case "Available offline" (off by default).
- Players can then download it.
- A pack contains the story and the choices, but no correct answers, feedback or critical flags.

**Playing offline.**

- Answers and reasoning are stored in SQLite and queued for sync.
- The player sees "feedback after sync", never a verdict.

**Syncing.**

- The queue uploads automatically when the connection returns, when the app resumes, and every 60 s while anything is waiting.
- It sends ordered batches with an idempotency key, so a retried upload can't be applied twice.
- The server scores the attempt, then reveals feedback and awards rewards.

**Retries.**

- Network failures wait without counting as failures.
- Server errors back off exponentially (5 s to 5 min) and stop after 8 attempts.
- "Sync now" re-queues stopped items.

**Conflicts.** If clinicians published a new version of the case after the download, the server rejects the attempt. The player sees the reason and a link to the current case. The pack is then refreshed or removed.

**Offline sessions.**

- A signed-in player stays signed in offline, using the cached profile and data.
- Cached data is stored per user.
- Signing out, or signing in as someone else, first tries to upload pending answers, then clears that player's local data.

**AI debriefs** are online only and say so.

## 3. Testing

**Unit tests (sync and data layer).**

- Queue order and payloads.
- Idempotency key reused on retry.
- Network deferral versus server-error backoff and give-up.
- Immediate send on reconnect.
- Conflict handling.
- Single upload under concurrent calls.
- Cache fallback scoped per user.
- Pack refresh and removal.
- Packs carry no answer data.
- Push links never open staff pages.
- Release builds require an https API URL.

**Widget tests (the full app with an in-memory fake API).**

- Onboarding, then welcome, then guest, then dashboard.
- Restoring the session offline.
- Download, then offline play (no feedback shown), then automatic sync, then the server's score and feedback, then the debrief with consent.
- Sign-in validation and server errors.
- Switching accounts.
- Commander limits.
- The sync status screen and a version conflict.
- Every screen rendered at 360, 800 and 1280 px with no layout errors.

**End-to-end test (`scripts/mobile/run-e2e.sh`, also in CI).**

- The real app (real HTTP, secure storage, SQLite file) runs as a Linux desktop build against the real backend and MongoDB.
- A guest downloads a case, the connection is cut, and they play the whole case.
- On reconnect the attempt syncs, and the app shows the server's score.

I also checked the database: the server recorded a completed mobile attempt, scored 25/50, +25 HP.

**Test data.** The case is approved by a test-only fixture (`apps/backend/test/fixtures/mobile-e2e.ts`), the same shortcut the backend integration tests use. It is labelled "Test fixture — not a clinical approval". It refuses to run in production or against a database without "e2e" in its name. The real clinician approval flow is covered by the website's browser journey.

**Bugs the tests found (all fixed):**

1. After an offline failure, reconnecting waited for the retry timer instead of syncing immediately.
2. Signing out or switching accounts could discard unsynced offline answers without trying to upload them.
3. Three layouts overflowed on narrow phones: the home title, the learner-level dropdowns and the onboarding footer.

## 4. Release configuration

**Android.**

- **Signing:** upload key from an untracked `android/key.properties` or `AHQ_UPLOAD_*` CI variables; see `key.properties.example`. Without one, release builds are debug-signed with a warning, and Google Play rejects those.
- **Build:** R8 and resource shrinking; minimum Android 7.0 (API 24).
- **Network:** plain HTTP is allowed only in debug builds.
- **Notifications:** notification permission and a default "Game updates" channel.
- **Firebase:** applied only if `google-services.json` is present (it is git-ignored).
- **Backups:** cloud backup and device transfer exclude the token and local data.
- **Branding:** app name and cream launch screen.

**iOS.**

- Push entitlement and the background mode for remote notifications.
- Cream launch screen.
- `GoogleService-Info.plist` is git-ignored and optional.
- Minimum iOS 15.

**Both.** `scripts/mobile/build-release.sh android|ios`:

- refuses a non-https `API_BASE_URL`;
- builds obfuscated AAB/APK or IPA;
- keeps debug symbols in `build/symbols`.

The app also refuses to start in release mode without an https API URL.

## 5. Performance measures

**Startup.**

- Sync, push and connectivity start after the first frame.
- The splash only waits for the session check.

**Images.**

- Decoded at display size (`cacheWidth` / `memCacheWidth`).
- Network images are cached on disk.
- The hero image was resized to 900 px.

**Database and API.**

- SQLite runs in WAL mode, and lookups use primary keys.
- Lists are cached per user, so screens open instantly offline.
- Screen data providers are released when the screen closes.

**Battery.**

- No timers while idle: the retry timer runs only while items are waiting, and debrief polling only while that screen is open.
- Push replaces polling for notifications.

These measures are in the code but have not been profiled on a real device (see §6).

## 6. Not verified, and decisions needed

**Not verified**

1. **Android build.** The environment's network policy blocks `dl.google.com`, which serves the Android SDK, so no APK or AAB was built here. To build in this environment, add `dl.google.com` to the environment's allowed domains. The CI `mobile` job builds debug and release APKs on GitHub's runners, but CI has never run because no repository is connected.
2. **iOS build.** This needs macOS; the CI `ios-build` job builds debug and release without signing. The Xcode project was edited by hand (entitlements setting) and has not been opened in Xcode.
3. **Real push delivery.** FCM was tested only with the backend's fake sender. No Firebase project or config files exist yet.
4. **Real devices and profiling.** Nothing has run on a physical phone, emulator or simulator. Release testing on devices (install, cold start, offline toggling, push, battery) is still to be done.
5. **Firebase build plugin.** The `com.google.gms.google-services` plugin 4.4.2 with Android Gradle Plugin 9 has not been build-tested.

**Decisions needed before store submission**

6. **App identifiers.** `org.africahealthquest.africa_health_quest` (Android) and `org.africahealthquest.africaHealthQuest` (iOS) were set in Phase 3. They can't be changed after the first store release; please confirm them.
7. **App icon and store artwork.** The launcher icons are still Flutter's defaults, and the store listing graphics don't exist. They need real artwork; I haven't made any up.
8. **Firebase projects** (development and production), the Android upload keystore, and the Apple team and provisioning profiles.
9. **Apple export-compliance answer.** The app uses only standard HTTPS. Please confirm before submission.
