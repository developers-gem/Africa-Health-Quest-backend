import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { MediaAssetModel } from "../../src/modules/media/media.model.js";
import { PlayerProgressModel } from "../../src/modules/players/player.models.js";
import { MissionReviewModel } from "../../src/modules/reviews/review.models.js";
import { UserModel } from "../../src/modules/users/user.model.js";
import { PNG_1X1 } from "../fixtures/media.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const ctx = makeApp();
  await seedReference(ctx);
  const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, admin: admin.accessToken as string, adminId: admin.user.id as string, player };
}

describe("admin endpoints are protected", () => {
  it("requires sign-in and the right permission for every M8 endpoint", async () => {
    const { ctx, player } = await setup();
    const reviewer = await createVerifiedUser(ctx, "rev@example.com", ["player", "reviewer"]);
    const endpoints: [string, string][] = [
      ["get", "/api/v1/admin/settings"],
      ["get", "/api/v1/admin/settings/economy"],
      ["get", "/api/v1/admin/settings/economy/history"],
      ["put", "/api/v1/admin/settings/economy"],
      ["get", "/api/v1/admin/audit-logs"],
      ["get", "/api/v1/admin/analytics/overview"],
      ["get", "/api/v1/admin/analytics/missions"],
      ["get", "/api/v1/admin/analytics/funnel"],
      ["get", "/api/v1/admin/roles"],
      ["post", `/api/v1/admin/users/${player.user.id}/erase`],
    ];
    for (const [method, path] of endpoints) {
      const call = (t?: string) => {
        const req = (
          ctx.http() as unknown as Record<string, (p: string) => import("supertest").Test>
        )[method]!(path);
        return t ? req.set(bearer(t)) : req;
      };
      expect((await call()).status, `${method} ${path} anonymous`).toBe(401);
      expect((await call(player.accessToken)).status, `${method} ${path} player`).toBe(403);
      expect((await call(reviewer.accessToken)).status, `${method} ${path} reviewer`).toBe(403);
    }
  });
});

describe("platform settings", () => {
  it("lists active settings, versions an update with audit and optimistic concurrency", async () => {
    const { ctx, admin, adminId } = await setup();
    const list = await ctx.http().get("/api/v1/admin/settings").set(bearer(admin)).expect(200);
    expect(list.body.items.map((s: { key: string }) => s.key)).toEqual([
      "ai",
      "economy",
      "hospital",
      "progression",
    ]);
    const economy = list.body.items.find((s: { key: string }) => s.key === "economy");
    expect(economy).toMatchObject({ version: 1, status: "active" });
    expect(economy.value.pointsPerCorrectStep).toBe(25);

    const put = (value: object, expectedVersion: number) =>
      ctx
        .http()
        .put("/api/v1/admin/settings/economy")
        .set(bearer(admin))
        .send({ value, changeNote: "Raise replay reward", expectedVersion });
    const updated = await put({ ...economy.value, replayHpFactor: 0.5 }, 1).expect(200);
    expect(updated.body).toMatchObject({
      version: 2,
      status: "active",
      value: { replayHpFactor: 0.5 },
    });

    const stale = await put({ ...economy.value, replayHpFactor: 0.4 }, 1);
    expect(stale.status).toBe(412);
    expect(stale.body.error.code).toBe("PRECONDITION_FAILED");

    const invalid = await put({ ...economy.value, passThreshold: 3 }, 2);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.details[0].path).toBe("value.passThreshold");
    await put({ pointsPerCorrectStep: 10 }, 2).expect(400); // incomplete values are rejected

    const history = await ctx
      .http()
      .get("/api/v1/admin/settings/economy/history")
      .set(bearer(admin))
      .expect(200);
    expect(history.body.total).toBe(2);
    expect(
      history.body.items.map((v: { version: number; status: string }) => [v.version, v.status]),
    ).toEqual([
      [2, "active"],
      [1, "archived"],
    ]);
    expect(history.body.items[0].createdBy).toBe(adminId);

    const audit = await AuditLogModel.findOne({ action: "settings.updated" }).lean();
    expect(audit).toMatchObject({ targetId: "economy@2", reason: "Raise replay reward" });

    await ctx.http().get("/api/v1/admin/settings/unknown").set(bearer(admin)).expect(400);
  });

  it("validates progression tiers and requires recent authentication to change settings", async () => {
    const { ctx, admin } = await setup();
    const current = await ctx
      .http()
      .get("/api/v1/admin/settings/progression")
      .set(bearer(admin))
      .expect(200);
    const tiers = current.body.value.tiers as { hpRequired: number }[];
    const broken = tiers.map((t, i) => (i === 1 ? { ...t, hpRequired: 0 } : t));
    await ctx
      .http()
      .put("/api/v1/admin/settings/progression")
      .set(bearer(admin))
      .send({ value: { tiers: broken }, changeNote: "oops", expectedVersion: 1 })
      .expect(400);

    await SessionModel.updateMany(
      {},
      { $set: { authenticatedAt: new Date(Date.now() - 3_600_000) } },
    );
    const stale = await ctx
      .http()
      .put("/api/v1/admin/settings/progression")
      .set(bearer(admin))
      .send({ value: current.body.value, changeNote: "no-op", expectedVersion: 1 });
    expect(stale.body.error.code).toBe("STEP_UP_REQUIRED");
  });
});

describe("audit log viewer", () => {
  it("filters by action prefix, actor, target and time and paginates newest first", async () => {
    const { ctx, admin, adminId, player } = await setup();
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin))
      .send({ reason: "Testing audit" })
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/unsuspend`)
      .set(bearer(admin))
      .send({ reason: "Resolved" })
      .expect(200);

    const all = await ctx
      .http()
      .get("/api/v1/admin/audit-logs?action=user.")
      .set(bearer(admin))
      .expect(200);
    expect(all.body.items.map((a: { action: string }) => a.action)).toEqual([
      "user.unsuspended",
      "user.suspended",
    ]);
    expect(all.body.items[1]).toMatchObject({
      actorId: adminId,
      targetType: "User",
      targetId: player.user.id,
      reason: "Testing audit",
    });

    const exact = await ctx
      .http()
      .get(
        `/api/v1/admin/audit-logs?action=user.suspended&targetId=${player.user.id}&actorId=${adminId}`,
      )
      .set(bearer(admin))
      .expect(200);
    expect(exact.body.total).toBe(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    const none = await ctx
      .http()
      .get(`/api/v1/admin/audit-logs?from=${future}`)
      .set(bearer(admin))
      .expect(200);
    expect(none.body.total).toBe(0);

    await ctx.http().get("/api/v1/admin/audit-logs?action=$where").set(bearer(admin)).expect(400);
    await ctx.http().get("/api/v1/admin/audit-logs?actorId=nope").set(bearer(admin)).expect(400);
  });
});

describe("analytics", () => {
  async function play(ctx: ReturnType<typeof makeApp>, token: string, pick: (n: number) => number) {
    const started = await ctx
      .http()
      .post("/api/v1/attempts")
      .set(bearer(token))
      .send({ missionKey: "malaria", mode: "story" })
      .expect(201);
    for (const [i, step] of ["s1", "s2"].entries()) {
      const a = await ctx.http().get(`/api/v1/attempts/${started.body.id}`).set(bearer(token));
      const current = a.body.steps.find((s: { stepId: string }) => s.stepId === step);
      const sorted = [...current.choices].sort((x: { choiceId: string }, y: { choiceId: string }) =>
        x.choiceId.localeCompare(y.choiceId),
      );
      await ctx
        .http()
        .post(`/api/v1/attempts/${started.body.id}/answers`)
        .set(bearer(token))
        .send({ stepId: step, choiceId: sorted[pick(i)].choiceId })
        .expect(200);
    }
  }

  it("summarises users, gameplay, hospital, content and sync without personal data", async () => {
    const { ctx, admin, player } = await setup();
    await publishAll(ctx, ["malaria"]);
    await ctx.http().post("/api/v1/auth/guest").expect(201);
    await play(ctx, player.accessToken, () => 0);
    await ctx
      .http()
      .post("/api/v1/hospital/runs")
      .set(bearer(player.accessToken))
      .send({ allocation: { staff: 1, beds: 0, ambulances: 0, supplies: 0 } })
      .expect(201);

    const res = await ctx
      .http()
      .get("/api/v1/admin/analytics/overview")
      .set(bearer(admin))
      .expect(200);
    expect(res.body.activePlayers.daily).toBeGreaterThanOrEqual(2);
    expect(res.body.users).toMatchObject({ registered: 2, guests: 1, suspended: 0 });
    expect(res.body.users.byRole).toEqual({ player: 2, reviewer: 0, admin: 1 });
    expect(res.body).toMatchObject({
      newRegistrations: 2,
      guestConversions: 0,
      attemptsStarted: 1,
      attemptsCompleted: 1,
      attemptsAbandoned: 0,
      shifts: 1,
    });
    expect(res.body.averageScorePct).toBeGreaterThanOrEqual(0);
    expect(res.body.content.missionsByStatus.published).toBe(1);
    expect(res.body.content.versionsAwaitingReview).toBe(9);
    expect(JSON.stringify(res.body)).not.toContain("player@example.com");

    const past = await ctx
      .http()
      .get("/api/v1/admin/analytics/overview?from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z")
      .set(bearer(admin))
      .expect(200);
    expect(past.body).toMatchObject({ attemptsStarted: 0, newRegistrations: 0, shifts: 0 });
    await ctx
      .http()
      .get("/api/v1/admin/analytics/overview?from=2021-01-01T00:00:00Z&to=2020-01-01T00:00:00Z")
      .set(bearer(admin))
      .expect(400);
    await ctx
      .http()
      .get("/api/v1/admin/analytics/overview?from=2020-01-01T00:00:00Z&to=2022-01-01T00:00:00Z")
      .set(bearer(admin))
      .expect(400);
  });

  it("reports per-version mission statistics with the choice distribution", async () => {
    const { ctx, admin, player } = await setup();
    await publishAll(ctx, ["malaria"]);
    const other = await createVerifiedUser(ctx, "other@example.com");
    await play(ctx, player.accessToken, () => 0);
    await play(ctx, other.accessToken, () => 0);
    const res = await ctx
      .http()
      .get("/api/v1/admin/analytics/missions")
      .set(bearer(admin))
      .expect(200);
    expect(res.body.items).toHaveLength(1);
    const m = res.body.items[0];
    expect(m).toMatchObject({
      missionKey: "malaria",
      versionNumber: 1,
      countryCode: "NG",
      attempts: 2,
      completed: 2,
      completionRate: 1,
    });
    expect(m.choiceDistribution).toEqual([
      { stepId: "s1", choiceId: "s1c1", count: 2 },
      { stepId: "s2", choiceId: "s2c1", count: 2 },
    ]);
    const kenya = await ctx
      .http()
      .get("/api/v1/admin/analytics/missions?country=KE")
      .set(bearer(admin))
      .expect(200);
    expect(kenya.body.items).toEqual([]);
    await ctx
      .http()
      .get("/api/v1/admin/analytics/missions?country=kenya")
      .set(bearer(admin))
      .expect(400);
  });

  it("tracks the guest funnel including upgrades and merges", async () => {
    const { ctx, admin, player } = await setup();
    await publishAll(ctx, ["malaria"]);
    const guest = async () =>
      (await ctx.http().post("/api/v1/auth/guest").set("X-Client-Platform", "mobile").expect(201))
        .body.accessToken as string;
    const g1 = await guest();
    await play(ctx, g1, () => 0);
    await ctx
      .http()
      .post("/api/v1/auth/guest/upgrade")
      .set(bearer(g1))
      .send({
        email: "converted@example.com",
        password: "healthy-nation-1",
        displayName: "Converted",
      })
      .expect((r) => expect(r.status).toBeLessThan(300));
    await guest(); // never plays
    const g3 = await guest();
    await play(ctx, g3, () => 0);
    await ctx
      .http()
      .post("/api/v1/sync/merge-guest")
      .set(bearer(player.accessToken))
      .send({ guestAccessToken: g3 })
      .expect(200);

    const res = await ctx
      .http()
      .get("/api/v1/admin/analytics/funnel")
      .set(bearer(admin))
      .expect(200);
    expect(res.body.steps).toEqual([
      { name: "guest_started", count: 2 },
      { name: "guest_played_mission", count: 1 },
      { name: "guest_registered", count: 1 },
      { name: "guest_merged_into_account", count: 1 },
    ]);
    const overview = await ctx
      .http()
      .get("/api/v1/admin/analytics/overview")
      .set(bearer(admin))
      .expect(200);
    expect(overview.body.guestConversions).toBe(2);
    expect(overview.body.newRegistrations).toBe(2); // admin + player; the upgraded guest counts as a conversion
  });
});

describe("role catalogue", () => {
  it("lists roles with permissions and session policies; admins cannot decide reviews", async () => {
    const { ctx, admin } = await setup();
    const res = await ctx.http().get("/api/v1/admin/roles").set(bearer(admin)).expect(200);
    const adminRole = res.body.roles.find((r: { role: string }) => r.role === "admin");
    expect(adminRole.permissions).not.toContain("review:decide");
    expect(adminRole.sessionPolicy.mfaRequired).toBe(true);
    expect(res.body.permissions).toContain("audit:read");
  });
});

describe("account erasure", () => {
  it("erases a player and all their data, keeping the audit record", async () => {
    const { ctx, admin, player } = await setup();
    const id = player.user.id as string;
    await ctx
      .http()
      .post("/api/v1/users/me/clinician-evidence?filename=licence.png")
      .set(bearer(player.accessToken))
      .set("Content-Type", "image/png")
      .send(PNG_1X1)
      .expect(201);
    await ctx.http().get("/api/v1/players/me/progress").set(bearer(player.accessToken)).expect(200);
    expect(await PlayerProgressModel.exists({ userId: id })).not.toBeNull();

    const wrong = await ctx
      .http()
      .post(`/api/v1/admin/users/${id}/erase`)
      .set(bearer(admin))
      .send({ reason: "Data-subject request", confirmEmail: "someone@example.com" });
    expect(wrong.status).toBe(400);
    expect(await UserModel.exists({ _id: id })).not.toBeNull();

    const res = await ctx
      .http()
      .post(`/api/v1/admin/users/${id}/erase`)
      .set(bearer(admin))
      .send({ reason: "Data-subject request", confirmEmail: "PLAYER@example.com" })
      .expect(200);
    expect(res.body.documentsDeleted).toBeGreaterThan(2);
    expect(await UserModel.exists({ _id: id })).toBeNull();
    expect(await PlayerProgressModel.exists({ userId: id })).toBeNull();
    expect(await MediaAssetModel.countDocuments({ ownerId: id, status: { $ne: "deleted" } })).toBe(
      0,
    );
    await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken)).expect(401);
    expect(await AuditLogModel.exists({ action: "user.erased", targetId: id })).not.toBeNull();
  });

  it("refuses to erase staff, clinical reviewers' signed records, or the acting admin", async () => {
    const { ctx, admin, adminId, player } = await setup();
    const erase = (id: string, confirmEmail: string) =>
      ctx
        .http()
        .post(`/api/v1/admin/users/${id}/erase`)
        .set(bearer(admin))
        .send({ reason: "Data-subject request", confirmEmail });
    expect((await erase(adminId, "admin@example.com")).status).toBe(409);
    const other = await createVerifiedUser(ctx, "ops@example.com", ["player", "admin"]);
    expect((await erase(other.user.id, "ops@example.com")).status).toBe(409);

    await MissionReviewModel.collection.insertOne({
      reviewerId: new Types.ObjectId(player.user.id as string),
      decision: "approved",
    });
    expect((await erase(player.user.id, "player@example.com")).status).toBe(409);
    expect((await erase("000000000000000000000000", "x@example.com")).status).toBe(404);
  });
});
