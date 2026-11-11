import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../../src/app.js";
import { seedReferenceData } from "../../src/db/seed.js";
import { loadConfig } from "../../src/config/env.js";
import { createLogger } from "../../src/lib/logger.js";
import { UserModel } from "../../src/modules/users/user.model.js";
import { LogMailer } from "../../src/services/mailer.js";
import type { GoogleVerifier } from "../../src/services/google.js";
import type { ClaudeClient } from "../../src/modules/ai/claude-client.js";
import type { PushSender } from "../../src/modules/notifications/push.js";
import type { ObjectStorage } from "../../src/modules/media/storage.js";

export const MONGO_TEST_URL =
  process.env.MONGO_TEST_URL ?? "mongodb://127.0.0.1:27017/?directConnection=true";

export function testConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    MONGODB_URI: "unused-in-tests",
    JWT_ACCESS_SECRET: "test-secret-test-secret-test-secret-123",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    MFA_REQUIRED_FOR_STAFF: "false",
    MEDIA_STORAGE_DIR: join(tmpdir(), "ahq-test-media"),
    WEB_APP_URL: "http://localhost:5173",
    RATE_LIMIT_AUTH_MAX: "1000",
    ...overrides,
  });
}

/** Spins up an isolated database per test file and a fresh app per call. */
export function useTestDatabase() {
  const dbName = `ahq_test_${randomUUID().slice(0, 8)}`;
  beforeAll(async () => {
    await mongoose.connect(MONGO_TEST_URL, { dbName, serverSelectionTimeoutMS: 5000 });
    await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export function makeApp(
  opts: {
    config?: Record<string, string>;
    google?: GoogleVerifier | null;
    aiClient?: ClaudeClient | null;
    pushSender?: PushSender;
    storage?: ObjectStorage;
  } = {},
) {
  const config = testConfig(opts.config);
  const logger = createLogger(process.env.TEST_LOG ?? "silent");
  const mailer = new LogMailer(logger);
  const { app, services } = createApp({
    config,
    logger,
    mailer,
    google: opts.google ?? null,
    aiClient: opts.aiClient === undefined ? null : opts.aiClient,
    ...(opts.pushSender ? { pushSender: opts.pushSender } : {}),
    ...(opts.storage ? { storage: opts.storage } : {}),
  });
  return { app, mailer, config, services, http: () => request(app) };
}

export function tokenFromMail(mailer: LogMailer, to: string) {
  const mail = [...mailer.sent].reverse().find((m) => m.to === to);
  const match = mail?.text.match(/token=([\w-]+)/);
  if (!match?.[1]) throw new Error(`No token mail for ${to}`);
  return match[1];
}

export function refreshCookie(res: request.Response) {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const c = raw?.find((x) => x.startsWith("ahq_rt="));
  return c?.split(";")[0];
}

export const PASSWORD = "healthy-nation-1";

/** Registers, verifies and signs in a user; returns the access token. */
export async function createVerifiedUser(
  ctx: ReturnType<typeof makeApp>,
  email: string,
  roles?: ("player" | "reviewer" | "admin")[],
) {
  await ctx
    .http()
    .post("/api/v1/auth/register")
    .send({ email, password: PASSWORD, displayName: "Test" })
    .expect(202);
  const token = tokenFromMail(ctx.mailer, email);
  await ctx.http().post("/api/v1/auth/verify-email").send({ token }).expect(200);
  if (roles) await UserModel.updateOne({ email }, { $set: { roles } });
  const login = await ctx
    .http()
    .post("/api/v1/auth/login")
    .set("X-Client-Platform", "mobile")
    .send({ email, password: PASSWORD })
    .expect(200);
  return {
    accessToken: login.body.accessToken as string,
    refreshToken: login.body.refreshToken as string,
    user: login.body.user,
  };
}

/** Seeds roles, settings and the 54 countries into the test database. */
export async function seedReference(ctx: ReturnType<typeof makeApp>) {
  ctx.services.settings.clearCache();
  await seedReferenceData(ctx.services.settings);
}
