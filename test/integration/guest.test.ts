import { describe, expect, it } from "vitest";
import { UserModel } from "../../src/modules/users/user.model.js";
import {
  PASSWORD,
  createVerifiedUser,
  makeApp,
  tokenFromMail,
  useTestDatabase,
} from "./helpers.js";

useTestDatabase();

const startGuest = async (ctx: ReturnType<typeof makeApp>) => {
  const r = await ctx
    .http()
    .post("/api/v1/auth/guest")
    .set("X-Client-Platform", "mobile")
    .expect(201);
  return r.body as {
    accessToken: string;
    refreshToken: string;
    user: { id: string; isGuest: boolean };
  };
};

describe("guest sessions", () => {
  it("creates a guest and records its activity time", async () => {
    const ctx = makeApp();
    const g = await startGuest(ctx);
    expect(g.user).toMatchObject({ isGuest: true, email: null, roles: ["player"] });
    const doc = await UserModel.findById(g.user.id).lean();
    expect(Date.now() - doc!.guestLastActiveAt!.getTime()).toBeLessThan(5_000);
  });

  it("refreshing the session marks the guest as active again", async () => {
    const ctx = makeApp();
    const g = await startGuest(ctx);
    const old = new Date(Date.now() - 20 * 86_400_000);
    await UserModel.updateOne({ _id: g.user.id }, { $set: { guestLastActiveAt: old } });
    await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: g.refreshToken })
      .expect(200);
    const doc = await UserModel.findById(g.user.id).lean();
    expect(Date.now() - doc!.guestLastActiveAt!.getTime()).toBeLessThan(5_000);
  });

  it("upgrades a guest in place, keeping the same account id", async () => {
    const ctx = makeApp();
    const g = await startGuest(ctx);
    const up = await ctx
      .http()
      .post("/api/v1/auth/guest/upgrade")
      .set("Authorization", `Bearer ${g.accessToken}`)
      .send({ email: "Upgraded@Example.com", password: PASSWORD, displayName: "Kofi" })
      .expect(200);
    expect(up.body.user).toMatchObject({
      id: g.user.id,
      isGuest: false,
      email: "upgraded@example.com",
      emailVerified: false,
    });

    const doc = await UserModel.findById(g.user.id).lean();
    expect(doc!.guestLastActiveAt).toBeUndefined();

    // The current session keeps working; future logins need a confirmed email.
    await ctx
      .http()
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${g.accessToken}`)
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "upgraded@example.com", password: PASSWORD })
      .expect(403);
    const token = tokenFromMail(ctx.mailer, "upgraded@example.com");
    await ctx.http().post("/api/v1/auth/verify-email").send({ token }).expect(200);
    const login = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "upgraded@example.com", password: PASSWORD })
      .expect(200);
    expect(login.body.user.id).toBe(g.user.id);
  });

  it("refuses to upgrade onto an email that is already registered", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "owner@example.com");
    const g = await startGuest(ctx);
    const r = await ctx
      .http()
      .post("/api/v1/auth/guest/upgrade")
      .set("Authorization", `Bearer ${g.accessToken}`)
      .send({ email: "owner@example.com", password: PASSWORD, displayName: "X" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CONFLICT");
  });

  it("only guests can upgrade, and only when signed in", async () => {
    const ctx = makeApp();
    const body = { email: "z@example.com", password: PASSWORD, displayName: "Z" };
    await ctx.http().post("/api/v1/auth/guest/upgrade").send(body).expect(401);
    const { accessToken } = await createVerifiedUser(ctx, "real@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/guest/upgrade")
      .set("Authorization", `Bearer ${accessToken}`)
      .send(body)
      .expect(403);
  });

  it("guests cannot use staff endpoints even if a role were set on them", async () => {
    const ctx = makeApp();
    const g = await startGuest(ctx);
    await UserModel.updateOne({ _id: g.user.id }, { $set: { roles: ["player", "admin"] } });
    await ctx
      .http()
      .get("/api/v1/admin/users")
      .set("Authorization", `Bearer ${g.accessToken}`)
      .expect(403);
  });
});
