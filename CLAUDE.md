# CLAUDE.md — working agreement for AI coding agents and contributors

Africa Health Quest is a production healthcare-education platform. Read `README.md` for the layout and commands, and
`docs/README.md` for the design documents. These rules are permanent.

## Before changing anything significant

1. Read the relevant design doc (`docs/architecture/*`, `docs/database/DATABASE_SCHEMA.md`, `docs/api/API_SPECIFICATION.md`).
2. Inspect the existing code and its tests; never replace working code without understanding its dependencies.
3. State the plan, affected files, dependencies, risks and acceptance criteria; get approval for major features.
4. Implement, run the relevant tests, and report honestly (never claim something works without running it).

## Non-negotiable rules

- **Answer keys stay on the server.** `@ahq/game-content` and full mission versions are backend-only; ESLint blocks
  importing `@ahq/game-content` from `apps/web`. Player-facing responses must never include `correct`, `feedback` or
  `critical` for unanswered steps.
- **Server-authoritative game state.** No endpoint accepts HP, funding, completion or unlocks from a client.
- **No secrets in code or clients.** Backend secrets come from environment variables (`apps/backend/.env.example`).
  `VITE_*` and Flutter `--dart-define` values are public — never put keys there. The Anthropic API key is used only
  by the backend.
- **Validate every input** with schemas from `@ahq/api-contracts`; keep the error envelope and error codes in
  `@ahq/shared-types` (additive changes only).
- **Clinical safety.** Never invent medical guidelines or references. AI output is educational only; AI must not
  approve content or change official answers. Content edits invalidate approvals; keep version history.
- **Preserve prototype content verbatim.** Regenerate `packages/game-content/src/prototype-content.ts` only with
  `npm run import:prototype -w @ahq/game-content`; the parity test must pass.
- **No unnecessary dependencies or services.** Modular monolith (backend + worker), no new microservices.

## Conventions

- TypeScript strict everywhere; ESM; Prettier (100 cols) + ESLint must pass. Dart: `dart format` (120 cols) +
  `flutter analyze` clean.
- Backend modules: `routes → service → repository/model`, pure domain logic in `domain/`, DTO mappers whitelist fields.
- API: `/api/v1`, camelCase JSON, ISO-8601 UTC, `Idempotency-Key` on reward/AI mutations (see API spec).
- Contracts first: add/change schemas in `packages/api-contracts`, then run `npm run openapi` and commit
  `docs/api/openapi.json` (CI fails on drift).
- Tests: unit tests next to the code they cover (web) or in `test/unit` (backend); integration tests in
  `apps/backend/test/integration` use a real MongoDB replica set; E2E in `apps/web/e2e` and `apps/mobile/integration_test`.
- Commits: small and focused; never commit `.env` files, build outputs or generated reports (except committed
  generated sources: `prototype-content.ts`, `*.g.dart`, `openapi.json`).

## Commands you will need

```bash
npm run db:up            # MongoDB replica set in Docker
npm run dev              # backend :4000 + web :5173
./scripts/check.sh       # all local quality gates
npm run test:e2e         # browser E2E (starts servers if not running)
cd apps/mobile && flutter test && flutter analyze
```
