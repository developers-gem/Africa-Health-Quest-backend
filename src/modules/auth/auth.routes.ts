import {
  CLIENT_PLATFORM_HEADER,
  ClientPlatformSchema,
  EmailRequestSchema,
  GoogleLoginRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  MfaChallengeRequestSchema,
  MfaCodeRequestSchema,
  ObjectIdSchema,
  REFRESH_COOKIE_NAME,
  ReauthenticateRequestSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  TokenRequestSchema,
  z,
  type MessageResponse,
  type SessionListResponse,
} from "@ahq/api-contracts";
import { Router, type Request, type RequestHandler, type Response } from "express";
import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import {
  GENERIC_EMAIL_MESSAGE,
  REGISTER_MESSAGE,
  type AuthService,
  type IssuedSession,
} from "./auth.service.js";
import type { MfaService } from "./mfa.service.js";
import type { ClientMeta, SessionService } from "./session.service.js";

const COOKIE_PATH = "/api/v1/auth";

export function authRouter(deps: {
  config: Config;
  auth: AuthService;
  sessions: SessionService;
  mfa: MfaService;
  authenticate: RequestHandler;
  requireRegistered: RequestHandler;
  requireRecentAuth: RequestHandler;
  limiter: RequestHandler;
  /** Failed sign-ins per email (shared across instances). */
  loginAccountLimiter?: RequestHandler;
  /** Failed two-factor codes per user (shared across instances). */
  mfaAccountLimiter?: RequestHandler;
}) {
  const noop: RequestHandler = (_req, _res, next) => next();
  const loginAccount = deps.loginAccountLimiter ?? noop;
  const mfaAccount = deps.mfaAccountLimiter ?? noop;
  const {
    config,
    auth,
    sessions,
    mfa,
    authenticate,
    requireRegistered,
    requireRecentAuth,
    limiter,
  } = deps;
  const r = Router();

  const platform = (req: Request) => {
    const p = ClientPlatformSchema.safeParse(req.get(CLIENT_PLATFORM_HEADER) ?? "web");
    return p.success ? p.data : "web";
  };
  const meta = (req: Request): ClientMeta => ({
    platform: platform(req),
    userAgent: req.get("user-agent"),
    appVersion: req.get("x-app-version"),
    ip: req.ip,
  });
  const cookieOpts = {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "strict" as const,
    path: COOKIE_PATH,
  };
  /** Web gets the refresh token as an httpOnly cookie; mobile gets it in the body for secure storage. */
  const sendSession = (req: Request, res: Response, s: IssuedSession, status = 200) => {
    if (platform(req) === "mobile") {
      res.status(status).json({ ...s.auth, refreshToken: s.refreshToken });
      return;
    }
    res.cookie(REFRESH_COOKIE_NAME, s.refreshToken, { ...cookieOpts, maxAge: 180 * 86_400_000 });
    res.status(status).json(s.auth);
  };
  const readRefreshToken = (req: Request, bodyToken: string | undefined): string | undefined =>
    bodyToken ?? (req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);
  const msg = (res: Response, message: string, status = 200) =>
    res.status(status).json({ message } satisfies MessageResponse);

  r.post("/register", limiter, async (req, res) => {
    await auth.register(parseBody(req, RegisterRequestSchema));
    msg(res, REGISTER_MESSAGE, 202);
  });

  r.post("/verify-email", limiter, async (req, res) => {
    await auth.verifyEmail(parseBody(req, TokenRequestSchema).token);
    msg(res, "Email confirmed. You can now sign in.");
  });

  r.post("/resend-verification", limiter, async (req, res) => {
    await auth.resendVerification(parseBody(req, EmailRequestSchema).email);
    msg(res, GENERIC_EMAIL_MESSAGE);
  });

  r.post("/login", limiter, loginAccount, async (req, res) => {
    const { email, password } = parseBody(req, LoginRequestSchema);
    sendSession(req, res, await auth.login(email, password, meta(req)));
  });

  r.post("/google", limiter, async (req, res) => {
    const { idToken } = parseBody(req, GoogleLoginRequestSchema);
    sendSession(req, res, await auth.loginWithGoogle(idToken, meta(req)));
  });

  r.post("/guest", limiter, async (req, res) => {
    sendSession(req, res, await auth.createGuest(meta(req)), 201);
  });

  r.post("/guest/upgrade", limiter, authenticate, async (req, res) => {
    const input = parseBody(req, RegisterRequestSchema);
    res.json(await auth.upgradeGuest(requireAuth(req).user, input));
  });

  r.post("/refresh", limiter, async (req, res) => {
    const token = readRefreshToken(req, parseBody(req, RefreshRequestSchema).refreshToken);
    if (!token) throw AppError.unauthenticated("Your session has ended. Please sign in again.");
    try {
      sendSession(req, res, await auth.refresh(token));
    } catch (e) {
      res.clearCookie(REFRESH_COOKIE_NAME, cookieOpts);
      throw e;
    }
  });

  r.post("/logout", async (req, res) => {
    await auth.logout(readRefreshToken(req, parseBody(req, LogoutRequestSchema).refreshToken));
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOpts);
    msg(res, "Signed out.");
  });

  r.post("/logout-all", authenticate, async (req, res) => {
    const { user } = requireAuth(req);
    await sessions.revokeAllForUser(user.id as string, "logout_all");
    res.clearCookie(REFRESH_COOKIE_NAME, cookieOpts);
    msg(res, "Signed out on every device.");
  });

  r.get("/sessions", authenticate, async (req, res) => {
    const { user, session } = requireAuth(req);
    const items = (await sessions.listForUser(user.id as string)).map((s) => ({
      id: s.id as string,
      platform: s.device!.platform as "web" | "mobile",
      userAgent: s.device?.userAgent ?? null,
      appVersion: s.device?.appVersion ?? null,
      createdAt: (s.get("createdAt") as Date).toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === session.id,
    }));
    res.json({ items } satisfies SessionListResponse);
  });

  r.delete("/sessions/:id", authenticate, async (req, res) => {
    const { id } = parseParams(req, z.object({ id: ObjectIdSchema }));
    const { user } = requireAuth(req);
    const target = await sessions.findActive(id, user.id as string);
    if (!target) throw AppError.notFound("Session not found.");
    await sessions.revoke(id, "user_revoked");
    res.status(204).end();
  });

  r.post("/reauthenticate", limiter, authenticate, requireRegistered, async (req, res) => {
    const { user, session } = requireAuth(req);
    res.json(await auth.reauthenticate(user, session, parseBody(req, ReauthenticateRequestSchema)));
  });

  r.post("/forgot-password", limiter, async (req, res) => {
    await auth.forgotPassword(parseBody(req, EmailRequestSchema).email);
    msg(res, GENERIC_EMAIL_MESSAGE);
  });

  r.post("/reset-password", limiter, async (req, res) => {
    const { token, password } = parseBody(req, ResetPasswordRequestSchema);
    await auth.resetPassword(token, password);
    msg(res, "Password changed. Please sign in again on all your devices.");
  });

  // ---- MFA ------------------------------------------------------------------------------
  r.post(
    "/mfa/totp/setup",
    limiter,
    authenticate,
    requireRegistered,
    requireRecentAuth,
    async (req, res) => {
      res.json(await mfa.beginSetup(requireAuth(req).user.id as string));
    },
  );

  r.post(
    "/mfa/totp/verify",
    limiter,
    authenticate,
    mfaAccount,
    requireRegistered,
    async (req, res) => {
      const { user, session } = requireAuth(req);
      const result = await mfa.confirmSetup(
        user.id as string,
        parseBody(req, MfaCodeRequestSchema).code,
      );
      await sessions.markMfaVerified(session.id as string);
      await recordAudit({
        actorId: user.id as string,
        action: "auth.mfa.enabled",
        targetType: "User",
        targetId: user.id as string,
        requestId: req.requestId,
      });
      res.json(result);
    },
  );

  r.post(
    "/mfa/challenge",
    limiter,
    authenticate,
    mfaAccount,
    requireRegistered,
    async (req, res) => {
      const { user, session } = requireAuth(req);
      const { method } = await mfa.verify(
        user.id as string,
        parseBody(req, MfaChallengeRequestSchema),
      );
      await sessions.markMfaVerified(session.id as string);
      if (method === "recovery_code") {
        await recordAudit({
          actorId: user.id as string,
          action: "auth.mfa.recovery_code_used",
          targetType: "User",
          targetId: user.id as string,
          requestId: req.requestId,
        });
      }
      msg(res, "Two-factor verification complete.");
    },
  );

  r.delete(
    "/mfa",
    limiter,
    authenticate,
    requireRegistered,
    requireRecentAuth,
    async (req, res) => {
      const { user } = requireAuth(req);
      await mfa.disable(user.id as string, parseBody(req, MfaCodeRequestSchema).code);
      await recordAudit({
        actorId: user.id as string,
        action: "auth.mfa.disabled",
        targetType: "User",
        targetId: user.id as string,
        requestId: req.requestId,
      });
      res.status(204).end();
    },
  );

  return r;
}
