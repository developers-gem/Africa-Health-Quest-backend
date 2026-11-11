# Testing

| Layer                                        | Tool                                                | Location                        | Needs                                                              | Command                                                               |
| -------------------------------------------- | --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Package unit tests                           | Vitest                                              | `packages/*/test`               | —                                                                  | `npm run test:unit`                                                   |
| Content parity                               | Vitest                                              | `packages/game-content/test`    | —                                                                  | included in `test:unit` (asserts every prototype string is preserved) |
| Backend unit                                 | Vitest                                              | `apps/backend/test/unit`        | —                                                                  | `npm run test:unit -w @ahq/backend`                                   |
| Backend integration                          | Vitest + Supertest                                  | `apps/backend/test/integration` | MongoDB replica set                                                | `npm run test:integration`                                            |
| Web unit/component                           | Vitest + Testing Library (jsdom)                    | `apps/web/src/**/*.test.ts(x)`  | —                                                                  | `npm run test:unit -w @ahq/web`                                       |
| Web end-to-end                               | Playwright (Pixel 7 profile)                        | `apps/web/e2e`                  | MongoDB; starts backend + web automatically                        | `npm run test:e2e`                                                    |
| Mobile unit/widget                           | `flutter_test`, fake HTTP adapter, in-memory SQLite | `apps/mobile/test`              | Flutter SDK                                                        | `cd apps/mobile && flutter test`                                      |
| Mobile integration (real app ↔ real backend) | `integration_test` on Linux desktop                 | `apps/mobile/integration_test`  | Flutter, MongoDB, GTK + Secret Service (script starts the backend) | `xvfb-run -a dbus-run-session -- ./scripts/mobile/run-e2e.sh`         |

## Conventions

- Integration tests create an isolated database per test file (`ahq_test_<random>`) and drop it afterwards; set
  `MONGO_TEST_URL` to point elsewhere (default `mongodb://127.0.0.1:27017/?directConnection=true`).
- External services are faked at their adapter boundary (mail, Google ID tokens, HTTP in Flutter tests). Tests never
  call real third-party APIs; AI tests will use the fake Claude client (see `docs/architecture/AI_ARCHITECTURE.md`).
- Playwright uses the installed Chromium; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to reuse a system browser.

## Continuous integration (`.github/workflows/ci.yml`)

| Job                  | Runs                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `quality`            | format check, ESLint, typecheck, unit tests, OpenAPI drift, content-import drift, production build |
| `integration`        | backend integration tests + web E2E against a MongoDB replica set                                  |
| `mobile`             | build_runner drift check, `dart format`, `flutter analyze`, `flutter test`, Android debug APK      |
| `mobile-integration` | real Flutter Linux app against a running backend (xvfb + keyring)                                  |
| `ios-build`          | iOS build without code signing (macOS runner; `main` and manual runs only)                         |
| `docker`             | backend production image build                                                                     |
