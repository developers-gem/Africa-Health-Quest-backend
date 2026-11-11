# Development Roadmap — Africa Health Quest

Phase numbering follows the master project plan, in which this audit is **Phase 1**.

> **Numbering note:** the foundation and identity work delivered on 2026-11-03 (commit `bbb130c`) was reported as
> "Phase 0–1" in `docs/reports/phase-0-1.md`, `README.md` and `docs/architecture.md`. In this roadmap it is **Phase 2**.
> Those three earlier files keep the old labels until this roadmap is approved. They are not edited during the audit.

Every phase follows the project methodology: inspect → plan → affected files → dependencies → risks → acceptance criteria →
implement → test → document. **No phase starts without product-owner approval of the previous phase's report.**

| Phase | Name                                          | Status                                             | Size |
| ----- | --------------------------------------------- | -------------------------------------------------- | ---- |
| 1     | Technical audit & product analysis            | **Awaiting approval**                              | —    |
| 2     | Foundation & identity                         | **Built, awaiting review against these documents** | —    |
| 3     | Content model, versioning & seed              | Next                                               | M    |
| 4     | Server-authoritative gameplay engine          | Planned                                            | L    |
| 5     | AI learning debrief (Claude)                  | Planned                                            | M    |
| 6     | Clinician review workflow                     | Planned                                            | M    |
| 7     | React web application (parity)                | Planned                                            | L    |
| 8     | Administration dashboard                      | Planned                                            | M    |
| 9     | Flutter Android & iOS                         | Planned                                            | XL   |
| 10    | Production infrastructure, hardening & launch | Planned (parts start earlier)                      | L    |

Sizes are relative (S < M < L < XL). Calendar estimates come with each phase plan, once team capacity is known.

---

## Phase 1 — Audit & analysis _(this phase)_

**Deliverables:** PRODUCT_REQUIREMENTS, FUNCTIONAL_REQUIREMENTS, TECHNICAL_AUDIT, EXISTING_FEATURE_INVENTORY, MIGRATION_PLAN,
SCREEN_INVENTORY, TECHNICAL_RISKS, DEVELOPMENT_ROADMAP, screenshot evidence (`docs/audit-evidence/`).
**Exit:** owner approves the documents and answers Q1–Q12 (`TECHNICAL_RISKS.md`).

## Phase 2 — Foundation & identity ✅ built

Monorepo, shared contracts + OpenAPI, Express API core (config, errors, logging, security headers, CORS, rate limits,
health), authentication (email + verification, Google ID token, guest + in-place upgrade, rotating refresh tokens,
password reset), RBAC, audited role administration, CI, Dockerfile. **50 tests passing.**
**Gaps identified by the audit, scheduled into later phases:**

- profile deletion/export → Phase 10;
- disable/enable accounts (FR-13.1) → Phase 8;
- guest-into-existing-account merge (FR-2.8) → Phase 4;
- cascade deletion of guest progress → Phase 4.

## Phase 3 — Content model, versioning & seed

- `Mission`, `MissionVersion` (immutable, sha-256 content hash, status machine draft → in_review → approved/changes_requested
  → published → retired), `Country`, `Tier`, `CommanderEvent`, `EconomyConfig` (versioned).
- Idempotent seed of the prototype content **verbatim**; parity test against `legacy/lovable-prototype/game-data.ts`.
- Player read APIs: countries, tiers, published missions (no answer keys), mission detail.
- Admin content APIs (D5): create/edit drafts, submit for review, withdraw.

**Acceptance:**

- 10 missions, 17 steps, 38 choices, 5 countries and 4 tiers are imported with identical text.
- Unapproved missions are invisible to players (D4).
- An automated test proves no player response contains `correct` or `feedback`.

## Phase 4 — Server-authoritative gameplay

- `Attempt` lifecycle (start → answer per step → finish), resumable, idempotent answers.
- Pure `scoring` module: prototype formulas first (golden tests), then the approved Q1/Q2/Q5/Q8 changes.
- `PlayerProgress` + progress ledger.
- Locks and tier computation on the server.
- Clinical Challenge practice mode.
- Commander shifts with server randomness.
- Guest merge (FR-2.8) and guest data cascade.

**Acceptance:**

- Golden tests pass for every mission.
- Forged or replayed requests cannot change progress.
- Two concurrent devices produce consistent totals.

## Phase 5 — AI learning debrief

- Anthropic Messages API client (server-only) with structured JSON output, prompt carried over from the prototype's four
  sections, level adaptation, injection-resistant input handling, citation restriction (Q4).
- Stored debriefs, quotas, usage ledger, error mapping (quota / rate limit / provider).
- Flagging of incorrect debriefs.

**Acceptance:**

- The prototype test case ("probably just a viral fever") flags the danger sign.
- Output always validates against the schema.
- A clinician rates a sample of 20 debriefs, with ≥ 90 % judged accurate.
- Cost per debrief is measured and reported.

## Phase 6 — Clinician review workflow

- Reviewer profiles with admin-verified credentials.
- Review API: approve with 3 checks + ≥ 1 reference; request changes with notes required; the latest decision wins;
  approving publishes the version.
- No self-approval of own edits; immutable history; audit log.
- Public verification DTO (name, credentials, references, date).

**Acceptance:**

- Editing content invalidates approval.
- The player badge always matches the reviewer's latest decision.
- All permission paths are tested.
- **Recruit ≥ 2 clinician reviewers at the start of this phase** (critical path R-20).

## Phase 7 — React web application

- Vite + React + TS + Tailwind + shadcn/ui; routes per screen; TanStack Query; API client generated from the contracts;
  design tokens ported (with the Q10 contrast fix if approved).
- All screens SC-01…SC-16; reviewer workspace UI; guest flow; single-flight token refresh.
- Responsive header and layouts (360/390/768/1280 px), WCAG 2.2 AA.

**Acceptance:**

- Screen-by-screen comparison with `audit-evidence` passes.
- Playwright end-to-end tests cover every feature.
- Lighthouse performance and accessibility budgets are met.

## Phase 8 — Administration dashboard

Users & roles (incl. disable), content editor with preview and submit-for-review, review queue, flagged debriefs, economy and
country configuration, AI usage dashboard, audit-log viewer.
**Acceptance:** an admin can author a new mission, have it reviewed and publish it without a code deployment.

## Phase 9 — Flutter Android & iOS

- Riverpod, Dio (auth interceptor, single-flight refresh), GoRouter, SQLite cache, `flutter_secure_storage`, Google
  sign-in, Dart models generated from OpenAPI.
- Theme from the design tokens.
- FCM push for review/approval notifications and engagement (opt-in).
- Offline behaviour per Q3.

**Acceptance:**

- Feature parity with web.
- Widget and integration tests pass.
- Internal-testing builds are distributed on Google Play and TestFlight.

## Phase 10 — Production infrastructure & launch

_Can start in parallel from Phase 4._

- AWS via IaC (Q7): ECS Fargate + ALB, S3 + CloudFront, Atlas (Q9 region), SES, S3 media, Secrets Manager, CloudWatch
  with alarms, WAF.
- Shared rate-limit store; backups and restore drill.
- CD pipelines for staging and production; security review / penetration test.
- Privacy policy and terms; account deletion and export; cut-over from the prototype (`MIGRATION_PLAN.md §3`).

**Acceptance:**

- The parity checklist in `MIGRATION_PLAN.md §5` is complete.
- No critical or high security findings remain open.
- Restore drill succeeds.
- Product owner signs off.

---

## Critical path and dependencies

```
1 Audit ──► 3 Content ──► 4 Gameplay ──► 5 AI ─────────────┐
               │              │                              ├─► 7 Web ──► 10 Launch (web)
               └──► 6 Review ─┴─► clinician approvals (R-20) ┘        └─► 9 Flutter ──► store release
                                       8 Admin (after 3 + 6) ─────────┘
10 Infrastructure work starts in parallel from Phase 4
```

The **launch is gated by clinician approvals** (D4): no mission is visible to players until approved in the new system.

## Immediate next steps after approval

1. Owner answers Q1–Q12.
2. Connect the GitHub repository; push the existing work; CI goes green.
3. Start Phase 3 with its implementation plan for approval.
