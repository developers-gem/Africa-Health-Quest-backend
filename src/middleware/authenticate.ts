import type { Permission } from "@ahq/shared-types";
import type { RequestHandler } from "express";
import type { Config } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { permissionsFor } from "../modules/auth/roles.js";
import type { SessionService } from "../modules/auth/session.service.js";
import type { TokenService } from "../modules/auth/token.service.js";
import { suspendedError } from "../modules/auth/auth.service.js";
import { UserModel, isStaff } from "../modules/users/user.model.js";

/**
 * Verifies the bearer token and loads the user and session on every request, so revoked sessions, role
 * changes and suspensions take effect immediately rather than when the access token expires.
 */
export function authenticate(tokens: TokenService, sessions: SessionService): RequestHandler {
  return async (req, _res, next) => {
    const match = req.headers.authorization?.match(/^Bearer\s+(\S+)$/i);
    if (!match?.[1]) throw AppError.unauthenticated();
    const claims = tokens.verifyAccessToken(match[1]);
    const [user, session] = await Promise.all([
      UserModel.findById(claims.userId).select("+mfa"),
      sessions.findActive(claims.sessionId, claims.userId),
    ]);
    if (!user) throw AppError.unauthenticated("Your session has ended. Please sign in again.");
    // Checked before the session so a suspended user learns why they were signed out.
    if (user.disabledAt) throw suspendedError();
    if (!session) throw AppError.unauthenticated("Your session has ended. Please sign in again.");
    req.auth = { user, session, permissions: permissionsFor(user.roles) };
    next();
  };
}

/** Non-guest accounts only (export, deletion, MFA, …). */
export const requireRegistered: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw AppError.unauthenticated();
  if (req.auth.user.isGuest) throw AppError.forbidden("Create an account to use this feature.");
  next();
};

/** Allows the request if the user holds every listed permission. Guests never hold staff permissions. */
export function requirePermission(...needed: Permission[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) throw AppError.unauthenticated();
    if (auth.user.isGuest || !needed.every((p) => auth.permissions.has(p)))
      throw AppError.forbidden();
    next();
  };
}

/** Staff must have verified MFA in this session (decision A-4). */
export function requireMfa(config: Config): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) throw AppError.unauthenticated();
    if (!config.MFA_REQUIRED_FOR_STAFF || !isStaff(auth.user.roles)) return next();
    if (!auth.user.mfa?.enabledAt) {
      throw new AppError(
        401,
        "MFA_REQUIRED",
        "Set up two-factor authentication to use staff features.",
        [{ path: "mfa", message: "setup_required" }],
      );
    }
    if (!auth.session.mfaVerifiedAt) {
      throw new AppError(401, "MFA_REQUIRED", "Enter your two-factor code to continue.", [
        { path: "mfa", message: "challenge_required" },
      ]);
    }
    next();
  };
}

/** Sensitive actions need a full authentication within the last STEP_UP_MAX_AGE_MINUTES. */
export function requireRecentAuth(config: Config): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth) throw AppError.unauthenticated();
    const age = Date.now() - auth.session.authenticatedAt.getTime();
    if (age > config.STEP_UP_MAX_AGE_MINUTES * 60_000) {
      throw new AppError(401, "STEP_UP_REQUIRED", "Please confirm it's you to continue.");
    }
    next();
  };
}

/** Authenticates when a bearer token is present; anonymous otherwise (public endpoints with personalisation). */
export function optionalAuthenticate(authn: RequestHandler): RequestHandler {
  return (req, res, next) => (req.headers.authorization ? authn(req, res, next) : next());
}
