# Africa Health Quest

**Save Lives. Build Healthier Nations.**

An African healthcare education and strategy game: clinical case simulations, story missions, hospital management,
country expansion, AI learning debriefs and clinician-reviewed content. One backend serves the web app and the
Android/iOS apps.

## Repository layout

```
apps/
  backend/        Node.js + Express + TypeScript + MongoDB (Mongoose) REST API — all business logic
  web/            React + Vite + TypeScript + Tailwind + shadcn/ui + Zustand + TanStack Query + React Router
  mobile/         Flutter (Dart) + Riverpod + Dio + GoRouter + SQLite (drift) + flutter_secure_storage
packages/
  shared-types/   Dependency-free constants and types (roles, error codes, content shapes)
  api-contracts/  zod request/response schemas → OpenAPI 3.1 (single contract for web and mobile)
  game-content/   Canonical missions/countries/tiers/Commander events (contains answer keys — backend only)
docs/             architecture/ requirements/ database/ api/ testing/ deployment/ reports/  (see docs/README.md)
scripts/          setup, quality checks, CI helpers
legacy/           Read-only copy of the Lovable prototype content (source for the verbatim content import)
.github/          CI workflows
```

## Quick start

Requirements: Node 22.12+, npm 11 (`npm install -g npm@11`), Docker, and Flutter 3.47.x for mobile work.

```bash
./scripts/setup.sh
```

```bash
npm run dev
```

`setup.sh` installs dependencies, builds the shared packages, creates `.env` files from the `.env.example` templates
(with a random JWT secret for the backend) and starts MongoDB as a single-node replica set in Docker.
`npm run dev` starts the backend on <http://localhost:4000> and the web app on <http://localhost:5173>.

Mobile (separate terminal, backend running):

```bash
cd apps/mobile && flutter run --dart-define-from-file=.env
```

## Common commands

| Command                                                                 | What it does                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run dev`                                                           | Backend (watch) + web (Vite) together                                                 |
| `npm run dev:backend` / `npm run dev:web`                               | One app at a time                                                                     |
| `npm run db:up` / `npm run db:down`                                     | Start/stop local MongoDB (replica set `rs0`)                                          |
| `npm run build`                                                         | Production build of packages, backend (`apps/backend/dist`) and web (`apps/web/dist`) |
| `npm run start:backend`                                                 | Run the built backend (production mode needs production env vars)                     |
| `npm run dev:worker -w @ahq/backend` / `npm run worker -w @ahq/backend` | Background worker (guest purge, stale-attempt expiry), watch / built                  |
| `npm run preview:web`                                                   | Serve the built web app locally                                                       |
| `npm run lint` / `npm run format` / `npm run typecheck`                 | Code quality                                                                          |
| `npm run test:unit`                                                     | Unit tests (packages, backend, web)                                                   |
| `npm run test:integration`                                              | Backend integration tests against MongoDB                                             |
| `npm run test:e2e`                                                      | Playwright browser test: web ↔ backend ↔ MongoDB                                      |
| `./scripts/check.sh`                                                    | Everything CI checks locally (incl. Flutter analyze/test)                             |
| `npm run admin:grant -- you@example.com`                                | Grant the first administrator (after registering and confirming email)                |

Details: `docs/deployment/DEVELOPMENT_ENVIRONMENT.md` and `docs/testing/TESTING.md`.

## Engineering rules (abridged — full list in `CLAUDE.md`)

- Clinical answer keys never leave the backend; scoring and rewards are server-authoritative.
- Every input is validated with zod contracts; errors use one envelope `{ error: { code, message, details?, requestId } }`.
- No secrets in code or in client apps. Configuration is validated at startup.
- Clinical content is published only after clinician approval; edits invalidate approvals.
