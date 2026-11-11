import { z } from "@ahq/api-contracts";

const bool = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");
const csv = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    /** 32 random bytes, base64. Encrypts MFA secrets and other sensitive fields at rest. */
    DATA_ENCRYPTION_KEY: z
      .string()
      .refine(
        (v) => Buffer.from(v, "base64").length === 32,
        "DATA_ENCRYPTION_KEY must be 32 bytes, base64-encoded",
      ),
    MFA_REQUIRED_FOR_STAFF: bool.default(true),
    STEP_UP_MAX_AGE_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    GUEST_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    WEB_APP_URL: z.url().default("http://localhost:5173"),
    CORS_ORIGINS: csv,
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
    MAIL_TRANSPORT: z.enum(["log", "smtp", "file"]).default("log"),
    /** MAIL_TRANSPORT=file (development/E2E only): each message is written as JSON to this directory. */
    MAIL_FILE_DIR: z.string().default("./var/mail"),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default("Africa Health Quest <no-reply@africahealthquest.local>"),
    GOOGLE_CLIENT_IDS: csv,
    MIN_APP_VERSION_ANDROID: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default("0.1.0"),
    MIN_APP_VERSION_IOS: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .default("0.1.0"),
    WORKER_INTERVAL_MINUTES: z.coerce.number().int().min(1).max(1440).default(60),
    ATTEMPT_MAX_AGE_DAYS: z.coerce.number().int().min(1).max(90).default(7),
    /** AI debriefs: "anthropic" (needs ANTHROPIC_API_KEY), "fake" (deterministic test output, never in production) or "disabled". */
    AI_PROVIDER: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.enum(["anthropic", "fake", "disabled"]).optional(),
    ),
    /** Base64 Firebase service-account JSON for push notifications (FCM). Without it, notifications are in-app only. */
    FIREBASE_SERVICE_ACCOUNT_JSON: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(20).optional(),
    ),
    ANTHROPIC_API_KEY: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z.string().min(1).optional(),
    ),
    /** "s3" in production (shared by all instances); "local" for development and tests. */
    MEDIA_STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    MEDIA_STORAGE_DIR: z.string().default("./var/media"),
    /** Private bucket for uploads; credentials come from the AWS default chain (ECS task role), never env files. */
    S3_MEDIA_BUCKET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(3).optional()),
    S3_MEDIA_PREFIX: z.string().default(""),
    AWS_REGION: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(2).optional()),
    /** S3-compatible endpoint for local testing only (e.g. moto/MinIO). Leave unset for AWS. */
    S3_ENDPOINT: z.preprocess((v) => (v === "" ? undefined : v), z.url().optional()),
    /** "mongo" shares rate-limit counters across API instances (decision A-7); "memory" is per process. */
    RATE_LIMIT_STORE: z.enum(["memory", "mongo"]).default("memory"),
    RATE_LIMIT_WINDOW_MS: z.coerce
      .number()
      .int()
      .min(1000)
      .default(15 * 60 * 1000),
    RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(20),
    RATE_LIMIT_API_MAX: z.coerce.number().int().min(1).default(600),
    /** Failed sign-ins per email, and failed two-factor codes per user, per RATE_LIMIT_WINDOW_MS. */
    RATE_LIMIT_ACCOUNT_MAX: z.coerce.number().int().min(1).default(10),
  })
  .superRefine((e, ctx) => {
    if (e.MAIL_TRANSPORT === "smtp" && !e.SMTP_URL) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_URL"],
        message: "SMTP_URL is required when MAIL_TRANSPORT=smtp",
      });
    }
    if (e.NODE_ENV === "production" && e.MAIL_TRANSPORT === "file") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message: "MAIL_TRANSPORT=file is not allowed in production",
      });
    }
    if (e.NODE_ENV === "production" && e.MAIL_TRANSPORT === "log") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_TRANSPORT"],
        message: "MAIL_TRANSPORT=log is not allowed in production",
      });
    }
    if (e.MEDIA_STORAGE_DRIVER === "s3" && (!e.S3_MEDIA_BUCKET || !e.AWS_REGION)) {
      ctx.addIssue({
        code: "custom",
        path: ["S3_MEDIA_BUCKET"],
        message: "MEDIA_STORAGE_DRIVER=s3 needs S3_MEDIA_BUCKET and AWS_REGION",
      });
    }
    if (e.NODE_ENV === "production" && e.MEDIA_STORAGE_DRIVER !== "s3") {
      ctx.addIssue({
        code: "custom",
        path: ["MEDIA_STORAGE_DRIVER"],
        message: "Production must store media in S3 (container disks are not durable or shared)",
      });
    }
    if (e.NODE_ENV === "production" && e.RATE_LIMIT_STORE !== "mongo") {
      ctx.addIssue({
        code: "custom",
        path: ["RATE_LIMIT_STORE"],
        message:
          "Production must use RATE_LIMIT_STORE=mongo so sign-in limits hold across API instances",
      });
    }
    if (e.NODE_ENV === "production" && e.AI_PROVIDER === "fake") {
      ctx.addIssue({
        code: "custom",
        path: ["AI_PROVIDER"],
        message: "AI_PROVIDER=fake is not allowed in production",
      });
    }
    if (e.AI_PROVIDER === "anthropic" && !e.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["ANTHROPIC_API_KEY"],
        message: "ANTHROPIC_API_KEY is required when AI_PROVIDER=anthropic",
      });
    }
    if (e.NODE_ENV === "production" && e.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["CORS_ORIGINS"],
        message: "CORS_ORIGINS is required in production",
      });
    }
  });

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  return {
    ...e,
    isProduction: e.NODE_ENV === "production",
    aiProvider: e.AI_PROVIDER ?? (e.ANTHROPIC_API_KEY ? "anthropic" : "disabled"),
    cookieSecure: e.COOKIE_SECURE ?? e.NODE_ENV === "production",
    corsOrigins: e.CORS_ORIGINS.length ? e.CORS_ORIGINS : [e.WEB_APP_URL],
  };
}
