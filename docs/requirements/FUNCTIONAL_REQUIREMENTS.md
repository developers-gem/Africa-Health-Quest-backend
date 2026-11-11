# Functional Requirements — Africa Health Quest v1

Conventions: **FR-x.y** requirement · _AC_ acceptance criteria · **[P]** preserves prototype behaviour ·
**[F]** fixes an audited defect · **[N]** new · **[Q#]** depends on a product decision in `TECHNICAL_RISKS.md`
(the recommended default is written here and changes if the owner decides otherwise).
All rules execute on the server; clients only render and submit.

## 1. Home dashboard

- **FR-1.1 [P]** Show kente strip, title, HP badge, funding badge, account button, tier card (current tier, HP to next tier,
  progress bar), hero image with tagline, and four mode entries (Story, Clinical Challenge, Hospital Commander, Countries).
- **FR-1.2 [P]** Signed-out/guest users see "Sign in to save progress across devices"; registered users see sync status.
- **FR-1.3 [F]** Header must not wrap at ≥ 360 px; large numbers abbreviate (e.g. 12.5k).
- _AC:_ Visual match to S01 at 390 px; tier card values come from `GET /me/progress`.

## 2. Player accounts

- **FR-2.1 [P]** Email + password registration with email confirmation before sign-in. ✅ built
- **FR-2.2 [P]** Google sign-in on web, Android, iOS. ✅ API built
- **FR-2.3 [N]** Guest play with a server guest account; upgrade in place keeps all progress (D3). ✅ API built
- **FR-2.4 [N]** Password reset by email; signs out all devices. ✅ built
- **FR-2.5 [N]** Profile: display name (editable), email, roles; account deletion and data export (data-protection).
- **FR-2.6 [F]** Sign-out clears all locally cached player data on the device.
- **FR-2.7 [F]** Links to reviewer/admin areas shown only to users with those roles.
- **FR-2.8 [N]** Signing into an existing account while holding guest progress: the guest's completed missions and
  rewards are merged server-side by replaying the guest's recorded attempts under first-completion rules (no `max` of totals);
  the guest account is then closed.
- _AC:_ Auth test suite (46 API tests exist); end-to-end sign-up → verify → sign in on web and Flutter.

## 3. Story Mode

- **FR-3.1 [P]** List published missions with icon, title, country flag + name, tier name, completion tick, lock state.
- **FR-3.2 [P]** Lock rule: locked if mission tier > player tier **or** player HP < country unlock threshold.
- **FR-3.3 [F]** Only clinician-approved, published versions are listed (D4). The "Awaiting review" badge disappears for
  players; "Clinician verified" detail appears on the result screen.
- **FR-3.4 [P]** Mission play: scenario, "Step i/n: prompt", optional reasoning (≤ 1500 chars), choices; one answer per step;
  after answering show correct (green), chosen-wrong (red), others dimmed, feedback of the chosen choice, Next/Finish.
- **FR-3.5 [F]** The client never receives `correct` flags or feedback before answering. `POST /attempts/:id/answers` returns
  correctness, the correct choice id and feedback for that step only.
- **FR-3.6 [F][Q12]** Scenario remains accessible (collapsible) on every step.
- **FR-3.7 [F]** An in-progress attempt survives refresh/app restart and can be resumed or abandoned.
- **FR-3.8 [P][Q5]** Result: "Patient saved!" if score ≥ 50 % of max, else "Learn and try again"; clinicians may flag
  _critical-error_ choices that force "Learn and try again".
- **FR-3.9 [F]** Result shows the **actual** HP and funding awarded.
- _AC:_ Golden tests reproduce prototype outcomes for all 10 missions; contract test proves no answer key in any
  pre-answer payload.

## 4. Clinical Challenge

- **FR-4.1 [P]** Grid of all published cases and a "Random Case" button (no immediate repeat of the previous case).
- **FR-4.2 [P]** Same play screen, reasoning box and debrief as Story Mode.
- **FR-4.3 [F][Q1]** Practice mode: locks ignored, **no HP/funding/completion awarded**; attempt and score recorded for
  learning history.
- **FR-4.4 [N]** Filter by country and topic.
- _AC:_ Playing a locked case from Clinical Challenge does not change progress.

## 5. Hospital Commander

- **FR-5.1 [P]** Allocate Staff, Beds, Ambulances, Supplies at ₵10 per unit; total cannot exceed funding.
- **FR-5.2 [P]** Start Shift: server deducts cost, picks one of the four events with server-side randomness, counts needs met
  (allocation ≥ need per resource), awards +15 HP and +₵8 per need met, returns event text and result
  "You covered k/4 needs. +N HP."
- **FR-5.3 [F]** Disabled controls are visually distinct; low-funds message shown below ₵10.
- **FR-5.4 [N]** Shift history stored per player.
- _AC:_ Shift rejected with 400 if allocation cost > funding; rewards match formula in unit tests; event distribution
  uniform within tolerance over 10 000 simulated shifts.

## 6. Country expansion

- **FR-6.1 [P]** List countries with flag, name, focus, "Unlocked" or "🔒 N HP"; teaser for remaining nations.
- **FR-6.2 [P]** Unlock when HP ≥ threshold (Nigeria 0, Ghana 100, Kenya 250, South Africa 450, Ethiopia 650).
- **FR-6.3 [N]** Country data (thresholds, focus, flag asset, currency label, locales) is admin-configurable; model supports 54.
- **FR-6.4 [F]** Flags rendered from SVG assets, with accessible names.

## 7. Health Points

- **FR-7.1 [P]** First completion of a Story mission awards HP equal to its score.
- **FR-7.2 [P][Q2][Q8]** A mission counts as completed only when passed; replays award 30 % of the _improvement_ over the
  previous best score (rounded); failed attempts award 0.
- **FR-7.3 [P]** Tier = highest tier whose threshold ≤ HP (0 / 150 / 400 / 800).
- **FR-7.4 [F]** HP changes only through server events (attempt finish, shift result); every change is recorded in a
  progress ledger (event, delta, source id, timestamp).

## 8. Funding

- **FR-8.1 [P]** Starting funding ₵100.
- **FR-8.2 [P][Q8]** First completion of a Story mission awards round(score / 2); replays award no funding.
- **FR-8.3 [P]** Commander spends and earns funding per FR-5.
- **FR-8.4 [F]** Funding never negative (database-level guard).

## 9. Mission progression

- **FR-9.1 [N]** Per-mission record: best score, attempts, passed flag, last played.
- **FR-9.2 [N]** Economy constants (points per step, pass threshold, replay factor, funding factor, tier and country
  thresholds, Commander costs/rewards) stored as versioned configuration, changeable by admins with audit.
- **FR-9.3 [F]** Progress responses are identical on all devices (server is the source of truth).

## 10. AI learning debrief

- **FR-10.1 [P]** After a finished attempt, the player selects a level (Nursing, Medical, Midwifery, Pharmacy student;
  Intern / junior doctor; Community health worker) and requests a debrief.
- **FR-10.2 [P]** Output sections: Overall · Decision by decision (quoting the student's reasoning) · Key teaching points
  (3–5, adapted to low-resource African settings) · Practice next (2 questions). ≤ 450 words. Disclaimer
  "For education only — not medical advice."
- **FR-10.3 [F]** Requires a signed-in (guest or registered) user; the debrief is generated from the server-recorded
  attempt (choices, correctness, reasoning) and the approved mission version — never from client-supplied correctness.
- **FR-10.4 [N]** Claude via the Anthropic API, server-side only; structured JSON output validated against a schema;
  model configurable (default `claude-sonnet-5-5`).
- **FR-10.5 [N][Q4]** The debrief may cite only references attached to the approved mission version.
- **FR-10.6 [N]** Debriefs are stored per attempt and level and can be re-opened; "Redo" regenerates within quota.
- **FR-10.7 [N]** Quotas: per user per day (default 10), global monthly budget; friendly messages for quota, rate-limit
  and provider errors.
- **FR-10.8 [N]** Usage ledger: user, attempt, model, input/output tokens, cost estimate, latency, outcome.
- **FR-10.9 [N]** Players can flag a debrief as wrong; flags appear in the admin/reviewer queue.
- _AC:_ Debrief for a deliberately wrong answer with "probably just a viral fever" identifies the danger sign
  (prototype test case); injection text in reasoning does not alter section structure; zod validation of output.

## 11. Clinician verification

- **FR-11.1 [P]** Reviewer workspace: list missions with status (Draft, Awaiting review, Changes requested, Approved/
  Published, Re-review needed).
- **FR-11.2 [P]** Review view shows the full scenario, every choice with correct flag and feedback, version id, and history.
- **FR-11.3 [P]** Approve requires: scenario realistic & culturally appropriate, treatment accurate, references support
  teaching (three checks) and ≥ 1 reference (title, optional URL). Request changes requires notes.
- **FR-11.4 [F]** Reviewer name and credentials come from a reviewer profile verified by an admin, not free text.
- **FR-11.5 [P][F]** Any content edit creates a new version and requires a new approval; the published version stays live
  until the new one is approved (or is withdrawn by an admin).
- **FR-11.6 [F]** The latest decision on a version determines its status.
- **FR-11.7 [N]** A reviewer cannot approve a version they authored (admins author per D5; an admin who is also a
  reviewer cannot approve their own edit).
- **FR-11.8 [P]** Players see "Clinician verified by {name}, {credentials}" with references on the result screen.
- **FR-11.9 [N]** Review history and audit log are immutable.

## 12. Progress synchronisation

- **FR-12.1 [F]** No client-side authoritative progress; clients fetch progress after each server event.
- **FR-12.2 [N]** Mobile caches published content (without answer keys) and the last known progress for offline display;
  answering requires connectivity [Q3].
- **FR-12.3 [N]** Requests that mutate progress are idempotent (client-generated idempotency key) so retries never
  double-award.

## 13. Administration (new)

- **FR-13.1** Users: search, view, assign/revoke roles (✅ API built), disable/enable accounts.
- **FR-13.2** Content: create/edit missions as drafts (story, steps, choices, feedback, country, tier, icon, references
  suggestions), preview, submit for review, withdraw published versions.
- **FR-13.3** Review queue and flagged debriefs.
- **FR-13.4** Configuration: countries, tiers, economy constants (FR-9.2).
- **FR-13.5** AI usage dashboard: requests, tokens, cost, errors per day; quota settings.
- **FR-13.6** Audit log viewer.

## 14. Non-functional requirements

| ID                        | Requirement                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1 Security            | OWASP ASVS L2 baseline; validated inputs; RBAC on every endpoint; secrets in a secret manager; dependency scanning in CI                    |
| NFR-2 Privacy             | Data minimisation; no patient data; deletion/export; privacy policy; compliance review for NDPA, Ghana DPA, Kenya DPA, POPIA, Ethiopia PDPP |
| NFR-3 Performance         | API p95 < 300 ms (excluding AI); web LCP < 2.5 s on mid-range Android/slow 4G; initial JS < 200 KB gzip                                     |
| NFR-4 Availability        | 99.5 % monthly for API and web                                                                                                              |
| NFR-5 Accessibility       | WCAG 2.2 AA for web; Flutter semantics labels; text alternatives for emoji/flags; not colour-only feedback                                  |
| NFR-6 Responsiveness      | Phone-first; correct at 360, 390, 768, 1280 px                                                                                              |
| NFR-7 Observability       | Structured logs with request ids, metrics, error tracking, AI usage ledger, alerting                                                        |
| NFR-8 Testability         | Unit + integration + E2E; CI blocks merges on failures; content-parity and answer-key-leak tests                                            |
| NFR-9 Contracts           | Single OpenAPI document generated from shared schemas; breaking changes versioned (`/api/v2`)                                               |
| NFR-10 Localisation-ready | All UI strings externalised; content model supports locales                                                                                 |
