# Mobile release guide (Android and iOS)

**Status:**

- The app code, release configuration and CI build jobs exist.
- **No Android or iOS build has been run, installed or tested on a device yet.**
- Store listings, icons and signing keys don't exist yet.

Do everything in §4 before the first store submission.

## 1. Identifiers and versions

| Item           | Value                                                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Android app ID | `org.africahealthquest.africa_health_quest`. **Permanent after the first Play upload; confirm before release**                   |
| iOS bundle ID  | `org.africahealthquest.africaHealthQuest`. **Permanent after the first App Store upload; confirm**                               |
| Version        | `apps/mobile/pubspec.yaml` `version: <name>+<build>`. Bump the build number on every upload                                      |
| Minimum OS     | Android 7.0 (API 24), iOS 15                                                                                                     |
| Forced update  | The backend's `MIN_APP_VERSION_ANDROID` / `_IOS`, returned by `GET /api/v1/catalog`. Raise it when an API change needs a new app |

## 2. One-off setup

### Android

1. Create the app in the Google Play Console and enrol in **Play App Signing**.
2. Create an **upload key** (keep it offline and back it up; never commit it):

   ```bash
   keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 4096 -validity 10000 -alias upload
   ```

3. Configure signing for local builds by copying `android/key.properties.example` to `android/key.properties`.
4. For CI, set `AHQ_UPLOAD_KEYSTORE`, `AHQ_UPLOAD_STORE_PASSWORD`, `AHQ_UPLOAD_KEY_ALIAS` and
   `AHQ_UPLOAD_KEY_PASSWORD` as GitHub secrets. Write the keystore from a base64 secret during the job.
5. Without an upload key, release builds are debug-signed and Google Play rejects them.

### iOS

1. In the Apple Developer account, create the App ID with the **Push Notifications** capability, and an APNs key.
2. Create the app in App Store Connect.
3. In Xcode, set the Team and signing for `Runner`. Release export uses automatic or manual signing with an App Store
   distribution profile.
4. Answer export compliance: the app uses only standard HTTPS encryption. The owner must confirm.

### Firebase (push), optional

1. Create a Firebase project per environment, and add the Android and iOS apps with the IDs above.
2. Upload the APNs key to Firebase.
3. Download `google-services.json` to `android/app/` and `GoogleService-Info.plist` to `ios/Runner/`. Both are
   git-ignored; in CI, write them from secrets.
4. Put the server service-account JSON (base64) in the backend secret `FIREBASE_SERVICE_ACCOUNT_JSON`.
5. Without these, the app builds and runs with the in-app inbox only.

### Google sign-in

**Not implemented in the app** (web only). Mobile players use email or guest accounts. Adding it needs the
`google_sign_in` package, OAuth clients for Android and iOS, and those client IDs in the backend's `GOOGLE_CLIENT_IDS`.

## 3. Building a release

```bash
API_BASE_URL=https://api.<domain> scripts/mobile/build-release.sh android
```

This produces:

- the store bundle: `build/app/outputs/bundle/release/app-release.aab`;
- a test APK: `build/app/outputs/flutter-apk/app-release.apk`.

```bash
API_BASE_URL=https://api.<domain> scripts/mobile/build-release.sh ios
```

This produces `build/ios/ipa/*.ipa` (macOS only).

The script:

- refuses an API URL that isn't `https://` (the app also refuses to start in release mode without one);
- obfuscates Dart code;
- writes debug symbols to `apps/mobile/build/symbols/`. Keep them per release: they're needed to read crash stack
  traces. Never ship or commit them.

Android release builds use R8 code and resource shrinking, allow no plain HTTP, and exclude tokens and local data
from backup.

## 4. Release testing before each submission

**This has never been done.** Use one low-end Android phone (2–3 GB RAM, Android 9–11), one current Android phone,
and one iPhone on iOS 15–16.

1. **Fresh install:**
   - onboarding;
   - guest start;
   - registration and email link;
   - sign in and out;
   - account switch.
2. **Gameplay:**
   - Story case with reasoning;
   - Clinical Challenge;
   - Hospital Commander shift;
   - countries;
   - achievements;
   - history.
3. **Offline:**
   - download a case;
   - airplane mode;
   - play it fully, with no feedback shown;
   - reconnect;
   - the result and feedback appear;
   - check _Settings → Sync status_.
4. **Conflict:**
   - download a case;
   - have an admin publish a new version;
   - play offline;
   - reconnect;
   - "Sync conflict" appears with the reason.
5. **AI debrief:** consent, report, "AI-generated educational feedback" label, report a problem. Also with AI
   switched off.
6. **Push:**
   - grant permission (Android 13+, iOS);
   - earn an achievement → notification;
   - tap it → it opens the right screen.
   - Background and killed-app cases.
7. **Resilience:**
   - kill the app mid-case and resume;
   - rotate;
   - large text (accessibility font size);
   - TalkBack and VoiceOver on main flows;
   - slow 3G network profile.
8. **Performance:**
   - cold start under 2 s on the low-end phone;
   - smooth scrolling on lists;
   - no memory growth over a 20-case session (Android Studio or Xcode profiler).
9. **Security:**
   - the release build talks only to `https://api.<domain>`;
   - the token survives restart;
   - sign-out clears local data;
   - no secrets in the APK (`apkanalyzer` / `strings` check).

## 5. Store submission

| Step           | Android (Play Console)                                                                                                           | iOS (App Store Connect)                                                         |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Listing        | Name, short and full description, **icon (512 px) and feature graphic (to be designed)**, screenshots (phone, 7" and 10" tablet) | Name, subtitle, description, **icon (1024 px)**, screenshots (6.7", 6.5", iPad) |
| Privacy        | Data safety form: account info, game progress, learner reasoning (sent to an AI provider with consent), device push token        | App Privacy "nutrition labels" with the same data                               |
| Content        | Content rating questionnaire. It's educational medical content: state "not medical advice" in the description                    | Age rating; medical/treatment information category                              |
| Policy URLs    | **Privacy policy URL required (not yet written)**                                                                                | Same                                                                            |
| Review account | A test login for reviewers (registered, with an approved case available)                                                         | Same                                                                            |
| Track          | Internal testing → closed testing → production (staged rollout 10% → 50% → 100%)                                                 | TestFlight internal → external → phased release                                 |

**Launcher icons are still Flutter's defaults:** replace them with real artwork, e.g. via `flutter_launcher_icons`.

## 6. After release

- Watch the Play and App Store crash and ANR dashboards. There's no in-app crash reporting yet (SECURITY_AUDIT M4).
- Keep the debug symbols and `mapping.txt` for every release.
- Raise `MIN_APP_VERSION_*` only after the new version is fully rolled out.
