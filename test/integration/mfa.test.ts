import { describe, expect, it } from "vitest";
import { hotp, totpStep } from "../../src/lib/totp.js";
import { PASSWORD, createVerifiedUser, makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const code = (secret: string, offsetSteps = 0) => hotp(secret, totpStep() + offsetSteps);

async function enrol(ctx: ReturnType<typeof makeApp>, accessToken: string) {
  const setup = await ctx
    .http()
    .post("/api/v1/auth/mfa/totp/setup")
    .set(bearer(accessToken))
    .expect(200);
  expect(setup.body.otpauthUri).toContain("otpauth://totp/");
  const verify = await ctx
    .http()
    .post("/api/v1/auth/mfa/totp/verify")
    .set(bearer(accessToken))
    .send({ code: code(setup.body.secret, -1) })
    .expect(200);
  expect(verify.body.recoveryCodes).toHaveLength(10);
  return {
    secret: setup.body.secret as string,
    recoveryCodes: verify.body.recoveryCodes as string[],
  };
}

describe("multi-factor authentication for staff", () => {
  it("blocks staff endpoints until MFA is set up and verified per session", async () => {
    const ctx = makeApp({ config: { MFA_REQUIRED_FOR_STAFF: "true" } });
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);

    const blocked = await ctx.http().get("/api/v1/admin/users").set(bearer(admin.accessToken));
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toMatchObject({
      code: "MFA_REQUIRED",
      details: [{ path: "mfa", message: "setup_required" }],
    });

    const { secret, recoveryCodes } = await enrol(ctx, admin.accessToken);
    await ctx.http().get("/api/v1/admin/users").set(bearer(admin.accessToken)).expect(200); // enrolling verifies this session

    // A new sign-in must complete the challenge.
    const login = await ctx
      .http()
      .post("/api/v1/auth/login")
      .set("X-Client-Platform", "mobile")
      .send({ email: "admin@example.com", password: PASSWORD })
      .expect(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.user.mfaEnabled).toBe(true);
    const t = login.body.accessToken;
    const pending = await ctx.http().get("/api/v1/admin/users").set(bearer(t));
    expect(pending.body.error.details[0].message).toBe("challenge_required");

    await ctx
      .http()
      .post("/api/v1/auth/mfa/challenge")
      .set(bearer(t))
      .send({ code: "000000" })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/challenge")
      .set(bearer(t))
      .send({ code: code(secret, 0) })
      .expect(200);
    await ctx.http().get("/api/v1/admin/users").set(bearer(t)).expect(200);

    // Replaying an already-used code fails; recovery codes work exactly once.
    const login2 = await ctx
      .http()
      .post("/api/v1/auth/login")
      .set("X-Client-Platform", "mobile")
      .send({ email: "admin@example.com", password: PASSWORD })
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/challenge")
      .set(bearer(login2.body.accessToken))
      .send({ code: code(secret, 0) })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/challenge")
      .set(bearer(login2.body.accessToken))
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(200);
    const login3 = await ctx
      .http()
      .post("/api/v1/auth/login")
      .set("X-Client-Platform", "mobile")
      .send({ email: "admin@example.com", password: PASSWORD })
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/challenge")
      .set(bearer(login3.body.accessToken))
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(401);
  });

  it("does not let staff disable MFA, but players may", async () => {
    const ctx = makeApp({ config: { MFA_REQUIRED_FOR_STAFF: "true" } });
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const adminMfa = await enrol(ctx, admin.accessToken);
    await ctx
      .http()
      .delete("/api/v1/auth/mfa")
      .set(bearer(admin.accessToken))
      .send({ code: code(adminMfa.secret, 1) })
      .expect(409);

    const player = await createVerifiedUser(ctx, "player@example.com");
    await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken)).expect(200); // players are never blocked
    const playerMfa = await enrol(ctx, player.accessToken);
    await ctx
      .http()
      .delete("/api/v1/auth/mfa")
      .set(bearer(player.accessToken))
      .send({ code: code(playerMfa.secret, 1) })
      .expect(204);
    const me = await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken)).expect(200);
    expect(me.body.mfaEnabled).toBe(false);
  });

  it("rejects setup confirmation with a wrong code and never exposes the secret afterwards", async () => {
    const ctx = makeApp();
    const player = await createVerifiedUser(ctx, "p@example.com");
    await ctx
      .http()
      .post("/api/v1/auth/mfa/totp/setup")
      .set(bearer(player.accessToken))
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/mfa/totp/verify")
      .set(bearer(player.accessToken))
      .send({ code: "123456" })
      .expect(401);
    const me = await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken)).expect(200);
    expect(JSON.stringify(me.body)).not.toMatch(/secret|recovery/i);
  });
});
