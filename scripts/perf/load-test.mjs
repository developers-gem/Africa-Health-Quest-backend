#!/usr/bin/env node
/**
 * API load test: N concurrent virtual players each run the core journey repeatedly for a fixed duration:
 *   guest session → catalogue → missions → mission → start case → answer every step → progress → hospital state
 *   → sync a profile change.
 * Reports per-endpoint latency percentiles, throughput and errors. No dependencies (Node 22 fetch).
 *
 *   node scripts/perf/load-test.mjs --base=http://localhost:4000 --users=50 --seconds=60 --mission=malaria
 *
 * Run it only against a test deployment with an approved mission and relaxed per-IP rate limits (all virtual
 * users share one IP): RATE_LIMIT_AUTH_MAX / RATE_LIMIT_API_MAX. Never against production.
 */
import { randomUUID } from "node:crypto";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
/** One or more API instances (comma-separated); virtual users are spread across them round-robin. */
const BASES = arg("base", "http://localhost:4000").split(",");
const USERS = Number(arg("users", "50"));
const SECONDS = Number(arg("seconds", "60"));
const MISSION = arg("mission", "malaria");

const stats = new Map(); // name -> { lat: number[], errors: number, codes: Map }
function record(name, ms, status) {
  const s = stats.get(name) ?? { lat: [], errors: 0, codes: new Map() };
  s.lat.push(ms);
  if (status >= 400 || status === 0) s.errors++;
  s.codes.set(status, (s.codes.get(status) ?? 0) + 1);
  stats.set(name, s);
}

async function call(name, method, path, { token, body, idem, base } = {}) {
  const started = performance.now();
  let status = 0;
  let json = null;
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Client-Platform": "mobile",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(idem ? { "Idempotency-Key": randomUUID() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    json = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  } catch {
    status = 0;
  }
  record(name, performance.now() - started, status);
  return { status, json };
}

async function journey(deadline, base) {
  const c = (name, method, path, opts = {}) => call(name, method, path, { ...opts, base });
  const guest = await c("POST /auth/guest", "POST", "/api/v1/auth/guest", { body: {} });
  const token = guest.json?.accessToken;
  if (!token) return;
  while (Date.now() < deadline) {
    await c("GET /catalog", "GET", "/api/v1/catalog", { token });
    await c("GET /missions", "GET", "/api/v1/missions?mode=practice", { token });
    await c("GET /missions/:key", "GET", `/api/v1/missions/${MISSION}`, { token });
    const att = await c("POST /attempts", "POST", "/api/v1/attempts", {
      token,
      idem: true,
      body: { missionKey: MISSION, mode: "practice" },
    });
    let step = att.json?.steps?.find((s) => !s.answer) ?? att.json?.steps?.[0];
    while (att.json?.id && step) {
      const ans = await c(
        "POST /attempts/:id/answers",
        "POST",
        `/api/v1/attempts/${att.json.id}/answers`,
        {
          token,
          idem: true,
          body: {
            stepId: step.stepId,
            choiceId: step.choices[0].choiceId,
            reasoning: "load test reasoning",
          },
        },
      );
      step = ans.json?.next ?? null;
    }
    await c("GET /players/me/progress", "GET", "/api/v1/players/me/progress", { token });
    await c("GET /hospital/state", "GET", "/api/v1/hospital/state", { token });
    await c("POST /sync/events", "POST", "/api/v1/sync/events", {
      token,
      idem: true,
      body: {
        events: [
          {
            eventId: randomUUID(),
            occurredAt: new Date().toISOString(),
            type: "profile.update",
            payload: { learnerLevel: "nursing_student" },
          },
        ],
      },
    });
  }
}

const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
const started = Date.now();
await Promise.all(
  Array.from({ length: USERS }, (_, i) =>
    journey(started + SECONDS * 1000, BASES[i % BASES.length]),
  ),
);
const elapsed = (Date.now() - started) / 1000;

let total = 0;
let errors = 0;
const rows = [];
for (const [name, s] of stats) {
  s.lat.sort((a, b) => a - b);
  total += s.lat.length;
  errors += s.errors;
  rows.push({
    endpoint: name,
    requests: s.lat.length,
    p50: Math.round(pct(s.lat, 50)),
    p95: Math.round(pct(s.lat, 95)),
    p99: Math.round(pct(s.lat, 99)),
    max: Math.round(s.lat.at(-1)),
    errors: s.errors,
    codes: Object.fromEntries(s.codes),
  });
}
console.log(
  `\n${BASES.length} instance(s) · ${USERS} virtual users · ${elapsed.toFixed(0)} s · ${total} requests · ${(total / elapsed).toFixed(1)} req/s · ${errors} errors (${((100 * errors) / Math.max(total, 1)).toFixed(2)}%)\n`,
);
console.table(rows.map(({ codes, ...r }) => ({ ...r, codes: JSON.stringify(codes) })));
process.exitCode = errors / Math.max(total, 1) > 0.01 ? 1 : 0;
