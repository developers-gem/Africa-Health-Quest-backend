import { describe, expect, it } from "vitest";
import { permissionsFor, sessionPolicyFor } from "../../src/modules/auth/roles.js";

describe("roles and permissions", () => {
  it("gives players only game and own-account permissions", () => {
    expect([...permissionsFor(["player"])].sort()).toEqual(["account:manage-own", "game:play"]);
  });

  it("separates duties: admins author content but cannot decide reviews", () => {
    const admin = permissionsFor(["player", "admin"]);
    expect(admin.has("content:edit")).toBe(true);
    expect(admin.has("review:decide")).toBe(false);
    expect(permissionsFor(["player", "reviewer"]).has("review:decide")).toBe(true);
    expect(permissionsFor(["player", "reviewer"]).has("content:edit")).toBe(false);
  });

  it("applies the strictest session policy of all roles held", () => {
    expect(sessionPolicyFor(["player"])).toEqual({
      idleHours: 720,
      absoluteDays: 180,
      mfaRequired: false,
    });
    expect(sessionPolicyFor(["player", "reviewer"])).toEqual({
      idleHours: 12,
      absoluteDays: 7,
      mfaRequired: true,
    });
  });

  it("ignores unknown roles", () => {
    expect(permissionsFor(["superuser"]).size).toBe(0);
  });
});
