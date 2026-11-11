import { describe, expect, it } from "vitest";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { PASSWORD, createVerifiedUser, makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("account suspension", () => {
  it("suspends immediately, blocks sign-in, and can be lifted", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const player = await createVerifiedUser(ctx, "player@example.com");

    const res = await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Abusive behaviour reported" })
      .expect(200);
    expect(res.body.suspended).toBe(true);

    const me = await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken));
    expect(me.status).toBe(403);
    expect(me.body.error.code).toBe("ACCOUNT_SUSPENDED");
    await ctx
      .http()
      .post("/api/v1/auth/refresh")
      .send({ refreshToken: player.refreshToken })
      .expect(401);
    const login = await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect(await SessionModel.countDocuments({ userId: player.user.id, revokedAt: null })).toBe(0);

    const audit = await AuditLogModel.findOne({ action: "user.suspended" }).lean();
    expect(audit).toMatchObject({
      targetId: player.user.id,
      reason: "Abusive behaviour reported",
      actorRoles: ["player", "admin"],
    });

    const list = await ctx
      .http()
      .get("/api/v1/admin/users?status=suspended")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(list.body.items.map((u: { id: string }) => u.id)).toEqual([player.user.id]);

    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/unsuspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Appeal upheld" })
      .expect(200);
    await ctx
      .http()
      .post("/api/v1/auth/login")
      .send({ email: "player@example.com", password: PASSWORD })
      .expect(200);
  });

  it("guards suspension: self, double suspension, permissions, step-up", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const reviewer = await createVerifiedUser(ctx, "rev@example.com", ["player", "reviewer"]);
    const player = await createVerifiedUser(ctx, "p@example.com");
    const body = { reason: "Testing guards" };

    await ctx
      .http()
      .post(`/api/v1/admin/users/${admin.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send(body)
      .expect(409);
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(reviewer.accessToken))
      .send(body)
      .expect(403);
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send({ reason: "x" })
      .expect(400);

    await SessionModel.updateMany(
      { userId: admin.user.id },
      { $set: { authenticatedAt: new Date(Date.now() - 3_600_000) } },
    );
    const stale = await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send(body);
    expect(stale.body.error.code).toBe("STEP_UP_REQUIRED");
    await ctx
      .http()
      .post("/api/v1/auth/reauthenticate")
      .set(bearer(admin.accessToken))
      .send({ password: PASSWORD })
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send(body)
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/suspend`)
      .set(bearer(admin.accessToken))
      .send(body)
      .expect(409);
  });

  it("admins can sign a user out of every device", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const player = await createVerifiedUser(ctx, "p@example.com");
    const res = await ctx
      .http()
      .post(`/api/v1/admin/users/${player.user.id}/sessions/revoke`)
      .set(bearer(admin.accessToken))
      .send({ reason: "Lost phone" })
      .expect(200);
    expect(res.body.revoked).toBe(1);
    await ctx.http().get("/api/v1/users/me").set(bearer(player.accessToken)).expect(401);
  });
});
