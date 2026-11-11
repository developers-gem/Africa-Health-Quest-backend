import { describe, expect, it } from "vitest";
import { EmailTokenModel } from "../../src/modules/auth/email-token.model.js";
import { UserModel } from "../../src/modules/users/user.model.js";
import {
  PASSWORD,
  createVerifiedUser,
  makeApp,
  refreshCookie,
  tokenFromMail,
  useTestDatabase,
} from "./helpers.js";

useTestDatabase();

const register = (ctx: ReturnType<typeof makeApp>, email: string, password = PASSWORD) =>
  ctx.http().post("/api/v1/auth/register").send({ email, password, displayName: "Ada" });

describe("registration and email verification", () => {
  it("registers, requires verification, then signs in", async () => {
    const ctx = makeApp();
    const reg = await register(ctx, "Ada@Example.com");
    expect(reg.status).toBe(202);
    expect(reg.body.message).toMatch(/confirmation link/);

    const blocked = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "ada@example.com", password: PASSWORD });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    const token = tokenFromMail(ctx.mailer, "ada@example.com");
    await ctx.http().post("/api/v1/auth/verify-email").send({ token }).expect(200);
    // Single use
    const again = await ctx.http().post("/api/v1/auth/verify-email").send({ token });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe("TOKEN_INVALID");

    const login = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "ADA@example.com ", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user).toMatchObject({
      email: "ada@example.com",
      emailVerified: true,
      roles: ["player"],
      isGuest: false,
    });
    expect(login.body.refreshToken).toBeUndefined(); // web: cookie only
    expect(refreshCookie(login)).toBeDefined();
    const setCookie = (login.headers["set-cookie"] as unknown as string[]).join(";");
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
  });

  it("does not reveal whether an email is already registered", async () => {
    const ctx = makeApp();
    await register(ctx, "taken@example.com").expect(202);
    const second = await register(ctx, "taken@example.com", "different-pass-2");
    expect(second.status).toBe(202);
    expect(second.body.message).toBe((await register(ctx, "fresh@example.com")).body.message);
    expect(ctx.mailer.sent.filter((m) => m.to === "taken@example.com").at(-1)?.subject).toMatch(
      /tried to create/,
    );
    // The original password is unchanged
    expect(await UserModel.countDocuments({ email: "taken@example.com" })).toBe(1);
  });

  it("stores passwords hashed, never in plain text", async () => {
    const ctx = makeApp();
    await register(ctx, "hash@example.com").expect(202);
    const u = await UserModel.findOne({ email: "hash@example.com" }).select("+passwordHash").lean();
    expect(u?.passwordHash).toMatch(/^scrypt\$/);
    expect(u?.passwordHash).not.toContain(PASSWORD);
    const tokens = await EmailTokenModel.find().lean();
    expect(tokens[0]?.tokenHash).toHaveLength(64);
  });

  it("rejects invalid input with a field-level error envelope", async () => {
    const ctx = makeApp();
    const res = await ctx
      .http()
      .post("/api/v1/auth/register")
      .send({ email: "nope", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["email", "password", "displayName"]));
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("resending verification invalidates the earlier link", async () => {
    const ctx = makeApp();
    await register(ctx, "resend@example.com").expect(202);
    const first = tokenFromMail(ctx.mailer, "resend@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/resend-verification")
      .send({ email: "resend@example.com" })
      .expect(200);
    const second = tokenFromMail(ctx.mailer, "resend@example.com");
    expect(second).not.toBe(first);
    await ctx.http().post("/api/v1/auth/verify-email").send({ token: first }).expect(401);
    await ctx.http().post("/api/v1/auth/verify-email").send({ token: second }).expect(200);
    // Unknown email: same response, no mail
    const before = ctx.mailer.sent.length;
    await ctx
      .http()
      .post("/api/v1/auth/resend-verification")
      .send({ email: "ghost@example.com" })
      .expect(200);
    expect(ctx.mailer.sent.length).toBe(before);
  });
});

describe("login", () => {
  it("returns the same error for a wrong password and an unknown email", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "login@example.com");
    const wrong = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "login@example.com", password: "wrong-pass-1" });
    const unknown = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "nobody@example.com", password: "wrong-pass-1" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it("blocks disabled accounts", async () => {
    const ctx = makeApp();
    const { accessToken } = await createVerifiedUser(ctx, "disabled@example.com");
    await UserModel.updateOne(
      { email: "disabled@example.com" },
      { $set: { disabledAt: new Date() } },
    );
    await ctx
      .http()
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(403);
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "disabled@example.com", password: PASSWORD })
      .expect(403);
  });
});

describe("sessions", () => {
  it("protects /users/me and accepts a valid access token", async () => {
    const ctx = makeApp();
    await ctx.http().get("/api/v1/users/me").expect(401);
    await ctx.http().get("/api/v1/users/me").set("Authorization", "Bearer garbage").expect(401);
    const { accessToken } = await createVerifiedUser(ctx, "me@example.com");
    const me = await ctx
      .http()
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.email).toBe("me@example.com");
    const patched = await ctx
      .http()
      .patch("/api/v1/users/me")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ displayName: "  Dr Ada  " })
      .expect(200);
    expect(patched.body.displayName).toBe("Dr Ada");
  });

  it("rejects access tokens signed with another secret", async () => {
    const ctx = makeApp();
    const other = makeApp({ config: { JWT_ACCESS_SECRET: "another-secret-another-secret-12345" } });
    await createVerifiedUser(ctx, "forge@example.com");
    const forged = await other
      .http()
      .post("/api/v1/auth/login")
      .set("X-Client-Platform", "mobile")
      .send({ email: "forge@example.com", password: PASSWORD });
    await ctx
      .http()
      .get("/api/v1/users/me")
      .set("Authorization", `Bearer ${forged.body.accessToken}`)
      .expect(401);
  });

  it("rotates web refresh cookies and revokes the family when an old one is reused", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "web@example.com");
    const login = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "web@example.com", password: PASSWORD });
    const c1 = refreshCookie(login)!;

    const r1 = await ctx.http().post("/api/v1/auth/refresh").set("Cookie", c1).expect(200);
    const c2 = refreshCookie(r1)!;
    expect(c2).not.toBe(c1);
    expect(r1.body.accessToken).toBeTruthy();

    // Replaying c1 (theft) kills the whole family, including c2.
    await ctx.http().post("/api/v1/auth/refresh").set("Cookie", c1).expect(401);
    await ctx.http().post("/api/v1/auth/refresh").set("Cookie", c2).expect(401);
  });

  it("returns refresh tokens in the body for mobile and supports logout", async () => {
    const ctx = makeApp();
    const { refreshToken } = await createVerifiedUser(ctx, "mobile@example.com");
    expect(refreshToken).toBeTruthy();
    const r = await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .set("X-Client-Platform", "mobile")
      .send({ refreshToken })
      .expect(200);
    expect(r.body.refreshToken).toBeTruthy();
    await ctx
      .http()
      .post("/api/v1/auth/logout")
      .send({ refreshToken: r.body.refreshToken })
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: r.body.refreshToken })
      .expect(401);
  });

  it("refuses refresh without a token", async () => {
    const ctx = makeApp();
    const r = await ctx.http().post("/api/v1/auth/refresh").send({});
    expect(r.status).toBe(401);
  });
});

describe("password reset", () => {
  it("resets the password and signs out every device", async () => {
    const ctx = makeApp();
    const { refreshToken } = await createVerifiedUser(ctx, "reset@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/forgot-password")
      .send({ email: "reset@example.com" })
      .expect(200);
    const token = tokenFromMail(ctx.mailer, "reset@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "brand-new-pass-9" })
      .expect(200);

    await ctx.http().post("/api/v1/auth/refresh").send({ refreshToken }).expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "reset@example.com", password: PASSWORD })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "reset@example.com", password: "brand-new-pass-9" })
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "another-pass-9" })
      .expect(401);
  });

  it("gives the same answer for unknown emails and sends nothing", async () => {
    const ctx = makeApp();
    const r = await ctx
      .http()
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    expect(r.status).toBe(200);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it("rejects expired tokens", async () => {
    const ctx = makeApp();
    await createVerifiedUser(ctx, "expired@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/forgot-password")
      .send({ email: "expired@example.com" })
      .expect(200);
    const token = tokenFromMail(ctx.mailer, "expired@example.com");
    await EmailTokenModel.updateMany(
      { purpose: "reset_password" },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await ctx
      .http()
      .post("/api/v1/auth/reset-password")
      .send({ token, password: "brand-new-pass-9" })
      .expect(401);
  });
});
