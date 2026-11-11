# Existing Feature Inventory — Lovable prototype

Classification key (a feature can carry several):

| Tag         | Meaning                                                                          |
| ----------- | -------------------------------------------------------------------------------- |
| **FULL**    | Fully implemented — works as described in the product history                    |
| **PARTIAL** | Partially implemented — works but with gaps or defects against the stated intent |
| **NONE**    | Not implemented                                                                  |
| **MIGRATE** | Requires migration to the target stack                                           |
| **SECURE**  | Requires security improvements                                                   |

Evidence: `S##` = PDF screenshot, `L##` = local-run capture (both in `docs/audit-evidence/`), file refs are prototype paths.

## Summary

| #   | Feature                  | Classification             |
| --- | ------------------------ | -------------------------- |
| 1   | Home dashboard           | FULL · MIGRATE             |
| 2   | Player accounts          | PARTIAL · MIGRATE · SECURE |
| 3   | Story Mode               | PARTIAL · MIGRATE · SECURE |
| 4   | Clinical Challenge       | PARTIAL · MIGRATE · SECURE |
| 5   | Hospital Commander       | PARTIAL · MIGRATE · SECURE |
| 6   | Country expansion        | PARTIAL · MIGRATE · SECURE |
| 7   | Health Points            | PARTIAL · MIGRATE · SECURE |
| 8   | Funding system           | PARTIAL · MIGRATE · SECURE |
| 9   | Mission progression      | PARTIAL · MIGRATE · SECURE |
| 10  | AI learning debrief      | PARTIAL · MIGRATE · SECURE |
| 11  | Clinician verification   | PARTIAL · MIGRATE · SECURE |
| 12  | Progress synchronisation | PARTIAL · MIGRATE · SECURE |

Only the Home dashboard is fully implemented as described. Every other feature works but has gaps or defects, and every feature needs to move to the new stack. All except the Home dashboard have security issues, because the browser decides scores and rewards. Details below.

---

## 1. Home dashboard — FULL · MIGRATE

**What exists:** kente strip; header with title (tap = home), ❤️ HP badge, ₵ funding badge, Sign in/👤 button;
tier card (icon + tier name, "N HP to next tier", progress bar, "Sign in to save progress across devices" link or
sync status); hero image with tagline; four mode buttons (Story, Clinical, Commander, Countries). (S01, L01)
**Gaps:** header wraps at 390 px (L03); single 448 px column on desktop (L12); no onboarding/tutorial; progress bar
full at top tier with no label.

## 2. Player accounts — PARTIAL · MIGRATE · SECURE

**What exists:** email/password sign-in and sign-up (toggle), email confirmation required, Google OAuth,
signed-in panel (email, link to clinician area, sign out). (S10, L06)
**Missing / defects:**

- No password reset, display name, profile, account deletion or data export.
- The clinician-area link is shown to **every** signed-in user.
- Sign-out leaves local progress on the device; next user inherits and merges it.
- Supabase/Lovable-specific (Lovable OAuth broker). → _Already rebuilt in the new API (Phase 2 work): email
  verification, Google ID-token sign-in, guest accounts, password reset, rotating sessions, RBAC._

## 3. Story Mode — PARTIAL · MIGRATE · SECURE

**What exists:** list of 10 missions with icon, title, flag + country, tier, review badge, ✔ when done, 🔒 + 50 %
opacity when locked (S02). Mission screen: Back, icon, title, story (step 1 only), "Step i/n: prompt", optional
reasoning textarea (≤1500 chars, locks after answering), choice buttons; after choosing: correct turns green,
chosen-wrong red, others dimmed, feedback panel + Next/Finish (S03, S04, S06, S07, L02). Result: 🎉 "Patient saved!"
or 💔 "Learn and try again", "+N Health Points", Continue, verification box, AI debrief panel (L03, L05).
**Defects:** answer key in the browser; "saved" at 50 % even with a dangerous wrong step; failed missions marked
done; result shows full score on replays; story hidden from step 2 onward; refresh loses an in-progress mission;
no narrative continuity between missions ("follow patients and communities" not yet realised).

## 4. Clinical Challenge — PARTIAL · MIGRATE · SECURE

**What exists:** "Random Case" button and 2-column grid of all 10 cases (S05); plays the same mission screen;
Back returns to the grid.
**Defects:** ignores locks and **awards HP, funding and completion** — a bypass of Story progression;
no case filtering (topic, country, difficulty), no timer ("rapid-fire" claim), no score history, no
student-level stats. Random may repeat the same case.

## 5. Hospital Commander — PARTIAL · MIGRATE · SECURE

**What exists:** four resources (Staff, Beds, Ambulances, Supplies) with −/+ steppers at ₵10/unit, capped by
funding; "Start Shift (₵cost)"; one of four random events; result "You covered k/4 needs. +HP" (S08, S09, L07, L08).
Formula: +15 HP and +₵8 per need met; allocation consumed.
**Missing vs. vision ("manage staff, beds, ambulances, supplies and budgets"):** no persistent hospital,
no event preview or difficulty, needs are hidden so allocation is guesswork, no link to tiers/countries,
no ambulances/beds as lasting assets, events are not tied to missions. Disabled `+` looks enabled.
Randomness and rewards are client-side.

## 6. Country expansion — PARTIAL · MIGRATE · SECURE

**What exists:** list of 5 countries with flag, focus diseases, "Unlocked" or 🔒 "N HP"; "+49 more nations coming
soon" (S11). Unlocking gates Story missions by country.
**Missing:** no country-specific gameplay, environments, languages or cultural elements; no map; currency is
always ₵; unlock is a pure HP threshold computed client-side.

## 7. Health Points — PARTIAL · MIGRATE · SECURE

**What exists:** single integer, shown in header and drives tier/country unlocks.
**Defects:** client-calculated and client-stored; forgeable (L11: 99 999 HP); rounding of 30 % replay values;
replays and Commander make HP grindable; first-completion maximum (425) is below late unlock thresholds.

## 8. Funding system — PARTIAL · MIGRATE · SECURE

**What exists:** starts at ₵100; +round(score/2) per mission (including replays); Commander spends ₵10/unit and
returns ₵8 per need met. Shown in header.
**Defects:** unlimited minting via replays; cross-device merge takes the **maximum**, undoing spending; only use is
Commander.

## 9. Mission progression — PARTIAL · MIGRATE · SECURE

**What exists:** tiers Village Clinic (0) → Community Hospital (150) → Regional Medical Center (400) → National
Health System (800); missions assigned a tier and a country; `done[]` list.
**Defects:** see Story/Clinical defects; tier and country thresholds disagree (e.g. _The Empty Shelf_ needs tier 3 =
800 HP although Ethiopia opens at 650); no per-mission best score or attempt history; no learning analytics.

## 10. AI learning debrief — PARTIAL · MIGRATE · SECURE

**What exists:** after any mission: level selector (6 options: Nursing, Medical, Midwifery, Pharmacy student,
Intern/junior doctor, Community health worker), "Get debrief" / "Redo", streamed Markdown with four sections,
"For education only — not medical advice", friendly errors for 402/429. (L03)
**Defects:** unauthenticated and unmetered; trusts client-supplied correctness; not stored (lost on navigation);
not structured (can't be rendered natively in Flutter); no usage monitoring; uses OpenAI via Lovable gateway
(target: Anthropic Claude, server-side).

## 11. Clinician verification — PARTIAL · MIGRATE · SECURE

**What exists:** reviewer-only `/review` page: mission list with status (Awaiting review / Re-review needed /
Verified / Changes requested), detail view with answer key, approve (3 checks + ≥1 reference) or request changes
(notes required), immutable history, content-hash invalidation; player badges and "Clinician verified by …" box
with references. (S02 badges, L03 "awaiting clinician review", L09 signed-out gate)
**Defects:** no role administration UI; self-declared reviewer identity; badge ignores later "changes requested";
hash ignores title/country/tier; content cannot be edited in-app (code deploy needed); no version history of
content itself (only hashes); unverified missions playable; reviewer user ids publicly readable.

## 12. Progress synchronisation — PARTIAL · MIGRATE · SECURE

**What exists:** localStorage save on every change; on sign-in, merge cloud and local (`max(hp)`, `max(funding)`,
union of `done`), then upsert on every change; "Progress synced ☁️" / "Sync failed — progress kept on this device."
**Defects:** last-write-wins after initial merge → a stale device overwrites newer progress; forged local values
are merged into the account; no offline queue/retry; no conflict model. The owner noted it was never tested on two
devices.

---

## Content inventory (`lib/game-data.ts`)

| id        | Title                     | Country      | Tier (HP)                       | Country unlock | Steps  | Choices | Max score | Topic                                    |
| --------- | ------------------------- | ------------ | ------------------------------- | -------------- | ------ | ------- | --------- | ---------------------------------------- |
| malaria   | Fever in the Rainy Season | Nigeria      | 0 Village Clinic (0)            | 0              | 2      | 6       | 50        | Severe malaria, child                    |
| sickle    | The Painful Crisis        | Nigeria      | 0 (0)                           | 0              | 2      | 5       | 50        | Sickle-cell crisis, acute chest syndrome |
| birth     | Midnight Delivery         | Ghana        | 0 (0)                           | 100            | 2      | 5       | 50        | Postpartum haemorrhage                   |
| bp        | The Silent Killer         | Ghana        | 1 Community Hospital (150)      | 100            | 2      | 4       | 50        | Hypertension, adherence                  |
| cholera   | Water of the Lake         | Kenya        | 1 (150)                         | 250            | 2      | 4       | 50        | Cholera treatment + outbreak response    |
| child     | Fast Breathing Baby       | Kenya        | 1 (150)                         | 250            | 1      | 2       | 25        | Childhood pneumonia (IMCI)               |
| trauma    | Highway Collision         | South Africa | 2 Regional Medical Center (400) | 450            | 2      | 4       | 50        | Triage, haemorrhage control              |
| diabetes  | Sugar Storm               | South Africa | 2 (400)                         | 450            | 1      | 2       | 25        | DKA                                      |
| seizure   | Shaking in the Market     | Ethiopia     | 2 (400)                         | 650            | 2      | 4       | 50        | Status epilepticus, stigma               |
| supply    | The Empty Shelf           | Ethiopia     | 3 National Health System (800)  | 650            | 1      | 2       | 25        | Medicine supply chain                    |
| **Total** | 10 missions               | 5 countries  | 4 tiers                         |                | **17** | **38**  | **425**   |                                          |

Countries: Nigeria 🇳🇬 (0 HP; malaria, sickle cell, road trauma), Ghana 🇬🇭 (100; hypertension, childbirth care),
Kenya 🇰🇪 (250; cholera, childhood infections), South Africa 🇿🇦 (450; diabetes, trauma systems), Ethiopia 🇪🇹 (650;
seizures, medicine supply chains).

Commander events: Malaria surge (staff 2, beds 2, supplies 3, ambulances 0); Bus crash (3/2/1/3);
Cholera outbreak (1/3/3/1); Maternity rush (3/3/1/1) — order staff/beds/supplies/ambulances.

AI debrief levels: Nursing student, Medical student, Midwifery student, Pharmacy student, Intern / junior doctor,
Community health worker.

No mission has clinician approval or references yet (all show "Awaiting review" in S02).
