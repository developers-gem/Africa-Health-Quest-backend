# Testing report (release, Phase 8)

**Run date:** 2026-11-05. All suites were run on the release candidate, the commits after `7a33728`.

**Environment:**

- MongoDB 8 replica set in Docker;
- Chromium (Playwright);
- Flutter 3.47 (Linux desktop target);
- moto S3-compatible server;
- a local SMTP sink.

**Android and iOS were not available:** this environment cannot install the Android SDK (download blocked) and
cannot build iOS (needs macOS).

## 1. Automated suites

| Suite                                             | Result                   | Notes                                                                                                                     |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Backend unit + integration (Vitest, real MongoDB) | **283 passed**, 0 failed | 34 files. Includes the security sweep, production infrastructure, AI and offline sync suites                              |
| API tests (OpenAPI-driven)                        | Included above           | All 129 operations are routed; all 110 protected ones reject anonymous calls; all 66 permission-gated ones reject players |
| Web unit and component (Vitest + Testing Library) | **27 passed**            |                                                                                                                           |
| Web end-to-end (Playwright, real backend + DB)    | **25 passed**, 2 skipped | Desktop 1366 px, tablet (iPad Mini), phone (Pixel 7). The skips are phone-only tests on larger screens                    |
| Flutter unit and widget                           | **42 passed**            | Full app over a fake API: every screen at 360/800/1280 px, offline play, sync, auth, Commander, debrief                   |
| Flutter integration (real app ↔ real backend)     | **1 passed**             | Linux desktop build: real HTTP, secure storage, SQLite. Download → offline play → reconnect → server scoring              |
| Security checks                                   | **Passed**               | Dependency audit (0 vulnerabilities), secret scans, sweeps — see SECURITY_AUDIT.md                                        |
| Static checks                                     | **Clean**                | ESLint, TypeScript (strict), Prettier, `dart format`, `flutter analyze`, `cfn-lint` (infrastructure)                      |
| Android release build                             | **Not run**              | No Android SDK here; the CI `mobile` job builds debug and release APKs                                                    |
| iOS release build                                 | **Not run**              | Needs macOS; the CI `ios-build` job builds without signing                                                                |
| CI on GitHub                                      | **Never run**            | No repository connected                                                                                                   |

## 2. Functional coverage by platform

**Key:**

- **E2E:** driven through the UI against the real API.
- **INT:** API integration test against the real database.
- **W:** Flutter widget test over a fake API.
- **M-E2E:** Flutter app against the real API (Linux).
- **—:** not covered.

| Feature                               | Backend + MongoDB                                                                   | Website                            | Flutter (Linux/widget)            | Android | iOS |
| ------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------- | ------- | --- |
| Registration, email verification      | INT                                                                                 | E2E                                | W (form)                          | —       | —   |
| Login, logout, sessions, MFA, step-up | INT                                                                                 | E2E (staff MFA)                    | W (validation, errors, switching) | —       | —   |
| Google sign-in                        | INT (fake verifier)                                                                 | — (needs a real client ID)         | not built in the app              | —       | —   |
| Guest play and upgrade                | INT                                                                                 | E2E                                | W, M-E2E (guest)                  | —       | —   |
| Player profiles, settings             | INT                                                                                 | E2E (profile)                      | W (screens render)                | —       | —   |
| Story Mode                            | INT                                                                                 | E2E                                | W, M-E2E                          | —       | —   |
| Clinical Challenge (practice, random) | INT                                                                                 | rendered                           | W (rendered)                      | —       | —   |
| Clinical gameplay + reasoning         | INT                                                                                 | E2E                                | W (online and offline)            | —       | —   |
| Mission progression, rewards, tiers   | INT                                                                                 | E2E (+HP, ₵)                       | W (results)                       | —       | —   |
| Hospital Commander                    | INT                                                                                 | E2E                                | W (allocation limits)             | —       | —   |
| Country expansion, unlocks            | INT                                                                                 | rendered                           | W (rendered)                      | —       | —   |
| AI debrief                            | INT (fake provider, 30 tests)                                                       | E2E (consent, report)              | W (consent, report, AI label)     | —       | —   |
| Clinician reviews                     | INT                                                                                 | E2E (verify, approve)              | n/a (web only)                    | n/a     | n/a |
| Administration                        | INT                                                                                 | E2E (most; see the Phase 5 report) | n/a (web only)                    | n/a     | n/a |
| Notifications (inbox, push)           | INT (fake push sender)                                                              | rendered                           | W (rendered); real FCM never      | —       | —   |
| Offline gameplay                      | INT (packs, sync, conflicts)                                                        | n/a                                | W, M-E2E                          | —       | —   |
| Cross-device synchronisation          | INT (same account across sessions; sync idempotency; server-authoritative progress) | E2E (guest upgrade keeps progress) | W (account switch), M-E2E         | —       | —   |

**Gaps:**

- **Mobile platforms:** nothing has run on Android or iOS (no builds, devices, emulators or simulators).
- **External services, tested only with fakes:**
  - Google sign-in (fake verifier);
  - FCM push (fake sender);
  - the Anthropic API (fake provider);
  - SES/SMTP (local sink);
  - AWS (moto for S3).

## 3. Defects found during release testing (all fixed)

| #   | Severity | Defect                                                                                                      | Found by                      |
| --- | -------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 1   | High     | nodemailer advisories (SMTP and header injection)                                                           | Dependency audit              |
| 2   | High     | Sign-in and two-factor guessing spread across many IPs was not limited per account                          | Security review               |
| 3   | High     | Media stored on container disk (lost on redeploy, not shared)                                               | Deployment review             |
| 4   | High     | The web CSP would have blocked inlined font subsets in production                                           | CSP run against the built app |
| 5   | High     | Infrastructure template: CloudFormation would reject YAML aliases and non-ASCII security-group descriptions | `cfn-lint`                    |
| 6   | Medium   | No response compression (15.5 KB country list on mobile networks)                                           | Performance test              |
| 7   | Medium   | Source maps published with the web build                                                                    | Build review                  |
| 8   | Medium   | The test helper silently dropped the storage override, so one S3 check was really using local disk          | Type checking                 |
| 9   | Low      | Bad URL encoding returned 500                                                                               | Security sweep                |
| 10  | Low      | The deploy workflow's `--delete` would remove chunks that players mid-session still need                    | Review                        |

## 4. Performance results

These were measured on a shared 4-vCPU sandbox that also ran MongoDB and the load generator. Treat them as lower
bounds for one Fargate task, not as production capacity.

**API load test** (`scripts/perf/load-test.mjs`). Each virtual player loops through the full journey without pausing:

- guest session;
- catalogue, missions and mission detail;
- start a case and answer every step;
- progress and hospital state;
- a sync upload.

| Setup                  | Throughput | Errors | p50 (reads) | p95 (reads) | p50 / p95 (answer step, transactional) |
| ---------------------- | ---------- | ------ | ----------- | ----------- | -------------------------------------- |
| 1 user, 1 instance     | 59 req/s   | 0      | 9–13 ms     | 11–16 ms    | 25 / 39 ms                             |
| 50 users, 1 instance   | 150 req/s  | 0%     | 153–335 ms  | 223–601 ms  | 493 / 941 ms                           |
| 150 users, 3 instances | 236 req/s  | 0%     | 256–596 ms  | 402–1191 ms | 930 / 1625 ms                          |

**Reading these numbers.**

- One Node process saturates a CPU core at about 150 req/s, so higher concurrency mostly shows queueing.
- The API is stateless and scales horizontally: three instances gave more throughput even on shared cores.
- At 1 request every 15 s per active player, 236 req/s is about 3,500 concurrent players.
- The template starts with 2 tasks of 1 vCPU and auto-scales to 6 at 60% CPU.
- **Not measured:** production capacity on real Fargate and Atlas (a staging load test is in the checklist).

**Other measurements:**

| Area                                                  | Result                                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database queries                                      | Profiler under load: every hot query uses an index (IXSCAN, IDHACK or COUNT_SCAN); worst observed 4 ms. The only collection scan is the small achievements table                              |
| DB operations per request                             | About 5 for a typical authenticated read (user check, data reads). The shared limiter write applies only to sign-in routes                                                                    |
| Offline synchronisation                               | 30 events (10 offline cases) per upload: 580–660 ms, all applied. About 20 ms per event (each in a transaction); a full 50-event batch takes about 1 s                                        |
| Response compression                                  | Country list 15.5 KB → 1.4 KB; catalogue similar                                                                                                                                              |
| Web, slow 4G, mid-range phone (4× CPU slowdown), cold | Landing: FCP 2.0 s, LCP 3.2 s (was 3.7 s before the responsive hero), 427 KB transferred. Countries: LCP 2.0 s. Player home: LCP 1.9 s                                                        |
| Web, warm cache                                       | FCP and LCP 0.6–0.8 s on slow 4G; about 4 KB transferred                                                                                                                                      |
| Web JavaScript                                        | Main chunk 132 KB gzipped (the shared contract schemas make it large); staff and admin areas lazy-load                                                                                        |
| Images                                                | Hero 207 KB JPEG → 66 KB WebP on phones; flags and images decoded at display size in the app                                                                                                  |
| Mobile startup                                        | Linux profile build: first frame 101 ms, first rasterized frame 291 ms. **Not measured on Android or iOS devices**                                                                            |
| AI response handling                                  | Requests wait up to 25 s, then return `202` and the client polls; failures don't count against quota; the fallback model is optional (tested with the fake provider; real latency unmeasured) |

## 5. Not tested (blocks a "production-ready" verdict)

1. **Android and iOS:** builds, installs, real devices, push notifications, store review.
2. **Google sign-in, FCM, the Anthropic API and SES** with real credentials.
3. **The deployed AWS stack:** CloudFront, ALB, WAF, ECS rollout and rollback, alarms. Also the CI and deploy
   workflows on GitHub.
4. **Load test on staging** with real Fargate and Atlas.
5. **Browsers other than Chromium** (Firefox, Safari).
6. **Accessibility audit** with assistive technology (only automated structure checks so far).
7. **Restore drill** (DATABASE_BACKUP_GUIDE §6).

## 6. How to re-run

```bash
npm run db:up
```

```bash
./scripts/check.sh
```

```bash
S3_TEST_ENDPOINT=http://127.0.0.1:5055 npx vitest run --root apps/backend
```

```bash
npm run test:e2e
```

```bash
cd apps/mobile && flutter analyze && flutter test
```

```bash
xvfb-run -a dbus-run-session -- ./scripts/mobile/run-e2e.sh
```

```bash
node scripts/perf/load-test.mjs --base=http://localhost:4000 --users=50 --seconds=60
```

The S3 test needs `moto_server -p 5055`. Run the load test only against a test deployment with relaxed rate limits.
