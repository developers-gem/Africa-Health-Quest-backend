# API Specification — Africa Health Quest REST API v1

|                      |                                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | Design reference. Implemented: §4–13 except notifications (§14) and announcements; AI debriefs (§11) were added in Phase 5. The authoritative contract is `docs/api/openapi.json`. Deviations: `docs/reports/phase-4-backend.md` §4 and `docs/reports/phase-5-web.md` §5. |
| **Base URL**         | `https://api.<domain>/api/v1` (system endpoints at the root)                                                                                                                                                                                                              |
| **Machine-readable** | Every endpoint below is added to `packages/api-contracts` and published as OpenAPI 3.1 at `/openapi.json` and `docs/api/openapi.json` as it is implemented. This document is the design reference.                                                                        |

## 1. Conventions

| Topic          | Rule                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format         | JSON (`application/json; charset=utf-8`), `camelCase`, UTF-8; request bodies ≤ 100 KB                                                                                          |
| Timestamps     | ISO-8601 UTC strings (`2026-11-03T10:15:00.000Z`)                                                                                                                              |
| Ids            | 24-hex ObjectId strings; missions by `key` (slug), countries by `code` (ISO alpha-2) in player routes                                                                          |
| Authentication | `Authorization: Bearer <accessToken>` (JWT, 15 min). Refresh token: httpOnly cookie `ahq_rt` (web) or body field (mobile, header `X-Client-Platform: mobile`)                  |
| Client headers | `X-Client-Platform: web\|android\|ios\|mobile` · `X-App-Version` (mobile) · `Accept-Language` (content locale) · `X-Request-Id` (optional, echoed)                             |
| Idempotency    | `Idempotency-Key: <uuid>` **required** where marked **[IK]**. Same key + same body → stored response replayed (24 h). Same key + different body → `422 IDEMPOTENCY_KEY_REUSED` |
| Caching        | Catalog GETs return `ETag`; send `If-None-Match` → `304`                                                                                                                       |
| Pagination     | Query `page` (≥1, default 1), `pageSize` (1–100, default 20). Response `{ items, page, pageSize, total }`                                                                      |
| Rate limits    | `RateLimit` and `RateLimit-Policy` headers (IETF draft-8); `429 RATE_LIMITED` with `Retry-After`                                                                               |
| Versioning     | Breaking changes → `/api/v2`; additive fields may appear at any time (clients must ignore unknown fields)                                                                      |
| Permissions    | `Public` · `Player` (any signed-in incl. guest) · `Registered` (non-guest, email verified) · named permissions (`SECURITY_ARCHITECTURE.md §4`)                                 |

## 2. Shared schemas

```ts
type Role = "player" | "reviewer" | "admin";
type LearnerLevel = "nursing_student" | "medical_student" | "midwifery_student" | "pharmacy_student"
                  | "intern_junior_doctor" | "community_health_worker" | "other";

type User = { id; email: string|null; displayName; roles: Role[]; emailVerified: boolean; isGuest: boolean;
              mfaEnabled: boolean; createdAt };
type AuthResponse = { accessToken; accessTokenExpiresIn: number; refreshToken?: string /* mobile only */; user: User;
                      mfaRequired?: boolean /* staff without verified MFA: limited token */ };

type Tier = { index: number; key; name; icon; hpRequired: number };
type Country = { code; name; flagUrl: string|null; flagEmoji; focus; unlockHp: number;
                 status: "active"|"coming_soon"; unlocked: boolean /* only when signed in */ };

type Progress = { hp; funding; tier: Tier; nextTier: Tier|null; hpToNextTier: number|null;
                  unlockedCountryCodes: string[];
                  missions: Record<string /*missionKey*/, { bestScore; maxScore; attempts; passed; lastPlayedAt }>;
                  achievements: { key; earnedAt }[]; version: number };

type Verification = { reviewerName; credentials; approvedAt; references: Reference[] };
type Reference = { id; title; organization?; year?; type; url?; doi? };

type MissionSummary = { key; title; icon; countryCode; tier: number; topics: string[]; stepCount; maxScore;
                        locked: boolean; lockReason?: "tier"|"country";
                        progress?: { bestScore; passed; attempts };
                        verified: true /* only published missions are listed (D4) */ };
type PlayerChoice = { choiceId; text };                       // never contains correct/feedback
type PlayerStep  = { stepId; index; prompt; choices: PlayerChoice[] };   // choices in per-attempt order
type MissionDetail = MissionSummary & { story; learningObjectives: string[]; verification: Verification };

type AnsweredStep = PlayerStep & { answer: { choiceId; correct: boolean; correctChoiceId; feedback; critical: boolean;
                                             reasoning?: string } };
type Attempt = { id; missionKey; mode: "story"|"practice"; status: "in_progress"|"completed"|"abandoned"|"expired";
                 story; stepCount; steps: (AnsweredStep|PlayerStep)[] /* answered + current only */;
                 currentStepIndex: number|null; startedAt; completedAt?; result?: AttemptResult };
type AttemptResult = { score; maxScore; passed: boolean; criticalError: boolean;
                       rewards: { hp; funding }; firstPass: boolean;
                       progress: Progress; newlyUnlocked: { tiers: Tier[]; countries: string[] };
                       achievements: { key; name }[]; verification: Verification };

type Debrief = { id; attemptId; level: LearnerLevel; generation; status: "pending"|"completed"|"failed";
                 output?: { overall; decisions: { stepId; prompt; chosenText; verdict: "correct"|"incorrect"; explanation }[];
                            teachingPoints: string[]; practiceQuestions: string[]; citedReferences: Reference[];
                            disclaimer };
                 error?: { code; message }; createdAt; completedAt? };

type HospitalRun = { id; allocation: { staff; beds; ambulances; supplies }; cost;
                     event: { key; text; needs: {...} }; needsMet; rewards: { hp; funding }; progress: Progress; createdAt };

type Notification = { id; type; title; body; data?: { route; entityId }; readAt: string|null; createdAt };
type Page<T> = { items: T[]; page; pageSize; total };
```

## 3. Errors

Envelope ✅: `{ "error": { "code": "…", "message": "human readable", "details": [{ "path", "message" }]?, "requestId": "…" } }`

| HTTP | Code                       | When                                                                                |
| ---- | -------------------------- | ----------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR` ✅      | Body/query/params fail schema; `details` lists fields                               |
| 401  | `UNAUTHENTICATED` ✅       | Missing/expired/invalid access token or refresh token                               |
| 401  | `INVALID_CREDENTIALS` ✅   | Wrong email/password                                                                |
| 401  | `TOKEN_INVALID` ✅         | Email/reset token invalid or expired                                                |
| 401  | `STEP_UP_REQUIRED`         | Sensitive action needs re-authentication within 15 min                              |
| 401  | `MFA_REQUIRED`             | Staff action without verified MFA in this session                                   |
| 403  | `EMAIL_NOT_VERIFIED` ✅    | Sign-in/feature requires a verified email                                           |
| 403  | `FORBIDDEN` ✅             | Missing permission, guest on registered-only route, disabled account                |
| 403  | `MISSION_LOCKED`           | Story attempt on a locked mission (`details`: tier/country requirement)             |
| 404  | `NOT_FOUND` ✅             | Resource absent **or not visible to the caller** (no existence leaks)               |
| 409  | `CONFLICT` ✅              | Unique/state conflicts (email exists on upgrade, self-demotion, open draft exists…) |
| 409  | `ATTEMPT_NOT_ACTIVE`       | Answer/abandon on a completed/abandoned attempt                                     |
| 409  | `STEP_ALREADY_ANSWERED`    | Second answer for the same step                                                     |
| 409  | `INVALID_STATE_TRANSITION` | Review/publish on a version in the wrong state                                      |
| 409  | `INSUFFICIENT_FUNDS`       | Hospital allocation cost exceeds funding                                            |
| 412  | `PRECONDITION_FAILED`      | `If-Match` version mismatch (admin edits)                                           |
| 413  | `VALIDATION_ERROR` ✅      | Body too large                                                                      |
| 422  | `IDEMPOTENCY_KEY_REUSED`   | Same key, different request                                                         |
| 429  | `RATE_LIMITED` ✅          | Rate limit hit (`Retry-After`)                                                      |
| 429  | `QUOTA_EXCEEDED`           | AI daily quota reached (`details`: resetsAt)                                        |
| 503  | `AI_UNAVAILABLE`           | AI disabled, budget cap reached, provider overloaded/refused                        |
| 503  | `SERVICE_UNAVAILABLE` ✅   | Dependency not configured/available (e.g. Google sign-in off)                       |
| 500  | `INTERNAL` ✅              | Unexpected; logged with `requestId`                                                 |

Every endpoint can return `400`, `401` (if authenticated), `429`, `500`; tables list only the specific extras.

## 4. System

| Method | Path            | Auth   | Response                                       |
| ------ | --------------- | ------ | ---------------------------------------------- |
| GET ✅ | `/health`       | Public | `{status:"ok", version}`                       |
| GET ✅ | `/ready`        | Public | `200 {status, version, database:"up"}` / `503` |
| GET ✅ | `/openapi.json` | Public | OpenAPI 3.1 document                           |

## 5. Authentication — `/auth`

| Method  | Path                        | Auth                       | Request                                                                                                      | Response                                                             | Specific errors                                           |
| ------- | --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- |
| POST ✅ | `/auth/register`            | Public                     | `{email, password (8–128, letters+digits), displayName (1–60)}` + `consent:{termsVersion, privacyVersion}` ▲ | `202 {message}` (identical whether or not the email exists)          | —                                                         |
| POST ✅ | `/auth/verify-email`        | Public                     | `{token}`                                                                                                    | `200 {message}`                                                      | 401 TOKEN_INVALID                                         |
| POST ✅ | `/auth/resend-verification` | Public                     | `{email}`                                                                                                    | `200 {message}` (always)                                             | —                                                         |
| POST ✅ | `/auth/login`               | Public                     | `{email, password, guestAccessToken?}` ▲                                                                     | `200 AuthResponse` (+cookie for web)                                 | 401 INVALID_CREDENTIALS, 403 EMAIL_NOT_VERIFIED/FORBIDDEN |
| POST ✅ | `/auth/google`              | Public                     | `{idToken, guestAccessToken?}`                                                                               | `200 AuthResponse`                                                   | 401, 503                                                  |
| POST    | `/auth/apple`               | Public                     | `{identityToken, authorizationCode, fullName?, guestAccessToken?}`                                           | `200 AuthResponse`                                                   | 401, 503                                                  |
| POST ✅ | `/auth/guest`               | Public (5/h/IP)            | `{}`                                                                                                         | `201 AuthResponse` (`user.isGuest=true`)                             | —                                                         |
| POST ✅ | `/auth/guest/upgrade`       | Player (guest)             | `{email, password, displayName, consent}`                                                                    | `200 {user, message}` (same id; progress kept)                       | 403 not a guest, 409 email exists                         |
| POST ✅ | `/auth/refresh`             | Refresh token              | `{refreshToken?}` (mobile)                                                                                   | `200 AuthResponse` (rotated token)                                   | 401 (reuse → whole session revoked)                       |
| POST ✅ | `/auth/logout`              | Refresh token              | `{refreshToken?}`                                                                                            | `200 {message}`; clears cookie; removes device token                 | —                                                         |
| POST    | `/auth/logout-all`          | Player                     | `{}`                                                                                                         | `200 {message}` (all sessions revoked)                               | —                                                         |
| GET     | `/auth/sessions`            | Player                     | —                                                                                                            | `200 {items:[{id, device, createdAt, lastUsedAt, current:boolean}]}` | —                                                         |
| DELETE  | `/auth/sessions/:id`        | Player (own)               | —                                                                                                            | `204`                                                                | 404                                                       |
| POST ✅ | `/auth/forgot-password`     | Public                     | `{email}`                                                                                                    | `200 {message}` (always)                                             | —                                                         |
| POST ✅ | `/auth/reset-password`      | Public                     | `{token, password}`                                                                                          | `200 {message}`; all sessions revoked                                | 401 TOKEN_INVALID                                         |
| POST    | `/auth/reauthenticate`      | Registered                 | `{password}` or `{idToken}` (social) or `{totpCode}`                                                         | `200 {authenticatedAt}` (step-up for 15 min)                         | 401                                                       |
| POST    | `/auth/mfa/totp/setup`      | Registered + step-up       | `{}`                                                                                                         | `200 {otpauthUri, secret (shown once)}`                              | 409 already enabled                                       |
| POST    | `/auth/mfa/totp/verify`     | Registered                 | `{code}`                                                                                                     | `200 {recoveryCodes: string[10] (shown once)}`                       | 401                                                       |
| POST    | `/auth/mfa/challenge`       | Session with `mfaRequired` | `{code}` or `{recoveryCode}`                                                                                 | `200 AuthResponse` (full)                                            | 401                                                       |
| DELETE  | `/auth/mfa`                 | Registered + step-up       | `{code}`                                                                                                     | `204` (blocked for staff roles: 409)                                 | 409                                                       |

**Guest merge (`guestAccessToken`)**: when a guest signs in to an existing account, the server verifies the guest token,
replays the guest's completed attempts into the account under first-completion rules, records `guest_merge` ledger
entries, then deletes the guest account. Response adds `merge: { attemptsMerged, hpAdded, fundingAdded }`.

## 6. Users — `/users`

| Method   | Path                        | Auth                 | Request                                                 | Response                                                     | Errors      |
| -------- | --------------------------- | -------------------- | ------------------------------------------------------- | ------------------------------------------------------------ | ----------- |
| GET ✅   | `/users/me`                 | Player               | —                                                       | `User`                                                       | —           |
| PATCH ✅ | `/users/me`                 | Player               | `{displayName}`                                         | `User`                                                       | —           |
| PUT      | `/users/me/consent`         | Registered           | `{termsVersion, privacyVersion, aiProcessing: boolean}` | `204`                                                        | —           |
| POST     | `/users/me/export` **[IK]** | Registered + step-up | `{}`                                                    | `202 {message}` (worker emails a time-limited download link) | 429 (1/day) |
| DELETE   | `/users/me`                 | Registered + step-up | `{confirm:"DELETE"}`                                    | `202 {scheduledFor}` (30-day grace; sign-in cancels)         | —           |
| POST     | `/users/me/deletion/cancel` | Registered           | `{}`                                                    | `204`                                                        | 404         |

## 7. Players — `/players/me`

| Method | Path                       | Auth   | Request                              | Response                                                                                                        |
| ------ | -------------------------- | ------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| GET    | `/players/me/profile`      | Player | —                                    | `{learnerLevel, institution, homeCountryCode, locale, avatarUrl, notificationPrefs, onboarding}`                |
| PATCH  | `/players/me/profile`      | Player | any subset of the above (validated)  | profile                                                                                                         |
| GET    | `/players/me/progress`     | Player | —                                    | `Progress` (+`ETag`)                                                                                            |
| GET    | `/players/me/ledger`       | Player | `page, pageSize`                     | `Page<{source, delta, balanceAfter, createdAt}>`                                                                |
| GET    | `/players/me/attempts`     | Player | `page, pageSize, missionKey?, mode?` | `Page<{id, missionKey, title, mode, status, score, maxScore, passed, startedAt, completedAt}>`                  |
| GET    | `/players/me/stats`        | Player | —                                    | `{storyCompleted, practiceCompleted, accuracyByTopic: {topic, correct, total}[], shiftsRun, debriefsGenerated}` |
| GET    | `/players/me/achievements` | Player | —                                    | `{earned: {key,name,icon,earnedAt}[], available: {key,name,description,icon,progress}[]}`                       |

## 8. Catalog — countries, tiers, missions

| Method | Path               | Auth                               | Request                                      | Response                                                                                                                                                                         | Errors                        |
| ------ | ------------------ | ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| GET    | `/catalog`         | Public (personalised if signed in) | `If-None-Match`                              | `{tiers: Tier[], countries: Country[], missions: MissionSummary[], hospital: {unitCost, resources}, minAppVersion: {android, ios}, etag}` — one call for app start/offline cache | 304                           |
| GET    | `/countries`       | Public                             | —                                            | `{items: Country[]}`                                                                                                                                                             | —                             |
| GET    | `/countries/:code` | Public                             | —                                            | `Country & {missionKeys: string[]}`                                                                                                                                              | 404                           |
| GET    | `/missions`        | Public                             | `mode=story\|practice`, `country?`, `topic?` | `{items: MissionSummary[]}` — published only; `locked` computed for story mode when signed in                                                                                    | —                             |
| GET    | `/missions/:key`   | Public                             | —                                            | `MissionDetail` (no steps — steps are served through attempts)                                                                                                                   | 404 (unpublished = not found) |

## 9. Gameplay — `/attempts`

| Method | Path                             | Auth           | Request                                  | Response                                                                                                                                                                       | Errors                                                                                          |
| ------ | -------------------------------- | -------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| POST   | `/attempts` **[IK]**             | Player         | `{missionKey, mode:"story"\|"practice"}` | `201 Attempt` (first step only). If an in-progress attempt exists for the mission it is returned with `200` (resume)                                                           | 403 MISSION_LOCKED, 404                                                                         |
| GET    | `/attempts/:id`                  | Player (owner) | —                                        | `Attempt` (resume)                                                                                                                                                             | 404                                                                                             |
| POST   | `/attempts/:id/answers` **[IK]** | Player (owner) | `{stepId, choiceId, reasoning? (≤1500)}` | `200 {step: AnsweredStep, next: PlayerStep \| null, result: AttemptResult \| null}` — `result` present when this was the last step (attempt completes in the same transaction) | 409 ATTEMPT_NOT_ACTIVE / STEP_ALREADY_ANSWERED, 400 unknown step/choice or not the current step |
| POST   | `/attempts/:id/abandon`          | Player (owner) | `{}`                                     | `200 Attempt` (`status:"abandoned"`, no rewards)                                                                                                                               | 409                                                                                             |

Rules (server): `stepId` must be the current step; `choiceId` must belong to it; reasoning is trimmed and stored;
rewards follow `platformSettings.economy` at the version recorded on the attempt; practice mode never changes HP,
funding or completion when `practiceAwardsRewards=false`.

Example — answer response:

```json
{ "step": { "stepId": "s1", "index": 0, "prompt": "What is your first step?",
            "choices": [ {"choiceId":"s1c3","text":"Start antibiotics immediately"},
                         {"choiceId":"s1c1","text":"Do a malaria rapid diagnostic test and check danger signs"},
                         {"choiceId":"s1c2","text":"Give paracetamol and send home"} ],
            "answer": { "choiceId":"s1c2", "correct": false, "correctChoiceId":"s1c1",
                        "feedback":"A drowsy child with fever may have severe malaria. Never send home untested.",
                        "critical": false } },
  "next": { "stepId":"s2", "index":1, "prompt":"RDT is positive and Chidi is hard to wake. Treatment?", "choices":[…] },
  "result": null }
```

## 10. Hospital Commander — `/hospital`

| Method | Path                      | Auth   | Request                                                                | Response                                                                                        | Errors                 |
| ------ | ------------------------- | ------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------- |
| GET    | `/hospital/config`        | Public | —                                                                      | `{unitCost, maxUnitsPerResource, resources: {key,name,icon}[]}` (event needs are not disclosed) | —                      |
| POST   | `/hospital/runs` **[IK]** | Player | `{allocation:{staff,beds,ambulances,supplies}}` (ints 0–50, total ≥ 1) | `201 HospitalRun`                                                                               | 409 INSUFFICIENT_FUNDS |
| GET    | `/hospital/runs`          | Player | `page, pageSize`                                                       | `Page<HospitalRun>` (without `progress`)                                                        | —                      |

## 10A. Synchronization — `/sync` (mobile offline support)

| Method | Path                    | Auth              | Request                                                     | Response                                                                    |
| ------ | ----------------------- | ----------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| POST   | `/sync/events` **[IK]** | Player            | `{events: SyncEvent[1..50]}` (`eventId` UUID, `occurredAt`) | `{serverTime, results: {eventId, status, code, message, data}[], progress}` |
| GET    | `/sync/state`           | Player            | `since?, progressVersion?`                                  | `{serverTime, progress\|null, profile\|null, attempts[], hospitalRuns[]}`   |
| POST   | `/sync/merge-guest`     | Registered player | `{guestAccessToken}`                                        | `{attemptsMerged, missionsCompleted, hpAdded, fundingAdded, progress}`      |

Event types: `attempt.start {missionKey, mode, clientRef}`, `attempt.answer {attempt: id\|"client:<ref>", stepId,
choiceId, reasoning?}`, `attempt.abandon`, `hospital.run {allocation}`, `profile.update`. Each `eventId` is applied at
most once (claimed under a unique index before it is applied); re-sent events return `duplicate` with the stored
result. Conflicts: the first answer to a step wins (same choice → `duplicate`, other choice → `rejected`
`STEP_ALREADY_ANSWERED` with the attempt state); profile edits are last-writer-wins by device time (`stale`); funding
is checked at processing time. Device times more than 5 minutes ahead are clamped. Guest merge replays completed guest
missions under first-completion rules; hospital shifts are not transferred; the guest is deleted.

## 11. AI debriefs

| Method | Path                              | Auth                                                  | Request                                                            | Response                                                                                                                                                                                                                                   | Errors                                                            |
| ------ | --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| POST   | `/attempts/:id/debriefs` **[IK]** | Player (owner); registered users must have AI consent | `{level: LearnerLevel}`                                            | `201 Debrief` (`completed`) when generated within the request window; `202 Debrief` (`pending`) if still running — poll `GET /debriefs/:id`. Re-requesting the same level returns the latest completed generation unless `regenerate:true` | 409 attempt not completed, 429 QUOTA_EXCEEDED, 503 AI_UNAVAILABLE |
| GET    | `/attempts/:id/debriefs`          | Player (owner)                                        | —                                                                  | `{items: Debrief[]}`                                                                                                                                                                                                                       | 404                                                               |
| GET    | `/debriefs/:id`                   | Player (owner)                                        | —                                                                  | `Debrief`                                                                                                                                                                                                                                  | 404                                                               |
| POST   | `/debriefs/:id/flags`             | Player (owner)                                        | `{reason: "inaccurate"\|"unsafe"\|"unhelpful"\|"other", comment?}` | `201 {message}`                                                                                                                                                                                                                            | 409 (≥5 flags)                                                    |
| GET    | `/ai/quota`                       | Player                                                | —                                                                  | `{limit, used, resetsAt, available: boolean}`                                                                                                                                                                                              | —                                                                 |

## 12. Clinician review — `/review` (permission `review:read`; decisions need `review:decide` + MFA)

| Method | Path                                           | Request                                                                                                                           | Response                                                                                                                                                                                        | Errors                                                                                                            |
| ------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| GET    | `/review/queue`                                | `status?=in_review\|changes_requested\|published`, `country?`, `page`                                                             | `Page<{missionId, missionKey, title, countryCode, versionId, versionNumber, status, submittedAt, previousPublishedVersion?}>`                                                                   | —                                                                                                                 |
| GET    | `/review/missions/:missionId`                  | —                                                                                                                                 | `{mission, versions: {id, versionNumber, status, submittedAt, publishedAt}[]}`                                                                                                                  | 404                                                                                                               |
| GET    | `/review/versions/:versionId`                  | —                                                                                                                                 | Full version **including answer key**, `contentHash`, references, `diffFromPublished` (field-level), `reviews: Review[]`, `choiceStats` (answer distribution of the previous published version) | 404                                                                                                               |
| POST   | `/review/versions/:versionId/reviews` **[IK]** | `{decision:"approved"\|"changes_requested", contentHash, checks:{scenario,treatment,references}, referenceIds: string[], notes?}` | `201 Review` — on approval the version is published atomically                                                                                                                                  | 409 INVALID_STATE_TRANSITION / hash mismatch, 403 self-approval or unverified clinician profile, 401 MFA_REQUIRED |
| GET    | `/review/references`                           | `search?, topic?, country?, page`                                                                                                 | `Page<Reference & {status, addedBy, lastVerifiedAt}>`                                                                                                                                           | —                                                                                                                 |
| POST   | `/review/references`                           | `{title, organization?, authors?, year?, edition?, type, url? (https), doi?, countryCodes?, topics?}`                             | `201 Reference`                                                                                                                                                                                 | 409 duplicate DOI                                                                                                 |
| PATCH  | `/review/references/:id`                       | subset; `status:"retired"` allowed                                                                                                | `Reference`                                                                                                                                                                                     | 404                                                                                                               |
| GET    | `/review/me`                                   | —                                                                                                                                 | `{clinician profile, verified: boolean, stats: {reviews, approvals}}`                                                                                                                           | —                                                                                                                 |
| GET    | `/review/flags`                                | `resolved?=false`, `page`                                                                                                         | `Page<{debriefId, missionKey, level, flags, output}>`                                                                                                                                           | —                                                                                                                 |
| POST   | `/review/flags/:debriefId/resolve`             | `{resolution}`                                                                                                                    | `204`                                                                                                                                                                                           | 404                                                                                                               |

`Review = { id, versionId, decision, checks, references: Reference[], notes, reviewer: {name, credentials}, createdAt }`.

## 13. Administration — `/admin` (permission per row; all writes audited; MFA required)

### 13.1 Users and roles

| Method | Path                               | Permission                     | Request                                                                                                                       | Response                                               | Errors                                                                                                |
| ------ | ---------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| GET ✅ | `/admin/users`                     | `users:read`                   | `search?, role?, status?=active\|disabled\|deletion_pending, page, pageSize`                                                  | `Page<User & {disabledAt, lastLoginAt}>`               | —                                                                                                     |
| GET    | `/admin/users/:id`                 | `users:read`                   | —                                                                                                                             | `User & {sessions, clinician, progressSummary, flags}` | 404                                                                                                   |
| PUT ✅ | `/admin/users/:id/roles`           | `users:manage-roles` + step-up | `{roles: Role[], reason}`                                                                                                     | `User`                                                 | 409 self-demotion / guest / unverified email; 409 reviewer role requires verified clinician profile ▲ |
| POST   | `/admin/users/:id/disable`         | `users:manage`                 | `{reason}`                                                                                                                    | `User` (all sessions revoked)                          | 409 self                                                                                              |
| POST   | `/admin/users/:id/enable`          | `users:manage`                 | `{reason}`                                                                                                                    | `User`                                                 | —                                                                                                     |
| PUT    | `/admin/users/:id/clinician`       | `clinicians:verify` + step-up  | `{fullName, credentials, profession, registrationBody, registrationNumber, countryCode, evidenceAssetIds, verified: boolean}` | `{clinician}`                                          | 404                                                                                                   |
| POST   | `/admin/users/:id/sessions/revoke` | `users:manage`                 | `{}`                                                                                                                          | `204`                                                  | —                                                                                                     |
| GET    | `/admin/roles`                     | `users:read`                   | —                                                                                                                             | `{items: {key, name, permissions}[]}`                  | —                                                                                                     |

### 13.2 Content authoring (D5: admins only)

| Method         | Path                                                | Permission                                          | Request                                                                                                   | Response                                                              | Errors                |
| -------------- | --------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------- |
| GET            | `/admin/missions`                                   | `content:read`                                      | `status?, country?, search?, page`                                                                        | `Page<Mission & {openDraft?, published?}>`                            | —                     |
| POST           | `/admin/missions`                                   | `content:edit`                                      | `{key, countryCode, tier, icon, topics, content:{title, story, steps, learningObjectives}, referenceIds}` | `201 {mission, version (draft v1)}`                                   | 409 key exists        |
| GET            | `/admin/missions/:id`                               | `content:read`                                      | —                                                                                                         | `{mission, versions}`                                                 | 404                   |
| PATCH          | `/admin/missions/:id`                               | `content:edit`                                      | `{tier?, icon?, sortOrder?, topics?}` (placement only)                                                    | `Mission`                                                             | 412                   |
| POST           | `/admin/missions/:id/versions`                      | `content:edit`                                      | `{basedOnVersionId?}`                                                                                     | `201 MissionVersion (draft)`                                          | 409 open draft exists |
| GET            | `/admin/versions/:versionId`                        | `content:read`                                      | —                                                                                                         | full version incl. answer key                                         | 404                   |
| PATCH          | `/admin/versions/:versionId`                        | `content:edit` (header `If-Match: <updatedAt>`)     | `{content?, referenceIds?, changeSummary?}`                                                               | `MissionVersion`                                                      | 409 not draft, 412    |
| POST           | `/admin/versions/:versionId/submit`                 | `content:edit`                                      | `{changeSummary}`                                                                                         | `MissionVersion (in_review, contentHash)`                             | 409                   |
| GET            | `/admin/versions/:versionId/diff`                   | `content:read`                                      | `against?=published\|<versionId>`                                                                         | `{changes: {path, before, after}[]}`                                  | —                     |
| POST           | `/admin/missions/:id/withdraw`                      | `content:publish-control` + step-up                 | `{reason}`                                                                                                | `Mission` (hidden from players)                                       | 409                   |
| POST           | `/admin/missions/:id/retire`                        | `content:publish-control` + step-up                 | `{reason}`                                                                                                | `Mission`                                                             | —                     |
| POST           | `/admin/countries` / PATCH `/admin/countries/:code` | `catalog:edit`                                      | country fields (§DB 4.7)                                                                                  | `Country`                                                             | 409                   |
| GET/POST/PATCH | `/admin/references[/:id]`                           | `references:edit`                                   | as `/review/references`                                                                                   | `Reference`                                                           | —                     |
| GET/POST/PATCH | `/admin/achievements[/:key]`                        | `catalog:edit`                                      | achievement fields                                                                                        | `Achievement`                                                         | —                     |
| POST           | `/uploads`                                          | `media:upload` (admins; reviewers for own evidence) | `{purpose, contentType, sizeBytes, sha256}`                                                               | `201 {assetId, upload: {url, fields}, expiresAt}` (S3 presigned POST) | 400 type/size         |
| POST           | `/uploads/:assetId/complete`                        | owner                                               | `{}`                                                                                                      | `202 {status:"scanning"}`                                             | 404                   |
| GET            | `/uploads/:assetId`                                 | owner/admin                                         | —                                                                                                         | `{status, url? (public or 5-min signed)}`                             | 404                   |

### 13.3 Settings, AI, analytics, audit, notifications

| Method | Path                            | Permission                | Request                                                                                            | Response                                                                                                                                |
| ------ | ------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/admin/settings/:key`          | `settings:read`           | —                                                                                                  | `{key, version, value, changeNote, createdBy, createdAt}`                                                                               |
| GET    | `/admin/settings/:key/history`  | `settings:read`           | `page`                                                                                             | `Page<…>`                                                                                                                               |
| PUT    | `/admin/settings/:key`          | `settings:edit` + step-up | `{value, changeNote, expectedVersion}`                                                             | new version (412 if `expectedVersion` stale; 400 if value fails the key's schema)                                                       |
| GET    | `/admin/ai/usage`               | `ai:read-usage`           | `from, to, groupBy=day\|model\|outcome`                                                            | `{series: {bucket, requests, inputTokens, outputTokens, costUsd, errorRate, p95LatencyMs}[], budget: {monthUsd, capUsd, percent}}`      |
| GET    | `/admin/analytics/overview`     | `analytics:read`          | `from, to`                                                                                         | `{activePlayers {daily, weekly, monthly}, newRegistrations, guestConversions, attemptsStarted, attemptsCompleted, debriefs, shifts}`    |
| GET    | `/admin/analytics/missions`     | `analytics:read`          | `from, to, country?`                                                                               | `{items: {missionKey, versionNumber, attempts, completionRate, passRate, avgScore, choiceDistribution: {stepId, choiceId, count}[]}[]}` |
| GET    | `/admin/analytics/funnel`       | `analytics:read`          | `from, to`                                                                                         | `{steps: {name, count}[]}` (visit → guest → first mission → registered)                                                                 |
| GET    | `/admin/audit-logs`             | `audit:read`              | `actorId?, targetType?, targetId?, action?, from?, to?, page`                                      | `Page<AuditLog>`                                                                                                                        |
| POST   | `/admin/announcements` **[IK]** | `notifications:broadcast` | `{title, body, route?, audience: {roles?: Role[], countries?: string[]}, channels: {push, email}}` | `202 {estimatedRecipients}`                                                                                                             |

## 14. Notifications and devices

| Method | Path                      | Auth           | Request                                                           | Response                                 |
| ------ | ------------------------- | -------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| GET    | `/notifications`          | Player         | `unread?=true, page`                                              | `Page<Notification> & {unreadCount}`     |
| POST   | `/notifications/:id/read` | Player (owner) | `{}`                                                              | `204`                                    |
| POST   | `/notifications/read-all` | Player         | `{}`                                                              | `204`                                    |
| PUT    | `/devices`                | Player         | `{token, platform:"android"\|"ios"\|"web", appVersion?, locale?}` | `204` (upsert; bound to current session) |
| DELETE | `/devices/:token`         | Player (owner) | —                                                                 | `204`                                    |

## 15. Rate limits (application level; WAF adds a coarse per-IP limit)

| Scope                                                                  | Limit                                                                         |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `/auth/login`, `/auth/google`, `/auth/apple`, register, password flows | 20 / 15 min per IP ✅; 10 failed logins / 15 min per account → `RATE_LIMITED` |
| `/auth/guest`                                                          | 5 / hour per IP                                                               |
| `/auth/refresh`                                                        | 60 / hour per session                                                         |
| `/attempts*`                                                           | 120 / min per user                                                            |
| `/attempts/:id/debriefs`                                               | daily quota (registered 10, guest 3) + 3 / min per user                       |
| `/hospital/runs`                                                       | 30 / min per user                                                             |
| `/uploads`                                                             | 20 / hour per user                                                            |
| `/admin/*`, `/review/*`                                                | 300 / min per user                                                            |
| Everything else                                                        | 600 / min per user or IP ✅                                                   |

## 16. Permission matrix (summary)

| Area                                                 | Public | Player (guest) | Registered          | Reviewer | Admin   |
| ---------------------------------------------------- | ------ | -------------- | ------------------- | -------- | ------- |
| Catalog, mission detail (published)                  | ✔      | ✔              | ✔                   | ✔        | ✔       |
| Play, Commander, own progress                        | —      | ✔              | ✔                   | ✔        | ✔       |
| AI debrief                                           | —      | ✔ (3/day)      | ✔ (10/day, consent) | ✔        | ✔       |
| Account export/deletion, MFA                         | —      | —              | ✔                   | ✔        | ✔       |
| Review workspace, references                         | —      | —              | —                   | ✔ (MFA)  | ✔ (MFA) |
| Content authoring, settings, users, analytics, audit | —      | —              | —                   | —        | ✔ (MFA) |

Full permission catalogue: `SECURITY_ARCHITECTURE.md §4`.
