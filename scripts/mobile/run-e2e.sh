#!/usr/bin/env bash
# Mobile end-to-end test: the real Flutter app (Linux desktop build) against the real backend and MongoDB.
#   1. prepares a throwaway e2e database (apps/backend/test/fixtures/mobile-e2e.ts),
#   2. starts the backend on :4000 with test-only settings (file mail, fake AI),
#   3. runs integration_test/app_test.dart, then stops the backend.
# Needs MongoDB (npm run db:up). Headless: xvfb-run -a dbus-run-session -- scripts/mobile/run-e2e.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RUN_ID="$(date +%s)"
export MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/ahq_e2e_mobile_${RUN_ID}?directConnection=true}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-e2e-only-secret-e2e-only-secret-123456}"
export DATA_ENCRYPTION_KEY="CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk="
export WEB_APP_URL="http://localhost:5173" LOG_LEVEL=warn NODE_ENV=development
export MAIL_TRANSPORT=file MAIL_FILE_DIR="$ROOT/apps/mobile/build/e2e-mail-$RUN_ID" AI_PROVIDER=fake
export RATE_LIMIT_AUTH_MAX=10000 RATE_LIMIT_API_MAX=100000 PORT=4000
export MEDIA_STORAGE_DIR="$ROOT/apps/mobile/build/e2e-media-$RUN_ID"

cd "$ROOT/apps/backend"
npx tsx test/fixtures/mobile-e2e.ts
npx tsx src/server.ts > "$ROOT/apps/mobile/build/e2e-backend-$RUN_ID.log" 2>&1 &
BACKEND=$!
trap 'kill $BACKEND 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -fs http://localhost:4000/ready >/dev/null && break; sleep 1; done
curl -fs http://localhost:4000/ready >/dev/null

# flutter_secure_storage on Linux needs a Secret Service: unlock a throwaway keyring for this session.
if command -v gnome-keyring-daemon >/dev/null 2>&1; then
  eval "$(printf 'ci-keyring\n' | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)"
  export GNOME_KEYRING_CONTROL
fi
cd "$ROOT/apps/mobile"
flutter test integration_test/app_test.dart -d linux --dart-define=API_BASE_URL=http://localhost:4000
