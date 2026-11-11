import type { ErrorResponse } from "@ahq/api-contracts";
import type { Request } from "express";
import {
  ipKeyGenerator,
  rateLimit,
  type IncrementResponse,
  type Options,
  type Store,
} from "express-rate-limit";
import mongoose, { Schema } from "mongoose";
import type { Logger } from "pino";

/** Fixed-window counters shared by every API instance (decision A-7: MongoDB, no Redis in v1). */
const counterSchema = new Schema(
  {
    _id: { type: String },
    hits: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false },
);
counterSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RateLimitCounterModel = mongoose.model(
  "RateLimitCounter",
  counterSchema,
  "rateLimitCounters",
);

export class MongoRateLimitStore implements Store {
  windowMs = 60_000;
  localKeys = false;
  constructor(
    readonly prefix: string,
    private readonly logger?: Logger,
  ) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private window(now = Date.now()) {
    const start = Math.floor(now / this.windowMs) * this.windowMs;
    return { start, resetTime: new Date(start + this.windowMs) };
  }

  async increment(key: string): Promise<IncrementResponse> {
    const { start, resetTime } = this.window();
    try {
      const doc = await RateLimitCounterModel.findOneAndUpdate(
        { _id: `${this.prefix}:${key}:${start}` },
        // The counter document lives one window past its reset, then MongoDB's TTL monitor removes it.
        {
          $inc: { hits: 1 },
          $setOnInsert: { expiresAt: new Date(resetTime.getTime() + this.windowMs) },
        },
        { upsert: true, new: true, lean: true },
      );
      return { totalHits: doc?.hits ?? 1, resetTime };
    } catch (err) {
      // Fail open: a database hiccup must not lock every user out. Logged for monitoring.
      this.logger?.warn({ err }, "rate-limit store unavailable; allowing request");
      return { totalHits: 0, resetTime };
    }
  }

  async decrement(key: string) {
    const { start } = this.window();
    await RateLimitCounterModel.updateOne(
      { _id: `${this.prefix}:${key}:${start}`, hits: { $gt: 0 } },
      { $inc: { hits: -1 } },
    ).catch(() => undefined);
  }

  async resetKey(key: string) {
    await RateLimitCounterModel.deleteMany({
      _id: { $regex: `^${escapeRegex(`${this.prefix}:${key}:`)}` },
    });
  }
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function createRateLimiter(
  windowMs: number,
  limit: number,
  opts: {
    store?: "memory" | "mongo";
    name?: string;
    logger?: Logger;
    /** Key per account instead of per IP (e.g. the email being signed in to). Undefined falls back to the IP. */
    key?: (req: Request) => string | undefined;
    /** Count only failed requests (status >= 400), e.g. wrong passwords. */
    failuresOnly?: boolean;
  } = {},
) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(opts.failuresOnly ? { skipSuccessfulRequests: true } : {}),
    ...(opts.key
      ? {
          keyGenerator: (req: Request) => opts.key!(req) ?? `ip:${ipKeyGenerator(req.ip ?? "")}`,
        }
      : {}),
    ...(opts.store === "mongo"
      ? { store: new MongoRateLimitStore(opts.name ?? "default", opts.logger) }
      : {}),
    handler: (req, res) => {
      const body: ErrorResponse = {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait and try again.",
          requestId: req.requestId,
        },
      };
      res.status(429).json(body);
    },
  });
}
