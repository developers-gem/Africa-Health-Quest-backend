# Screen Inventory — Lovable prototype

**Sources:** 11 PDF screenshots (`docs/audit-evidence/pdf/S01–S11`, captured at ≈520 px CSS width) and 12 captures from
running the prototype locally at 390×844 and 1280×800 (`docs/audit-evidence/local-run/L01–L12`). Screens not
covered by the PDFs (result, debrief, sign-up, review gate, 404, signed-in account, reviewer form) were captured
locally or, where they need Supabase/AI (signed-in account, reviewer list/form, debrief output), derived from source
and marked _[source]_.

| PDF file   | Evidence id | Screen                                                                             |
| ---------- | ----------- | ---------------------------------------------------------------------------------- |
| Page 1.pdf | S01         | Home                                                                               |
| Page2.pdf  | S02         | Story Mode — mission list                                                          |
| Page3.pdf  | S03         | Mission — Fever in the Rainy Season, step 1                                        |
| Page4.pdf  | S04         | Mission — The Painful Crisis, step 1                                               |
| page5.pdf  | S05         | Clinical Challenge                                                                 |
| page6.pdf  | S06         | Mission — Fast Breathing Baby, step 1 (opened from Clinical while Kenya is locked) |
| page7.pdf  | S07         | Mission — correct answer feedback state                                            |
| page8.pdf  | S08         | Hospital Commander — resources allocated (₵100)                                    |
| page9.pdf  | S09         | Hospital Commander — shift result                                                  |
| page10.pdf | S10         | Account — sign in                                                                  |
| page11.pdf | S11         | Countries                                                                          |

---

## Global frame (all game screens)

| Element        | Detail                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kente strip    | 8 px repeating gradient gold / green / terracotta / dark brown at top edge                                                                                                          |
| Header         | "Africa Health Quest" (display font, tap → Home); pills: ❤️ HP (primary), ₵ funding (secondary), Sign in / 👤 (outlined)                                                            |
| Tier card      | outlined card: tier icon + name; right: "N HP to {next tier}"; progress bar (primary on muted); signed-out link "Sign in to save progress across devices" or signed-in sync message |
| Content column | `max-w-md` (448 px) centred, 16 px side padding, bottom padding 40 px                                                                                                               |
| Navigation     | No tab bar or router — state-driven views; "← Back" text button on sub-screens; header title returns Home                                                                           |

## Screens

### SC-01 Home (S01, L01, L12)

Hero card (1024² image "village clinic at sunset", 224 px tall, gradient overlay, tagline "Save Lives. / Build Healthier
Nations."); four full-width mode buttons with emoji, title and subtitle:
Story Mode 📖 (terracotta), Clinical Challenge 🩺 (green), Hospital Commander 🏥 (gold), Countries 🌍 (cream).
Interaction: tap → view change. State: tier card reflects HP.

### SC-02 Story Mode — mission list (S02, L04)

Heading "Missions"; 10 list cards: icon (🔒 if locked), title, "{flag} {country} · {tier}", review pill ("Awaiting review"
muted / "Clinician verified" green), ✔ if done. Locked cards: disabled, 50 % opacity. Tap unlocked → SC-03.

### SC-03 Mission — question state (S03, S04, S06)

"← Back"; scenario card (icon, title, story on step 1 only, "Step i/n: prompt"); label "Your clinical reasoning
(optional, used for your AI debrief)"; textarea placeholder "Why would you choose this? What are you thinking?"
(max 1500); 2–3 full-width choice buttons.

### SC-04 Mission — answered state (S07, L02)

Choices disabled; correct = green, chosen wrong = red, others dimmed; reasoning textarea locked; feedback panel
(muted) with the chosen choice's feedback and primary "Next" / "Finish".

### SC-05 Mission — result (L03 success, L05 failure)

Card: 🎉 "Patient saved!" or 💔 "Learn and try again"; "+N Health Points"; "Continue" (→ Story list or Clinical grid).
Below: verification box ("This case is awaiting clinician review." or green "✔ Clinician verified by {name},
{credentials}" + reference list _[source]_); SC-06.

### SC-06 AI Learning Debrief panel (L03; output _[source]_)

"🧠 AI Learning Debrief", subtitle; level `<select>` (6 levels) + "Get debrief" (green); while loading "Thinking…" and
pulsing "Reviewing your case…"; streamed Markdown (h2 in primary colour, lists, quotes with gold rule); "Redo";
error line in destructive colour; footer "For education only — not medical advice."

### SC-07 Clinical Challenge (S05)

Heading + subtitle "Any case, any country. Sharpen your clinical reasoning."; "🎲 Random Case" (green, full width);
2-column grid of 10 case tiles (emoji + title). No lock indicators.

### SC-08 Hospital Commander — allocation (S08, L07)

Heading + "Allocate resources (₵10 each) before the next shift. An emergency will strike."; four rows (👩🏾‍⚕️ Staff,
🛏️ Beds, 🚑 Ambulances, 💊 Supplies) with "−" (muted), count, "+" (gold); "Start Shift (₵cost)" primary, disabled
at ₵0; low-funds warning "Low funds — complete Story missions to earn more." when funding < ₵10.

### SC-09 Hospital Commander — result (S09, L08)

Same as SC-08 with counters reset and a muted result panel "{event} You covered k/4 needs. +N HP."

### SC-10 Countries (S11)

Heading "Expand Across Africa"; 5 country cards (flag, name, focus line, "Unlocked" or 🔒 "N HP"; locked at 50 %
opacity); dashed card "+49 more nations coming soon". Non-interactive.

### SC-11 Account — sign in / sign up (S10, L06)

Card: "Welcome back, healer" / "Create your account"; subtitle; "Continue with Google"; "or"; Email; Password (min 6);
primary "Sign in" / "Sign up" ("Please wait…" while busy); message line (errors or "Check your email to confirm…");
toggle link "New here? Create an account" / "Have an account? Sign in".

### SC-12 Account — signed in _[source]_

"Your account", "Signed in as {email}. Your progress saves automatically.", link "Clinician review area →" (shown to
all users), "Sign out".

### SC-13 Clinician Review — gate (L09)

Separate page (`/review`): kente strip, "🩺 Clinician Review", "Back to game"; states: "Checking access…", signed-out
notice, no-role notice.

### SC-14 Clinician Review — mission list _[source]_

Intro text; 10 rows: icon, title, country, status pill (Awaiting review / Re-review needed (content changed) / Verified /
Changes requested).

### SC-15 Clinician Review — review form _[source]_

"← All missions"; full scenario incl. every choice with ✔/✗ and feedback; "Content version {hash}"; form: Full name,
Credentials, 3 checkboxes (scenario realistic & culturally appropriate; treatment accurate; references support
teaching), references (title + optional link, "+ Add reference"), notes; "Request changes" / "Approve & publish"
(disabled until 3 checks + ≥1 reference); history list (decision, reviewer, date, "older content version", notes).

### SC-16 404 and error pages (L10)

Generic template "404 / Page not found / Go home"; error boundary "This page didn't load" with "Try again"/"Go home".
Not themed with the game identity.

---

## Game states

| State                                                         | Where shown                                                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Signed out / signed in                                        | header button label; tier card link vs sync message; account card |
| Tier 0–3                                                      | tier card name/icon/progress                                      |
| Mission locked / unlocked / done / verified / awaiting review | SC-02                                                             |
| Step unanswered / answered-correct / answered-wrong           | SC-03, SC-04                                                      |
| Mission passed (≥50 %) / failed                               | SC-05                                                             |
| Debrief idle / loading / streaming / done / error             | SC-06                                                             |
| Commander allocating / insufficient funds / result            | SC-08, SC-09                                                      |
| Country locked / unlocked                                     | SC-10                                                             |
| Reviewer: loading / signed-out / denied / list / form         | SC-13–15                                                          |

## Design tokens (from `styles.css`)

| Token            | OKLCH                | ≈ Hex   | Use                                                          |
| ---------------- | -------------------- | ------- | ------------------------------------------------------------ |
| background       | 0.97 0.02 80         | #FCF4E6 | page (warm cream)                                            |
| foreground       | 0.22 0.04 40         | #2A140C | text, outlines, pop shadow                                   |
| card             | 0.995 0.01 85        | #FFFDF6 | cards, inputs                                                |
| primary          | 0.58 0.16 40         | #C55123 | terracotta: HP pill, Story, main actions, links              |
| secondary        | 0.42 0.09 155        | #185B37 | forest green: funding pill, Clinical, Random, debrief button |
| accent / gold    | 0.80 0.15 80         | #F0B135 | Commander, "+" steppers, kente                               |
| success          | 0.55 0.14 150        | #1C8742 | correct answers, verified                                    |
| destructive      | 0.55 0.21 27         | #D01D21 | wrong answers, errors                                        |
| muted            | 0.92 0.03 75         | #F1E2CF | feedback panels, "−" buttons, progress track                 |
| muted-foreground | 0.45 0.04 50         | #684F41 | secondary text                                               |
| border           | 0.86 0.04 70         | #E3CDB5 | dividers                                                     |
| radius           | 1 rem                |         | cards/buttons (`rounded-2xl` = 1.5 rem on hero/cards)        |
| shadow-pop       | 0 4px 0 0 foreground |         | "game button" depth; press = translateY(3px) + 1 px shadow   |

**Typography:** display = _Bricolage Grotesque_ 600/800 (headings, title, mode names); body = _Plus Jakarta Sans_
400/600/700. Sizes: page title 18 px, H2 20–24 px, body 14 px, captions 12 px, pills 10–14 px. Emoji used as icons
throughout (no icon font in use although `lucide-react` is installed).

**Design patterns:** chunky outlined "sticker" buttons with drop shadow and press animation; pill badges; card lists;
colour-coded modes; kente motif as brand signature; warm low-contrast cream palette.

## Responsive behaviour

| Viewport               | Observation                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ≈520 px (PDFs)         | Layout as designed                                                                                                                            |
| 390 px phone (L02–L09) | Header wraps: title on two lines, "❤️ 25" and "₵ 113" break inside pills, "Sign in" on two lines; Commander and mission screens otherwise fit |
| 1280 px desktop (L12)  | Same 448 px column centred; large empty margins; no desktop layout                                                                            |
| Large values (L11)     | 5-digit HP/funding make header pills wrap further                                                                                             |

## Accessibility notes

Emoji-only icons and flags lack text alternatives; correctness relies on colour (feedback text helps); disabled "+"
buttons not visually distinct; no visible focus style beyond browser default on custom buttons; `select` and inputs have
placeholders but no `<label>` (except reasoning).

Measured WCAG contrast (hex approximations above):

| Pair                                                          | Ratio | AA normal text (4.5)              |
| ------------------------------------------------------------- | ----- | --------------------------------- |
| foreground on gold (Commander button, "+")                    | 9.18  | pass                              |
| primary-foreground on secondary (green buttons)               | 7.64  | pass                              |
| muted-foreground on background                                | 6.91  | pass                              |
| muted-foreground on muted                                     | 5.94  | pass                              |
| white on destructive (wrong answer)                           | 5.41  | pass                              |
| primary-foreground on primary (Story, Next, Sign in, HP pill) | 4.33  | **fail** (passes large text only) |
| primary-foreground on success (correct answer, 14 px)         | 4.31  | **fail**                          |
| primary on background (12 px "Sign in to save progress" link) | 4.20  | **fail**                          |

The target design should darken primary and success slightly (keeping hue) to reach ≥ 4.5:1.
