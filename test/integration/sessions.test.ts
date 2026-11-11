import { describe, expect, it } from "vitest";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { PASSWORD, createVerifiedUser, makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const login = (ctx: ReturnType<typeof makeApp>, email: string, ua = "Device A") =>
  ctx
    .http()
    .post("/api/v1/auth/login")
    .set("X-Client-Platform", "mobile")
    .set("User-Agent", ua)
    .send({ email, password: PASSWORD })
    .expect(200);

describe("session management", () => {
  it("lists active sessions per device and marks the current one", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "multi@example.com");
    const a = await login(ctx, "multi@example.com", "Phone");
    await login(ctx, "multi@example.com", "Laptop");
    const res = await ctx
      .http()
      .get("/api/v1/auth/sessions")
      .set(bearer(a.body.accessToken))
      .expect(200);
    expect(res.body.items).toHaveLength(3); // createVerifiedUser also signed in once
    const current = res.body.items.filter((s: { current: boolean }) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ platform: "mobile", userAgent: "Phone" });
  });

  it("revoking a session kills its access and refresh tokens immediately", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "revoke@example.com");
    const phone = await login(ctx, "revoke@example.com", "Phone");
    const laptop = await login(ctx, "revoke@example.com", "Laptop");
    const list = await ctx
      .http()
      .get("/api/v1/auth/sessions")
      .set(bearer(phone.body.accessToken))
      .expect(200);
    const laptopSession = list.body.items.find(
      (s: { userAgent: string }) => s.userAgent === "Laptop",
    );

    await ctx
      .http()
      .delete(`/api/v1/auth/sessions/${laptopSession.id}`)
      .set(bearer(phone.body.accessToken))
      .expect(204);
    await ctx.http().get("/api/v1/users/me").set(bearer(laptop.body.accessToken)).expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: laptop.body.refreshToken })
      .expect(401);
    await ctx.http().get("/api/v1/users/me").set(bearer(phone.body.accessToken)).expect(200);
  });

  it("cannot revoke someone else's session", async () => {
    const ctx = makeApp();
    const a = await createVerifiedUser(ctx, "a@example.com");
    const b = await createVerifiedUser(ctx, "b@example.com");
    const bSession = await SessionModel.findOne({ userId: b.user.id });
    await ctx
      .http()
      .delete(`/api/v1/auth/sessions/${bSession!.id}`)
      .set(bearer(a.accessToken))
      .expect(404);
    await ctx.http().get("/api/v1/users/me").set(bearer(b.accessToken)).expect(200);
  });

  it("logout-all signs out every device", async () => {
    const ctx = makeApp();
    const first = await createVerifiedUser(ctx, "all@example.com");
    const second = await login(ctx, "all@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/logout-all")
      .set(bearer(second.body.accessToken))
      .expect(200);
    await ctx.http().get("/api/v1/users/me").set(bearer(first.accessToken)).expect(401);
    await ctx.http().get("/api/v1/users/me").set(bearer(second.body.accessToken)).expect(401);
    expect(await SessionModel.countDocuments({ revokedAt: null })).toBe(0);
  });

  it("expires idle sessions", async () => {
    const ctx = makeApp();
    const { refreshToken, user } = await createVerifiedUser(ctx, "idle@example.com");
    await SessionModel.updateMany(
      { userId: user.id },
      { $set: { idleExpiresAt: new Date(Date.now() - 1000) } },
    );
    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken }).expect(401);
  });

  it("refresh slides the idle window but never past the absolute expiry", async () => {
    const ctx = makeApp();
    const { refreshToken, user } = await createVerifiedUser(ctx, "slide@example.com");
    const absolute = new Date(Date.now() + 3_600_000);
    await SessionModel.updateMany(
      { userId: user.id },
      { $set: { absoluteExpiresAt: absolute, idleExpiresAt: new Date(Date.now() + 60_000) } },
    );
    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken }).expect(200);
    const s = await SessionModel.findOne({ userId: user.id });
    expect(s!.idleExpiresAt.getTime()).toBe(absolute.getTime());
  });

  it("re-using a rotated refresh token revokes the session", async () => {
    const ctx = makeApp();
    const { refreshToken } = await createVerifiedUser(ctx, "reuse@example.com");
    const r1 = await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken }).expect(200);
    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken }).expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
    await ctx.http().get("/api/v1/users/me").set(bearer(r1.body.accessToken)).expect(401);
    const s = await SessionModel.findOne({});
    expect(s!.revokedReason).toBe("reuse_detected");
  });

  it("stores refresh tokens only as hashes and IPs only as HMACs", async () => {
    const ctx = makeApp();
    const { refreshToken } = await createVerifiedUser(ctx, "hash@example.com");
    const raw = JSON.stringify(await SessionModel.find().lean());
    expect(raw).not.toContain(refreshToken);
    expect(raw).not.toContain("127.0.0.1");
  });
});

describe("step-up re-authentication", () => {
  it("requires a recent password confirmation for sensitive actions", async () => {
    const ctx = makeApp();
    const { accessToken, user } = await createVerifiedUser(ctx, "stepup@example.com");
    await SessionModel.updateMany(
      { userId: user.id },
      { $set: { authenticatedAt: new Date(Date.now() - 60 * 60_000) } },
    );
    const blocked = await ctx.http().post("/api/v1/auth/mfa/totp/setup").set(bearer(accessToken));
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.code).toBe("STEP_UP_REQUIRED");

    await ctx
      .http()
      .post("/api/v1/auth/reauthenticate")
      .set(bearer(accessToken))
      .send({ password: "wrong-pass-1" })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/reauthenticate")
      .set(bearer(accessToken))
      .send({ password: PASSWORD })
      .expect(200);
    await ctx.http().post("/api/v1/auth/mfa/totp/setup").set(bearer(accessToken)).expect(200);
  });

  it("is not available to guests", async () => {
    const ctx = makeApp();
    const g = await ctx
      .http()
      .post("/api/v1/auth/guest")
      .set("X-Client-Platform", "mobile")
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/auth/reauthenticate")
      .set(bearer(g.body.accessToken))
      .send({ password: "x" })
      .expect(403);
  });
});
