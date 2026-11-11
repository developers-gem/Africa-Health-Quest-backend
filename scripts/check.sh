#!/usr/bin/env bash
# Runs every local quality gate (what CI runs, minus E2E and platform builds). Requires MongoDB (npm run db:up).
set -euo pipefail
cd "$(dirname "$0")/.."
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
if command -v flutter >/dev/null 2>&1; then
  (cd apps/mobile && dart format --set-exit-if-changed $(find lib test integration_test -name '*.dart' ! -name '*.g.dart') >/dev/null && flutter analyze && flutter test)
fi
echo "✓ All checks passed"
