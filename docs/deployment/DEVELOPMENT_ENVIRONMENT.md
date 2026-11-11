# Development environment

## Prerequisites

| Tool                     | Version                                                                          | Notes                                                  |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Node.js                  | 22.12+ (`.nvmrc`)                                                                |                                                        |
| npm                      | 11 (`npm install -g npm@11`)                                                     | npm 10 fails on this dependency tree                   |
| Docker                   | recent                                                                           | Local MongoDB 7 replica set                            |
| Flutter                  | 3.47.x stable (Dart 3.13)                                                        | Only for `apps/mobile`                                 |
| Android Studio / Xcode   | current                                                                          | Emulators and device builds (macOS for iOS)            |
| Linux desktop (optional) | `clang cmake ninja-build pkg-config libgtk-3-dev libsecret-1-dev libjsoncpp-dev` | Run the Flutter app as a Linux app without an emulator |

## First run

```bash
./scripts/setup.sh      # deps, shared package builds, .env files, MongoDB
npm run dev             # backend http://localhost:4000 + web http://localhost:5173
```

## Environment variables

Each app has a committed `.env.example`; real `.env` files are git-ignored.

| File                | Consumed by                                                                            | Secrets?                                                      |
| ------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/backend/.env` | backend (`tsx --env-file-if-exists=.env`), validated by `src/config/env.ts` at startup | **Yes** — JWT secret, SMTP, later Anthropic key. Never commit |
| `apps/web/.env`     | Vite at build time (`VITE_API_BASE_URL`)                                               | **No** — values ship to the browser                           |
| `apps/mobile/.env`  | `flutter run --dart-define-from-file=.env` (`API_BASE_URL`, `APP_VERSION`)             | **No** — compiled into the app                                |

Mobile API URL defaults when `API_BASE_URL` is empty: Android emulator `http://10.0.2.2:4000`; iOS simulator and
desktop `http://localhost:4000`. Debug Android builds allow plain HTTP only to these hosts
(`android/app/src/debug/res/xml/network_security_config.xml`); iOS allows local-network HTTP only
(`NSAllowsLocalNetworking`). Release builds require HTTPS.

## MongoDB

`docker compose` runs MongoDB 7 as a single-node replica set (`rs0`) because the backend uses multi-document
transactions. Connection string for local tools: `mongodb://127.0.0.1:27017/ahq?directConnection=true`.
`docker compose --profile full up -d --build` additionally runs the backend container.

## Running each app independently

| App     | Command                                                      | Depends on                        |
| ------- | ------------------------------------------------------------ | --------------------------------- |
| Backend | `npm run dev:backend`                                        | MongoDB                           |
| Web     | `npm run dev:web`                                            | Backend URL in `apps/web/.env`    |
| Mobile  | `cd apps/mobile && flutter run --dart-define-from-file=.env` | Backend URL in `apps/mobile/.env` |

All clients talk only to the backend; no client contains database credentials or AI keys.
