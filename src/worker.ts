/**
 * Background worker (separate process from the API, same codebase): scheduled data-retention jobs.
 * A lease in MongoDB ensures only one worker instance runs jobs at a time.
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { loadConfig } from "./config/env.js";
import { connectDatabase } from "./db/connect.js";
import { createLogger } from "./lib/logger.js";
import { expireStaleAttempts, purgeInactiveGuests } from "./modules/jobs/retention.js";
import { JobLockModel } from "./modules/sync/sync.models.js";
import { NotificationsService } from "./modules/notifications/notifications.service.js";
import { pushSenderFrom } from "./modules/notifications/push.js";

export async function acquireLease(owner: string, ms: number, now = new Date()) {
  try {
    const lock = await JobLockModel.findOneAndUpdate(
      { _id: "scheduler", $or: [{ lockedUntil: { $lt: now } }, { owner }] },
      { $set: { owner, lockedUntil: new Date(now.getTime() + ms) } },
      { upsert: true, new: true },
    );
    return lock?.owner === owner;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) return false; // another worker holds the lease
    throw e;
  }
}

export async function releaseLease(owner: string) {
  await JobLockModel.updateOne({ _id: "scheduler", owner }, { $set: { lockedUntil: new Date(0) } });
}

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL).child({ component: "worker" });
  await connectDatabase(config.MONGODB_URI, logger);
  const owner = randomUUID();
  const intervalMs = config.WORKER_INTERVAL_MINUTES * 60_000;

  const tick = async () => {
    if (!(await acquireLease(owner, intervalMs - 5_000)))
      return logger.debug("lease held elsewhere");
    const guests = await purgeInactiveGuests(config.GUEST_TTL_DAYS);
    const attempts = await expireStaleAttempts(config.ATTEMPT_MAX_AGE_DAYS);
    logger.info({ guests, attempts }, "retention jobs completed");
  };
  await tick().catch((err) => logger.error({ err }, "job run failed"));
  const timer = setInterval(
    () => void tick().catch((err) => logger.error({ err }, "job run failed")),
    intervalMs,
  );
  // Push outbox sweep: retries pushes the API couldn't send right away (rows are claimed, so this is safe to
  // run on several workers).
  const notifications = new NotificationsService(pushSenderFrom(config), logger);
  const pushTimer = notifications.pushEnabled
    ? setInterval(
        () =>
          void notifications
            .dispatchPending()
            .catch((err) => logger.error({ err }, "push sweep failed")),
        60_000,
      )
    : null;

  const stop = async () => {
    clearInterval(timer);
    if (pushTimer) clearInterval(pushTimer);
    await releaseLease(owner).catch(() => undefined); // let a replacement worker start immediately
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
}

if (process.argv[1]?.endsWith("worker.js") || process.argv[1]?.endsWith("worker.ts")) {
  main().catch((err) => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
