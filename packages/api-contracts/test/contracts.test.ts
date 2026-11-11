import { describe, expect, it } from "vitest";
import {
  buildOpenApiDocument,
  LoginRequestSchema,
  RegisterRequestSchema,
  UpdateRolesRequestSchema,
} from "../src/index.js";

describe("auth contracts", () => {
  it("normalises email to lowercase and trims it", () => {
    const r = LoginRequestSchema.parse({ email: "  Ada@Example.COM ", password: "x" });
    expect(r.email).toBe("ada@example.com");
  });

  it("rejects weak passwords", () => {
    const base = { email: "a@b.co", displayName: "Ada" };
    expect(RegisterRequestSchema.safeParse({ ...base, password: "short1" }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...base, password: "lettersonly" }).success).toBe(
      false,
    );
    expect(RegisterRequestSchema.safeParse({ ...base, password: "12345678" }).success).toBe(false);
    expect(RegisterRequestSchema.safeParse({ ...base, password: "goodpass1" }).success).toBe(true);
  });

  it("rejects unknown roles", () => {
    expect(UpdateRolesRequestSchema.safeParse({ roles: ["superuser"] }).success).toBe(false);
  });
});

describe("OpenAPI document", () => {
  it("documents every public route", () => {
    const doc = buildOpenApiDocument();
    const paths = Object.keys(doc.paths ?? {});
    for (const p of [
      "/health",
      "/api/v1/auth/register",
      "/api/v1/auth/login",
      "/api/v1/auth/refresh",
      "/api/v1/auth/guest",
      "/api/v1/auth/guest/upgrade",
      "/api/v1/users/me",
      "/api/v1/admin/users/{id}/roles",
    ]) {
      expect(paths).toContain(p);
    }
    expect(doc.components?.schemas?.ErrorResponse).toBeDefined();
  });
});
