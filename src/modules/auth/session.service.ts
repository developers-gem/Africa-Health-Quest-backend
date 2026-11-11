import type { ClientPlatform } from "@ahq/shared-types";
import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { hmacSha256, randomToken, sha256 } from "../../lib/crypto.js";
import { sessionPolicyFor } from "./roles.js";
import { SessionModel, type SessionDocument, type SessionRevokeReason } from "./session.model.js";

export type ClientMeta = {
  platform: ClientPlatform;
  userAgent?: string | undefined;
  appVersion?: string | undefined;
  ip?: string | undefined;
};

const HOUR = 3_600_000;
const DAY = 86_400_000;
const PREVIOUS_HASHES_KEPT = 5;
const ended = () => AppError.unauthenticated("Your session has ended. Please sign in again.");

export class SessionService {
  constructor(private readonly config: Config) {}

  async create(user: { id: string; roles: readonly string[] }, meta: ClientMeta) {
    const policy = sessionPolicyFor(user.roles);
    const now = Date.now();
    const absolute = now + policy.absoluteDays * DAY;
    const refreshToken = randomToken();
    const session = await SessionModel.create({
      userId: user.id,
      currentTokenHash: sha256(refreshToken),
      device: {
        platform: meta.platform,
        userAgent: meta.userAgent?.slice(0, 300),
        appVersion: meta.appVersion?.slice(0, 20),
      },
      ipHash: meta.ip ? hmacSha256(meta.ip, this.config.DATA_ENCRYPTION_KEY) : undefined,
      authenticatedAt: new Date(now),
      lastUsedAt: new Date(now),
      idleExpiresAt: new Date(Math.min(now + policy.idleHours * HOUR, absolute)),
      absoluteExpiresAt: new Date(absolute),
    });
    return { session, refreshToken };
  }

  /**
   * Atomically rotates a refresh token. Presenting a recently rotated token (theft or a client that refreshed
   * concurrently) revokes the session.
   */
  async rotate(
    refreshToken: string,
    rolesOf: (userId: string) => Promise<readonly string[] | null>,
  ) {
    const hash = sha256(refreshToken);
    const now = new Date();
    const candidate = await SessionModel.findOne({ currentTokenHash: hash });
    if (!candidate) {
      const reused = await SessionModel.findOne({ previousTokenHashes: hash, revokedAt: null });
      if (reused) await this.revoke(reused.id as string, "reuse_detected");
      throw ended();
    }
    if (candidate.revokedAt || candidate.idleExpiresAt <= now || candidate.absoluteExpiresAt <= now)
      throw ended();

    const userRoles = await rolesOf(candidate.userId.toString());
    if (!userRoles) throw ended();
    const policy = sessionPolicyFor(userRoles);
    const next = randomToken();
    const updated = await SessionModel.findOneAndUpdate(
      { _id: candidate._id, currentTokenHash: hash, revokedAt: null },
      {
        $set: {
          currentTokenHash: sha256(next),
          rotatedAt: now,
          lastUsedAt: now,
          idleExpiresAt: new Date(
            Math.min(
              now.getTime() + policy.idleHours * HOUR,
              candidate.absoluteExpiresAt.getTime(),
            ),
          ),
        },
        $push: { previousTokenHashes: { $each: [hash], $slice: -PREVIOUS_HASHES_KEPT } },
      },
      { new: true },
    );
    if (!updated) throw ended(); // lost a race with a concurrent rotation
    return { session: updated, refreshToken: next };
  }

  async findActive(sessionId: string, userId: string): Promise<SessionDocument | null> {
    const s = await SessionModel.findOne({ _id: sessionId, userId, revokedAt: null });
    if (!s) return null;
    const now = new Date();
    return s.idleExpiresAt > now && s.absoluteExpiresAt > now ? s : null;
  }

  async listForUser(userId: string) {
    return SessionModel.find({
      userId,
      revokedAt: null,
      absoluteExpiresAt: { $gt: new Date() },
    }).sort({
      lastUsedAt: -1,
    });
  }

  async revoke(sessionId: string, reason: SessionRevokeReason) {
    await SessionModel.updateOne(
      { _id: sessionId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
  }

  async revokeByToken(refreshToken: string, reason: SessionRevokeReason) {
    await SessionModel.updateOne(
      { currentTokenHash: sha256(refreshToken), revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: reason } },
    );
  }

  async revokeAllForUser(userId: string, reason: SessionRevokeReason, exceptSessionId?: string) {
    const filter: Record<string, unknown> = { userId, revokedAt: null };
    if (exceptSessionId) filter._id = { $ne: exceptSessionId };
    const res = await SessionModel.updateMany(filter, {
      $set: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.modifiedCount;
  }

  async markAuthenticated(sessionId: string) {
    await SessionModel.updateOne({ _id: sessionId }, { $set: { authenticatedAt: new Date() } });
  }

  async markMfaVerified(sessionId: string) {
    await SessionModel.updateOne({ _id: sessionId }, { $set: { mfaVerifiedAt: new Date() } });
  }
}
