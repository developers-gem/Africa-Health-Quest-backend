# Technical Audit — Africa Health Quest (Lovable prototype)

|                |                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit date** | 2026-11-03                                                                                                                                                                                                                                                                                                                                                                |
| **Subject**    | Lovable prototype source ZIP (`48565645-…zip`), 11 PDF screenshots, product history                                                                                                                                                                                                                                                                                       |
| **Live URL**   | https://africa-health-quest.lovable.app/ — _not reachable from the audit sandbox (egress policy)._ The prototype was instead **run locally from the ZIP** (Vite dev server, phone viewport 390×844) to observe behaviour not covered by the PDFs. Supabase and the AI gateway were unreachable during that run, so signed-in and AI flows were analysed from source only. |
| **Method**     | Every non-generated source file was read in full. Generated/vendor files (`components/ui/*`, `routeTree.gen.ts`, Supabase `types.ts`) were read for purpose and usage. Findings marked **[verified]** were reproduced in the running prototype; **[source]** are from code reading.                                                                                       |

---

## 1. Project structure

```
src/
  routes/__root.tsx        App shell: <head>, fonts, 404 + error boundaries, React Query provider (122 lines)
  routes/index.tsx         THE ENTIRE GAME — 10 components in one file (414 lines)
  routes/review.tsx        Clinician review area (188 lines)
  routes/api/debrief.ts    POST /api/debrief → lib/debrief.server.ts (6 lines)
  lib/game-data.ts         Missions, countries, tiers — hard-coded content (161 lines)
  lib/debrief.server.ts    AI debrief: prompt + streaming via Lovable AI Gateway (102 lines)
  lib/review.ts            Content hash (djb2) + approved-review loader (27 lines)
  lib/utils.ts             cn() class merge helper
  lib/error-*.ts, lovable-error-reporting.ts   SSR error capture / Lovable telemetry plumbing
  integrations/supabase/*  Generated Supabase clients (browser, server, service-role, auth middleware, preview storage)
  integrations/lovable/    Generated Lovable OAuth wrapper (Google)
  components/ui/*          46 shadcn/ui components — none are imported by any screen
  hooks/use-mobile.tsx     Unused
  styles.css               Tailwind v4 theme: kente palette, fonts, btn-game, debrief typography
  assets/hero.jpg          1024×1024 JPEG, 207 KB
  server.ts, start.ts, router.tsx   TanStack Start SSR entry, CSRF + error middleware, router factory
  test/                    1 routing test + jsdom setup
drizzle/migrations/        2 SQL migrations (Postgres/Supabase); drizzle/schema.ts intentionally blank
supabase/config.toml       project_id only
.env                       Supabase URL + publishable keys (public-by-design values)
```

**Observations**

- All gameplay, account, sync, Commander, map and debrief UI live in one 414-line route file with
  state passed by props; there is no state management library, no domain layer, no services.
- Two database migrations are the only backend schema. There is no seed data.
- `src/components/ui` (46 files) and several dependencies (`react-hook-form`, `recharts`,
  `embla-carousel-react`, `react-day-picker`, `cmdk`, `vaul`, `input-otp`, `date-fns`, `drizzle-orm`,
  `@tanstack/react-query` beyond the provider) are installed but unused by product code.

## 2. Frameworks and libraries

| Concern         | Prototype                                                    | Notes                                                |
| --------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Framework       | TanStack Start 1.168 (React 19, SSR, file routes)            | Lovable template `tanstack_start_ts_current`         |
| Build           | Vite 8 via `@lovable.dev/vite-tanstack-config`               | Bundles nitro; default deploy target Cloudflare      |
| Styling         | Tailwind CSS 4, `tw-animate-css`, custom utilities           | shadcn "new-york" config present but unused          |
| Data/auth       | `@supabase/supabase-js` 2.117, `@lovable.dev/cloud-auth-js`  | Browser talks directly to Supabase (PostgREST + RLS) |
| AI              | Vercel AI SDK `ai` 7 + `@ai-sdk/openai` → Lovable AI Gateway | Model id `openai/gpt-6-astra`                        |
| Markdown        | `react-markdown` 10                                          | Renders AI output (no raw HTML — safe default)       |
| Testing         | Vitest 4 + Testing Library + jsdom                           | One test                                             |
| Package manager | Bun (`bun.lock`, `bunfig.toml`)                              | npm also works (verified)                            |

## 3. Frontend architecture

- **Routing:** 3 routes (`/`, `/review`, `/api/debrief`) + 404. In-game navigation is **not** routing:
  `index.tsx` keeps a `view` discriminated union (`home | story | mission | clinical | commander | map | account`)
  in `useState`. Consequences: no deep links, browser Back leaves the game, refresh returns to Home,
  a mission in progress is lost on refresh. **[verified]**
- **State:** one `Save = { hp, funding, done[] }` object in the `Game` component, mirrored to
  `localStorage["ahq"]` and (when signed in) upserted to Supabase on every change.
- **Components in `index.tsx`:** `Game` (shell/header/progress), `Home`, `StoryList`, `MissionPlay`,
  `Clinical`, `Commander`, `MapView`, `Debrief`, `Account`, `VerifiedBox`.
- **Layout:** single centred column `max-w-md` (448 px) at every viewport; no tablet/desktop layout. **[verified]**
- **Design system:** CSS custom properties in OKLCH (see `SCREEN_INVENTORY.md §Design tokens`), utilities
  `kente-strip`, `shadow-pop`, `btn-game` (2 px outline + 4 px offset shadow, press-down on `:active`).
- **SEO:** per-route `<title>`/description/OpenGraph meta.

## 4. Backend implementation

There is no application server in the conventional sense:

| Capability                            | Where it runs                        | Trust model                                                              |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------ |
| Progress read/write                   | Browser → Supabase PostgREST         | RLS: a user may insert/update **their own row with any values**          |
| Review read/write                     | Browser → Supabase                   | RLS + `has_role()`; approval preconditions enforced in the INSERT policy |
| Role check                            | Browser → `rpc('has_role')`          | `SECURITY DEFINER`, callable for **any** `_user_id`                      |
| AI debrief                            | TanStack server route `/api/debrief` | No authentication, no rate limit                                         |
| Scoring, unlocks, rewards, randomness | **Browser only**                     | Fully client-controlled                                                  |

SSR plumbing (`server.ts`, `start.ts`, `error-capture.ts`) wraps h3 errors into an HTML error page and
installs TanStack's CSRF middleware for server functions (no server functions are actually used).

## 5. Database configuration (Supabase Postgres)

**`player_progress`** — `user_id uuid PK, hp int, funding int, done text[], updated_at`.
RLS: own select/insert/update. No CHECK constraints (negative or huge values accepted), no FK to `auth.users`.

**`user_roles`** — `(user_id → auth.users, role app_role['admin','reviewer'])`, unique pair. Users can read only
their own roles. **No policy or UI lets anyone grant roles** — grants require SQL by the project owner.

**`mission_reviews`** — append-only review records: `mission_id, content_hash, status('approved'|'changes_requested'),
reviewer_id, reviewer_name, reviewer_credentials, scenario_ok, treatment_ok, references_ok, notes, refs jsonb, created_at`.

- `anon` + `authenticated` can SELECT approved rows — **all columns**, including `reviewer_id` and `notes`.
- INSERT requires reviewer/admin role, `reviewer_id = auth.uid()`, and for approvals all three checks + ≥1 reference.
- No UPDATE/DELETE grants → history is immutable (good).

## 6. Authentication

- Supabase Auth: email + password (client `minLength=6`, Supabase default policy), email confirmation required.
- Google via `lovable.auth.signInWithOAuth` (Lovable-brokered OAuth).
- Sessions: Supabase JWT in `localStorage` (or brokered via `postMessage` inside the Lovable editor preview).
- No password reset UI, no profile/display name, no account deletion. Signed-in state shows only email.
- **Sign-out does not clear `localStorage["ahq"]`** → the next person on a shared device inherits the
  progress, and it is merged into _their_ account on sign-in. **[source]**

## 7. Game engine (business logic, all client-side)

| Rule               | Implementation (`index.tsx`)                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start state        | `{ hp: 0, funding: 100, done: [] }`                                                                                                                                                                            |
| Step scoring       | +25 per correct choice; one attempt per step; choice locks after selection                                                                                                                                     |
| Outcome            | "Patient saved!" if `score ≥ 50% of max` — 1 of 2 correct counts as saved even if the wrong step was dangerous **[verified]**                                                                                  |
| HP reward          | first completion `+score`; replay `+score × 0.3`; then `Math.round`                                                                                                                                            |
| Funding reward     | `+round(score / 2)` on **every** completion including replays (uncapped)                                                                                                                                       |
| "Done"             | mission added to `done` on first finish **even with score 0** **[verified]** → the full first-completion reward is then lost forever                                                                           |
| Result screen      | always displays `+{score} Health Points`, even on replay where only 30 % is awarded                                                                                                                            |
| Tier               | highest `TIERS[i]` with `hp ≥ need` (0 / 150 / 400 / 800)                                                                                                                                                      |
| Story lock         | `mission.tier > tierIndex` **or** `hp < country.need`                                                                                                                                                          |
| Clinical Challenge | **no lock check** — any mission playable from 0 HP and it **awards HP, funding and `done`** **[verified]**                                                                                                     |
| Commander          | allocate units at ₵10 each (cannot exceed funding); random event from 4 (`Math.random`); per resource meeting the event's need: +15 HP, +₵8. Allocation is consumed each shift (no persistent hospital state). |
| Countries          | unlocked when `hp ≥ need` (0 / 100 / 250 / 450 / 650); purely cosmetic list — no country-specific gameplay                                                                                                     |
| Story text         | shown on step 1 only                                                                                                                                                                                           |

**Balance finding:** maximum first-completion HP across all 10 missions is **425**. South Africa (450 HP),
Ethiopia (650 HP) and the National Health System tier (800 HP) are reachable only through replays (30 %)
or Commander grinding, and replays also mint unlimited funding. See `TECHNICAL_RISKS.md` R-12.

## 8. Mission and country data

`lib/game-data.ts`: **10 missions, 17 steps, 38 choices, 5 countries, 4 tiers**. Every step has exactly one
correct choice (verified programmatically). Each choice carries `text`, `correct`, `feedback`.
Full per-mission table: `EXISTING_FEATURE_INVENTORY.md §Content`.

- Content contains **no references, no learning objectives, no difficulty, no versioning, no localisation**.
- Missions have emoji icons; countries have emoji flags (render as letters on some Windows/Android builds).
- Content ships in the browser bundle **including `correct` flags and feedback** — the answer key is public.

## 9. AI integration (`/api/debrief`)

- Client sends `{ title, story, level, steps:[{prompt, chosen, correct, bestAnswer, reasoning}] }`.
- Server builds a text prompt (four required sections: _Overall, Decision by decision, Key teaching points,
  Practice next_; < 450 words; "education, not medical advice") and streams plain text.
- Model: `openai/gpt-6-astra` via `https://ai.gateway.lovable.dev/v1`, low reasoning effort, `store:false`.
- Errors: 402 → "AI credits are used up", 429 → "Too many requests", else generic; delivered **in-band** by appending
  `[[ERROR]]message` to the stream, which the client splits on.
- **Trust problems:** no auth, no rate limit, no per-user quota; `correct` and `bestAnswer` are supplied by the
  client (a student can make the AI "confirm" a wrong answer); `prompt`, `chosen`, `bestAnswer`, `title` are not
  length-limited (only `story`/`reasoning` 1500 chars and `level` 80); reasoning is inserted verbatim (prompt
  injection); unstructured Markdown output; no usage logging; no evaluation of output quality.

## 10. Clinician review

- `/review` gate: signed in **and** `has_role(reviewer)` or `has_role(admin)`; otherwise a notice. **[verified signed-out state]**
- Reviewer sees full scenario with answer key and feedback, a content version (`missionHash`), a form
  (name, credentials, 3 checkboxes, references with optional URL, notes) and per-mission history.
- `missionHash` = 32-bit djb2 of `JSON.stringify({story, steps})` computed **in the browser** from the bundled
  content. Title, country, tier and icon changes do **not** invalidate approval.
- Player view (`loadVerifications`) shows "Clinician verified" if **any** approved row matches the current hash —
  so a later "changes requested" on the same version does **not** revoke the badge, while the reviewer page
  shows "Changes requested". Inconsistent state. **[source]**
- Reviewer name/credentials are free text typed per review; nothing ties them to a verified identity.
- Unverified missions are fully playable (product decision D4 changes this).
- No admin UI for granting reviewer roles; no notifications; no content editing (content is code).

## 11. Existing APIs

| Endpoint                     | Method        | Auth                       | Purpose                      |
| ---------------------------- | ------------- | -------------------------- | ---------------------------- |
| `/api/debrief`               | POST          | none                       | Stream AI debrief text       |
| Supabase `player_progress`   | select/upsert | Supabase JWT               | Load/save progress           |
| Supabase `mission_reviews`   | select/insert | anon (approved) / reviewer | Verification badges, reviews |
| Supabase `rpc/has_role`      | post          | Supabase JWT               | Role check                   |
| Supabase Auth, Lovable OAuth | —             | —                          | Sign-up/in, Google           |

## 12. Reusable assets for the migration

| Asset                                                                                  | Reuse                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Mission/country/tier data                                                              | Import **verbatim** (decision D2 keeps content)                        |
| Gameplay formulas (§7)                                                                 | Re-implement server-side, with bug fixes agreed with the product owner |
| Debrief prompt structure                                                               | Port to Claude with structured (JSON) output                           |
| Review rules (3 checks + ≥1 reference, content-change invalidation, immutable history) | Keep; harden                                                           |
| Visual identity (tokens, `btn-game`, kente strip, fonts, hero image)                   | Port to web + Flutter theme                                            |
| Copy/microcopy ("Welcome back, healer", result texts, notices)                         | Keep                                                                   |
| shadcn/ui setup                                                                        | Available for the admin dashboard; game screens use custom components  |

## 13. Quality, testing and operations

- **Tests:** 1 (route matching). No unit tests for scoring, sync, hashing or debrief.
- **Accessibility:** emoji-only icons without text alternatives; correctness conveyed by green/red colour plus
  feedback text; only the Account button has an `aria-label`; disabled `+` buttons in Commander look identical
  to enabled ones **[verified]**; no `prefers-reduced-motion` handling; header wraps at 390 px **[verified]**.
- **Internationalisation:** English only; currency symbol `₵` (Ghanaian cedi) used for all countries.
- **Observability:** Lovable editor telemetry only; no server logs, metrics or AI usage tracking.
- **Offline:** none (no service worker); localStorage only.
- **Secrets:** `.env` contains Supabase _publishable_ keys (designed to be public); no secret keys in the ZIP.
  `LOVABLE_API_KEY` is read from the hosting environment.

## 14. Summary of critical findings

1. Answer keys and feedback ship to every browser.
2. Scores, rewards, unlocks and randomness are client-side; localStorage edits grant 99 999 HP and all tiers **[verified]**, and sign-in merge (`Math.max`) pushes forged values to the account.
3. Cross-device sync loses data (stale device overwrites newer progress) and duplicates funding (`max` merge undoes spending).
4. The AI endpoint is an unauthenticated, unmetered LLM proxy that trusts client-supplied answer correctness.
5. Verification badge logic disagrees with the reviewer's latest decision; reviewer identity is self-declared.
6. Progression bugs: failed missions are marked done; Clinical Challenge bypasses locks; replays mint funding; late tiers unreachable without grinding.
