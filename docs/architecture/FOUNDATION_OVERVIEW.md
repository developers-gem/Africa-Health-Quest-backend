# Architecture

```
 React web (Phase 6) ─┐                      ┌─ MongoDB Atlas
                      ├── HTTPS /api/v1 ── API (Express, stateless) ─┼─ Anthropic Claude API (Phase 4)
 Flutter app (Phase 8)┘     (OpenAPI 3.1)    └─ SMTP/SES, FCM, S3 (Phase 9)
```

## API module layout (`apps/backend/src`)

| Folder          | Responsibility                                                                              |
| --------------- | ------------------------------------------------------------------------------------------- |
| `config/`       | zod-validated environment; refuses unsafe production config                                 |
| `lib/`          | errors (`AppError`), crypto (scrypt, tokens), logger (pino with redaction), request parsing |
| `middleware/`   | authentication + role checks, rate limiting, error envelope                                 |
| `modules/auth`  | registration, email verification, login, Google, guest, refresh rotation, password reset    |
| `modules/users` | profile (`/users/me`)                                                                       |
| `modules/admin` | user search, role management (audited)                                                      |
| `modules/audit` | append-only audit log for privileged actions                                                |
| `services/`     | adapters for external systems (mail, Google) behind interfaces for testing                  |

`createApp(deps)` builds the app with injectable adapters, so tests run the real HTTP stack against
a real MongoDB with fake mail/Google.

## Security model

- **Roles:** `player` (everyone), `reviewer`, `admin`. Guests can never use staff endpoints.
- **Tokens:** see decision D8. Re-using a rotated refresh token revokes the whole session family.
- **Email tokens:** single-use, hashed, 24 h (verify) / 1 h (reset); issuing a new one voids older ones.
- **Abuse:** per-IP auth rate limit (20 / 15 min default) and global API limit. In-memory store today —
  must move to a shared store before running more than one instance (Phase 9).
- **Data:** guests auto-expire via a MongoDB TTL index; refresh/email tokens expire via TTL indexes.
- **Logging:** request ids on every response; `Authorization`, cookies, passwords and tokens redacted.
