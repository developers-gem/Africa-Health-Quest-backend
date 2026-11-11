import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MissionAttemptModel } from "../../src/modules/gameplay/attempt.model.js";
import { HospitalRunModel } from "../../src/modules/hospital/hospital.models.js";
import { expireStaleAttempts, purgeInactiveGuests } from "../../src/modules/jobs/retention.js";
import {
  PlayerProgressModel,
  ProgressLedgerModel,
} from "../../src/modules/players/player.models.js";
import { IdempotencyRecordModel, SyncEventModel } from "../../src/modules/sync/sync.models.js";
import { UserModel } from "../../src/modules/users/user.model.js";
import { acquireLease, releaseLease } from "../../src/worker.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const malaria = PROTOTYPE_MISSIONS.find((m) => m.key === "malaria")!;
const correctOf = (stepId: string) =>
  malaria.steps.find((s) => s.stepId === stepId)!.choices.find((c) => c.correct)!.choiceId;
const wrongOf = (stepId: string) =>
  malaria.steps.find((s) => s.stepId === stepId)!.choices.find((c) => !c.correct)!.choiceId;
const now = () => new Date().toISOString();
const ev = (type: string, payload: object, occurredAt = now()) => ({
  eventId: randomUUID(),
  occurredAt,
  type,
  payload,
});
const alloc = (a: Partial<Record<"staff" | "beds" | "ambulances" | "supplies", number>>) => ({
  staff: 0,
  beds: 0,
  ambulances: 0,
  supplies: 0,
  ...a,
});

async function setup() {
  const ctx = makeApp();
  await seedReference(ctx);
  await publishAll(ctx);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, token: player.accessToken as string, userId: player.user.id as string };
}
const sync = (ctx: ReturnType<typeof makeApp>, token: string, events: object[], key?: string) => {
  const req = ctx.http().post("/api/v1/sync/events").set(bearer(token));
  if (key) req.set("Idempotency-Key", key);
  return req.send({ events });
};

describe("idempotency keys", () => {
  it("replays the stored response and never repeats the side effect", async () => {
    const { ctx, token, userId } = await setup();
    const send = () =>
      ctx
        .http()
        .post("/api/v1/hospital/runs")
        .set(bearer(token))
        .set("Idempotency-Key", "shift-0001")
        .send({ allocation: alloc({ staff: 2 }) });
    const first = await send().expect(201);
    expect(first.headers["idempotency-replayed"]).toBeUndefined();
    const second = await send().expect(201);
    expect(second.headers["idempotency-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    expect(await HospitalRunModel.countDocuments({ userId })).toBe(1);
  });

  it("rejects a key reused with a different body and malformed keys", async () => {
    const { ctx, token } = await setup();
    const post = (key: string, staff: number) =>
      ctx
        .http()
        .post("/api/v1/hospital/runs")
        .set(bearer(token))
        .set("Idempotency-Key", key)
        .send({ allocation: alloc({ staff }) });
    await post("shift-0002", 1).expect(201);
    const reused = await post("shift-0002", 2).expect(422);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    await post("bad key!", 1).expect(400);
  });

  it("scopes keys per user and reports an in-flight request as a conflict", async () => {
    const { ctx, token, userId } = await setup();
    const other = await createVerifiedUser(ctx, "other@example.com");
    await IdempotencyRecordModel.create({
      userId,
      key: "inflight-1",
      requestHash: "x",
      status: "processing",
      expiresAt: new Date(Date.now() + 60_000),
    });
    const busy = await ctx
      .http()
      .post("/api/v1/hospital/runs")
      .set(bearer(token))
      .set("Idempotency-Key", "inflight-1")
      .send({ allocation: alloc({ staff: 1 }) });
    expect([409, 422]).toContain(busy.status);
    await ctx
      .http()
      .post("/api/v1/hospital/runs")
      .set(bearer(other.accessToken))
      .set("Idempotency-Key", "inflight-1")
      .send({ allocation: alloc({ staff: 1 }) })
      .expect(201);
  });

  it("does not store failed responses, so a corrected retry can succeed", async () => {
    const { ctx, token } = await setup();
    const post = (staff: number) =>
      ctx
        .http()
        .post("/api/v1/hospital/runs")
        .set(bearer(token))
        .set("Idempotency-Key", "retry-0001")
        .send({ allocation: alloc({ staff }) });
    expect((await post(50)).status).toBeGreaterThanOrEqual(400); // over the per-resource limit
    expect(await IdempotencyRecordModel.countDocuments({ key: "retry-0001" })).toBe(0);
    await post(1).expect(201);
  });
});

describe("offline event queue", () => {
  it("plays a whole mission offline using a client reference and rewards it once", async () => {
    const { ctx, token, userId } = await setup();
    const events = [
      ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "m1" }),
      ev("attempt.answer", { attempt: "client:m1", stepId: "s1", choiceId: correctOf("s1") }),
      ev("attempt.answer", { attempt: "client:m1", stepId: "s2", choiceId: correctOf("s2") }),
    ];
    const res = await sync(ctx, token, events, "batch-0001").expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(res.body.results[2].data.result).toMatchObject({ score: 50, passed: true });
    expect(res.body.progress).toMatchObject({ hp: 50, funding: 125 });

    // The phone lost the response and re-sends the same events under a new request.
    const again = await sync(ctx, token, events).expect(200);
    expect(again.body.results.map((r: { status: string }) => r.status)).toEqual([
      "duplicate",
      "duplicate",
      "duplicate",
    ]);
    expect(again.body.results[2].data.result.score).toBe(50);
    expect(again.body.progress).toMatchObject({ hp: 50, funding: 125 });
    expect(await ProgressLedgerModel.countDocuments({ userId })).toBe(1);
  });

  it("deduplicates concurrent uploads of the same batch", async () => {
    const { ctx, token, userId } = await setup();
    const events = [ev("hospital.run", { allocation: alloc({ staff: 2 }) })];
    const [a, b] = await Promise.all([sync(ctx, token, events), sync(ctx, token, events)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const statuses = [a.body.results[0].status, b.body.results[0].status].sort();
    expect(statuses).toEqual(["applied", "duplicate"]);
    expect(await HospitalRunModel.countDocuments({ userId })).toBe(1);
  });

  it("resolves answer conflicts from two devices: first answer wins", async () => {
    const { ctx, token } = await setup();
    const started = await ctx
      .http()
      .post("/api/v1/attempts")
      .set(bearer(token))
      .send({ missionKey: "malaria", mode: "story" })
      .expect(201);
    const id = started.body.id as string;
    await ctx
      .http()
      .post(`/api/v1/attempts/${id}/answers`)
      .set(bearer(token))
      .send({ stepId: "s1", choiceId: correctOf("s1") })
      .expect(200);
    const res = await sync(ctx, token, [
      ev("attempt.answer", { attempt: id, stepId: "s1", choiceId: correctOf("s1") }),
      ev("attempt.answer", { attempt: id, stepId: "s1", choiceId: wrongOf("s1") }),
    ]).expect(200);
    expect(res.body.results[0]).toMatchObject({ status: "duplicate", code: null });
    expect(res.body.results[1]).toMatchObject({
      status: "rejected",
      code: "STEP_ALREADY_ANSWERED",
    });
    expect(res.body.results[1].data.steps[0].answer.choiceId).toBe(correctOf("s1"));
  });

  it("rejects events that cannot apply without stopping the rest of the batch", async () => {
    const { ctx, token, userId } = await setup();
    const res = await sync(ctx, token, [
      ev("hospital.run", { allocation: alloc({ staff: 6, beds: 5 }) }), // costs more than 100
      ev("attempt.answer", { attempt: "client:never", stepId: "s1", choiceId: "s1c1" }),
      ev("attempt.start", { missionKey: "bp", mode: "story", clientRef: "x" }), // tier-locked
      ev("hospital.run", { allocation: alloc({ staff: 1 }) }),
    ]).expect(200);
    expect(
      res.body.results.map((r: { status: string; code: string }) => [r.status, r.code]),
    ).toEqual([
      ["rejected", "INSUFFICIENT_FUNDS"],
      ["rejected", "NOT_FOUND"],
      ["rejected", "MISSION_LOCKED"],
      ["applied", null],
    ]);
    expect(await HospitalRunModel.countDocuments({ userId })).toBe(1);
  });

  it("applies profile edits last-writer-wins by device time", async () => {
    const { ctx, token } = await setup();
    const t0 = Date.now();
    const res = await sync(ctx, token, [
      ev("profile.update", { institution: "Korle Bu" }, new Date(t0 - 1_000).toISOString()),
      ev("profile.update", { institution: "Older edit" }, new Date(t0 - 60_000).toISOString()),
    ]).expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["applied", "stale"]);
    const me = await ctx.http().get("/api/v1/players/me/profile").set(bearer(token)).expect(200);
    expect(me.body.institution).toBe("Korle Bu");
  });

  it("clamps device timestamps that are in the future", async () => {
    const { ctx, token, userId } = await setup();
    const future = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await sync(ctx, token, [ev("profile.update", { institution: "A" }, future)]).expect(200);
    const stored = await SyncEventModel.findOne({ userId }).lean();
    expect(stored!.occurredAt.getTime()).toBeLessThan(Date.now() + 6 * 60_000);
    // A normal edit afterwards still wins, because the bogus future time was clamped.
    await new Promise((r) => setTimeout(r, 10));
    const later = await sync(ctx, token, [
      ev(
        "profile.update",
        { institution: "B" },
        new Date(Date.now() + 5 * 60_000 + 1000).toISOString(),
      ),
    ]).expect(200);
    expect(later.body.results[0].status).toBe("applied");
  });

  it("validates batches and requires authentication", async () => {
    const { ctx, token } = await setup();
    await ctx.http().post("/api/v1/sync/events").send({ events: [] }).expect(401);
    await sync(ctx, token, []).expect(400);
    await sync(ctx, token, [
      { ...ev("hospital.run", { allocation: alloc({}) }), eventId: "x" },
    ]).expect(400);
    await sync(ctx, token, [ev("progress.set", { hp: 9999 })]).expect(400); // no such event: clients cannot set progress
    const many = Array.from({ length: 51 }, () => ev("profile.update", { locale: "en" }));
    await sync(ctx, token, many).expect(400);
  });
});

describe("sync state", () => {
  it("returns only what changed since the last sync", async () => {
    const { ctx, token } = await setup();
    const first = await ctx.http().get("/api/v1/sync/state").set(bearer(token)).expect(200);
    expect(first.body.progress).toMatchObject({ hp: 0, funding: 100 });
    expect(first.body.profile).not.toBeNull();
    expect(first.body.attempts).toEqual([]);

    // The first call creates the default profile, so use the next sync time as the baseline.
    const second = await ctx.http().get("/api/v1/sync/state").set(bearer(token)).expect(200);
    const since = second.body.serverTime as string;
    const version = first.body.progress.version as number;
    const unchanged = await ctx
      .http()
      .get(`/api/v1/sync/state?since=${encodeURIComponent(since)}&progressVersion=${version}`)
      .set(bearer(token))
      .expect(200);
    expect(unchanged.body).toMatchObject({
      progress: null,
      profile: null,
      attempts: [],
      hospitalRuns: [],
    });

    await new Promise((r) => setTimeout(r, 5));
    await sync(ctx, token, [
      ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "m1" }),
      ev("hospital.run", { allocation: alloc({ staff: 1 }) }),
    ]).expect(200);
    const changed = await ctx
      .http()
      .get(`/api/v1/sync/state?since=${encodeURIComponent(since)}&progressVersion=${version}`)
      .set(bearer(token))
      .expect(200);
    expect(changed.body.progress).not.toBeNull();
    expect(changed.body.attempts).toHaveLength(1);
    expect(changed.body.attempts[0]).toMatchObject({
      missionKey: "malaria",
      status: "in_progress",
    });
    expect(changed.body.hospitalRuns).toHaveLength(1);
    expect(JSON.stringify(changed.body)).not.toMatch(/"correct"|"feedback"/);
  });
});

describe("catalog", () => {
  it("serves a cacheable catalogue with ETag revalidation and no answer keys", async () => {
    const { ctx, token } = await setup();
    const anon = await ctx.http().get("/api/v1/catalog").expect(200);
    expect(anon.body.countries).toHaveLength(54);
    expect(anon.body.missions).toHaveLength(10);
    expect(anon.body.minAppVersion).toEqual({ android: "0.1.0", ios: "0.1.0" });
    expect(anon.headers["etag"]).toBe(anon.body.etag);
    expect(anon.headers["cache-control"]).toContain("public");
    expect(JSON.stringify(anon.body)).not.toMatch(/"correct"|"feedback"|"steps"/);
    await ctx.http().get("/api/v1/catalog").set("If-None-Match", anon.body.etag).expect(304);

    const mine = await ctx.http().get("/api/v1/catalog").set(bearer(token)).expect(200);
    expect(mine.headers["cache-control"]).toContain("private");
    const byKey = Object.fromEntries(mine.body.missions.map((m: { key: string }) => [m.key, m]));
    expect(byKey.bp.locked).toBe(true);
  });
});

describe("guest merge", () => {
  async function guestWithMalaria(ctx: ReturnType<typeof makeApp>) {
    const g = await ctx
      .http()
      .post("/api/v1/auth/guest")
      .set("X-Client-Platform", "mobile")
      .expect(201);
    const t = g.body.accessToken as string;
    await sync(ctx, t, [
      ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "g1" }),
      ev("attempt.answer", { attempt: "client:g1", stepId: "s1", choiceId: correctOf("s1") }),
      ev("attempt.answer", { attempt: "client:g1", stepId: "s2", choiceId: correctOf("s2") }),
      ev("hospital.run", { allocation: alloc({ staff: 1 }) }),
    ]).expect(200);
    return { token: t, id: g.body.user.id as string };
  }

  it("replays guest missions under first-completion rules and deletes the guest", async () => {
    const { ctx, token, userId } = await setup();
    const guest = await guestWithMalaria(ctx);
    const res = await ctx
      .http()
      .post("/api/v1/sync/merge-guest")
      .set(bearer(token))
      .send({ guestAccessToken: guest.token })
      .expect(200);
    expect(res.body).toMatchObject({
      attemptsMerged: 1,
      missionsCompleted: 1,
      hpAdded: 50,
      fundingAdded: 25,
    });
    expect(res.body.progress).toMatchObject({ hp: 50, funding: 125 });
    expect(await UserModel.exists({ _id: guest.id })).toBeNull();
    expect(await PlayerProgressModel.exists({ userId: guest.id })).toBeNull();
    expect(await MissionAttemptModel.countDocuments({ userId })).toBe(1);
    await ctx.http().get("/api/v1/users/me").set(bearer(guest.token)).expect(401);

    // Merging another guest that completed the same mission adds no first-completion rewards again.
    const guest2 = await guestWithMalaria(ctx);
    const res2 = await ctx
      .http()
      .post("/api/v1/sync/merge-guest")
      .set(bearer(token))
      .send({ guestAccessToken: guest2.token })
      .expect(200);
    expect(res2.body).toMatchObject({ attemptsMerged: 1, missionsCompleted: 0 });
    expect(res2.body.progress.hp).toBeLessThan(100);
  });

  it("refuses invalid tokens, registered accounts and guests as the target", async () => {
    const { ctx, token } = await setup();
    const other = await createVerifiedUser(ctx, "other@example.com");
    const merge = (t: string, guestAccessToken: string) =>
      ctx.http().post("/api/v1/sync/merge-guest").set(bearer(t)).send({ guestAccessToken });
    expect((await merge(token, other.accessToken)).status).toBe(403);
    expect((await merge(token, "x".repeat(40))).status).toBe(401);
    const guest = await guestWithMalaria(ctx);
    expect((await merge(guest.token, guest.token)).status).toBe(403);
  });
});

describe("retention jobs and worker lease", () => {
  it("purges inactive guests with their data and expires stale attempts", async () => {
    const { ctx, token } = await setup();
    const g = await ctx
      .http()
      .post("/api/v1/auth/guest")
      .set("X-Client-Platform", "mobile")
      .expect(201);
    await sync(ctx, g.body.accessToken, [
      ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "g" }),
    ]).expect(200);
    await sync(ctx, token, [
      ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "p" }),
    ]).expect(200);

    const later = new Date(Date.now() + 31 * 86_400_000);
    const purged = await purgeInactiveGuests(30, later);
    expect(purged.guests).toBe(1);
    expect(await UserModel.exists({ _id: g.body.user.id })).toBeNull();
    expect(await SyncEventModel.countDocuments({ userId: g.body.user.id })).toBe(0);
    expect(await UserModel.countDocuments({ isGuest: false })).toBe(1);

    expect((await expireStaleAttempts(7, new Date(Date.now() + 6 * 86_400_000))).expired).toBe(0);
    expect((await expireStaleAttempts(7, new Date(Date.now() + 8 * 86_400_000))).expired).toBe(1);
  });

  it("gives the scheduler lease to one worker at a time", async () => {
    const t = new Date();
    expect(await acquireLease("a", 60_000, t)).toBe(true);
    expect(await acquireLease("b", 60_000, t)).toBe(false);
    expect(await acquireLease("a", 60_000, t)).toBe(true); // renew
    expect(await acquireLease("b", 60_000, new Date(t.getTime() + 61_000))).toBe(true);
    await releaseLease("a"); // not the owner any more: no effect
    expect(await acquireLease("a", 60_000, new Date(t.getTime() + 62_000))).toBe(false);
    await releaseLease("b"); // graceful shutdown hands the lease over immediately
    expect(await acquireLease("a", 60_000, new Date(t.getTime() + 62_000))).toBe(true);
  });
});
