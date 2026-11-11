import { describe, expect, it } from "vitest";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import { MissionModel, MissionVersionModel } from "../../src/modules/missions/mission.models.js";
import { JPEG_WITH_EXIF, PNG_1X1 } from "../fixtures/media.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setup() {
  const ctx = makeApp();
  await seedReference(ctx);
  const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, admin: admin.accessToken as string, player: player.accessToken as string };
}

const upload = (
  ctx: ReturnType<typeof makeApp>,
  token: string,
  purpose: string,
  type: string,
  body: Buffer,
) =>
  ctx
    .http()
    .post(`/api/v1/admin/media?purpose=${purpose}&filename=flag.png`)
    .set(bearer(token))
    .set("Content-Type", type)
    .send(body);

describe("country administration", () => {
  it("lists all countries for admins with filters", async () => {
    const { ctx, admin, player } = await setup();
    const all = await ctx.http().get("/api/v1/admin/countries").set(bearer(admin)).expect(200);
    expect(all.body.items).toHaveLength(54);
    const coming = await ctx
      .http()
      .get("/api/v1/admin/countries?status=coming_soon&region=eastern")
      .set(bearer(admin))
      .expect(200);
    expect(coming.body.items.map((c: { code: string }) => c.code)).not.toContain("KE");
    expect(coming.body.items.length).toBe(12);
    const search = await ctx
      .http()
      .get("/api/v1/admin/countries?search=tanz")
      .set(bearer(admin))
      .expect(200);
    expect(search.body.items.map((c: { code: string }) => c.code)).toEqual(["TZ"]);
    await ctx.http().get("/api/v1/admin/countries").set(bearer(player)).expect(403);
  });

  it("adds a country (hidden by default) and rejects duplicates", async () => {
    const { ctx, admin } = await setup();
    const res = await ctx
      .http()
      .post("/api/v1/admin/countries")
      .set(bearer(admin))
      .send({ code: "eh", name: "Sahrawi Republic", region: "northern" })
      .expect(201);
    expect(res.body).toMatchObject({
      code: "EH",
      status: "hidden",
      flagEmoji: "🇪🇭",
      unlock: { minHp: 0, minTierIndex: 0 },
    });
    await ctx
      .http()
      .post("/api/v1/admin/countries")
      .set(bearer(admin))
      .send({ code: "NG", name: "Nigeria", region: "western" })
      .expect(409);
    await ctx
      .http()
      .post("/api/v1/admin/countries")
      .set(bearer(admin))
      .send({ code: "N1", name: "Bad", region: "western" })
      .expect(400);
    expect(
      (await ctx.http().get("/api/v1/countries").expect(200)).body.items.map(
        (c: { code: string }) => c.code,
      ),
    ).not.toContain("EH");
  });

  it("activates a country with content and unlock rules that apply to players immediately", async () => {
    const { ctx, admin, player } = await setup();
    await ctx
      .http()
      .patch("/api/v1/admin/countries/UG")
      .set(bearer(admin))
      .send({
        status: "active",
        focus: "Malaria, HIV care",
        description: "Country content for Uganda.",
        healthPriorities: ["Malaria", "HIV"],
        languages: ["English", "Luganda"],
        currencyLabel: "Ugandan shilling",
        unlock: { minHp: 0, minTierIndex: 0 },
      })
      .expect(200);
    const pub = await ctx.http().get("/api/v1/countries/UG").set(bearer(player)).expect(200);
    expect(pub.body).toMatchObject({
      status: "active",
      unlocked: true,
      languages: ["English", "Luganda"],
      healthPriorities: ["Malaria", "HIV"],
    });
    const progress = await ctx
      .http()
      .get("/api/v1/players/me/progress")
      .set(bearer(player))
      .expect(200);
    expect(progress.body.unlockedCountryCodes).toEqual(["NG", "UG"]);

    await ctx
      .http()
      .patch("/api/v1/admin/countries/UG")
      .set(bearer(admin))
      .send({ unlock: { minHp: 500, minTierIndex: 2 } })
      .expect(200);
    expect(
      (await ctx.http().get("/api/v1/countries/UG").set(bearer(player)).expect(200)).body.unlocked,
    ).toBe(false);
    await ctx
      .http()
      .patch("/api/v1/admin/countries/UG")
      .set(bearer(admin))
      .send({ status: "hidden" })
      .expect(200);
    await ctx.http().get("/api/v1/countries/UG").expect(404);

    await ctx
      .http()
      .patch("/api/v1/admin/countries/UG")
      .set(bearer(admin))
      .send({ unlock: { minHp: -1, minTierIndex: 0 } })
      .expect(400);
    await ctx
      .http()
      .patch("/api/v1/admin/countries/UG")
      .set(bearer(admin))
      .send({ code: "XX" })
      .expect(400);
    expect(await AuditLogModel.countDocuments({ action: "country.updated", targetId: "UG" })).toBe(
      3,
    );
  });

  it("assigns missions to a country through reviewable draft versions", async () => {
    const { ctx, admin } = await setup();
    await publishAll(ctx, ["malaria"]);
    const res = await ctx
      .http()
      .put("/api/v1/admin/countries/GH/missions")
      .set(bearer(admin))
      .send({ missionKeys: ["malaria"] })
      .expect(200);
    expect(res.body.items).toEqual([
      { missionKey: "malaria", action: "draft_created", versionNumber: 2 },
    ]);
    const m = await MissionModel.findOne({ key: "malaria" }).lean();
    expect(m!.countryCode).toBe("NG"); // live mission unchanged until a clinician approves v2
    const draft = await MissionVersionModel.findById(m!.openDraftVersionId).lean();
    expect(draft).toMatchObject({
      status: "draft",
      versionNumber: 2,
      content: { countryCode: "GH", title: "Fever in the Rainy Season" },
    });

    const again = await ctx
      .http()
      .put("/api/v1/admin/countries/GH/missions")
      .set(bearer(admin))
      .send({ missionKeys: ["malaria"] })
      .expect(200);
    expect(again.body.items[0].action).toBe("unchanged");
    const moved = await ctx
      .http()
      .put("/api/v1/admin/countries/KE/missions")
      .set(bearer(admin))
      .send({ missionKeys: ["malaria"] })
      .expect(200);
    expect(moved.body.items[0]).toMatchObject({ action: "draft_updated", versionNumber: 2 });
    await ctx
      .http()
      .put("/api/v1/admin/countries/KE/missions")
      .set(bearer(admin))
      .send({ missionKeys: ["nope"] })
      .expect(404);
  });
});

describe("media uploads", () => {
  it("uploads a flag, serves it safely and attaches it to a country", async () => {
    const { ctx, admin } = await setup();
    const up = await upload(ctx, admin, "country_flag", "image/png", PNG_1X1).expect(201);
    expect(up.body).toMatchObject({
      purpose: "country_flag",
      visibility: "public",
      contentType: "image/png",
      sizeBytes: PNG_1X1.length,
    });
    const served = await ctx.http().get(up.body.url).expect(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-security-policy"]).toContain("sandbox");
    expect(served.headers["cache-control"]).toContain("immutable");
    expect(Buffer.from(served.body)).toEqual(PNG_1X1);
    await ctx.http().get(up.body.url).set("If-None-Match", String(served.headers.etag)).expect(304);

    await ctx
      .http()
      .patch("/api/v1/admin/countries/NG")
      .set(bearer(admin))
      .send({ flagAssetId: up.body.id })
      .expect(200);
    expect((await ctx.http().get("/api/v1/countries/NG").expect(200)).body.flagUrl).toBe(
      up.body.url,
    );
    await ctx.http().delete(`/api/v1/admin/media/${up.body.id}`).set(bearer(admin)).expect(409);
    await ctx
      .http()
      .patch("/api/v1/admin/countries/NG")
      .set(bearer(admin))
      .send({ imageAssetId: up.body.id })
      .expect(400); // wrong purpose
  });

  it("rejects spoofed, unsupported and oversized files", async () => {
    const { ctx, admin } = await setup();
    await upload(ctx, admin, "country_flag", "image/jpeg", PNG_1X1).expect(400);
    await upload(ctx, admin, "country_flag", "image/svg+xml", Buffer.from("<svg/>")).expect(400);
    await upload(ctx, admin, "country_flag", "application/pdf", Buffer.from("%PDF-1.7")).expect(
      400,
    );
    const big = Buffer.concat([PNG_1X1, Buffer.alloc(2 * 1024 * 1024)]);
    await upload(ctx, admin, "country_flag", "image/png", big).expect(413);
  });

  it("strips location metadata from JPEG photos", async () => {
    const { ctx, admin } = await setup();
    const up = await upload(ctx, admin, "country_image", "image/jpeg", JPEG_WITH_EXIF).expect(201);
    const served = await ctx.http().get(up.body.url).expect(200);
    expect(Buffer.from(served.body).toString("latin1")).not.toContain("GPSLatitude");
  });

  it("keeps clinician evidence private to its owner and credential verifiers", async () => {
    const { ctx, admin, player } = await setup();
    const rev = await createVerifiedUser(ctx, "rev@example.com", ["player", "reviewer"]);
    const other = await createVerifiedUser(ctx, "rev2@example.com", ["player", "reviewer"]);
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
    const up = await upload(
      ctx,
      rev.accessToken,
      "clinician_evidence",
      "application/pdf",
      pdf,
    ).expect(201);
    expect(up.body).toMatchObject({ visibility: "private", url: null });
    await ctx.http().get(`/media/${up.body.id}`).expect(404);
    await ctx
      .http()
      .get(`/api/v1/admin/media/${up.body.id}/content`)
      .set(bearer(rev.accessToken))
      .expect(200);
    await ctx
      .http()
      .get(`/api/v1/admin/media/${up.body.id}/content`)
      .set(bearer(other.accessToken))
      .expect(404);
    const asAdmin = await ctx
      .http()
      .get(`/api/v1/admin/media/${up.body.id}/content`)
      .set(bearer(admin))
      .expect(200);
    expect(asAdmin.headers["content-disposition"]).toContain("attachment");

    await upload(
      ctx,
      rev.accessToken,
      "clinician_evidence",
      "application/pdf",
      Buffer.from("%PDF-1.7 /OpenAction /JavaScript"),
    ).expect(400);
    await upload(ctx, rev.accessToken, "country_flag", "image/png", PNG_1X1).expect(403);
    await upload(ctx, player, "country_flag", "image/png", PNG_1X1).expect(403);
    const mine = await ctx
      .http()
      .get("/api/v1/admin/media")
      .set(bearer(other.accessToken))
      .expect(200);
    expect(mine.body.items).toEqual([]);
  });
});
