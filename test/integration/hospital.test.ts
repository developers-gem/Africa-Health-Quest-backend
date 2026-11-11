import { describe, expect, it } from "vitest";
import {
  HospitalEventModel,
  HospitalRunModel,
} from "../../src/modules/hospital/hospital.models.js";
import {
  PlayerProgressModel,
  ProgressLedgerModel,
} from "../../src/modules/players/player.models.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const alloc = (a: Partial<Record<"staff" | "beds" | "ambulances" | "supplies", number>>) => ({
  staff: 0,
  beds: 0,
  ambulances: 0,
  supplies: 0,
  ...a,
});

async function setup(onlyEvent?: string) {
  const ctx = makeApp();
  await seedReference(ctx);
  if (onlyEvent)
    await HospitalEventModel.updateMany(
      { key: { $ne: onlyEvent } },
      { $set: { status: "retired" } },
    );
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, token: player.accessToken as string, userId: player.user.id as string };
}
const run = (ctx: ReturnType<typeof makeApp>, token: string, allocation: object) =>
  ctx.http().post("/api/v1/hospital/runs").set(bearer(token)).send({ allocation });

describe("Hospital Commander", () => {
  it("reports the player's hospital state and budget", async () => {
    const { ctx, token } = await setup();
    const res = await ctx.http().get("/api/v1/hospital/state").set(bearer(token)).expect(200);
    expect(res.body).toMatchObject({
      budget: 100,
      hospitalLevel: { name: "Village Clinic" },
      unitCost: 10,
      maxAffordableUnits: 10,
      rewardsPerNeedMet: { hp: 15, funding: 8 },
      recent: { shifts: 0, averageNeedsMet: null },
    });
    expect(
      res.body.resources.map((r: { name: string; icon: string }) => `${r.icon} ${r.name}`),
    ).toEqual(["👩🏾‍⚕️ Staff", "🛏️ Beds", "🚑 Ambulances", "💊 Supplies"]);
  });

  it("runs a shift with server-side rewards (prototype maternity-rush example)", async () => {
    const { ctx, token, userId } = await setup("maternity_rush");
    const res = await run(ctx, token, alloc({ staff: 6 })).expect(201);
    expect(res.body).toMatchObject({
      cost: 60,
      needsMet: 1,
      rewards: { hp: 15, funding: 8 },
      netFundingChange: -52,
      summary: "Maternity rush — 12 deliveries tonight. You covered 1/4 needs. +15 HP.",
      performance: { rating: "poor", coveragePercent: 25 },
      progress: { hp: 15, funding: 48 },
    });
    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p!.stats).toMatchObject({ shiftsRun: 1, needsMet: 1 });
    expect(
      await ProgressLedgerModel.findOne({ userId, source: "hospital_run" }).lean(),
    ).toMatchObject({ delta: { hp: 15, funding: -52 } });
    const history = await ctx.http().get("/api/v1/hospital/runs").set(bearer(token)).expect(200);
    expect(history.body).toMatchObject({ total: 1, items: [{ id: res.body.id, needsMet: 1 }] });
    const state = await ctx.http().get("/api/v1/hospital/state").set(bearer(token)).expect(200);
    expect(state.body).toMatchObject({ budget: 48, recent: { shifts: 1, averageNeedsMet: 1 } });
  });

  it("requires the full cost to be affordable and records nothing otherwise", async () => {
    const { ctx, token, userId } = await setup();
    const res = await run(ctx, token, alloc({ staff: 6, beds: 5 }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INSUFFICIENT_FUNDS");
    expect(await HospitalRunModel.countDocuments({ userId })).toBe(0);
    expect((await PlayerProgressModel.findOne({ userId }).lean())!.funding).toBe(100);
  });

  it("cannot overspend through concurrent shifts", async () => {
    const { ctx, token, userId } = await setup("maternity_rush");
    const results = await Promise.all([
      run(ctx, token, alloc({ staff: 10 })),
      run(ctx, token, alloc({ staff: 10 })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await PlayerProgressModel.findOne({ userId }).lean())!.funding).toBe(8);
    expect(await HospitalRunModel.countDocuments({ userId })).toBe(1);
  });

  it("validates allocations", async () => {
    const { ctx, token } = await setup();
    await run(ctx, token, alloc({})).expect(400);
    await run(ctx, token, alloc({ staff: 51 })).expect(400);
    await run(ctx, token, alloc({ staff: -1 })).expect(400);
    await run(ctx, token, { staff: 1 }).expect(400);
    await ctx
      .http()
      .post("/api/v1/hospital/runs")
      .send({ allocation: alloc({ staff: 1 }) })
      .expect(401);
  });

  it("only rolls events the player qualifies for (tier and country gating)", async () => {
    const { ctx, token } = await setup("maternity_rush");
    await HospitalEventModel.create([
      {
        key: "national_strike",
        text: "Nationwide health worker strike.",
        needs: { staff: 5, beds: 0, ambulances: 0, supplies: 0 },
        minTierIndex: 3,
        weight: 100,
      },
      {
        key: "rift_valley_fever",
        text: "Rift Valley fever cases reported.",
        needs: { staff: 1, beds: 1, ambulances: 0, supplies: 1 },
        countryCodes: ["KE"],
        weight: 100,
      },
    ]);
    for (let i = 0; i < 5; i++) {
      const r = await run(ctx, token, alloc({ staff: 1 })).expect(201);
      expect(r.body.event.key).toBe("maternity_rush");
    }
  });

  it("uses the configured unit cost", async () => {
    const { ctx, token } = await setup("maternity_rush");
    const { value, version } = await ctx.services.settings.get("hospital");
    await ctx.services.settings.update(
      "hospital",
      {
        value: { ...(value as object), unitCost: 5 },
        changeNote: "Cheaper units",
        expectedVersion: version,
      },
      { id: "000000000000000000000000", roles: ["admin"] },
    );
    const r = await run(ctx, token, alloc({ staff: 6 })).expect(201);
    expect(r.body.cost).toBe(30);
  });
});

describe("Hospital Commander administration", () => {
  it("manages emergency events and keeps at least one active", async () => {
    const { ctx, token } = await setup();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const list = await ctx
      .http()
      .get("/api/v1/admin/hospital/events")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(list.body.items.map((e: { key: string }) => e.key)).toEqual([
      "bus_crash",
      "cholera_outbreak",
      "malaria_surge",
      "maternity_rush",
    ]);
    await ctx
      .http()
      .post("/api/v1/admin/hospital/events")
      .set(bearer(admin.accessToken))
      .send({
        key: "flood",
        text: "Flooding cuts off the district road.",
        needs: { staff: 2, beds: 1, ambulances: 2, supplies: 2 },
        weight: 2,
      })
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/admin/hospital/events")
      .set(bearer(admin.accessToken))
      .send({
        key: "flood",
        text: "Duplicate key here",
        needs: { staff: 1, beds: 1, ambulances: 1, supplies: 1 },
      })
      .expect(409);
    for (const key of ["bus_crash", "cholera_outbreak", "malaria_surge", "maternity_rush"]) {
      await ctx
        .http()
        .patch(`/api/v1/admin/hospital/events/${key}`)
        .set(bearer(admin.accessToken))
        .send({ status: "retired" })
        .expect(200);
    }
    const last = await ctx
      .http()
      .patch("/api/v1/admin/hospital/events/flood")
      .set(bearer(admin.accessToken))
      .send({ status: "retired" });
    expect(last.status).toBe(409);
    await ctx.http().get("/api/v1/admin/hospital/events").set(bearer(token)).expect(403);
  });
});
