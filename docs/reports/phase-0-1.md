# Phase 0 + 1 report — Foundation, API core, authentication & RBAC

**Date:** 2026-11-03 · **Status:** complete, tested locally; awaiting a connected GitHub repo for CI.

## Built

- npm-workspaces monorepo, strict TypeScript, ESLint + Prettier, `.env.example`, docker-compose,
  API Dockerfile (multi-stage, non-root, healthcheck), GitHub Actions CI.
- `@ahq/api-contracts`: zod schemas + generated OpenAPI 3.1 (`docs/api/openapi.json`).
- API core: validated config, error envelope with request ids, pino logging with redaction, helmet,
  CORS allow-list, JSON body limit (100 kB), rate limiting, `/health`, `/ready`, `/openapi.json`.
- Auth: register (non-enumerating) → email verification → login; Google ID-token sign-in with safe
  account linking; guest sessions with in-place upgrade (D3); rotating refresh tokens with reuse
  detection; logout; forgot/reset password (signs out all devices).
- RBAC: `player` / `reviewer` / `admin`; admin user search + role management with audit log and
  safeguards (no self-demotion, no roles for guests or unverified emails); `admin:grant` bootstrap CLI.

## Verified

| Check                                                                        | Result                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Contracts unit tests                                                         | 4 / 4 pass                                                                     |
| API tests (real MongoDB 7, HTTP via supertest)                               | 46 / 46 pass                                                                   |
| ESLint, Prettier, `tsc --noEmit` (both packages)                             | clean                                                                          |
| Production build + boot of `dist/server.js` against MongoDB, curl smoke test | pass                                                                           |
| `admin:grant` script against MongoDB                                         | pass (unknown user refused, idempotent, audited)                               |
| Docker image build                                                           | **not verified here** — sandbox network blocks registry CDNs; CI job builds it |

## Known limitations / follow-ups

- Rate-limit store is in-memory → shared store needed before horizontal scaling (Phase 9).
- Production email uses generic SMTP (works with Amazon SES SMTP); templates are plain text.
- Concurrent refreshes with the same token end the session by design — web/mobile clients must
  single-flight refresh (documented in `docs/api/README.md`).
- Signing in to an existing account while holding guest progress: merge rules land with progress in
  Phase 3.
- Guest deletion by TTL must cascade to guest progress documents (Phase 3).

## Next: Phase 2 — mission content & versioning

Mission/version models with server-side content hashing, verbatim import of the 10 prototype missions,
countries and tiers, admin draft editing (D5), publication gated on approval (D4).
