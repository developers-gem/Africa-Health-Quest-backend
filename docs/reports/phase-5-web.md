# Phase 5 report — React website

**Commits:**

- `02f514c`: backend AI debriefs (needed by two of the requested screens).
- `768bbb9`: backend fixes found while testing in a browser.
- `4e4d56b`: the website.

**Stack:** React 19, Vite, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), Zustand, TanStack Query, React Router.
Types come from `@ahq/api-contracts`, and forms validate with the same contract schemas the API uses.

**Result.** All screens are connected to the Express API. Nothing is static or uses hardcoded production data. Every list and page has loading, empty, error and success states.

| Gate                                     | Result                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck, format (whole monorepo) | Clean                                                                                                                                  |
| Backend tests                            | 246 passing                                                                                                                            |
| Web unit and component tests             | 27 passing                                                                                                                             |
| Playwright browser tests                 | 24 passing on desktop (1366 px), tablet (iPad Mini, 768 px) and phone (Pixel 7); 2 skips are the phone-only menu test on wider screens |

The browser tests run against the real backend and MongoDB.

## 1. Design system

**Identity.** The prototype's look is kept:

- warm cream background;
- deep orange, green and gold;
- kente strip;
- 2 px dark outlines with offset "pop" shadows;
- rounded cards and coloured action tiles;
- HP and funding pills;
- the prototype's hero illustration.

**Typography and colour.**

- Fonts are self-hosted (Bricolage Grotesque, Plus Jakarta Sans).
- The orange and green are slightly darkened to meet WCAG AA contrast.
- The chart colour passed the palette validator: lightness band, chroma floor, and at least 3:1 against cards.

**Accessibility and motion.**

- A skip link on every layout.
- Labelled form fields, with errors linked to their fields.
- Focus rings.
- Reduced-motion support.
- An `h1` on every page.
- Charts have a table view and hover/focus tooltips.

**Layouts.**

- Public site: header with a phone menu.
- Player app: header navigation on tablet and desktop, bottom tab bar on phones.
- Clinician and admin consoles: sidebar on desktop, drawer on smaller screens.

## 2. Screens

**Verified** means:

- **E2E**: driven through the UI in Playwright against the real API.
- **R**: rendered in the responsive suite (no horizontal scroll at three widths).
- **C**: component test with a mocked API.
- **Build**: typecheck and build only; its API is covered by backend integration tests.

| Area      | Screen                                                                                                  | Route                                                          | Verified                          |
| --------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| Public    | Landing (live counts from the catalogue)                                                                | `/`                                                            | E2E, R                            |
| Public    | About · How to play (levels and Commander rules from the API) · Learning (objectives of approved cases) | `/about`, `/how-to-play`, `/learn`                             | R                                 |
| Public    | Countries, country detail (approved cases per country)                                                  | `/countries[/:code]`                                           | R                                 |
| Public    | Registration and guest upgrade · email verification · login                                             | `/register`, `/verify-email`, `/login`                         | E2E, C                            |
| Public    | Password recovery                                                                                       | `/forgot-password`, `/reset-password`                          | R (form); reset completion: Build |
| Player    | 1 Dashboard                                                                                             | `/play`                                                        | E2E, R                            |
| Player    | 2 Story Mode                                                                                            | `/play/story`                                                  | E2E, R                            |
| Player    | 3 Clinical Challenge (random case, practice)                                                            | `/play/challenge`                                              | R                                 |
| Player    | 4 Mission listing (filters)                                                                             | `/play/missions`                                               | R                                 |
| Player    | 5 Mission details (clinician verification, references)                                                  | `/play/missions/:key`                                          | E2E                               |
| Player    | 6 Clinical gameplay · 7 Reasoning input                                                                 | `/play/attempts/:id`                                           | E2E, C                            |
| Player    | 8 AI debrief (consent, level, polling, report)                                                          | result panel                                                   | E2E, C                            |
| Player    | 9 Hospital Commander                                                                                    | `/play/commander`                                              | E2E, C, R                         |
| Player    | 10 Country expansion                                                                                    | `/play/countries`                                              | R                                 |
| Player    | 11 Profile · 12 Achievements                                                                            | `/play/profile`, `/play/achievements`                          | E2E, R                            |
| Player    | 13 Learning history (cases and rewards ledger)                                                          | `/play/history`                                                | E2E, R                            |
| Player    | 14 Account settings (profile, MFA, password, devices)                                                   | `/play/settings`                                               | R                                 |
| Clinician | Reviewer dashboard · assigned missions                                                                  | `/review`, `/review/assignments`                               | E2E (dashboard)                   |
| Clinician | Scenario inspection · treatment review · approval                                                       | `/review/versions/:id`                                         | E2E                               |
| Clinician | Request changes                                                                                         | `/review/versions/:id`                                         | Build                             |
| Clinician | Reference verification (library, "verify today")                                                        | `/review/references`                                           | E2E (add)                         |
| Clinician | Review history · mission history · reported debriefs                                                    | `/review/history`, `/review/missions/:key`, `/review/ai-flags` | Build                             |
| Clinician | Reviewer profile (application, evidence upload)                                                         | `/review/profile`                                              | E2E (no evidence file)            |
| Admin     | Overview                                                                                                | `/admin`                                                       | E2E                               |
| Admin     | User management: list, search, roles                                                                    | `/admin/users[/:id]`                                           | E2E                               |
| Admin     | User management: suspend, sign-out, HP/funding adjustment, erasure                                      | `/admin/users/:id`                                             | Build                             |
| Admin     | Clinician management (decrypted registration, evidence, verify)                                         | `/admin/clinicians[/:id]`                                      | E2E                               |
| Admin     | Country management (edit, image upload, unlocks, activation)                                            | `/admin/countries/:code`                                       | E2E                               |
| Admin     | Mission assignment to a country                                                                         | `/admin/countries/:code`                                       | Build                             |
| Admin     | Mission management (author, edit draft, save, submit)                                                   | `/admin/missions/new`, `/admin/versions/:id`                   | E2E                               |
| Admin     | Placement, publishing controls, rollback                                                                | `/admin/missions/:key`                                         | Build                             |
| Admin     | Content publishing (queue)                                                                              | `/admin/publishing`                                            | E2E                               |
| Admin     | Reviewer assignment                                                                                     | `/admin/publishing`                                            | Build                             |
| Admin     | AI settings (model, effort, quotas, kill switch, budget, prices) and usage                              | `/admin/ai`                                                    | E2E (view); saving: Build         |
| Admin     | Analytics (overview, pass rate, guest funnel, choice distribution)                                      | `/admin/analytics`                                             | E2E                               |
| Admin     | Reports (CSV built from live API data)                                                                  | `/admin/reports`                                               | E2E (mission CSV)                 |
| Admin     | Audit logs                                                                                              | `/admin/audit`                                                 | E2E                               |
| Admin     | Platform configuration: economy setting                                                                 | `/admin/configuration`                                         | E2E (one versioned change)        |
| Admin     | Platform configuration: emergencies, achievements                                                       | `/admin/configuration`                                         | E2E                               |
| Admin     | Platform configuration: levels, Commander rules                                                         | `/admin/configuration`                                         | Build                             |

## 3. How the end-to-end journey works

Three separate browser sessions:

1. **Administrator.**
   - Registers and follows the emailed link.
   - Is made the first admin with the real `admin:grant` script.
   - Signs in and is forced to set up two-factor authentication.
   - Saves the recovery codes.
2. **Clinician.**
   - Registers and applies as a reviewer.
   - Cannot open the review console yet.
   - The admin sees the decrypted registration number, verifies it, and grants the reviewer role.
   - The clinician signs in again (role changes sign out every device) and sets up two-factor authentication.
   - Adds a WHO reference and inspects the scenario and treatment.
   - **Approve** stays disabled until all three checks and a reference are selected; then they approve.
3. **Guest player.**
   - Sees no cases before approval; afterwards plays the case with written reasoning.
   - Saves the patient (+50 HP, ₵125), gets an AI debrief (consent first) citing the approved WHO reference, and runs a Commander shift.
   - Sees both in the history and ledger.
   - Is refused at `/admin` and `/review`.
   - Upgrades to an account without losing progress.

The admin then checks the published mission, analytics, AI usage, the audit trail and a CSV download.

**Test conditions.** E2E runs use:

- their own database;
- the new `file` mail transport, to follow emailed links;
- the deterministic `fake` AI provider.

They never call Anthropic.

## 4. Defects found by testing in the browser (all fixed)

**Staff two-factor flow**

1. Staff who hadn't enrolled in two-factor authentication were shown a code prompt instead of setup.
2. The one-time recovery codes vanished immediately after setup, so users never saw them. The session now updates only after "I've saved them — continue".

**Player and backend**

3. After a guest upgraded to an account, the page told them to "sign in" instead of "your progress is already saved".
4. The AI debrief could not cite the references a clinician confirmed when approving a case (only references attached to the draft). Fixed in the backend.

**Accessibility and analytics**

5. The authentication pages had no `<h1>`.
6. The choice-distribution chart showed internal IDs (`s1c1`); it now shows each choice's text and marks the official answer.

**Test environment**

7. The browser tests silently depended on a developer's local `apps/backend/.env`, which had MFA turned off. The tests now pin their whole environment.
8. CI used a fixed database and retried the serial journeys, so a retry would re-register the same users. Each run now gets its own database and the journeys don't retry.

## 5. Additions and deviations from the design documents

**AI debriefs: built in this phase**

- The website needed AI debriefs and AI settings, which had no backend, so they were built to the approved AI architecture:
  - server-side Claude (`claude-opus-5-5`, medium effort, refusal fallback, structured output);
  - verdicts taken from the recorded attempt, not the model;
  - only clinician-approved references cited;
  - quotas, kill switch and monthly budget;
  - usage and cost logging.
- `GET /ai/quota` became `GET /ai/status` plus `POST /ai/consent`, which add the consent state the architecture requires.
- Reported debriefs are listed at `/review/ai-flags`.

**Other changes**

- **Reports** are CSV downloads built in the browser from the live analytics, AI-usage and audit APIs. No new report endpoints were added.
- **Dev/test-only mail transport:** `MAIL_TRANSPORT=file` writes emails (with their links) to a local folder for development and browser tests. Production refuses it.

## 6. Not verified, and outstanding issues

**Not verified**

1. **Real AI output.** No Anthropic API key is available here. The adapter is unit-tested with the SDK's `fetch` injected (exact request shape, refusal and overload handling). Before launch, run the clinician evaluation set from `AI_ARCHITECTURE.md` §10 with a real key, and set the monthly budget (decision AI-4).
2. **Google sign-in.** The button appears only when `VITE_GOOGLE_CLIENT_ID` is set; never tested with a real Google client.
3. **Browsers other than Chromium.** Firefox and Safari/WebKit have not been run. Responsive checks used Chromium device emulation only.
4. **Actions with no browser test** (marked "Build" in §2): request changes, rollback/withdraw/retire, reviewer assignment, erasure, suspension, adjustments, settings forms other than economy, and password-reset completion. Their API endpoints are covered by backend integration tests.

**Outstanding issues**

5. **Main bundle size.** The main chunk is about 420 KB (134 KB gzipped), because forms import the shared contract schemas. Each area loads as its own chunk.
6. **Console 401 on load.** Restoring the session when signed out logs one expected 401 in the browser console. The refresh cookie is HttpOnly, so the page can't tell in advance that no session exists.
7. **Carried over from Phase 4:**
   - notifications and announcements;
   - Apple sign-in;
   - self-service account deletion;
   - S3 media storage and malware scanning;
   - shared rate limits;
   - CI never run on GitHub (no repository connected);
   - Q1–Q12 product defaults;
   - erasure policy.
