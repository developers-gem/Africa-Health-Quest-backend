import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import { FileMailer } from "../../src/services/mailer.js";

describe("file mail transport (development/E2E)", () => {
  it("writes each message as JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ahq-mail-"));
    const m = new FileMailer(dir);
    await m.send({ to: "a@example.com", subject: "Hi", text: "token=abc" });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(JSON.parse(await readFile(join(dir, files[0]!), "utf8"))).toMatchObject({
      to: "a@example.com",
      text: "token=abc",
    });
  });

  it("is refused in production", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        MONGODB_URI: "x",
        JWT_ACCESS_SECRET: "x".repeat(40),
        DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
        CORS_ORIGINS: "https://example.org",
        MAIL_TRANSPORT: "file",
      }),
    ).toThrow(/MAIL_TRANSPORT=file is not allowed in production/);
  });
});
