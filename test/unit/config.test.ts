import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";

const base = {
  MONGODB_URI: "mongodb://x",
  JWT_ACCESS_SECRET: "s".repeat(32),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};

describe("configuration", () => {
  it("applies safe defaults", () => {
    const c = loadConfig(base);
    expect(c.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(c.cookieSecure).toBe(false);
    expect(c.corsOrigins).toEqual(["http://localhost:5173"]);
  });
  it("refuses short secrets and missing database", () => {
    expect(() => loadConfig({ ...base, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => loadConfig({ JWT_ACCESS_SECRET: "s".repeat(32) })).toThrow(/MONGODB_URI/);
  });
  it("enforces production requirements", () => {
    expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(
      /MAIL_TRANSPORT[\s\S]*CORS_ORIGINS/,
    );
    const prod = loadConfig({
      ...base,
      NODE_ENV: "production",
      MAIL_TRANSPORT: "smtp",
      SMTP_URL: "smtp://u:p@mail:587",
      CORS_ORIGINS: "https://app.example.org, https://admin.example.org",
      MEDIA_STORAGE_DRIVER: "s3",
      S3_MEDIA_BUCKET: "ahq-media",
      AWS_REGION: "eu-west-1",
      RATE_LIMIT_STORE: "mongo",
    });
    expect(prod.cookieSecure).toBe(true);
    expect(prod.corsOrigins).toEqual(["https://app.example.org", "https://admin.example.org"]);
  });
});
