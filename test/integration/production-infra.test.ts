/**
 * Production infrastructure behaviour (Phase 8): shared rate limits across API instances, the S3 media driver,
 * and the configuration rules that keep a production deployment from starting with development settings.
 */
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import { S3Storage } from "../../src/modules/media/storage.js";
import { PNG_1X1 } from "../fixtures/media.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";

useTestDatabase();

describe("shared rate limits (RATE_LIMIT_STORE=mongo)", () => {
  it("counts requests across two API instances", async () => {
    const config = { RATE_LIMIT_STORE: "mongo", RATE_LIMIT_AUTH_MAX: "3" };
    const a = makeApp({ config });
    const b = makeApp({ config });
    const login = (app: typeof a) =>
      app
        .http()
        .post("/api/v1/auth/login")
        .send({ email: "x@example.com", password: "wrong-password" });
    const statuses = [];
    for (const app of [a, b, a, b, a]) statuses.push((await login(app)).status);
    // Three attempts allowed in the window across both instances, then 429 from either.
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    const limited = await login(b);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    expect(limited.headers["ratelimit-policy"] ?? limited.headers["ratelimit"]).toBeDefined();
  });
});

describe("per-account sign-in limits", () => {
  it("stop password guessing spread across many IPs, without blocking other accounts", async () => {
    const ctx = makeApp({
      config: { RATE_LIMIT_STORE: "mongo", RATE_LIMIT_ACCOUNT_MAX: "3", TRUST_PROXY: "1" },
    });
    await seedReference(ctx);
    await createVerifiedUser(ctx, "victim@example.com");
    await createVerifiedUser(ctx, "other@example.com");
    const attempt = (email: string, password: string, ip: string) =>
      ctx.http().post("/api/v1/auth/login").set("X-Forwarded-For", ip).send({ email, password });
    // A correct sign-in does not count.
    await attempt("victim@example.com", "healthy-nation-1", "198.51.100.1").expect(200);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (await attempt("VICTIM@example.com ", "guess-123456", `203.0.113.${i + 1}`)).status,
      );
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);
    // Even the right password is refused while the account is cooling down…
    expect((await attempt("victim@example.com", "healthy-nation-1", "198.51.100.9")).status).toBe(
      429,
    );
    // …but other accounts are unaffected.
    await attempt("other@example.com", "healthy-nation-1", "203.0.113.1").expect(200);
  });
});

const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)("S3 media storage (S3-compatible test server)", () => {
  it("stores, serves and deletes uploads through S3", async () => {
    const bucket = `ahq-test-${Date.now()}`;
    const s3 = new S3Client({
      region: "us-east-1",
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    const storage = new S3Storage(s3, bucket, "media/");

    await storage.put("unit/a.png", PNG_1X1);
    expect(await storage.get("unit/a.png")).toEqual(PNG_1X1);
    await expect(storage.put("unit/a.png", PNG_1X1)).rejects.toThrow(); // write-once
    expect(await storage.get("unit/missing.png")).toBeNull();
    await storage.delete("unit/a.png");
    expect(await storage.get("unit/a.png")).toBeNull();
    await expect(storage.put("../escape.png", PNG_1X1)).rejects.toThrow("invalid storage key");

    // Through the API: upload as an admin, then serve publicly.
    const ctx = makeApp({ storage });
    await seedReference(ctx);
    const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
    const up = await ctx
      .http()
      .post("/api/v1/admin/media?purpose=country_flag&filename=flag.png")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("Content-Type", "image/png")
      .send(PNG_1X1)
      .expect(201);
    const served = await ctx.http().get(up.body.url).expect(200);
    expect(Buffer.from(served.body)).toEqual(PNG_1X1);
    // The object really is in the bucket, not on local disk.
    const { MediaAssetModel } = await import("../../src/modules/media/media.model.js");
    const asset = await MediaAssetModel.findById(up.body.id).lean();
    expect(await storage.get(asset!.storageKey)).toEqual(PNG_1X1);
  });
});

describe("production configuration rules", () => {
  const base = {
    NODE_ENV: "production",
    MONGODB_URI: "mongodb+srv://cluster.example.mongodb.net/ahq",
    JWT_ACCESS_SECRET: "p".repeat(48),
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    WEB_APP_URL: "https://app.example.org",
    CORS_ORIGINS: "https://app.example.org",
    MAIL_TRANSPORT: "smtp",
    SMTP_URL: "smtps://user:pass@smtp.example.org:465",
    AI_PROVIDER: "disabled",
    MEDIA_STORAGE_DRIVER: "s3",
    S3_MEDIA_BUCKET: "ahq-media",
    AWS_REGION: "eu-west-1",
    RATE_LIMIT_STORE: "mongo",
  };
  it("accepts a complete production configuration", () => {
    expect(() => loadConfig(base)).not.toThrow();
  });
  it.each([
    ["local media storage", { MEDIA_STORAGE_DRIVER: "local" }],
    ["per-process rate limits", { RATE_LIMIT_STORE: "memory" }],
    ["the fake AI provider", { AI_PROVIDER: "fake" }],
    ["file mail", { MAIL_TRANSPORT: "file" }],
    ["S3 without a bucket", { S3_MEDIA_BUCKET: "" }],
  ])("refuses %s", (_name, override) => {
    expect(() => loadConfig({ ...base, ...override })).toThrow();
  });
});
