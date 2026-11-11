# Phase 4 report — Backend implementation

**Scope:** the eight backend modules in "Phase 4 — Develop the complete backend".
**Commits:** `09b42ce` (M1) → `0af60b8` (M8). One module per commit; each passed its tests before the next started.
**Result:** 233 backend tests pass (10 unit files, 16 integration files against a real MongoDB replica set), plus 11
`game-content` tests and 8 web tests. Lint, typecheck (all workspaces) and Prettier are clean. The API is described by
112 operations on 96 paths in `docs/api/openapi.json`. A test checks that every documented operation is routed, and
every route handler is documented except `/openapi.json` itself.

## 1. Modules

| #   | Module             | What was built                                                                                                                                                                                                                                                                                                                                                                                                                | Tests (integration + unit)                                                         |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| M1  | Authentication     | Email/password, email verification, Google, guests (upgraded in place). One session per device with rotating opaque refresh tokens and reuse detection. Permission catalogue, MFA (TOTP + recovery codes) required for staff, step-up for sensitive actions, suspension, encrypted secrets at rest. Web gets an HttpOnly cookie; mobile gets the token in the body.                                                           | auth, guest, google, sessions, suspension, mfa, admin, crypto, totp, roles, config |
| M2  | Player management  | Profile, progress, ledger, stats and achievements. `ProgressService.applyChange` is the only writer: transactional, with a unique ledger entry per source (rewards cannot apply twice). Versioned platform settings.                                                                                                                                                                                                          | players, progression                                                               |
| M3  | Mission engine     | Missions with immutable, content-hashed versions. Attempts with per-attempt shuffled choices, sequential answers, and feedback revealed only for answered steps. Server-side scoring and rewards, matching the prototype formulas (golden tests) and the Q1/Q2/Q5/Q8 defaults. **Answer keys never leave the server**; a leak detector checks every gameplay response.                                                        | missions, scoring, content-hash                                                    |
| M4  | Country management | All 54 African countries. Admins create and edit countries, upload flags and images, set unlock requirements, and assign missions. Uploads are checked by magic bytes, EXIF is stripped and active PDFs are rejected.                                                                                                                                                                                                         | countries-admin, file-inspection                                                   |
| M5  | Hospital Commander | Server-run shifts reproducing the prototype example. The full cost must be affordable, and concurrent overspend is blocked. Emergency events have tier and country gating; admins manage events.                                                                                                                                                                                                                              | hospital, hospital-simulation                                                      |
| M6  | Clinician review   | Clinician profiles with evidence and admin verification. Review queue and assignments; immutable review records. **Only verified clinicians approve; admins cannot** (separation of duties). Any content edit creates a new version that needs review. Publish, withdraw, restore, rollback and retire. Players keep the version they started.                                                                                | reviews                                                                            |
| M7  | Synchronization    | `Idempotency-Key` middleware on reward-bearing writes. Offline event queue (`/sync/events`): each event is claimed before it is applied, so it runs at most once even when uploads race. Events can refer to attempts started offline. First answer wins; profile edits are last-writer-wins. Delta pull (`/sync/state`), ETag-cached catalogue, guest merge under first-completion rules. Worker process for retention jobs. | sync, idempotency                                                                  |
| M8  | Administration     | Settings: read, history, and validated updates with optimistic concurrency, step-up and audit. Audit-log viewer. Analytics: overview, per-version mission statistics with choice distribution, guest funnel. Role catalogue. Player account erasure.                                                                                                                                                                          | admin-ops, openapi-coverage                                                        |

Every module uses:

- request validation with Zod schemas from `@ahq/api-contracts`;
- authentication and permission guards (admin routes also require MFA);
- the shared error envelope and error codes;
- structured logging with request IDs;
- audit entries for every privileged write;
- OpenAPI documentation generated from the same schemas.

## 2. Defects found and fixed during this phase

Each of these was caught by a test or a smoke run, not by inspection alone.

- **Concurrent sync uploads applied an event twice** (M7). Two requests carrying the same offline event could both apply it. Events are now claimed under a unique index before they are applied.
- **Reading a player profile changed its `updatedAt`** (M7). Mongoose timestamps were applied on read-upserts, which broke change detection for sync.
- **Production Docker image could not start** (M8):
  - It omitted `@ahq/game-content`, which the server imports to seed reference data. I reproduced the image's file layout locally: the old layout failed with `Cannot find package '@ahq/game-content'`, and the fixed layout starts and serves requests.
  - The media directory was not writable by the non-root user.
  - Compose did not pass the required `DATA_ENCRYPTION_KEY`.
- **A restarted worker waited up to an hour before running jobs** (M8). Its predecessor's lease was still held. The worker now releases the lease on shutdown.
- **Earlier modules** (M1–M6) were already covered in their commit messages, for example: suspended users got 401 instead of 403, and login didn't load MFA state.

## 3. Verification performed

- Full gates after every module: `build:packages`, `openapi`, `lint`, `typecheck`, the backend test suite and `format:check`.
- Built server run against MongoDB: `/ready`, `/api/v1/catalog` (ETag, 54 countries, 0 missions until a clinician approves them), and 401 on admin and sync endpoints without a token.
- Production config refuses to start without real mail and CORS settings.
- Built worker run twice in a row: both runs completed their retention jobs, which confirms the lease hand-over.

## 4. Deviations from the design documents

`openapi.json` is authoritative. `API_SPECIFICATION.md` is the design reference, and its status line now says so.

| Design                                              | Implemented                                                                                                                      | Reason                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `POST /admin/users/:id/disable` / `enable`          | `suspend` / `unsuspend` with a required reason                                                                                   | Same behaviour (sessions revoked, 403 `ACCOUNT_SUSPENDED`); clearer name              |
| `PUT /admin/users/:id/clinician`                    | Clinician applies via `PUT /users/me/clinician-profile` + evidence upload; admin decides via `POST /admin/clinicians/:id/verify` | Clinician enters their own registration details; the admin verifies, never types them |
| `GET /admin/users/:id` with progress summary        | `GET /admin/users/:id` (account) + `GET /admin/players/:id` (progress, profile)                                                  | Separate permissions and modules                                                      |
| Analytics `from,to`; overview includes `debriefs`   | `from,to` (default 30 days, max 366); no `debriefs` field                                                                        | AI debriefs are not built yet                                                         |
| Funnel "visit → guest → first mission → registered" | `guest_started → guest_played_mission → guest_registered`, plus `guest_merged_into_account`                                      | Page visits are not tracked server-side                                               |
| —                                                   | Added: `/sync/*`, `/catalog`, `/admin/roles`, `POST /admin/users/:id/erase`                                                      | Required by M7 and M8; sync section added to the spec (§10A)                          |

## 5. Outstanding issues

**Not built in Phase 4 (outside the eight modules)**

1. **AI debriefs** (spec §11) and `GET /admin/ai/usage`. The Anthropic key is server-side only, but there is no AI code yet.
2. **Notifications:** device registration, FCM push, email templates beyond verification and reset, and `POST /admin/announcements`.
3. **Apple sign-in**, which the App Store requires if Google sign-in ships on iOS.
4. **Self-service account deletion** (`DELETE /users/me`). Admin erasure exists; the player-initiated flow does not.

**Infrastructure and operations**

5. **Repository not connected:** CI has never run on GitHub.
6. **Production Docker image never built:** the base-image download is blocked in this environment. The runtime layout was verified by simulation only.
7. **Android and iOS builds unverified.**
8. **Media storage is local disk only:** there is no S3 driver yet, and malware scanning is limited to file-type and active-content checks.
9. **Rate limits and the settings cache are per instance.** Rate limits need a shared store (e.g. Redis or Mongo) before horizontal scaling. Settings changes reach other instances within 30 seconds.

**Product decisions to confirm**

10. **Q1–Q12** (`TECHNICAL_RISKS.md`) are implemented with the recommended defaults.
11. **Q3 (offline play):** the sync API can accept answers queued offline, and keys never reach the device. But a player answering offline sees no feedback until the device syncs. Decide whether the mobile app offers offline answering or only offline browsing and resuming.
12. **Guest merge** does not transfer Hospital Commander shifts (they spent the guest's separate budget).
13. **Erasure policy:**
    - Erasure is refused for users who signed clinical reviews (records kept for clinical governance) and for staff (roles must be removed first).
    - The audit log keeps the erased user's ID as a target.
    - Please confirm this against the applicable data-protection law (e.g. NDPA, POPIA, Kenya DPA).

**Documentation**

14. `DEVELOPMENT_ROADMAP.md` phase numbering still predates the Phase 1–4 instructions.

## 6. Suggested next steps

1. Connect the repository so CI runs: it builds the Docker image, runs the integration tests and the mobile jobs.
2. Grant the first admin and enrol a verified clinician so the 10 seeded missions can be reviewed and published. Until then, players see no missions, as decided (D4).
3. Confirm items 10–13 above.
4. Next phase: the web and mobile clients on top of this API, then AI debriefs and notifications.
