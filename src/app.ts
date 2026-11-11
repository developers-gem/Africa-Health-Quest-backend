import { API_PREFIX, buildOpenApiDocument, type HealthResponse } from "@ahq/api-contracts";
import { API_VERSION, type Permission } from "@ahq/shared-types";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router, type RequestHandler } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { pinoHttp } from "pino-http";
import type { Config } from "./config/env.js";
import { isDatabaseUp } from "./db/connect.js";
import type { Logger } from "./lib/logger.js";
import {
  authenticate,
  optionalAuthenticate,
  requireMfa,
  requirePermission,
  requireRecentAuth,
  requireRegistered,
} from "./middleware/authenticate.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { adminOpsRouter } from "./modules/admin/admin-ops.routes.js";
import { adminUsersRouter } from "./modules/admin/admin-users.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { MfaService } from "./modules/auth/mfa.service.js";
import { SessionService } from "./modules/auth/session.service.js";
import { TokenService } from "./modules/auth/token.service.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { countriesRouter } from "./modules/countries/countries.routes.js";
import { CountriesService } from "./modules/countries/countries.service.js";
import { adminPlayersRouter } from "./modules/players/admin-players.routes.js";
import { playersRouter } from "./modules/players/players.routes.js";
import { ProfileService } from "./modules/players/profile.service.js";
import { ProgressService } from "./modules/players/progress.service.js";
import { SettingsService } from "./modules/settings/settings.service.js";
import { attemptHistoryRouter, attemptsRouter } from "./modules/gameplay/gameplay.routes.js";
import { GameplayService } from "./modules/gameplay/gameplay.service.js";
import { missionsRouter } from "./modules/missions/missions.routes.js";
import { MissionsService } from "./modules/missions/missions.service.js";
import { AuthoringService } from "./modules/missions/authoring.service.js";
import { adminCountriesRouter } from "./modules/countries/admin-countries.routes.js";
import { adminMediaRouter, publicMediaRouter } from "./modules/media/media.routes.js";
import { MediaService } from "./modules/media/media.service.js";
import { S3Client } from "@aws-sdk/client-s3";
import compression from "compression";
import { LocalDiskStorage, S3Storage, type ObjectStorage } from "./modules/media/storage.js";
import { adminHospitalRouter, hospitalRouter } from "./modules/hospital/hospital.routes.js";
import { HospitalService } from "./modules/hospital/hospital.service.js";
import {
  adminCliniciansRouter,
  clinicianProfileRouter,
} from "./modules/reviews/clinicians.routes.js";
import { CliniciansService } from "./modules/reviews/clinicians.service.js";
import { adminContentRouter, reviewRouter } from "./modules/reviews/reviews.routes.js";
import { ReviewsService } from "./modules/reviews/reviews.service.js";
import { idempotency } from "./middleware/idempotency.js";
import { adminAiRouter, aiRouter, reviewAiRouter } from "./modules/ai/ai.routes.js";
import { AiService } from "./modules/ai/ai.service.js";
import {
  adminAnnouncementsRouter,
  notificationsRouter,
} from "./modules/notifications/notifications.routes.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { pushSenderFrom, type PushSender } from "./modules/notifications/push.js";
import {
  AnthropicClaudeClient,
  FakeClaudeClient,
  type ClaudeClient,
} from "./modules/ai/claude-client.js";
import { catalogRouter, syncRouter } from "./modules/sync/sync.routes.js";
import { SyncService } from "./modules/sync/sync.service.js";
import { GoogleIdTokenVerifier, type GoogleVerifier } from "./services/google.js";
import { FileMailer, LogMailer, SmtpMailer, type Mailer } from "./services/mailer.js";

export { API_VERSION };

export type AppDeps = {
  config: Config;
  logger: Logger;
  mailer?: Mailer;
  google?: GoogleVerifier | null;
  /** AI provider override (tests pass a FakeClaudeClient); defaults from AI_PROVIDER. */
  aiClient?: ClaudeClient | null;
  /** Push sender override (tests pass a FakePushSender); defaults to FCM when configured. */
  pushSender?: PushSender;
  /** Media storage override (tests). */
  storage?: ObjectStorage;
};

/** Middleware building blocks shared by every module router. */
export type Guards = {
  authn: RequestHandler;
  registered: RequestHandler;
  recentAuth: RequestHandler;
  mfa: RequestHandler;
  /** Signed-in staff with verified MFA holding all listed permissions. */
  staff: (...p: Permission[]) => RequestHandler[];
  can: (...p: Permission[]) => RequestHandler;
};

export function createApp({ config, logger, ...overrides }: AppDeps) {
  const mailer =
    overrides.mailer ??
    (config.MAIL_TRANSPORT === "smtp"
      ? new SmtpMailer(config.SMTP_URL!, config.MAIL_FROM)
      : config.MAIL_TRANSPORT === "file"
        ? new FileMailer(config.MAIL_FILE_DIR)
        : new LogMailer(logger));
  const google =
    overrides.google !== undefined
      ? overrides.google
      : config.GOOGLE_CLIENT_IDS.length
        ? new GoogleIdTokenVerifier(config.GOOGLE_CLIENT_IDS)
        : null;

  const tokens = new TokenService(config);
  const sessions = new SessionService(config);
  const mfa = new MfaService(config);
  const auth = new AuthService(config, tokens, sessions, mailer, google, logger);
  const settings = new SettingsService();
  const countries = new CountriesService();
  const progress = new ProgressService(settings, countries);
  const profiles = new ProfileService();
  const missions = new MissionsService(settings);
  const gameplay = new GameplayService(settings, missions, progress);
  const authoring = new AuthoringService(missions);
  const clinicians = new CliniciansService(config);
  const reviews = new ReviewsService(missions, authoring);
  const hospital = new HospitalService(settings, progress);
  const sync = new SyncService({
    gameplay,
    hospital,
    profiles,
    progress,
    settings,
    tokens,
    sessions,
  });
  const media = new MediaService(
    overrides.storage ??
      (config.MEDIA_STORAGE_DRIVER === "s3"
        ? new S3Storage(
            new S3Client({
              region: config.AWS_REGION!,
              ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT, forcePathStyle: true } : {}),
            }),
            config.S3_MEDIA_BUCKET!,
            config.S3_MEDIA_PREFIX,
          )
        : new LocalDiskStorage(config.MEDIA_STORAGE_DIR)),
  );
  const idempotent = idempotency(logger);
  const aiClient =
    overrides.aiClient !== undefined
      ? overrides.aiClient
      : config.aiProvider === "anthropic"
        ? new AnthropicClaudeClient(config.ANTHROPIC_API_KEY!)
        : config.aiProvider === "fake"
          ? new FakeClaudeClient()
          : null;
  const ai = new AiService(settings, aiClient, logger);
  const notifications = new NotificationsService(
    overrides.pushSender ?? pushSenderFrom(config),
    logger,
  );
  // Rewards and their notifications commit in one transaction; pushes go out after the commit (outbox).
  progress.onAwarded = async (userId, result, session) => {
    for (const a of result.achievements) {
      await notifications.create(
        [userId],
        {
          type: "achievement",
          title: "Achievement unlocked! 🏅",
          body: a.name,
          route: "/play/achievements",
        },
        session,
      );
    }
    for (const t of result.newlyUnlocked.tiers) {
      await notifications.create(
        [userId],
        {
          type: "level_up",
          title: `${t.icon} You reached ${t.name}`,
          body: "New cases are open in Story Mode.",
          route: "/play/story",
        },
        session,
      );
    }
    if (result.newlyUnlocked.countries.length) {
      await notifications.create(
        [userId],
        {
          type: "country_unlocked",
          title: "🌍 New country unlocked",
          body: `You can now work in: ${result.newlyUnlocked.countries.join(", ")}.`,
          route: "/play/countries",
        },
        session,
      );
    }
  };
  ai.onReady = async (userId, attemptId) => {
    await notifications.create([userId], {
      type: "debrief_ready",
      title: "🧠 Your debrief is ready",
      body: "Personalised feedback on your last case is waiting.",
      route: `/play/attempts/${attemptId}`,
    });
  };

  const authn = authenticate(tokens, sessions);
  const mfaGuard = requireMfa(config);
  const guards: Guards = {
    authn,
    registered: requireRegistered,
    recentAuth: requireRecentAuth(config),
    mfa: mfaGuard,
    can: (...p) => requirePermission(...p),
    staff: (...p) => [authn, requirePermission(...p), mfaGuard],
  };
  const limiterStore = { store: config.RATE_LIMIT_STORE, logger };
  const authLimiter = createRateLimiter(config.RATE_LIMIT_WINDOW_MS, config.RATE_LIMIT_AUTH_MAX, {
    ...limiterStore,
    name: "auth",
  });
  // Per-account limits on failed sign-ins and two-factor codes, so guessing can't be spread across many IPs.
  const accountLimiter = (name: string, key: (req: express.Request) => string | undefined) =>
    createRateLimiter(config.RATE_LIMIT_WINDOW_MS, config.RATE_LIMIT_ACCOUNT_MAX, {
      ...limiterStore,
      name,
      key,
      failuresOnly: true,
    });
  const loginAccountLimiter = accountLimiter("login-account", (req) => {
    const email = (req.body as { email?: unknown } | undefined)?.email;
    return typeof email === "string" ? `email:${email.trim().toLowerCase()}` : undefined;
  });
  const mfaAccountLimiter = accountLimiter("mfa-account", (req) =>
    req.auth?.user.id ? `user:${String(req.auth.user.id)}` : undefined,
  );
  // Decision A-7: the general per-IP API limit is a coarse safety net per instance (the AWS WAF rate rule is
  // the shared coarse limit); brute-force-sensitive auth limits are shared across instances in MongoDB.
  const apiLimiter = createRateLimiter(60_000, config.RATE_LIMIT_API_MAX, { name: "api" });

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY);
  app.use((req, res, next) => {
    const incoming = req.get("x-request-id");
    req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader("x-request-id", req.requestId);
    res.setHeader("x-server-time", new Date().toISOString());
    next();
  });
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: { ignore: (req) => req.url === "/health" },
      customProps: (req) => ({ userId: (req as express.Request).auth?.user.id }),
    }),
  );
  app.use(helmet());
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Client-Platform",
        "X-App-Version",
        "X-Request-Id",
        "Idempotency-Key",
      ],
      exposedHeaders: ["X-Request-Id", "X-Server-Time", "Idempotency-Replayed"],
    }),
  );
  // gzip/brotli for JSON over slow mobile networks (catalogue/country lists shrink ~5x); media is already compressed.
  app.use(compression({ threshold: 1024 }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", version: API_VERSION } satisfies HealthResponse);
  });
  app.get("/ready", (_req, res) => {
    const up = isDatabaseUp();
    const body: HealthResponse = {
      status: up ? "ok" : "degraded",
      version: API_VERSION,
      database: up ? "up" : "down",
    };
    res.status(up ? 200 : 503).json(body);
  });
  app.use("/media", publicMediaRouter({ media }));
  const openapi = buildOpenApiDocument(API_VERSION);
  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });

  const api = Router();
  api.use(apiLimiter);
  api.use(
    "/auth",
    authRouter({
      config,
      auth,
      sessions,
      mfa,
      authenticate: authn,
      requireRegistered,
      requireRecentAuth: guards.recentAuth,
      limiter: authLimiter,
      loginAccountLimiter,
      mfaAccountLimiter,
    }),
  );
  api.use("/users", usersRouter({ authenticate: authn }));
  api.use("/players", playersRouter({ authn, profiles, progress }));
  api.use("/players", attemptHistoryRouter({ authn, gameplay }));
  api.use(
    "/missions",
    missionsRouter({ missions, progress, optionalAuth: optionalAuthenticate(authn), authn }),
  );
  api.use("/attempts", attemptsRouter({ authn, gameplay, idempotent }));
  api.use("/hospital", hospitalRouter({ authn, hospital, idempotent }));
  api.use(
    "/users",
    clinicianProfileRouter({ authn, registered: requireRegistered, clinicians, media }),
  );
  api.use("/review", authn, mfaGuard, reviewRouter({ can: guards.can, reviews }));
  api.use("/review", authn, mfaGuard, reviewAiRouter({ can: guards.can, ai }));
  api.use(aiRouter({ authn, idempotent, ai }));
  api.use("/notifications", notificationsRouter({ authn, notifications }));
  api.use("/sync", syncRouter({ authn, registered: requireRegistered, idempotent, sync }));
  api.use(
    "/catalog",
    catalogRouter({
      config,
      optionalAuth: optionalAuthenticate(authn),
      settings,
      countries,
      missions,
      progress,
      hospital,
    }),
  );
  api.use(
    "/countries",
    countriesRouter({ countries, progress, optionalAuth: optionalAuthenticate(authn) }),
  );

  const admin = Router();
  admin.use(authn, mfaGuard);
  admin.use(
    "/users",
    adminUsersRouter({ sessions, can: guards.can, requireRecentAuth: guards.recentAuth }),
  );
  admin.use(
    adminPlayersRouter({ can: guards.can, recentAuth: guards.recentAuth, profiles, progress }),
  );
  admin.use("/countries", adminCountriesRouter({ can: guards.can, countries, media, authoring }));
  admin.use("/media", adminMediaRouter({ media, can: guards.can }));
  admin.use("/hospital", adminHospitalRouter({ can: guards.can, hospital }));
  admin.use(
    "/clinicians",
    adminCliniciansRouter({ can: guards.can, recentAuth: guards.recentAuth, clinicians }),
  );
  admin.use(
    adminContentRouter({ can: guards.can, recentAuth: guards.recentAuth, authoring, reviews }),
  );
  admin.use(adminAiRouter({ can: guards.can, ai }));
  admin.use(
    adminAnnouncementsRouter({ can: guards.can, recentAuth: guards.recentAuth, notifications }),
  );
  admin.use(adminOpsRouter({ can: guards.can, recentAuth: guards.recentAuth, settings, media }));
  api.use("/admin", admin);

  app.use(API_PREFIX, api);
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return {
    app,
    services: {
      auth,
      tokens,
      sessions,
      mfa,
      mailer,
      settings,
      countries,
      progress,
      profiles,
      missions,
      gameplay,
      authoring,
      media,
      hospital,
      clinicians,
      reviews,
      sync,
      ai,
      notifications,
    },
    guards,
  };
}
