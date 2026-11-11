# API documentation

The Express API serves the website and the mobile app. It has 129 operations, all under `/api/v1` except the
health checks and public media.

**Machine-readable spec.** [`docs/api/openapi.json`](../api/openapi.json) (OpenAPI 3.1) is generated from the shared
zod contracts in `packages/api-contracts`. Every running server also serves it at `GET /openapi.json`. CI fails if
the committed file is out of date, and a test checks that every documented operation is routed.

**Design rationale.** Request lifecycles, state machines and error semantics are in
[`docs/api/API_SPECIFICATION.md`](../api/API_SPECIFICATION.md).

The endpoint index in §8 is generated from `openapi.json`. Regenerate it whenever the API changes.

## 1. Base URLs

| Environment | Base URL                                            |
| ----------- | --------------------------------------------------- |
| Production  | `https://api.<domain>` (set in DEPLOYMENT_GUIDE.md) |
| Staging     | `https://api.staging.<domain>`                      |
| Local       | `http://localhost:4000`                             |

## 2. Authentication

- **Access token:** a JWT (`HS256`, 15 minutes) sent as `Authorization: Bearer <token>`. Tokens signed any other
  way, or with `alg: none`, are rejected.
- **Refresh token:** rotated on every use. Reusing an old refresh token is treated as theft and ends that session
  family.
  - **Web:** an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, sent with `credentials: "include"`.
  - **Mobile:** sends `X-Client-Platform: mobile` and passes the refresh token in the body. The app keeps it in
    Keychain/Keystore.
  - Refreshes must be single-flight per client.
- **Guests:** `POST /auth/guest` creates a server-side guest. `POST /auth/guest/upgrade` turns it into an account
  without losing progress.
- **Staff** (reviewer, admin) must complete TOTP two-factor authentication in the session. Sensitive admin actions
  also need a recent sign-in (step-up, 15 minutes).
- **Permissions** are role-based. Each operation's description states its permission; §8 shows it under "Access".

## 3. Requests and responses

- JSON, camelCase, UTC ISO-8601 timestamps.
- Responses over 1 KB are gzip/brotli-compressed when the client accepts it.
- Bodies are limited to 100 KB, except media uploads (2 MB for images, 10 MB for PDFs; the file type is checked from
  its content).
- Every input is validated against the contract schema. Unknown or ill-typed fields return `400 VALIDATION_ERROR`
  with `details[{path, message}]`.
- Every response carries `X-Request-Id`. Quote it when reporting a problem.

## 4. Errors

All errors use one envelope:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Human-readable text",
    "details": [],
    "requestId": "…"
  }
}
```

Codes are stable and only ever added to (`@ahq/shared-types` `ERROR_CODES`):

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `INVALID_CREDENTIALS`
- `EMAIL_NOT_VERIFIED`
- `TOKEN_INVALID`
- `STEP_UP_REQUIRED`
- `MFA_REQUIRED`
- `FORBIDDEN`
- `ACCOUNT_SUSPENDED`
- `MISSION_LOCKED`
- `NOT_FOUND`
- `CONFLICT`
- `ATTEMPT_NOT_ACTIVE`
- `STEP_ALREADY_ANSWERED`
- `INVALID_STATE_TRANSITION`
- `INSUFFICIENT_FUNDS`
- `PRECONDITION_FAILED`
- `IDEMPOTENCY_KEY_REUSED`
- `RATE_LIMITED`
- `QUOTA_EXCEEDED`
- `AI_UNAVAILABLE`
- `SERVICE_UNAVAILABLE`
- `INTERNAL`

Server errors never expose stack traces or database details.

## 5. Idempotency and synchronisation

**Idempotency keys.** Starting attempts, answering, Hospital Commander shifts, debrief requests and sync uploads take
an `Idempotency-Key` header (a UUID). A retry with the same key returns the original result, marked
`Idempotency-Replayed: true`. The same key with a different body returns `IDEMPOTENCY_KEY_REUSED`.

**Offline play.**

- The app downloads `GET /missions/{key}/pack`, which contains no answers, feedback or critical flags.
- Later it uploads ordered events to `POST /sync/events`, at most 50 per batch.
- Each event is applied once, by `eventId`.
- An attempt on an outdated case version is rejected with `CONFLICT` (`versionNumber: mission_changed`).

## 6. Rate limits and quotas

**Per IP:**

- 600 requests per minute per instance (a safety net);
- AWS WAF blocks over 3000 requests per 5 minutes per IP;
- 20 sign-in-type requests per 15 minutes, shared across instances.

Rate-limit headers (`RateLimit`, `RateLimit-Policy`) are returned.

**AI debriefs** (configurable by admins):

- a daily quota per player;
- a per-minute limit;
- a monthly budget cap.

## 7. Answer-key protection

**Never served to players for unanswered steps:**

- `correct`;
- `feedback`;
- `critical`;
- `correctChoiceId`.

They appear only in the reveal for a step the player has already answered, and in staff authoring and review
endpoints.

This is checked automatically for every player-readable endpoint (`security-sweep.test.ts`).

## 8. Endpoint index

### AI debriefs

| Method | Path                             | Purpose                                                                               | Access    |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------- | --------- |
| `POST` | `/api/v1/attempts/{id}/debriefs` | Request a learning debrief for a completed attempt (Anthropic Claude, server-side)    | signed in |
| `GET`  | `/api/v1/attempts/{id}/debriefs` | Debriefs for one of your attempts (newest first)                                      | signed in |
| `GET`  | `/api/v1/debriefs/{id}`          | One of your debriefs (poll while `pending`)                                           | signed in |
| `POST` | `/api/v1/debriefs/{id}/flags`    | Report a debrief as inaccurate, unsafe or unhelpful (clinicians review reports)       | signed in |
| `GET`  | `/api/v1/ai/status`              | Whether debriefs are available, consent state and today's quota                       | signed in |
| `POST` | `/api/v1/ai/consent`             | Accept AI processing of your case choices and reasoning (no names or emails are sent) | signed in |

### Admin · Achievements

| Method  | Path                               | Purpose                               | Access       |
| ------- | ---------------------------------- | ------------------------------------- | ------------ |
| `GET`   | `/api/v1/admin/achievements`       | Achievement catalogue (incl. retired) | catalog:edit |
| `POST`  | `/api/v1/admin/achievements`       | Create an achievement                 | catalog:edit |
| `PATCH` | `/api/v1/admin/achievements/{key}` | Update or retire an achievement       | catalog:edit |

### Admin · Clinician verification

| Method | Path                                       | Purpose                                            | Access            |
| ------ | ------------------------------------------ | -------------------------------------------------- | ----------------- |
| `GET`  | `/api/v1/admin/clinicians`                 | Clinician applications                             | clinicians:verify |
| `GET`  | `/api/v1/admin/clinicians/{userId}`        | Application detail (decrypted registration number) | clinicians:verify |
| `POST` | `/api/v1/admin/clinicians/{userId}/verify` | Verify or reject credentials (never your own)      | clinicians:verify |

### Admin · Content

| Method   | Path                                     | Purpose                                                                            | Access                  |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| `GET`    | `/api/v1/admin/missions`                 | Missions with publication state                                                    | content:read            |
| `POST`   | `/api/v1/admin/missions`                 | Create a mission (version 1 as draft; hidden until approved)                       | content:edit            |
| `GET`    | `/api/v1/admin/missions/{key}`           | Mission with full version and review history                                       | content:read            |
| `PATCH`  | `/api/v1/admin/missions/{key}`           | Gameplay placement (tier, icon, order, topics) — not clinical content              | content:edit            |
| `POST`   | `/api/v1/admin/missions/{key}/drafts`    | Start a new draft from the latest version                                          | content:edit            |
| `POST`   | `/api/v1/admin/missions/{key}/withdraw`  | Hide a published mission immediately (ends in-progress attempts)                   | content:publish-control |
| `POST`   | `/api/v1/admin/missions/{key}/restore`   | Re-publish a withdrawn mission unchanged                                           | content:publish-control |
| `POST`   | `/api/v1/admin/missions/{key}/retire`    | Permanently remove a mission from play (history kept)                              | content:publish-control |
| `POST`   | `/api/v1/admin/missions/{key}/rollback`  | Re-publish an earlier clinician-approved version                                   | content:publish-control |
| `GET`    | `/api/v1/admin/versions/{id}`            | Full version incl. answer key                                                      | content:read            |
| `PATCH`  | `/api/v1/admin/versions/{id}`            | Edit a draft (optimistic concurrency via expectedUpdatedAt)                        | content:edit            |
| `DELETE` | `/api/v1/admin/versions/{id}`            | Discard a draft                                                                    | content:edit            |
| `GET`    | `/api/v1/admin/versions/{id}/diff`       | Field-level diff against the published (or another) version                        | content:read            |
| `POST`   | `/api/v1/admin/versions/{id}/submit`     | Freeze the draft, compute its content hash and send it to review                   | content:edit            |
| `GET`    | `/api/v1/admin/reviews/assignments`      | Review assignments                                                                 | content:publish-control |
| `POST`   | `/api/v1/admin/reviews/assignments`      | Assign a verified, non-author reviewer to a version in review                      | content:publish-control |
| `DELETE` | `/api/v1/admin/reviews/assignments/{id}` | Cancel an open assignment                                                          | content:publish-control |
| `GET`    | `/api/v1/admin/content/approvals`        | Clinical approval monitoring: review queue, re-reviews pending, reviewers and gaps | content:read            |

### Admin · Countries

| Method  | Path                                      | Purpose                                                                               | Access       |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------ |
| `GET`   | `/api/v1/admin/countries`                 | All countries incl. hidden (54 AU members seeded)                                     | catalog:edit |
| `POST`  | `/api/v1/admin/countries`                 | Add a country (hidden until activated)                                                | catalog:edit |
| `GET`   | `/api/v1/admin/countries/{code}`          | Country detail                                                                        | catalog:edit |
| `PATCH` | `/api/v1/admin/countries/{code}`          | Edit country content, status, images and unlock requirements                          | catalog:edit |
| `PUT`   | `/api/v1/admin/countries/{code}/missions` | Assign missions to this country (creates draft versions that need clinician approval) | content:edit |

### Admin · Hospital Commander

| Method  | Path                                  | Purpose                                                                 | Access       |
| ------- | ------------------------------------- | ----------------------------------------------------------------------- | ------------ |
| `GET`   | `/api/v1/admin/hospital/events`       | Emergency events                                                        | catalog:edit |
| `POST`  | `/api/v1/admin/hospital/events`       | Create an emergency event (optionally tier- or country-gated, weighted) | catalog:edit |
| `PATCH` | `/api/v1/admin/hospital/events/{key}` | Update or retire an event (one must stay active)                        | catalog:edit |

### Admin · Media

| Method   | Path                               | Purpose                                                        | Access                              |
| -------- | ---------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `POST`   | `/api/v1/admin/media`              | Upload a file as the raw request body                          | media:upload (+ purpose permission) |
| `GET`    | `/api/v1/admin/media`              | List uploads (own uploads unless catalog:edit)                 | media:upload                        |
| `GET`    | `/api/v1/admin/media/{id}/content` | Download a file (private evidence: owner or clinicians:verify) | media:upload                        |
| `DELETE` | `/api/v1/admin/media/{id}`         | Delete an unused file                                          | media:upload (+ purpose permission) |

### Admin · Players

| Method | Path                                     | Purpose                                        | Access       |
| ------ | ---------------------------------------- | ---------------------------------------------- | ------------ |
| `GET`  | `/api/v1/admin/players/{id}`             | Player profile and progress                    | users:read   |
| `POST` | `/api/v1/admin/players/{id}/adjustments` | Audited manual HP/funding adjustment (support) | users:manage |

### Admin · Users

| Method | Path                                       | Purpose                                                                         | Access             |
| ------ | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------ |
| `GET`  | `/api/v1/admin/users`                      | Search users                                                                    | users:read         |
| `GET`  | `/api/v1/admin/users/{id}`                 | User detail                                                                     | users:read         |
| `PUT`  | `/api/v1/admin/users/{id}/roles`           | Replace a user's roles ('player' always kept; sessions of the user are revoked) | users:manage-roles |
| `POST` | `/api/v1/admin/users/{id}/suspend`         | Suspend an account (revokes all its sessions)                                   | users:manage       |
| `POST` | `/api/v1/admin/users/{id}/unsuspend`       | Lift a suspension                                                               | users:manage       |
| `POST` | `/api/v1/admin/users/{id}/sessions/revoke` | Sign a user out of every device                                                 | users:manage       |

### Admin: analytics

| Method | Path                               | Purpose                                                                                    | Access         |
| ------ | ---------------------------------- | ------------------------------------------------------------------------------------------ | -------------- |
| `GET`  | `/api/v1/admin/analytics/overview` | Active players, registrations, conversions, gameplay, shifts, content and sync metrics     | analytics:read |
| `GET`  | `/api/v1/admin/analytics/missions` | Per mission version: completion, pass rate, average score and choice distribution          | analytics:read |
| `GET`  | `/api/v1/admin/analytics/funnel`   | Guest funnel: started → played a mission → registered (or merged)                          | analytics:read |
| `GET`  | `/api/v1/admin/ai/usage`           | AI requests, tokens, cost, failures and latency per day and model, plus the monthly budget | analytics:read |
| `GET`  | `/api/v1/admin/ai/provider`        | AI provider, model and fallback configuration, and whether generation is available         | settings:read  |

### Admin: audit

| Method | Path                       | Purpose                                         | Access     |
| ------ | -------------------------- | ----------------------------------------------- | ---------- |
| `GET`  | `/api/v1/admin/audit-logs` | Search the append-only audit log (newest first) | audit:read |

### Admin: settings

| Method | Path                                   | Purpose                                                                   | Access        |
| ------ | -------------------------------------- | ------------------------------------------------------------------------- | ------------- |
| `GET`  | `/api/v1/admin/settings`               | Active version of every platform setting (economy, progression, hospital) | settings:read |
| `GET`  | `/api/v1/admin/settings/{key}`         | Active version of one setting                                             | settings:read |
| `PUT`  | `/api/v1/admin/settings/{key}`         | Publish a new version of a setting                                        | settings:edit |
| `GET`  | `/api/v1/admin/settings/{key}/history` | Version history (newest first)                                            | settings:read |

### Admin: users

| Method | Path                             | Purpose                                                                 | Access                  |
| ------ | -------------------------------- | ----------------------------------------------------------------------- | ----------------------- |
| `GET`  | `/api/v1/admin/roles`            | System roles with their permissions and session policies                | users:read              |
| `POST` | `/api/v1/admin/users/{id}/erase` | Erase a player account and all its personal data (data-subject request) | users:manage            |
| `POST` | `/api/v1/admin/announcements`    | Send an announcement to players (in-app, and push when configured)      | notifications:broadcast |

### Auth

| Method   | Path                               | Purpose                                                                   | Access    |
| -------- | ---------------------------------- | ------------------------------------------------------------------------- | --------- |
| `POST`   | `/api/v1/auth/register`            | Register with email and password (non-enumerating: always 202)            | public    |
| `POST`   | `/api/v1/auth/verify-email`        | Confirm an email address                                                  | public    |
| `POST`   | `/api/v1/auth/resend-verification` | Resend the verification email (always 200)                                | public    |
| `POST`   | `/api/v1/auth/login`               | Sign in with email and password                                           | public    |
| `POST`   | `/api/v1/auth/google`              | Sign in with a Google ID token                                            | public    |
| `POST`   | `/api/v1/auth/guest`               | Start a guest session                                                     | public    |
| `POST`   | `/api/v1/auth/guest/upgrade`       | Turn the current guest into a registered account (same id, progress kept) | signed in |
| `POST`   | `/api/v1/auth/refresh`             | Rotate the refresh token; re-using an old token revokes the session       | public    |
| `POST`   | `/api/v1/auth/logout`              | Revoke the current session                                                | public    |
| `POST`   | `/api/v1/auth/logout-all`          | Revoke every session of the current user (including this one)             | signed in |
| `GET`    | `/api/v1/auth/sessions`            | List active sessions (devices)                                            | signed in |
| `DELETE` | `/api/v1/auth/sessions/{id}`       | Revoke one of your sessions                                               | signed in |
| `POST`   | `/api/v1/auth/reauthenticate`      | Confirm identity for sensitive actions (step-up)                          | signed in |
| `POST`   | `/api/v1/auth/forgot-password`     | Email a password reset link (always 200)                                  | public    |
| `POST`   | `/api/v1/auth/reset-password`      | Set a new password; signs out every device                                | public    |
| `POST`   | `/api/v1/auth/mfa/totp/setup`      | Start authenticator-app (TOTP) setup                                      | signed in |
| `POST`   | `/api/v1/auth/mfa/totp/verify`     | Confirm TOTP setup with a first code; returns recovery codes              | signed in |
| `POST`   | `/api/v1/auth/mfa/challenge`       | Verify MFA for this session (TOTP or recovery code)                       | signed in |
| `DELETE` | `/api/v1/auth/mfa`                 | Disable MFA (not allowed for staff)                                       | signed in |

### Clinician profile

| Method | Path                                       | Purpose                                                                           | Access    |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------- | --------- |
| `GET`  | `/api/v1/users/me/clinician-profile`       | Your clinician (reviewer) application                                             | signed in |
| `PUT`  | `/api/v1/users/me/clinician-profile`       | Submit or update your clinician profile (re-verification required after changes)  | signed in |
| `POST` | `/api/v1/users/me/clinician-evidence`      | Upload credential evidence (raw body: PDF/PNG/JPEG); private to you and verifiers | signed in |
| `GET`  | `/api/v1/users/me/clinician-evidence/{id}` | Download your own evidence file                                                   | signed in |

### Clinician review

| Method  | Path                                     | Purpose                                                                           | Access          |
| ------- | ---------------------------------------- | --------------------------------------------------------------------------------- | --------------- |
| `GET`   | `/api/v1/review/queue`                   | Versions awaiting review (or other states); filter to your assignments            | review:read     |
| `GET`   | `/api/v1/review/versions/{id}`           | Full version (incl. answer key), diff from published, review history, eligibility | review:read     |
| `POST`  | `/api/v1/review/versions/{id}/decisions` | Approve (publishes atomically) or request changes                                 | review:decide   |
| `GET`   | `/api/v1/review/missions/{key}/history`  | All versions and reviews of a mission                                             | review:read     |
| `GET`   | `/api/v1/review/assignments`             | Your open review assignments                                                      | review:read     |
| `GET`   | `/api/v1/review/references`              | Clinical reference library                                                        | review:read     |
| `POST`  | `/api/v1/review/references`              | Add a reference (https links only; never AI-generated)                            | references:edit |
| `PATCH` | `/api/v1/review/references/{id}`         | Update, verify or retire a reference                                              | references:edit |
| `GET`   | `/api/v1/review/ai-flags`                | Debriefs reported by players, for clinician follow-up                             | review:read     |

### Countries

| Method | Path                       | Purpose                                                                         | Access |
| ------ | -------------------------- | ------------------------------------------------------------------------------- | ------ |
| `GET`  | `/api/v1/countries`        | Active and coming-soon countries (all 54 AU members); `unlocked` when signed in | public |
| `GET`  | `/api/v1/countries/{code}` | Country detail                                                                  | public |

### Gameplay

| Method | Path                            | Purpose                                                                            | Access    |
| ------ | ------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| `POST` | `/api/v1/attempts`              | Start (or resume) a mission attempt                                                | signed in |
| `GET`  | `/api/v1/attempts/{id}`         | Attempt state: answered steps (with feedback) plus the current step                | signed in |
| `POST` | `/api/v1/attempts/{id}/answers` | Answer the current step; the last answer completes the attempt and applies rewards | signed in |
| `POST` | `/api/v1/attempts/{id}/abandon` | Abandon an attempt (no rewards)                                                    | signed in |

### Hospital Commander

| Method | Path                     | Purpose                                                                                     | Access    |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------- | --------- |
| `GET`  | `/api/v1/hospital/state` | Budget, hospital level, resources and recent performance                                    | signed in |
| `POST` | `/api/v1/hospital/runs`  | Run a shift: allocate resources; the server rolls an emergency and applies cost and rewards | signed in |
| `GET`  | `/api/v1/hospital/runs`  | Shift history                                                                               | signed in |

### Media

| Method | Path          | Purpose                             | Access |
| ------ | ------------- | ----------------------------------- | ------ |
| `GET`  | `/media/{id}` | Public media (immutable, sandboxed) | public |

### Missions

| Method | Path                          | Purpose                                                                                | Access    |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------- | --------- |
| `GET`  | `/api/v1/missions`            | Published missions (clinician-approved only); story locks when signed in               | public    |
| `GET`  | `/api/v1/missions/random`     | Random case (Clinical Challenge) chosen server-side                                    | public    |
| `GET`  | `/api/v1/missions/{key}`      | Mission detail with clinician verification (no steps)                                  | public    |
| `GET`  | `/api/v1/missions/{key}/pack` | Download an offline mission pack (offline-eligible published missions; no answer keys) | signed in |

### Notifications

| Method | Path                                       | Purpose                                                                      | Access    |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------- | --------- |
| `GET`  | `/api/v1/notifications`                    | Your notifications (newest first) and unread count                           | signed in |
| `POST` | `/api/v1/notifications/{id}/read`          | Mark one notification read                                                   | signed in |
| `POST` | `/api/v1/notifications/read-all`           | Mark all notifications read                                                  | signed in |
| `POST` | `/api/v1/notifications/devices`            | Register this device's Firebase Cloud Messaging token for push notifications | signed in |
| `POST` | `/api/v1/notifications/devices/unregister` | Stop push notifications to this device (e.g. on sign-out)                    | signed in |

### Players

| Method  | Path                              | Purpose                                                                                     | Access    |
| ------- | --------------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `GET`   | `/api/v1/players/me/profile`      | Player profile (created on first access)                                                    | signed in |
| `PATCH` | `/api/v1/players/me/profile`      | Update profile (unknown fields rejected)                                                    | signed in |
| `GET`   | `/api/v1/players/me/progress`     | Server-authoritative progress: HP, funding, hospital level, unlocks, missions, achievements | signed in |
| `GET`   | `/api/v1/players/me/stats`        | Player statistics                                                                           | signed in |
| `GET`   | `/api/v1/players/me/ledger`       | History of every HP/funding change                                                          | signed in |
| `GET`   | `/api/v1/players/me/achievements` | Earned achievements and progress towards the others                                         | signed in |
| `GET`   | `/api/v1/players/me/attempts`     | Mission history                                                                             | signed in |

### Synchronization

| Method | Path                       | Purpose                                                                                 | Access    |
| ------ | -------------------------- | --------------------------------------------------------------------------------------- | --------- |
| `POST` | `/api/v1/sync/events`      | Upload queued offline events (applied in order, each at most once)                      | signed in |
| `GET`  | `/api/v1/sync/state`       | Pull server state changed since the last sync                                           | signed in |
| `POST` | `/api/v1/sync/merge-guest` | Merge a guest's progress into the signed-in registered account                          | signed in |
| `GET`  | `/api/v1/catalog`          | Catalogue for app start and offline caches (tiers, countries, missions, hospital rules) | public    |

### System

| Method | Path      | Purpose                           | Access |
| ------ | --------- | --------------------------------- | ------ |
| `GET`  | `/health` | Liveness check                    | public |
| `GET`  | `/ready`  | Readiness (database connectivity) | public |

### Users

| Method  | Path               | Purpose             | Access    |
| ------- | ------------------ | ------------------- | --------- |
| `GET`   | `/api/v1/users/me` | Current user        | signed in |
| `PATCH` | `/api/v1/users/me` | Update display name | signed in |
