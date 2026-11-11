import { describe, expect, it } from "vitest";
import { UserModel } from "../../src/modules/users/user.model.js";
import type { GoogleIdentity, GoogleVerifier } from "../../src/services/google.js";
import { PASSWORD, makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();

/** Test double: maps fake ID tokens to identities, as Google's verifier would. */
class FakeGoogle implements GoogleVerifier {
  constructor(private readonly identities: Record<string, GoogleIdentity>) {}
  async verify(idToken: string) {
    return this.identities[idToken] ?? null;
  }
}

const amara: GoogleIdentity = {
  sub: "g-123",
  email: "amara@example.com",
  emailVerified: true,
  name: "Amara Okafor",
};

describe("Google sign-in", () => {
  it("creates a verified account on first sign-in and reuses it after", async () => {
    const ctx = makeApp({ google: new FakeGoogle({ "token-amara-0001": amara }) });
    const first = await ctx
      .http()
      .post("/api/v1/auth/google")
      .send({ idToken: "token-amara-0001" })
      .expect(200);
    expect(first.body.user).toMatchObject({
      email: "amara@example.com",
      emailVerified: true,
      displayName: "Amara Okafor",
    });
    const second = await ctx
      .http()
      .post("/api/v1/auth/google")
      .send({ idToken: "token-amara-0001" })
      .expect(200);
    expect(second.body.user.id).toBe(first.body.user.id);
  });

  it("links to an existing verified email account", async () => {
    const ctx = makeApp({ google: new FakeGoogle({ "token-amara-0001": amara }) });
    const existing = await UserModel.create({
      email: "amara@example.com",
      displayName: "A",
      emailVerifiedAt: new Date(),
      passwordHash: "scrypt$keep",
    });
    const r = await ctx
      .http()
      .post("/api/v1/auth/google")
      .send({ idToken: "token-amara-0001" })
      .expect(200);
    expect(r.body.user.id).toBe(existing.id);
    const doc = await UserModel.findById(existing.id).select("+passwordHash").lean();
    expect(doc?.googleSub).toBe("g-123");
    expect(doc?.passwordHash).toBe("scrypt$keep");
  });

  it("drops an unverified password when Google proves ownership (pre-hijack defence)", async () => {
    const ctx = makeApp({ google: new FakeGoogle({ "token-amara-0001": amara }) });
    await ctx
      .http()
      .post("/api/v1/auth/register")
      .send({ email: "amara@example.com", password: PASSWORD, displayName: "Attacker" })
      .expect(202);
    await ctx.http().post("/api/v1/auth/google").send({ idToken: "token-amara-0001" }).expect(200);
    const doc = await UserModel.findOne({ email: "amara@example.com" })
      .select("+passwordHash")
      .lean();
    expect(doc?.passwordHash).toBeUndefined();
    expect(doc?.emailVerifiedAt).toBeTruthy();
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "amara@example.com", password: PASSWORD })
      .expect(401);
  });

  it("rejects invalid tokens and unverified Google emails", async () => {
    const ctx = makeApp({
      google: new FakeGoogle({
        "token-unverified-01": { ...amara, sub: "g-9", emailVerified: false },
      }),
    });
    await ctx
      .http()
      .post("/api/v1/auth/google")
      .send({ idToken: "token-not-known-01" })
      .expect(401);
    await ctx
      .http()
      .post("/api/v1/auth/google")
      .send({ idToken: "token-unverified-01" })
      .expect(401);
  });

  it("returns 503 when Google sign-in is not configured", async () => {
    const ctx = makeApp({ google: null });
    const r = await ctx.http().post("/api/v1/auth/google").send({ idToken: "token-amara-0001" });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("SERVICE_UNAVAILABLE");
  });
});
