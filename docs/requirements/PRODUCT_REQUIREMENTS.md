# Product Requirements — Africa Health Quest

**Tagline:** _Save Lives. Build Healthier Nations._
**Status:** Draft for product-owner approval · 2026-11-03
**Inputs:** original product description, Lovable development history, prototype audit (`TECHNICAL_AUDIT.md`), master project
instructions, approved decisions D1–D5 (`decisions.md`).

## 1. Vision

An African healthcare education and strategy game at the intersection of mobile gaming, health education, African culture
and medical training. The player starts as a young healthcare professional running a small community clinic and grows it,
through successful missions, into a national health system:

**Village Clinic → Community Hospital → Regional Medical Center → National Health System**

Content is adapted to each African country — diseases, health-system challenges, environments and cultural elements —
starting with Nigeria, Ghana, Kenya, South Africa and Ethiopia and expanding toward all 54 countries.

## 2. Problem and opportunity

- Healthcare students in many African settings have limited access to realistic, locally relevant case practice and
  structured feedback.
- Existing case banks are rarely contextualised to low-resource African settings or to national guidelines.
- Games and mobile phones offer reach; AI can give individual feedback at scale; clinician review makes it trustworthy.

## 3. Users

| Persona                                                        | Needs                                                                                       | Primary modes                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Healthcare student** (nursing, medical, midwifery, pharmacy) | Realistic cases, clear explanations, feedback on _their_ reasoning, progress across devices | Clinical Challenge, Story, AI debrief |
| **Intern / junior doctor, community health worker**            | Quick refreshers on emergencies and first-line care in low-resource settings                | Clinical Challenge, debrief           |
| **General player / public**                                    | Engaging story, learning about African health systems                                       | Story, Commander, Countries           |
| **Clinician reviewer**                                         | Efficient review of scenarios, answers and references; clear history and accountability     | Review workspace                      |
| **Administrator**                                              | Manage users/roles, author and edit content, monitor review queue and AI usage              | Admin dashboard                       |
| _(Future)_ Educator / institution                              | Assign cases, view cohort results                                                           | Out of scope for v1                   |

## 4. Goals (v1 — production platform)

1. **Parity:** preserve every prototype feature and all mission content (verbatim) on web, Android and iOS.
2. **Trust:** all clinical content is clinician-approved before players see it (D4); AI feedback is educational and never
   changes official answers or approves content.
3. **Integrity:** scoring, rewards, unlocks and answer keys are server-authoritative; progress is identical across devices.
4. **Learning value:** personalised AI debriefs grounded in the student's recorded decisions and the mission's approved
   references.
5. **Operability:** admins manage content, roles and reviews without code deployments; AI usage is monitored and capped.

## 5. Non-goals for v1

- Leaderboards, social features, multiplayer.
- Institutional/cohort management, LMS integration.
- Additional countries beyond the existing 5 (the data model must support 54; content comes later).
- Local-language translations (the data model must support locales; translations come later).
- Real patient data of any kind; any clinical decision-support use.
- Monetisation/payments.

## 6. Scope

### 6.1 Player experience (parity + fixes)

Home dashboard · Accounts (email, Google, guest with in-place upgrade) · Story Mode · Clinical Challenge ·
Hospital Commander · Countries · Health Points · Funding · Tier progression · AI learning debrief · Verification
display · Cross-device progress. Detailed in `FUNCTIONAL_REQUIREMENTS.md`.

### 6.2 Clinical governance

Mission version history; reviewer workspace; approve / request changes with three checks and ≥ 1 reference; any edit
invalidates approval; only approved versions are published; full audit trail; reviewer identity and credentials verified
by an admin.

### 6.3 Administration

Users and roles; mission authoring (admins only — D5); review queue; country/tier/economy configuration; AI usage
and cost dashboard.

### 6.4 Platforms

Responsive web (phone-first, usable on tablet/desktop) · Flutter Android · Flutter iOS · public REST API with OpenAPI docs.

## 7. Clinical safety principles (from the master instructions)

- Clinical content must have appropriate references; never invent guidelines or references.
- Only authorised clinicians can approve content; AI must not approve content or modify official answers.
- Content changes invalidate previous approvals; every mission has version history.
- AI output is labelled "for education only — not medical advice".

## 8. Success measures (proposed — targets to be agreed)

| Measure                                 | Proposed v1 target                                                        |
| --------------------------------------- | ------------------------------------------------------------------------- |
| Missions clinician-approved at launch   | 10 / 10                                                                   |
| Account conversion (guest → registered) | ≥ 25 % of guests who finish 3 missions                                    |
| Debrief usage                           | ≥ 40 % of completed Clinical Challenge cases request a debrief            |
| Debrief quality                         | ≥ 90 % of sampled debriefs rated accurate by a clinician reviewer         |
| Cross-device consistency                | 0 progress-loss incidents                                                 |
| Web performance                         | LCP < 2.5 s on a mid-range Android over 3G (Lighthouse "Slow 4G" profile) |
| Crash-free sessions (mobile)            | ≥ 99.5 %                                                                  |
| Security                                | 0 critical/high findings open at launch                                   |

## 9. Constraints

- Technology stack fixed by the master instructions (React/Vite/TS/Tailwind/shadcn · Node/Express/TS · MongoDB/Mongoose ·
  Flutter/Riverpod/Dio/GoRouter/SQLite · Anthropic Claude · AWS · MongoDB Atlas · FCM · GitHub Actions).
- No secrets in code; role-based authorisation; validated inputs; automated tests; API documentation.
- Data-protection laws of target countries (see `TECHNICAL_RISKS.md` R-32).
- Low-bandwidth, low-end-device friendliness.

## 10. Release plan (summary — see `DEVELOPMENT_ROADMAP.md`)

1. Backend content, gameplay, AI and review services.
2. Clinician approval of the 10 missions.
3. Web launch (parity) → prototype retired.
4. Admin dashboard.
5. Android/iOS beta → store release.

## 11. Open questions

Q1–Q12 in `TECHNICAL_RISKS.md §Product decisions needed`.
