# Phase 7 report — AI learning and clinician verification

**Commits:** `72535c2` (engine, safety, admin, UI, tests) and the following commit (evaluation script, docs, this
report).

**Starting point.** Phase 5 had already built the AI debrief module, and Phase 4 (M6) the clinician review system.
This phase audited both against the brief and filled the gaps. Part D needed no new work; §4 shows where each
requirement is met.

| Gate                             | Result                                               |
| -------------------------------- | ---------------------------------------------------- |
| Backend tests                    | 270 passing (24 of them added or updated this phase) |
| Web unit/component tests         | 27 passing                                           |
| Web browser tests (real backend) | 25 passing, 2 phone-only skips                       |
| Flutter tests, analyzer          | 42 passing, no issues                                |
| Lint, typecheck, format, OpenAPI | Clean; `docs/api/openapi.json` regenerated           |
| Real Claude API                  | **Not run** — see §6                                 |

## 1. Part A — learning engine (prompt `debrief-2.0.0`)

**What the model receives** (all built on the server):

- **The case:** the clinician-approved scenario, learning objectives and steps, each with the official answer and
  feedback.
- **The learner level,** plus guidance on how to pitch the debrief for it.
- **The attempt:** each answer as recorded by the server (chosen option, whether it matched) and the learner's own
  reasoning.
- **Earlier performance:** an anonymous summary of the last 30 cases (cases passed, topics often missed, topics
  answered well).
- **References:** only the ones a clinician approved for this exact version.
- **Topics:** the topics of currently published cases.

**What it returns**, validated against a schema:

1. Overall assessment.
2. Decision-by-decision explanations.
3. Strengths.
4. Knowledge gaps.
5. Key teaching points.
6. Recommended topics. Only topics from the published-case list are kept, and each links to published cases.
7. Exactly two practice questions.
8. A fixed disclaimer, added by the server, not the model.

**Correct, incorrect and incomplete reasoning.** The prompt handles each explicitly:

- It affirms specific sound reasoning and corrects misconceptions.
- It explains the official answer and invites reasoning next time when none was given.
- It says so when the choice was right but the reasoning wasn't.

## 2. Part B — personalisation

**Learner levels.** Two were added: _Allied health student_ and _Healthcare professional_. The existing nursing,
medical, midwifery, pharmacy, intern, community health worker and "other" levels stay. Every level has its own
guidance text, for example:

- community health workers get plain language, danger signs and referral;
- healthcare professionals get peer-to-peer feedback focused on pitfalls.

**Where they appear.** The website and the app list the new levels in the debrief and profile pickers.

## 3. Part C — AI safety

| Requirement                      | How                                                                                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use approved mission content     | **New:** debriefs are refused (`409 mission: not_approved`) for withdrawn, retired or never-approved versions, before any provider call                                       |
| Never invent references          | Only the version's clinician-approved active references are sent. Cited ids are filtered. URLs are stripped. The prompt forbids naming other sources                          |
| Validate structured responses    | API structured output plus schema validation. Every step must be explained, and only real steps. Invalid output gets one retry, then fails safely                             |
| AI can't change official answers | Right/wrong verdicts, prompts and chosen text are copied from the attempt, never from the model. Tested with a prompt-injection attempt                                       |
| AI can't approve content         | The AI module has no access to review, authoring or publishing. Tested: content, hashes and approvals are unchanged after a debrief                                           |
| Label educational feedback       | **New:** an "AI-generated educational feedback … does not replace teaching from qualified clinical instructors" banner on web and mobile, plus `aiGenerated: true` in the API |
| Usage limits                     | Daily quotas, a per-minute limit (**now configurable**), the kill switch and the monthly budget cap                                                                           |
| Track costs                      | Per-call tokens (including cache) and cost. **New:** totals, cost per completed debrief, and usage by level                                                                   |
| Protect user information         | No names, emails or IDs are sent. **New:** emails and phone/ID-like numbers typed into reasoning are redacted; doses and vital signs are kept. Consent is required first      |
| Fallback handling                | Refusal fallback, SDK retries, and failures that never count against quota. **New:** an optional fallback model, tried once when the configured model is unavailable          |

## 4. Part D — clinician review (already built; verified)

| Requirement                                    | Where it is met                                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Reviewer registration                          | `PUT /me/clinician-profile`; the registration number is encrypted                                                             |
| Credential submission                          | Evidence upload (`/me/clinician-evidence`)                                                                                    |
| Admin verification                             | `POST /admin/clinicians/:id/verify`: step-up, audited, no self-verification                                                   |
| Review assignments                             | `/admin/reviews/assignments`; authors can't review their own version                                                          |
| Scenario, treatment and reference verification | Approval requires all three checks plus a reference                                                                           |
| Approval, change requests                      | `POST /review/versions/:id/decisions`, bound to the content hash                                                              |
| Review history, version control                | Mission history, version diff and rollback                                                                                    |
| Approval invalidation                          | Published versions are frozen. Any edit is a new version that needs a new approval. A decision on changed content is rejected |

All of this is covered by the existing backend tests and the browser journey.

## 5. Part E — administration

- **AI provider and model:**
  - a status card (provider, whether a key is configured, model, fallback, prompt version, availability; the key is
    never shown);
  - model, effort, kill switch and refusal fallback;
  - **new:** fallback model and per-minute limit.
- **Usage, tokens and cost:**
  - daily series;
  - **new** totals: tokens in/out and cache, cost per completed debrief, failures by kind (rate-limited, invalid,
    refused, unavailable), fallback calls, and requests stopped by player limits;
  - **new:** usage by learner level, including how many debriefs players reported.
- **Rate limits:** quotas, per-minute limit and budget cap.
- **Reviewer management:** the existing clinicians pages.
- **Content approval monitoring (new, on the publishing page):**
  - published, withdrawn and retired counts;
  - review queue and the oldest item waiting;
  - edits pending re-approval;
  - active reviewers and pending applications;
  - overdue assignments;
  - decisions in the last 30 days;
  - published cases that cite no reference.

## 6. Part F — testing

All scenarios run against the real backend and MongoDB with a deterministic fake AI provider. The tests also assert
exactly what the model would receive.

| Scenario                 | Test                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Correct reasoning        | All verdicts true, every section present, official answers sent as ground truth                                           |
| Incorrect reasoning      | Verdicts false (from the attempt), gaps reported, mismatches and reasoning in the prompt                                  |
| Incomplete reasoning     | Missing reasoning sent empty; the prompt's handling rules are present                                                     |
| Different levels         | Five levels incl. the two new ones: each gets its own label, guidance and stored debrief                                  |
| Earlier performance      | Weak topics computed from earlier attempts; invented topics dropped; topic links exclude the current case                 |
| AI API failure           | Fails safely without counting against quota; succeeds on the fallback model when one is configured, and is logged as such |
| Invalid AI output        | Wrong shape or a missing step → one retry, then a safe failure; not counted against quota                                 |
| Rate-limit errors        | Provider 429 logged as `rate_limited`; the configurable per-minute limit returns 429 and is counted separately            |
| Missing references       | Nothing cited; an invented id is dropped; retired references are never sent                                               |
| Unapproved missions      | Withdrawn and never-approved versions refused with no provider call                                                       |
| Personal data, injection | Emails and phone numbers redacted, clinical numbers kept; an injection attempt can't change a verdict or content          |
| Monitoring               | Usage totals, provider status (no key leak) and approval monitor                                                          |

**Real-model evaluation.** `npm run ai:eval -w @ahq/backend` sends 8 scenarios through the production client and
prompt:

- correct, incorrect and incomplete reasoning;
- right answer with wrong reasoning;
- five levels;
- missing references;
- prompt injection.

It applies the service's validation plus safety checks (URLs, named guidelines without references, a mismatched answer
called correct) and writes the outputs for clinicians to read.

**It has not been run.** This environment has no Anthropic API key, and it does not accept one for Anthropic's own
host. Until it runs, the model's actual wording, tone per level and adherence to the reference rules are **unverified**.

## 7. Things to note

1. **Recommended topics need topic tags.** The prototype cases have no topics yet, so recommendations stay empty until
   an admin tags cases (mission placement → topics). The rest of the debrief works without them.
2. **The disclaimer changed** from "For education only — not medical advice." to the fuller AI-generated wording, so
   tests asserting the old text were updated.
3. **The prompt changed** from `debrief-1.0.0` to `debrief-2.0.0`. Old debriefs keep their stored version and simply
   have no strengths, gaps or topics. The prompt file was renamed `prompts/debrief.ts`; the old text is in git history.
4. **The fallback model is off by default.** Choosing one is the owner's decision. It should go through the evaluation
   first, because a different model changes quality and cost.

## 8. Before launch

- Run `npm run ai:eval -w @ahq/backend -- --out=eval.json` with a real key, and have clinicians review the outputs
  (decision AI-4 in the AI architecture also still needs the monthly budget set).
- Tag published cases with topics.
- Carried over: Android/iOS builds and real push (Phase 6), and CI never run on GitHub (no repository connected).
