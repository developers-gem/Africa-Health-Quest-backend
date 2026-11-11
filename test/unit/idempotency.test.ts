import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { idempotency } from "../../src/middleware/idempotency.js";
import { errorHandler } from "../../src/middleware/error-handler.js";
import { createLogger } from "../../src/lib/logger.js";

describe("idempotency middleware (no database needed)", () => {
  it("passes through requests without a key and rejects malformed keys before touching storage", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { auth: unknown }).auth = { user: { id: "000000000000000000000001" } };
      next();
    });
    app.post("/x", idempotency(createLogger("silent")), (_req, res) => {
      res.status(201).json({ ok: true });
    });
    app.use(errorHandler(createLogger("silent")));
    await request(app).post("/x").send({}).expect(201);
    const bad = await request(app).post("/x").set("Idempotency-Key", "short").send({});
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});
