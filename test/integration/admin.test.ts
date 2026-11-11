import { describe, expect, it } from "vitest";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import { UserModel } from "../../src/modules/users/user.model.js";
import { PASSWORD, createVerifiedUser, makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();

const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

describe("role-based access control", () => {
  it("requires sign-in and the admin role", async () => {
    const ctx = makeApp();
    await ctx.http().get("/api/v1/admin/users").expect(401);
    const player = await createVerifiedUser(ctx, "player@example.com");
    const reviewer = await createVerifiedUser(ctx, "reviewer@example.com", ["player", "reviewer"]);
    const p = await ctx.http().get("/api/v1/admin/users").set(bearer(player.accessToken));
    expect(p.status).toBe(403);
    expect(p.body.error.code).toBe("FORBIDDEN");
    await ctx.http().get("/api/v1/admin/users").set(bearer(reviewer.accessToken)).expect(403);
  });

  it("lists and searches users with pagination", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    await createVerifiedUser(ctx, "nurse.abena@example.com");
    await createVerifiedUser(ctx, "dr.tunde@example.com");
    await ctx.http().post("/api/v1/auth/guest").expect(201); // guests are excluded

    const all = await ctx
      .http()
      .get("/api/v1/admin/users?pageSize=2")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
    expect(all.body.items).toHaveLength(2);

    const search = await ctx
      .http()
      .get("/api/v1/admin/users?search=abena")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(search.body.items.map((u: { email: string }) => u.email)).toEqual([
      "nurse.abena@example.com",
    ]);

    const regexy = await ctx
      .http()
      .get("/api/v1/admin/users?search=.*")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(regexy.body.total).toBe(0); // search text is escaped, not treated as a pattern

    const byRole = await ctx
      .http()
      .get("/api/v1/admin/users?role=admin")
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(byRole.body.total).toBe(1);

    await ctx
      .http()
      .get("/api/v1/admin/users?pageSize=1000")
      .set(bearer(admin.accessToken))
      .expect(400);
  });

  it("grants roles, keeps 'player', audits the change, and applies it immediately", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const clin = await createVerifiedUser(ctx, "clinician@example.com");

    // Before the grant, the clinician has no admin access.
    await ctx.http().get("/api/v1/admin/users").set(bearer(clin.accessToken)).expect(403);

    // The reviewer role requires verified clinician credentials.
    const early = await ctx
      .http()
      .put(`/api/v1/admin/users/${clin.user.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ["reviewer"] });
    expect(early.status).toBe(409);
    await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(clin.accessToken))
      .send({
        fullName: "Dr Kwame Asante",
        credentials: "MBChB",
        profession: "doctor",
        registrationBody: "Medical and Dental Council of Ghana",
        registrationNumber: "MDC/RN/1234",
        countryCode: "GH",
      })
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/clinicians/${clin.user.id}/verify`)
      .set(bearer(admin.accessToken))
      .send({ decision: "verified", reason: "Registration confirmed" })
      .expect(200);

    const r = await ctx
      .http()
      .put(`/api/v1/admin/users/${clin.user.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ["reviewer"] })
      .expect(200);
    expect(r.body.roles.sort()).toEqual(["player", "reviewer"]);

    const audit = await AuditLogModel.findOne({
      targetId: clin.user.id,
      action: "user.roles.update",
    }).lean();
    expect(audit).toMatchObject({
      action: "user.roles.update",
      before: { roles: ["player"] },
      after: { roles: ["player", "reviewer"] },
    });
    expect(audit!.actorId.toString()).toBe(admin.user.id);

    // Role changes sign the user out everywhere so the stricter staff session policy applies on next sign-in.
    await ctx
      .http()
      .put(`/api/v1/admin/users/${clin.user.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: ["admin"], reason: "Operations lead" })
      .expect(200);
    await ctx.http().get("/api/v1/users/me").set(bearer(clin.accessToken)).expect(401);
    const relogin = await ctx
      .http()
      .post("/api/v1/auth/login")
      .set("X-Client-Platform", "mobile")
      .send({ email: "clinician@example.com", password: PASSWORD })
      .expect(200);
    await ctx.http().get("/api/v1/admin/users").set(bearer(relogin.body.accessToken)).expect(200);

    // Revoking the role takes effect immediately (permissions are resolved per request).
    await ctx
      .http()
      .put(`/api/v1/admin/users/${clin.user.id}/roles`)
      .set(bearer(admin.accessToken))
      .send({ roles: [] })
      .expect(200);
    await ctx.http().get("/api/v1/admin/users").set(bearer(relogin.body.accessToken)).expect(401);
  });

  it("blocks unsafe role changes", async () => {
    const ctx = makeApp();
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const h = bearer(admin.accessToken);

    const self = await ctx
      .http()
      .put(`/api/v1/admin/users/${admin.user.id}/roles`)
      .set(h)
      .send({ roles: ["reviewer"] });
    expect(self.status).toBe(409);

    await ctx
      .http()
      .post("/api/v1/auth/register")
      .send({ email: "unverified@example.com", password: "pass-word-1", displayName: "U" });
    const unverified = await UserModel.findOne({ email: "unverified@example.com" });
    await ctx
      .http()
      .put(`/api/v1/admin/users/${unverified!.id}/roles`)
      .set(h)
      .send({ roles: ["reviewer"] })
      .expect(409);

    const guest = await ctx.http().post("/api/v1/auth/guest").expect(201);
    await ctx
      .http()
      .put(`/api/v1/admin/users/${guest.body.user.id}/roles`)
      .set(h)
      .send({ roles: ["reviewer"] })
      .expect(409);

    await ctx
      .http()
      .put(`/api/v1/admin/users/000000000000000000000000/roles`)
      .set(h)
      .send({ roles: [] })
      .expect(404);
    await ctx
      .http()
      .put(`/api/v1/admin/users/not-an-id/roles`)
      .set(h)
      .send({ roles: [] })
      .expect(400);
    await ctx
      .http()
      .put(`/api/v1/admin/users/${admin.user.id}/roles`)
      .set(h)
      .send({ roles: ["superuser"] })
      .expect(400);
  });
});
