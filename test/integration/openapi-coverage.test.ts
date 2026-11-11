import { buildOpenApiDocument } from "@ahq/api-contracts";
import { describe, expect, it } from "vitest";
import { makeApp, useTestDatabase } from "./helpers.js";

useTestDatabase();

const SAMPLE: Record<string, string> = {
  id: "665f1c2e9b1d8a0012345678",
  userId: "665f1c2e9b1d8a0012345678",
  key: "malaria",
  code: "GH",
};

describe("OpenAPI document matches the implemented routes", () => {
  it("routes every documented operation (none falls through to the 404 handler)", async () => {
    const ctx = makeApp();
    const doc = buildOpenApiDocument();
    const missing: string[] = [];
    let operations = 0;
    for (const [path, item] of Object.entries(doc.paths ?? {})) {
      const url = path.replace(/\{(\w+)\}/g, (_m, name: string) => SAMPLE[name] ?? "sample");
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        if (!(item as Record<string, unknown>)[method]) continue;
        operations++;
        const res = await ctx.http()[method](url);
        if (res.status === 404 && res.body?.error?.message === "This endpoint does not exist.") {
          missing.push(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(missing).toEqual([]);
    expect(operations).toBeGreaterThan(100);
  });
});
