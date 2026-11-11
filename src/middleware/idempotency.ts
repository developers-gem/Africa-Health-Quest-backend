import type { RequestHandler } from "express";
import { AppError } from "../lib/errors.js";
import { sha256 } from "../lib/crypto.js";
import type { Logger } from "../lib/logger.js";
import { canonicalJson } from "../modules/missions/domain/content-hash.js";
import { IdempotencyRecordModel } from "../modules/sync/sync.models.js";

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const TTL_MS = 24 * 3_600_000;
const MAX_STORED_BYTES = 64 * 1024;

/**
 * Idempotency-Key support for mutations (must run after authentication).
 * - Same key + same request → the stored response is replayed (header `Idempotency-Replayed: true`).
 * - Same key + different request → 422 IDEMPOTENCY_KEY_REUSED.
 * - Same key while the first request is still running → 409 CONFLICT (retry shortly).
 * Only successful (2xx) responses are stored; failures release the key so the client can retry.
 */
export function idempotency(logger: Logger): RequestHandler {
  return async (req, res, next) => {
    const key = req.get("idempotency-key");
    if (!key) return next();
    if (!KEY.test(key))
      throw AppError.badRequest("Invalid Idempotency-Key.", [
        { path: "Idempotency-Key", message: "8–64 characters: letters, digits, - or _" },
      ]);
    const userId = req.auth?.user.id as string | undefined;
    if (!userId) throw AppError.unauthenticated();
    const requestHash = sha256(
      `${req.method} ${req.baseUrl}${req.path}\n${canonicalJson(req.body ?? null)}`,
    );

    try {
      await IdempotencyRecordModel.create({
        userId,
        key,
        requestHash,
        status: "processing",
        expiresAt: new Date(Date.now() + TTL_MS),
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const existing = await IdempotencyRecordModel.findOne({ userId, key }).lean();
      if (!existing) throw AppError.conflict("Please retry the request.");
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          422,
          "IDEMPOTENCY_KEY_REUSED",
          "This Idempotency-Key was already used for a different request.",
        );
      }
      if (existing.status !== "completed") {
        res.setHeader("Retry-After", "1");
        throw AppError.conflict("A request with this Idempotency-Key is still being processed.");
      }
      res.setHeader("Idempotency-Replayed", "true");
      res.status(existing.responseStatus ?? 200).json(existing.responseBody);
      return;
    }

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      captured = body;
      return originalJson(body);
    };
    res.on("finish", () => {
      const ok = res.statusCode >= 200 && res.statusCode < 300 && captured !== undefined;
      const size = ok ? Buffer.byteLength(JSON.stringify(captured)) : 0;
      const op =
        ok && size <= MAX_STORED_BYTES
          ? IdempotencyRecordModel.updateOne(
              { userId, key },
              {
                $set: {
                  status: "completed",
                  responseStatus: res.statusCode,
                  responseBody: captured,
                },
              },
            )
          : IdempotencyRecordModel.deleteOne({ userId, key, status: "processing" });
      op.catch((err) => logger.error({ err, key }, "failed to finalise idempotency record"));
    });
    next();
  };
}
