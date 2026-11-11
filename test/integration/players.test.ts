import { describe, expect, it } from "vitest";
import { Types } from "mongoose";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import {
  PlayerProgressModel,
  ProgressLedgerModel,
} from "../../src/modules/players/player.models.js";
import { DuplicateChangeError } from "../../src/modules/players/progress.service.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const sid = () => new Types.ObjectId().toString();

async function setup() {
  const ctx = makeApp();
  await seedReference(ctx);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, player, userId: player.user.id as string };
}

describe("progress", () => {
  it("starts with prototype defaults: 0 HP, ₵100, Village Clinic, Nigeria unlocked", async () => {
    const { ctx, player } = await setup();
    const res = await ctx
      .http()
      .get("/api/v1/players/me/progress")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      hp: 0,
      funding: 100,
      tier: { index: 0, name: "Village Clinic" },
      nextTier: { name: "Community Hospital" },
      hpToNextTier: 150,
      version: 0,
    });
    // Unlock state is derived on the first change; the initial list reflects the 0-HP countries after any change.
    const etag = res.headers.etag;
    await ctx
      .http()
      .get("/api/v1/players/me/progress")
      .set(bearer(player.accessToken))
      .set("If-None-Match", String(etag))
      .expect(304);
  });

  it("applies HP, levels up the hospital and unlocks countries", async () => {
    const { ctx, player, userId } = await setup();
    const r = await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId: sid(),
      hp: 260,
      funding: 25,
    });
    expect(r.newlyUnlocked.tiers.map((t) => t.name)).toEqual(["Community Hospital"]);
    expect(r.newlyUnlocked.countries).toEqual(["GH", "KE"]); // Nigeria (0 HP) is unlocked from the start
    const res = await ctx
      .http()
      .get("/api/v1/players/me/progress")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      hp: 260,
      funding: 125,
      tier: { name: "Community Hospital" },
      hpToNextTier: 140,
      version: 1,
    });
    expect(res.body.unlockedCountryCodes).toEqual(["GH", "KE", "NG"]);
  });

  it("refuses to spend more funding than available and rolls back the ledger", async () => {
    const { ctx, userId } = await setup();
    await ctx.services.progress.get(userId);
    await expect(
      ctx.services.progress.applyChange(userId, {
        source: "hospital_run",
        sourceId: sid(),
        hp: 0,
        funding: -150,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_FUNDS" });
    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p!.funding).toBe(100);
    expect(await ProgressLedgerModel.countDocuments({ userId })).toBe(0);
  });

  it("never applies the same source twice", async () => {
    const { ctx, userId } = await setup();
    const sourceId = sid();
    await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId,
      hp: 50,
      funding: 0,
    });
    await expect(
      ctx.services.progress.applyChange(userId, {
        source: "mission_attempt",
        sourceId,
        hp: 50,
        funding: 0,
      }),
    ).rejects.toBeInstanceOf(DuplicateChangeError);
    expect((await PlayerProgressModel.findOne({ userId }).lean())!.hp).toBe(50);
  });

  it("keeps totals exact under concurrent changes", async () => {
    const { ctx, userId } = await setup();
    await ctx.services.progress.get(userId);
    await Promise.all(
      Array.from({ length: 10 }, () =>
        ctx.services.progress.applyChange(userId, {
          source: "hospital_run",
          sourceId: sid(),
          hp: 15,
          funding: 8,
        }),
      ),
    );
    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p).toMatchObject({ hp: 150, funding: 180, version: 10, tierIndex: 1 });
    expect(await ProgressLedgerModel.countDocuments({ userId })).toBe(10);
  });

  it("tracks mission best score, pass state and practice separately", async () => {
    const { ctx, player, userId } = await setup();
    const apply = (score: number, passed: boolean, mode: "story" | "practice") =>
      ctx.services.progress.applyChange(userId, {
        source: "mission_attempt",
        sourceId: sid(),
        hp: 0,
        funding: 0,
        mission: { key: "malaria", score, maxScore: 50, passed, mode },
      });
    await apply(25, true, "story");
    await apply(0, false, "story");
    await apply(50, true, "practice");
    const res = await ctx
      .http()
      .get("/api/v1/players/me/progress")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(res.body.missions.malaria).toMatchObject({
      bestScore: 25,
      maxScore: 50,
      attempts: 2,
      practiceAttempts: 1,
      passed: true,
    });
    expect(res.body.missions.malaria.firstPassedAt).toBeTruthy();
  });

  it("lists the ledger newest first with balances", async () => {
    const { ctx, player, userId } = await setup();
    await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId: sid(),
      hp: 25,
      funding: 13,
    });
    await ctx.services.progress.applyChange(userId, {
      source: "hospital_run",
      sourceId: sid(),
      hp: 15,
      funding: -32,
    });
    const res = await ctx
      .http()
      .get("/api/v1/players/me/ledger?pageSize=1")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(res.body.items[0]).toMatchObject({
      source: "hospital_run",
      delta: { hp: 15, funding: -32 },
      balanceAfter: { hp: 40, funding: 81 },
    });
  });
});

describe("achievements", () => {
  it("awards once, pays rewards through the ledger and reports progress towards others", async () => {
    const { ctx, player, userId } = await setup();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin.accessToken))
      .send({
        key: "first_save",
        name: "First save",
        description: "Pass your first story mission",
        icon: "🎖️",
        criterion: "missions_passed",
        threshold: 1,
        rewards: { hp: 10, funding: 5 },
      })
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin.accessToken))
      .send({
        key: "five_saves",
        name: "Five saves",
        description: "Pass five story missions",
        icon: "🏅",
        criterion: "missions_passed",
        threshold: 5,
      })
      .expect(201);

    const r = await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId: sid(),
      hp: 25,
      funding: 13,
      stats: { storyPassed: 1 },
    });
    expect(r.achievements.map((a) => a.key)).toEqual(["first_save"]);
    expect(r.delta).toEqual({ hp: 35, funding: 18 });

    const again = await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId: sid(),
      hp: 0,
      funding: 0,
      stats: { storyPassed: 1 },
    });
    expect(again.achievements).toEqual([]);
    expect(await ProgressLedgerModel.countDocuments({ userId, source: "achievement" })).toBe(1);

    const list = await ctx
      .http()
      .get("/api/v1/players/me/achievements")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(list.body.earned.map((a: { key: string }) => a.key)).toEqual(["first_save"]);
    expect(list.body.available).toEqual([
      expect.objectContaining({ key: "five_saves", current: 2, threshold: 5 }),
    ]);
  });

  it("validates the catalogue and rejects duplicate keys", async () => {
    const { ctx } = await setup();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const body = {
      key: "explorer",
      name: "Explorer",
      description: "Unlock 3 countries",
      icon: "🌍",
      criterion: "countries_unlocked",
      threshold: 3,
    };
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin.accessToken))
      .send(body)
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin.accessToken))
      .send(body)
      .expect(409);
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin.accessToken))
      .send({ ...body, key: "x!", criterion: "nope" })
      .expect(400);
    const upd = await ctx
      .http()
      .patch("/api/v1/admin/achievements/explorer")
      .set(bearer(admin.accessToken))
      .send({ status: "retired" })
      .expect(200);
    expect(upd.body.status).toBe("retired");
  });
});

describe("profile and stats", () => {
  it("creates a default profile and validates updates", async () => {
    const { ctx, player } = await setup();
    const get = await ctx
      .http()
      .get("/api/v1/players/me/profile")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(get.body).toMatchObject({
      learnerLevel: null,
      locale: "en",
      notificationPrefs: { push: true, email: false },
    });
    const upd = await ctx
      .http()
      .patch("/api/v1/players/me/profile")
      .set(bearer(player.accessToken))
      .send({
        learnerLevel: "nursing_student",
        institution: "  Lagos School of Nursing ",
        homeCountryCode: "ng",
        notificationPrefs: { email: true },
        onboardingCompleted: true,
      })
      .expect(200);
    expect(upd.body).toMatchObject({
      learnerLevel: "nursing_student",
      institution: "Lagos School of Nursing",
      homeCountryCode: "NG",
      notificationPrefs: { push: true, email: true },
    });
    expect(upd.body.onboardingCompletedAt).toBeTruthy();
    await ctx
      .http()
      .patch("/api/v1/players/me/profile")
      .set(bearer(player.accessToken))
      .send({ learnerLevel: "surgeon" })
      .expect(400);
    await ctx
      .http()
      .patch("/api/v1/players/me/profile")
      .set(bearer(player.accessToken))
      .send({ hp: 9999 })
      .expect(400);
  });

  it("reports statistics", async () => {
    const { ctx, player, userId } = await setup();
    await ctx.services.progress.applyChange(userId, {
      source: "mission_attempt",
      sourceId: sid(),
      hp: 25,
      funding: 0,
      stats: { correctAnswers: 3, answersTotal: 4, storyCompleted: 2, storyPassed: 1 },
      mission: { key: "malaria", score: 25, maxScore: 50, passed: true, mode: "story" },
    });
    const res = await ctx
      .http()
      .get("/api/v1/players/me/stats")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(res.body).toMatchObject({
      accuracy: 0.75,
      missionsPassed: 1,
      countriesUnlocked: 1,
      tier: { name: "Village Clinic" },
    });
    expect(res.body.counters).toMatchObject({
      correctAnswers: 3,
      answersTotal: 4,
      storyCompleted: 2,
    });
  });

  it("requires sign-in", async () => {
    const { ctx } = await setup();
    await ctx.http().get("/api/v1/players/me/progress").expect(401);
  });
});

describe("countries (public)", () => {
  it("lists all 54 countries; the 5 launch countries are active", async () => {
    const { ctx } = await setup();
    const res = await ctx.http().get("/api/v1/countries").expect(200);
    expect(res.body.items).toHaveLength(54);
    const active = res.body.items.filter((c: { status: string }) => c.status === "active");
    expect(
      active.map((c: { code: string; unlock: { minHp: number } }) => [c.code, c.unlock.minHp]),
    ).toEqual([
      ["NG", 0],
      ["GH", 100],
      ["KE", 250],
      ["ZA", 450],
      ["ET", 650],
    ]);
    expect(active[0]).toMatchObject({
      name: "Nigeria",
      flagEmoji: "🇳🇬",
      focus: "Malaria, sickle cell, road trauma",
    });
    expect(res.body.items[0].unlocked).toBeUndefined();
  });

  it("personalises unlock state when signed in", async () => {
    const { ctx, player, userId } = await setup();
    await ctx.services.progress.applyChange(userId, {
      source: "admin_adjustment",
      sourceId: sid(),
      hp: 120,
      funding: 0,
    });
    const res = await ctx
      .http()
      .get("/api/v1/countries")
      .set(bearer(player.accessToken))
      .expect(200);
    const byCode = Object.fromEntries(
      res.body.items.map((c: { code: string; unlocked: boolean }) => [c.code, c.unlocked]),
    );
    expect(byCode).toMatchObject({ NG: true, GH: true, KE: false, DZ: false });
    const one = await ctx
      .http()
      .get("/api/v1/countries/gh")
      .set(bearer(player.accessToken))
      .expect(200);
    expect(one.body).toMatchObject({ code: "GH", unlocked: true });
    await ctx.http().get("/api/v1/countries/XX").expect(404);
  });

  it("seeding is idempotent and never overwrites admin edits", async () => {
    const { ctx } = await setup();
    const { CountryModel } = await import("../../src/modules/countries/country.model.js");
    await CountryModel.updateOne({ code: "NG" }, { $set: { focus: "Edited by admin" } });
    const again = await (
      await import("../../src/db/seed.js")
    ).seedReferenceData(ctx.services.settings);
    expect(again.countries.inserted).toBe(0);
    expect((await CountryModel.findOne({ code: "NG" }).lean())!.focus).toBe("Edited by admin");
  });
});

describe("admin player management", () => {
  it("shows a player and applies audited adjustments", async () => {
    const { ctx, userId } = await setup();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const detail = await ctx
      .http()
      .get(`/api/v1/admin/players/${userId}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(detail.body.progress).toMatchObject({ hp: 0, funding: 100 });
    const adj = await ctx
      .http()
      .post(`/api/v1/admin/players/${userId}/adjustments`)
      .set(bearer(admin.accessToken))
      .send({ hp: 20, funding: -10, reason: "Restore lost progress (ticket 42)" })
      .expect(200);
    expect(adj.body).toMatchObject({ hp: 20, funding: 90 });
    expect(
      await AuditLogModel.countDocuments({ action: "progress.admin_adjustment", targetId: userId }),
    ).toBe(1);
    await ctx
      .http()
      .post(`/api/v1/admin/players/${userId}/adjustments`)
      .set(bearer(admin.accessToken))
      .send({ hp: -100, funding: 0, reason: "Too much" })
      .expect(409);
    await ctx
      .http()
      .post(`/api/v1/admin/players/${userId}/adjustments`)
      .set(bearer(admin.accessToken))
      .send({ hp: 0, funding: 0, reason: "Nothing" })
      .expect(400);
  });

  it("is forbidden to players and reviewers", async () => {
    const { ctx, player, userId } = await setup();
    const reviewer = await createVerifiedUser(ctx, "rev@example.com", ["player", "reviewer"]);
    await ctx
      .http()
      .get(`/api/v1/admin/players/${userId}`)
      .set(bearer(player.accessToken))
      .expect(403);
    await ctx
      .http()
      .post(`/api/v1/admin/players/${userId}/adjustments`)
      .set(bearer(reviewer.accessToken))
      .send({ hp: 5, funding: 0, reason: "nope" })
      .expect(403);
  });
});
