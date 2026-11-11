/**
 * Release security sweep (Phase 8), driven by the OpenAPI document so new endpoints are covered automatically:
 *  - every operation documented as authenticated rejects anonymous calls (401);
 *  - every operation documented with a permission rejects an ordinary player (403);
 *  - nothing a player can read before answering contains answer-key fields;
 *  - error responses never leak stack traces or internals.
 */
import { buildOpenApiDocument } from "@ahq/api-contracts";
import { describe, expect, it } from "vitest";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();

const SAMPLE: Record<string, string> = {
  id: "665f1c2e9b1d8a0012345678",
  userId: "665f1c2e9b1d8a0012345678",
  key: "malaria",
  code: "GH",
};
const METHODS = ["get", "post", "put", "patch", "delete"] as const;
type Op = {
  method: (typeof METHODS)[number];
  path: string;
  url: string;
  secured: boolean;
  permission: string | null;
};

function operations(): Op[] {
  const doc = buildOpenApiDocument();
  const ops: Op[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, { security?: unknown[]; description?: string }>)[method];
      if (!op) continue;
      const permission = /\*\*Permission:\*\* `([^`]+)`/.exec(op.description ?? "")?.[1] ?? null;
      ops.push({
        method,
        path,
        url: path.replace(/\{(\w+)\}/g, (_m, n: string) => SAMPLE[n] ?? "sample"),
        secured: Boolean(op.security?.length),
        permission,
      });
    }
  }
  return ops;
}

/** Keys that would reveal the answer key if present before the learner answers. */
function answerKeyFields(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => answerKeyFields(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(["correct", "feedback", "critical", "correctChoiceId"].includes(k)
        ? [`${path}.${k}`]
        : []),
      ...answerKeyFields(v, `${path}.${k}`),
    ]);
  }
  return [];
}

describe("release security sweep", () => {
  it("every authenticated operation rejects anonymous requests", async () => {
    const ctx = makeApp();
    const ops = operations().filter((o) => o.secured);
    expect(ops.length).toBeGreaterThan(100);
    const open: string[] = [];
    for (const o of ops) {
      const res = await ctx.http()[o.method](o.url).send({});
      if (res.status !== 401) open.push(`${o.method.toUpperCase()} ${o.path} → ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("every permission-gated operation rejects an ordinary player, with a forged token rejected too", async () => {
    const ctx = makeApp();
    await seedReference(ctx);
    const player = await createVerifiedUser(ctx, "player@example.com");
    const ops = operations().filter((o) => o.permission);
    expect(ops.length).toBeGreaterThan(50);
    const leaks: string[] = [];
    for (const o of ops) {
      const res = await ctx
        .http()
        [o.method](o.url)
        .set("Authorization", `Bearer ${player.accessToken}`)
        .send({});
      if (res.status !== 403)
        leaks.push(`${o.method.toUpperCase()} ${o.path} (${o.permission}) → ${res.status}`);
    }
    expect(leaks).toEqual([]);

    // A token signed with another secret, or with alg "none", is rejected.
    const [h, p] = (player.accessToken as string).split(".");
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${p}.`;
    for (const t of [`${h}.${p}.invalidsignature`, none]) {
      await ctx.http().get("/api/v1/users/me").set("Authorization", `Bearer ${t}`).expect(401);
    }
  });

  it("no answer-key field is readable by a player before answering", async () => {
    const ctx = makeApp();
    await seedReference(ctx);
    await publishAll(ctx);
    await ctx.http().patch("/api/v1/admin/missions/malaria"); // no-op: unauthenticated
    const { MissionModel } = await import("../../src/modules/missions/mission.models.js");
    await MissionModel.updateOne({ key: "malaria" }, { $set: { offlineEligible: true } });
    const player = await createVerifiedUser(ctx, "player@example.com");
    const auth = { Authorization: `Bearer ${player.accessToken}` };
    const started = await ctx
      .http()
      .post("/api/v1/attempts")
      .set(auth)
      .send({ missionKey: "malaria", mode: "story" })
      .expect(201);
    const urls = [
      "/api/v1/catalog",
      "/api/v1/missions",
      "/api/v1/missions?mode=practice",
      "/api/v1/missions/malaria",
      "/api/v1/missions/random?mode=practice",
      "/api/v1/missions/malaria/pack",
      `/api/v1/attempts/${started.body.id}`,
      "/api/v1/players/me/attempts",
      "/api/v1/players/me/progress",
    ];
    const found: string[] = [];
    for (const url of urls) {
      const res = await ctx.http().get(url).set(auth);
      expect(res.status, url).toBe(200);
      found.push(...answerKeyFields(res.body).map((f) => `${url} ${f}`));
    }
    // Anonymous catalogue reads too.
    for (const url of ["/api/v1/catalog", "/api/v1/missions", "/api/v1/missions/malaria"]) {
      found.push(
        ...answerKeyFields((await ctx.http().get(url)).body).map((f) => `anon ${url} ${f}`),
      );
    }
    expect(found).toEqual([]);
  });

  it("errors are generic: no stack traces, framework names or database details", async () => {
    const ctx = makeApp();
    const bad = [
      ctx
        .http()
        .post("/api/v1/auth/login")
        .set("Content-Type", "application/json")
        .send("{bad json"),
      ctx.http().get("/api/v1/missions/%E0%A4%A"),
      ctx
        .http()
        .post("/api/v1/auth/login")
        .send({ email: { $gt: "" }, password: { $ne: 1 } }),
      ctx.http().get("/api/v1/countries/ZZ"),
    ];
    for (const res of await Promise.all(bad)) {
      expect(res.status).toBeLessThan(500);
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/at \w+ \(|node_modules|Mongo|Cast to ObjectId|stack/i);
      expect(res.body.error?.code).toBeTruthy();
    }
    const res = await ctx.http().get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["strict-transport-security"]).toBeDefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});
