# Final acceptance report (Phase 8)

## Verdict: not production-ready

**The software is ready for a staging deployment and a closed web pilot.**

**It is not ready for public production release**, because some critical work has not been done or tested.

| Area                     | Ready?           | Why not                                                                                                      |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| Backend, web, data model | Yes, for staging | Feature-complete and tested against a real database; security findings fixed. **Never deployed**             |
| Clinical content         | **No**           | No case has been approved by a verified clinician in a real environment, so players would see no cases       |
| Android and iOS apps     | **No**           | Never built, installed or tested on a device; store assets and signing missing; no Google sign-in in the app |
| AI debriefs              | **No**           | Never run against the real Claude API; no clinician evaluation. Can launch switched off                      |
| Infrastructure           | **No**           | Template and workflow prepared and checked, but nothing deployed; no backups or restore drill yet            |
| Legal and privacy        | **No**           | No privacy policy or terms; data-protection review not done                                                  |

## 1. Completed features

### Platform (backend + MongoDB)

**Accounts and access**

- Registration and email verification.
- Login and logout.
- Rotated sessions with reuse detection.
- Password reset.
- Guest play with upgrade in place.
- Google sign-in (web).
- Staff TOTP two-factor and step-up.
- Role-based permissions.
- Suspension and erasure.
- Full audit log.

**Game**

- Story Mode and Clinical Challenge.
- Server-authoritative scoring, HP, funding, tiers and achievements.
- Hospital Commander with emergencies.
- 54-country expansion with unlock rules.
- Learning history and rewards ledger.

**Clinical governance**

- Clinician registration with encrypted registration numbers and evidence uploads.
- Admin verification.
- Review assignments.
- Scenario, treatment and reference checks.
- Approval and change requests.
- Version history, diff, rollback, withdraw and retire.
- Content-hash-bound approvals (any edit needs re-approval).
- Approval monitoring.

**AI learning engine**

- Claude, server-side only.
- Approved content only.
- Eight output sections, five or more learner levels, learner history.
- Validated output; verdicts taken from the attempt.
- Approved references only.
- Personal details redacted.
- Quotas, per-minute limit, budget, kill switch.
- Fallback model.
- Usage and cost reporting.
- Flagging for clinician review.

**Offline and synchronisation**

- Offline packs with no answer keys.
- Ordered, idempotent event sync.
- Version-conflict detection.

**Notifications**

- In-app inbox.
- FCM push via an outbox and worker.
- Admin announcements.

**Release hardening (this phase)**

- S3 media storage.
- Shared, per-account rate limits.
- Response compression.
- Production configuration guards.

### Website (React)

- Public site.
- The full player app (14 screens).
- The clinician console.
- The admin console: users, clinicians, content, publishing with approval monitoring, countries, configuration, AI
  settings and usage, announcements, analytics, reports, audit.
- Responsive from phone to desktop.
- Accessible structure.

### Flutter app (code complete)

- All 15 modules.
- Offline play and sync with conflict handling.
- Push handling.
- Release configuration for Android and iOS.
- Responsive layout (rail at 840 px and wider).

### Deployment assets (this phase)

- AWS CloudFormation template (cfn-lint clean).
- GitHub deploy workflow (OIDC, approvals, rollback).
- Release scripts.
- Load-test script.
- The eight release documents in `docs/release/`.

## 2. Incomplete features

| Feature                                       | State                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Google sign-in in the mobile app**          | Not implemented. Web only; the backend supports it                                                                   |
| **Android and iOS release builds**            | Configured, never built: no Android SDK in this environment, no macOS                                                |
| App icons and store listings                  | Flutter default icons; no store artwork, privacy policy or listings                                                  |
| **Client error tracking** (web, mobile)       | Not set up (owner decision: Sentry or Crashlytics)                                                                   |
| **Upload malware scanning**                   | Not implemented (planned S3 quarantine + scan). Type checks, metadata stripping and a PDF active-content check exist |
| Apple sign-in                                 | Not implemented (carried over from Phase 4). Needed only if third-party sign-in is offered on iOS                    |
| Self-service account deletion                 | Admin-performed erasure only (carried over)                                                                          |
| Privacy policy, terms, data-protection review | Not written (legal input needed)                                                                                     |

## 3. Known bugs and limitations

No known functional bugs are open. The ten defects found in this phase are fixed (TESTING_REPORT §3).

Known limitations:

1. **Web landing LCP is 3.2 s** on slow 4G cold load (target 2.5 s). The cause is the main JavaScript chunk
   (132 KB gzipped).
2. **About 1 s for a full offline batch:** offline sync applies each event in its own transaction, about 20 ms per
   event. Fine for normal use.
3. **Recommended topics in AI debriefs stay empty** until admins tag published cases with topics.
4. **Sign-in lockout:** 10 failed sign-ins lock that email for 15 minutes (anti-brute-force, by design).
5. **Prototype content is still waiting for review:** imported verbatim from the prototype as drafts awaiting review.

## 4. Test results (TESTING_REPORT.md)

| Suite                                                | Result                           |
| ---------------------------------------------------- | -------------------------------- |
| Backend unit + integration (real MongoDB)            | **283 / 283 passed**             |
| Web unit and component                               | **27 / 27**                      |
| Web end-to-end (3 viewports)                         | **25 passed**, 2 by-design skips |
| Flutter unit and widget                              | **42 / 42**                      |
| Flutter app ↔ real backend (Linux)                   | **1 / 1**                        |
| Security sweeps and dependency audit                 | **Passed; 0 vulnerabilities**    |
| Static analysis (all languages + IaC)                | **Clean**                        |
| Android, iOS, real external services, deployed stack | **Not tested**                   |

## 5. Security (SECURITY_AUDIT.md)

**Fixed in this phase:**

- **H1:** nodemailer injection advisories.
- **H2:** sign-in and two-factor guessing spread across many IPs.
- **M1:** media lost on redeploy.
- **M2:** public source maps.
- **L1:** 500 on bad URLs.

**Verified:** authentication, authorization, answer-key protection, error hygiene, token forgery, log redaction,
CORS, CSP.

**Open, all with mitigations:**

- **M3:** no malware scanning.
- **M4:** no client crash reporting.
- **M5:** account lockout can be used as denial of service.
- **M6:** no external penetration test.

No open critical or high issues.

## 6. Performance (TESTING_REPORT.md §4)

**API:** 0 errors at 150 concurrent continuous players across 3 instances (236 req/s on a shared 4-vCPU sandbox).
About 150 req/s per Node process; scales horizontally. Single-request reads take 9–16 ms. All hot queries are indexed.

**Web, slow 4G, mid-range phone:** landing LCP 3.2 s cold, 0.8 s warm; player screens about 1.9–2.0 s cold.

**Payloads:** compression cut the country list from 15.5 KB to 1.4 KB; the hero image from 207 KB to 66 KB on phones.

**Mobile:** first frame 101 ms on the Linux profile build. Phones not measured.

**Not measured:**

- capacity on real Fargate and Atlas;
- real AI latency;
- Android and iOS performance.

## 7. Deployment status

| Component              | Status                                                                                                                                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Website                | Build and CDN configuration ready (S3 + CloudFront, CSP verified). **Not deployed**                                                                                                                                     |
| Backend                | Production build and worker boot and run with production settings (verified locally); ECS template ready. **Not deployed**. Container image not built here (base image download blocked); the CI `docker` job builds it |
| Database               | Atlas configuration, users, backups and restore runbook documented. **No cluster**                                                                                                                                      |
| Mobile                 | Release scripts and configuration ready. **No builds**                                                                                                                                                                  |
| HTTPS, domain, CDN     | In the template (ACM, CloudFront, ALB TLS 1.3 policy). Domains and certificates not chosen                                                                                                                              |
| Backups                | Atlas point-in-time recovery plus snapshots; S3 versioning (documented). Not configured                                                                                                                                 |
| Logging and monitoring | CloudWatch logs and alarms in the template. Not deployed                                                                                                                                                                |
| Error tracking         | Server: log-based alarms. Client: none (decision pending)                                                                                                                                                               |
| CI/CD                  | CI workflow (tests, audit, builds) and deploy workflow ready. **Never run** (no repository connected)                                                                                                                   |

## 8. Outstanding risks

| Risk                                                      | Impact | Likelihood | Mitigation                                                                        |
| --------------------------------------------------------- | ------ | ---------- | --------------------------------------------------------------------------------- |
| No approved clinical content at launch                    | High   | High       | Recruit and verify clinicians now; review the prototype cases first               |
| Mobile apps fail on real devices (never built)            | High   | Medium     | Build in CI as soon as the repository is connected; run MOBILE_RELEASE_GUIDE §4   |
| AI output quality or safety unknown with the real model   | High   | Medium     | Launch with AI off, or run the evaluation and get clinician sign-off; kill switch |
| First deployment problems (IAM, networking, Atlas access) | Medium | High       | Deploy to staging first; rehearse rollback; follow the checklist                  |
| Data-protection non-compliance in launch countries        | High   | Medium     | Legal review; privacy policy; consent wording                                     |
| Unnoticed client crashes                                  | Medium | Medium     | Add Sentry or Crashlytics before public launch                                    |
| Malicious upload                                          | Medium | Low        | Uploads limited to admins and clinician applicants; add scanning                  |
| Capacity under real launch traffic                        | Medium | Low        | Auto-scaling 2–6 tasks; staging load test                                         |
| Loss of `DATA_ENCRYPTION_KEY`                             | High   | Low        | Offline escrow with two custodians                                                |

## 9. Recommended path to launch

1. **Connect the repository.** CI green (mobile builds, iOS build, Docker image).
2. **Staging.** AWS + Atlas staging; deploy; restore drill; staging load test; real SMTP, Google and FCM.
3. **Content.** Verify clinicians; review and approve the launch cases; tag topics.
4. **Decide.** AI on (after the evaluation) or off; error tracking; upload scanning.
5. **Mobile.** Icons, signing, device test plan; internal/TestFlight.
6. **Closed pilot.** Web plus internal mobile testers, with a few institutions.
7. **Legal and security.** Privacy and terms; penetration test.
8. **Public launch.** Production deployment; staged mobile rollout.
