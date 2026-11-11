import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";

const ISSUER = "ahq-api";
const AUDIENCE = "ahq-clients";

export type AccessClaims = { userId: string; sessionId: string };

/** Short-lived JWT access tokens bound to a session (claim `sid`). */
export class TokenService {
  constructor(private readonly config: Config) {}

  signAccessToken(userId: string, sessionId: string) {
    return jwt.sign({ sid: sessionId }, this.config.JWT_ACCESS_SECRET, {
      algorithm: "HS256",
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
      jwtid: randomUUID(),
    });
  }

  verifyAccessToken(token: string): AccessClaims {
    try {
      const payload = jwt.verify(token, this.config.JWT_ACCESS_SECRET, {
        algorithms: ["HS256"],
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      if (typeof payload === "string" || !payload.sub || typeof payload.sid !== "string") {
        throw new Error("bad payload");
      }
      return { userId: payload.sub, sessionId: payload.sid };
    } catch {
      throw AppError.unauthenticated("Your session has expired. Please sign in again.");
    }
  }
}
