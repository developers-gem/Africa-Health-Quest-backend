#!/usr/bin/env bash
# Release builds of the mobile app.
#   API_BASE_URL=https://api.example.org scripts/mobile/build-release.sh android   # .aab for Google Play (+ .apk)
#   API_BASE_URL=https://api.example.org scripts/mobile/build-release.sh ios       # .ipa (macOS + signing set up)
# Signing: android/key.properties or AHQ_UPLOAD_* env vars (see android/key.properties.example); iOS uses the
# team/profile configured in Xcode. Dart symbols go to build/symbols (upload them to your crash reporter;
# never ship or commit them).
set -euo pipefail
TARGET="${1:?usage: build-release.sh android|ios}"
: "${API_BASE_URL:?set API_BASE_URL to the production API (https://...)}"
case "$API_BASE_URL" in https://*) ;; *) echo "API_BASE_URL must use https://" >&2; exit 1 ;; esac
cd "$(dirname "$0")/../../apps/mobile"
VERSION="$(sed -n 's/^version: *//p' pubspec.yaml)"
ARGS=(--release --obfuscate --split-debug-info=build/symbols
  "--dart-define=API_BASE_URL=$API_BASE_URL" "--dart-define=APP_VERSION=${VERSION%%+*}")
flutter pub get
case "$TARGET" in
  android)
    flutter build appbundle "${ARGS[@]}"
    flutter build apk "${ARGS[@]}"
    ;;
  ios) flutter build ipa "${ARGS[@]}" ;;
  *) echo "unknown target $TARGET" >&2; exit 1 ;;
esac
