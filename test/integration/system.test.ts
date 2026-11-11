import mongoose from "mongoose";
import { describe, expect, it } from "vitest";
import { makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();

describe("system endpoints and cross-cutting behaviour", () => {
  it("reports health and readiness", async () => {
    const ctx = makeApp();
    const h = await ctx.http().get("/health").expect(200);
    expect(h.body).toMatchObject({ status: "ok" });
    const r = await ctx.http().get("/ready").expect(200);
    expect(r.body.database).toBe("up");
  });

  it("serves the OpenAPI document", async () => {
    const ctx = makeApp();
    const r = await ctx.http().get("/openapi.json").expect(200);
    expect(r.body.openapi).toBe("3.1.0");
    expect(r.body.paths["/api/v1/auth/login"]).toBeDefined();
  });

  it("uses the error envelope for unknown routes and bad JSON", async () => {
    const ctx = makeApp();
    const nf = await ctx.http().get("/api/v1/nope").expect(404);
    expect(nf.body.error.code).toBe("NOT_FOUND");
    const bad = await ctx
      .http()
      .post("/api/v1/auth/login")
      .set("Content-Type", "application/json")
      .send("{bad json");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects oversized bodies", async () => {
    const ctx = makeApp();
    const r = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "a@b.co", password: "x".repeat(200_000) });
    expect(r.status).toBe(413);
  });

  it("ignores injected query operators in input", async () => {
    const ctx = makeApp();
    const r = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(r.status).toBe(400);
  });

  it("sets security headers and a request id", async () => {
    const ctx = makeApp();
    const r = await ctx.http().get("/health").set("X-Request-Id", "trace-12345678");
    expect(r.headers["x-request-id"]).toBe("trace-12345678");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
    expect(r.headers["x-powered-by"]).toBeUndefined();
  });

  it("only allows configured CORS origins", async () => {
    const ctx = makeApp();
    const ok = await ctx
      .http()
      .options("/api/v1/auth/login")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await ctx
      .http()
      .options("/api/v1/auth/login")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rate-limits auth endpoints", async () => {
    const ctx = makeApp({ config: { RATE_LIMIT_AUTH_MAX: "3" } });
    const body = { email: "rl@example.com", password: "whatever-1" };
    for (let i = 0; i < 3; i++) await ctx.http().post("/api/v1/auth/login").send(body).expect(401);
    const limited = await ctx.http().post("/api/v1/auth/login").send(body);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("supports multi-document transactions (MongoDB replica set required by the architecture)", async () => {
    const col = mongoose.connection.db!.collection("tx_probe");
    const session = await mongoose.startSession();
    await expect(
      session.withTransaction(async () => {
        await col.insertOne({ n: 1 }, { session });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    await session.withTransaction(async () => {
      await col.insertOne({ n: 2 }, { session });
    });
    await session.endSession();
    expect(await col.find().toArray()).toEqual([expect.objectContaining({ n: 2 })]);
  });
});
