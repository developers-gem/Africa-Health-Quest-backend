# Production checklist

**How to use it:** tick each item with a name and date. **Release only when every _Blocker_ is ticked.**

**Status at the end of Phase 8:** ☑ means done and verified in this repository. ☐ means still to do, and most of
those need accounts, devices or decisions only the owner can provide.

## A. Code and tests

- ☑ All automated suites green (TESTING_REPORT §1): backend 283, web 27 + 25 E2E, Flutter 42 + 1 integration
- ☑ Lint, types, formatting, OpenAPI drift check, `cfn-lint` clean
- ☑ `npm audit --omit=dev`: 0 vulnerabilities; CI fails on high
- ☑ Security sweeps (authentication, authorization, answer keys, errors) in CI
- ☐ **Blocker:** connect the GitHub repository; CI green on `main`, including `mobile`, `mobile-integration`,
  `ios-build` and `docker`
- ☐ **Blocker:** tag the release commit (`vX.Y.Z`); changelog

## B. Clinical content and safety

- ☐ **Blocker:** at least one case per launch country approved by a **verified clinician** through the review
  workflow. The prototype cases are drafts awaiting review; none are approved in production
- ☐ **Blocker:** clinical lead sign-off on the AI debrief, or launch with AI **disabled**
  (`AiProvider=disabled`)
- ☐ If AI is on, `npm run ai:eval -w @ahq/backend -- --out=eval.json` has been run with the production key, and
  clinicians have reviewed the outputs
- ☐ Topics tagged on published cases (for AI recommendations)
- ☐ Offline-eligible cases chosen deliberately (off by default)

## C. Infrastructure (DEPLOYMENT_GUIDE)

- ☐ **Blocker:** AWS accounts; VPC with NAT; ACM certificates (web in us-east-1, API regional); DNS
- ☐ **Blocker:** `infra/aws/africa-health-quest.yaml` deployed to **staging**, then production
- ☐ **Blocker:** Secrets Manager secret complete; `DATA_ENCRYPTION_KEY` escrowed offline with two custodians
- ☐ **Blocker:** SMTP sender verified (SPF, DKIM, DMARC); registration and reset emails arrive (check spam)
- ☐ GitHub environments with OIDC deploy roles; production requires a reviewer
- ☐ First deploy via the **Deploy** workflow; the smoke test passes
- ☐ Rollback rehearsed on staging (previous task definition, previous web commit)
- ☐ GuardDuty, CloudTrail and AWS Config on; billing alarms set

## D. Database (DATABASE_BACKUP_GUIDE)

- ☐ **Blocker:** Atlas production cluster (M30+, 3 zones), `ahq-app` least-privilege user, network restricted to the
  VPC or NAT
- ☐ **Blocker:** continuous backup with point-in-time recovery on; snapshot copy to a second region; compliance
  policy on
- ☐ **Blocker:** restore drill completed on staging (timed; inside RTO)
- ☐ Atlas alerts routed to the on-call email
- ☐ Seed run; first admin granted; admin MFA set up

## E. Monitoring and operations

- ☐ SNS alarm email confirmed; each alarm test-fired once
- ☐ Logs Insights saved queries: errors by route; lookup by `requestId`
- ☐ **Decision:** client error tracking (Sentry or Crashlytics) for web and apps (SECURITY_AUDIT M4)
- ☐ On-call rota and incident contacts; ADMIN_USER_GUIDE §10 shared with administrators
- ☐ Status or maintenance message plan (for example a banner)

## F. Performance

- ☑ Local load test: 0 errors at 150 concurrent continuous users across 3 instances (TESTING_REPORT §4)
- ☑ Indexed queries; compression; responsive images; lazy-loaded staff areas
- ☐ Load test on **staging** (Fargate + Atlas) at the expected peak, plus 2× headroom; tune `ApiMinTasks`
- ☐ Web LCP under 2.5 s on slow 4G (now 3.2 s cold): consider splitting the contract schemas out of the main chunk

## G. Security and privacy

- ☑ Findings H1–H2, M1–M2 and L1 fixed (SECURITY_AUDIT §2)
- ☐ **Blocker:** privacy policy and terms of use published (web, app stores); data-protection review for launch
  countries; AI processing consent wording approved
- ☐ **Decision:** upload malware scanning (SECURITY_AUDIT M3)
- ☐ External penetration test before **public** launch (a closed pilot can go first)
- ☐ Erasure and backup-retention policy decided and published

## H. Web

- ☐ Production build deployed through the workflow; HTTPS and HSTS verified (`curl -I`)
- ☐ Security headers check (e.g. securityheaders.com) on the live domain
- ☐ Firefox and Safari smoke test (only Chromium has been tested)
- ☐ Google sign-in tested with the real OAuth client (if enabled)

## I. Mobile (MOBILE_RELEASE_GUIDE)

- ☐ **Blocker:** confirm the Android and iOS app IDs
- ☐ **Blocker:** real launcher icons and store artwork
- ☐ **Blocker:** Android upload key and Play App Signing; Apple signing
- ☐ **Blocker:** release builds produced and the device test plan (§4) passed on low-end Android, current Android and
  an iPhone
- ☐ Firebase projects and config files (if push is wanted at launch); APNs key uploaded
- ☐ Store listings, data-safety and privacy labels, reviewer test account
- ☐ Internal/TestFlight → closed testing → staged rollout

## J. Go-live day

- ☐ Final backup snapshot taken before launch
- ☐ Deploy production from the tagged commit; smoke test; sign in as admin
- ☐ Check the dashboards for the first hour (errors, latency, 5xx, AI spend)
- ☐ Announce; keep the AI kill switch and case-withdraw controls at hand
