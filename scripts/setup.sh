#!/usr/bin/env bash
# First-time local setup. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ $1 is required ($2)"; exit 1; }; }
need node "Node.js 22.12+"
need npm "npm 11 — run: npm install -g npm@11"
need docker "Docker, for the local MongoDB replica set"
node -e 'const [M,m]=process.versions.node.split(".").map(Number);if(M<22||(M===22&&m<12)){console.error("✗ Node 22.12+ required");process.exit(1)}'
[ "$(npm -v | cut -d. -f1)" -ge 11 ] || { echo "✗ npm 11+ required (npm install -g npm@11)"; exit 1; }

echo "→ Installing workspace dependencies (also builds shared packages)"
npm install

secret() { node -e 'console.log(require("crypto").randomBytes(48).toString("base64url"))'; }
if [ ! -f apps/backend/.env ]; then
  cp apps/backend/.env.example apps/backend/.env
  sed -i.bak "s#^JWT_ACCESS_SECRET=.*#JWT_ACCESS_SECRET=$(secret)#" apps/backend/.env && rm -f apps/backend/.env.bak
  key=$(node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))')
  sed -i.bak "s#^DATA_ENCRYPTION_KEY=.*#DATA_ENCRYPTION_KEY=${key}#" apps/backend/.env && rm -f apps/backend/.env.bak
  echo "→ Created apps/backend/.env with random secrets"
fi
[ -f apps/web/.env ] || { cp apps/web/.env.example apps/web/.env; echo "→ Created apps/web/.env"; }
[ -f apps/mobile/.env ] || { cp apps/mobile/.env.example apps/mobile/.env; echo "→ Created apps/mobile/.env"; }

echo "→ Starting MongoDB (single-node replica set)"
npm run db:up

if command -v flutter >/dev/null 2>&1; then
  echo "→ Fetching Flutter packages"
  (cd apps/mobile && flutter pub get)
else
  echo "! Flutter not found — install Flutter 3.47.x to work on apps/mobile (see apps/mobile/README.md)"
fi

echo "✓ Setup complete. Next: npm run dev   (backend :4000 + web :5173)"
