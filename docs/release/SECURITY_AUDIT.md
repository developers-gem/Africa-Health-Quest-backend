# Security audit (release, Phase 8)

**Scope:**

- the Express API and worker;
- the React website;
- the Flutter app;
- MongoDB usage;
- file uploads;
- the AI endpoints;
- the AWS deployment template and CI/CD.

**Method:**

- automated tests (below, all in CI);
- a dependency audit;
- secret scans of the repository and the built clients;
- the production build run locally with production settings;
- a code review of the authentication, session, upload and AI paths.

**No external penetration test has been done.** Commission one before public launch (see §6).

**Result.**

- **Critical:** none open.
- **High:** two found and fixed (H1, H2).
- **Medium:** two fixed, four open with mitigations.
- **Low:** listed in §5.

## 1. Automated security checks (all passing)

| Check                     | What it proves                                                                                                                                                                                                                         | Where                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Authentication sweep      | Every one of the 110 authenticated operations in the OpenAPI document returns 401 without a token                                                                                                                                      | `apps/backend/test/integration/security-sweep.test.ts`        |
| Authorization sweep       | Every one of the 66 permission-gated operations returns 403 to an ordinary player                                                                                                                                                      | same                                                          |
| Token forgery             | Tokens with a bad signature or `alg: none` are rejected                                                                                                                                                                                | same                                                          |
| Answer-key exposure       | No `correct`, `feedback`, `critical` or `correctChoiceId` field appears in any player-readable response before answering (catalogue, missions, details, random case, offline pack, attempt, history, progress), signed in or anonymous | same, plus the mission and mobile tests                       |
| Error hygiene             | Malformed JSON, bad URL encoding, NoSQL-operator payloads and unknown resources give 4xx with no stack traces or database details; `X-Powered-By` is off; HSTS and `nosniff` are on                                                    | same                                                          |
| Input validation          | Every body, query and params object is parsed by a zod contract schema; `{ "$gt": "" }`-style payloads are rejected                                                                                                                    | contracts and all integration tests                           |
| Sessions                  | Refresh rotation, reuse detection revoking the family, logout-all, revocation on password reset and role change, staff MFA, step-up for sensitive actions, suspension                                                                  | `auth`, `sessions`, `mfa`, `suspension` tests                 |
| Rate limits               | Sign-in limits are shared across two API instances. **New:** per-account limits stop guesses spread across many IPs, without blocking other accounts                                                                                   | `production-infra.test.ts`                                    |
| Uploads                   | File type taken from content (magic bytes), size limits, JPEG metadata including GPS stripped, PDFs with active content rejected, sandboxed `nosniff` delivery, private evidence admin-only                                            | `countries-admin` (media uploads) and `file-inspection` tests |
| AI endpoints              | Authentication, consent, quotas, per-minute limit, budget, approved-content-only, verdicts from the attempt, approved references only, personal details redacted, prompt-injection test                                                | `ai.test.ts`, `ai-learning.test.ts`                           |
| Production configuration  | The server refuses to start with development-only settings (local media, per-process limits, fake AI, file or log mail, missing CORS)                                                                                                  | `production-infra.test.ts`, `config.test.ts`                  |
| Web security policy (CSP) | The CloudFront policy produces zero violations on public, player and deep-linked pages of the built app                                                                                                                                | release check (DEPLOYMENT_GUIDE §8)                           |
| Dependencies              | `npm audit --omit=dev`: **0 vulnerabilities** (was 1 high, 4 moderate). CI now fails on high-severity advisories                                                                                                                       | CI `integration` job                                          |

## 2. Findings fixed in this release

| ID     | Severity | Finding                                                                                                                                                            | Fix                                                                                                                                        |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **H1** | High     | nodemailer ≤ 10.1.3: SMTP command injection (`envelope.size`), CRLF injection in headers and EHLO, quadratic-time denial of service                                | Upgraded to 10.3.1; SMTP delivery re-tested against an SMTP sink. Transitive moderate advisories fixed with `npm audit fix`                |
| **H2** | High     | Sign-in and two-factor attempts were limited per IP only. Credential stuffing or TOTP guessing spread across many IPs was not stopped, and limits were per process | Per-account limits on failures (10 per 15 min per email or user), stored in MongoDB and shared across instances; WAF rate rule at the edge |
| M1     | Medium   | Uploaded media lived on the container disk: lost on redeploy and not shared between instances                                                                      | S3 driver (private bucket, write-once, server-side encryption, task-role credentials); production refuses local storage                    |
| M2     | Medium   | Web source maps were published with the bundles, exposing the full client source                                                                                   | Hidden source maps, excluded from the public bucket and kept as a CI artefact                                                              |
| L1     | Low      | A malformed percent-encoded URL caused a 500 (and noisy error logs/alarms)                                                                                         | Returns 400                                                                                                                                |

## 3. Review notes by area

**Authentication**

- Passwords are hashed with scrypt (NFKC-normalised, per-user salt).
- Minimum password: 8 characters with letters and digits.
- Email verification is required before sign-in.
- Access JWTs are pinned to `HS256` and last 15 minutes.
- Refresh tokens are random, stored hashed, rotated, and end their family on reuse.
- Google sign-in verifies the ID token's audience against configured client IDs. It has never been tested against
  real Google.

**Authorization**

- Role-based permissions on every staff route (the sweep above).
- Ownership checks on player resources (attempts, debriefs, notifications), tested.
- Staff need TOTP two-factor; role changes and admin-sensitive actions need step-up.
- Staff actions are audited.

**Sessions**

- **Web:** an `HttpOnly`, `Secure`, `SameSite=Strict` refresh cookie; access tokens are kept in memory only.
- **Mobile:** the refresh token is stored in Keychain or Keystore.
- **Backups:** Android backup is turned off for tokens and local data.

**API**

- Helmet headers and a CORS allow-list (a foreign origin gets no `Access-Control-Allow-Origin`, verified).
- 100 KB JSON limit.
- Request IDs, and logs with tokens, cookies and passwords redacted (verified in the production run).
- Idempotency keys on reward and AI mutations.

**Exposed secrets**

- None in git history or the working tree: patterns checked for API keys, AWS keys, private keys, Mongo URIs with
  passwords and Google keys.
- None in the built web bundle or the Flutter release bundle; the only matches are UI text naming variables.
- `.env`, keystores and Firebase config files are git-ignored.
- Production secrets come only from Secrets Manager.

**Answer keys**

- Kept server-side.
- The offline packs carry no keys; feedback is revealed only after the server scores an answer.
- ESLint blocks importing `@ahq/game-content` from the web app.

**Database permissions**

- The application user should have `readWrite` on its own database only (DATABASE_BACKUP_GUIDE §1).
- Network access is limited to the VPC or NAT IPs, with TLS.
- Multi-document transactions protect reward and publication flows.
- **Not yet verifiable:** no Atlas cluster exists.

**AI**

- The Anthropic key is server-only.
- Only clinician-approved content and references reach the model.
- Output is schema-validated.
- Verdicts are never taken from the model.
- Debriefs are labelled AI-generated educational feedback.
- Cost and quotas are enforced.
- The real model has never been evaluated (Phase 7).

**Infrastructure template**

- Private S3 buckets with Block Public Access and TLS-only.
- CloudFront with Origin Access Control.
- HSTS, CSP, frame denial and referrer policy headers.
- ALB with TLS 1.2+ (TLS 1.3 policy), dropping invalid headers.
- WAF with a rate rule and AWS managed rule groups.
- Tasks in private subnets.
- Least-privilege task role (S3 `media/*` only).
- Secrets through ECS secrets.
- Deployments through GitHub OIDC (no long-lived keys), with production behind environment approval.

## 4. Open findings (accepted for release with mitigation; owner to confirm)

| ID  | Severity | Finding                                                                                                                             | Mitigation now                                                                                                                                                   | Recommended fix                                                                                                                              |
| --- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| M3  | Medium   | No malware scanning of uploads. The PDF active-content check is a regex and can miss content inside compressed object streams       | Only admins upload media. Only clinician applicants upload evidence PDFs, which are private, admin-only and served as downloads with `nosniff` and a sandbox CSP | Scan uploads (S3 quarantine plus GuardDuty Malware Protection for S3, or ClamAV in the worker) before promotion, as the architecture planned |
| M4  | Medium   | No client error tracking (web, mobile). Production crashes would go unnoticed                                                       | Server-side errors alarm in CloudWatch                                                                                                                           | Sentry or Firebase Crashlytics (needs an owner decision and account)                                                                         |
| M5  | Medium   | Account lockout as denial of service: 10 failed sign-ins lock an email for 15 minutes                                               | Time-limited; the WAF slows mass attempts                                                                                                                        | Add a CAPTCHA after 3 failures if abuse appears                                                                                              |
| M6  | Medium   | No external penetration test, and no real-device mobile security review (certificate pinning not used; root/jailbreak not detected) | Reviews in this report                                                                                                                                           | Third-party penetration test before public launch                                                                                            |

## 5. Low or informational

- Password policy is a minimum of 8 characters with letters and digits; there's no breached-password check. Consider
  checking against Have I Been Pwned's k-anonymity API.
- `style-src 'unsafe-inline'` is allowed for React inline styles. Scripts allow only `'self'` and Google's sign-in
  client.
- Staff-only screens ship in the public bundle as lazy chunks. They contain no data or answer keys, and the server
  enforces everything.
- The per-IP API limit (600 per minute) is per instance by design (decision A-7); the WAF provides the shared limit.

## 6. Before public launch

1. Third-party penetration test (web, API, mobile).
2. Decide on M3 (upload scanning) and M4 (error tracking).
3. Confirm Atlas users and network rules match DATABASE_BACKUP_GUIDE §1.
4. Turn on GuardDuty, AWS Config and CloudTrail in the AWS account.
5. Write privacy and terms pages and settle the data-protection position (Nigeria NDPA, Kenya DPA, South Africa
   POPIA, Ghana DPA as applicable). Learner reasoning is sent to Anthropic only after consent, and personal details
   are redacted first.
