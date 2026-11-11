# @ahq/backend

Express 5 + TypeScript + MongoDB (Mongoose) REST API — the single backend for the web and mobile apps.

```bash
npm run dev -w @ahq/backend          # watch mode, reads apps/backend/.env
npm run test:unit -w @ahq/backend
npm run test:integration -w @ahq/backend   # needs MongoDB replica set (npm run db:up)
npm run build -w @ahq/backend && npm run start -w @ahq/backend
```

- Versioned API under `/api/v1`; `GET /health`, `GET /ready`, `GET /openapi.json` at the root.
- Security middleware: helmet, CORS allow-list with credentials, JSON body limit, rate limiting, request ids,
  log redaction (pino). Config is zod-validated at startup (`src/config/env.ts`).
- Module layout and auth design: `docs/architecture/FOUNDATION_OVERVIEW.md`, `docs/architecture/SECURITY_ARCHITECTURE.md`.
- Environment variables: `.env.example`.
