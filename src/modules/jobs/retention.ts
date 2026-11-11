import mongoose, { type ClientSession } from "mongoose";
import { EmailTokenModel } from "../auth/email-token.model.js";
import { SessionModel } from "../auth/session.model.js";
import { MissionAttemptModel } from "../gameplay/attempt.model.js";
import { HospitalRunModel } from "../hospital/hospital.models.js";
import {
  PlayerProfileModel,
  PlayerProgressModel,
  ProgressLedgerModel,
} from "../players/player.models.js";
import { IdempotencyRecordModel, SyncEventModel } from "../sync/sync.models.js";
import { DeviceTokenModel, NotificationModel } from "../notifications/notification.models.js";
import { UserModel } from "../users/user.model.js";

/** Deletes a user and every document that belongs to them (guest purge, merged guests). */
export async function purgeUserData(userId: string, session?: ClientSession) {
  const opts = session ? { session } : {};
  const filter = { userId };
  const results = await Promise.all([
    SessionModel.deleteMany(filter, opts),
    EmailTokenModel.deleteMany(filter, opts),
    PlayerProfileModel.deleteMany(filter, opts),
    PlayerProgressModel.deleteMany(filter, opts),
    ProgressLedgerModel.deleteMany(filter, opts),
    MissionAttemptModel.deleteMany(filter, opts),
    HospitalRunModel.deleteMany(filter, opts),
    SyncEventModel.deleteMany(filter, opts),
    IdempotencyRecordModel.deleteMany(filter, opts),
    NotificationModel.deleteMany(filter, opts),
    DeviceTokenModel.deleteMany(filter, opts),
  ]);
  await UserModel.deleteOne({ _id: userId }, opts);
  return results.reduce((a, r) => a + r.deletedCount, 0);
}

/** Guests inactive for more than `ttlDays` are deleted with all their data. */
export async function purgeInactiveGuests(ttlDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - ttlDays * 86_400_000);
  const guests = await UserModel.find({ isGuest: true, guestLastActiveAt: { $lt: cutoff } })
    .select("_id")
    .limit(1000)
    .lean();
  let documents = 0;
  for (const g of guests) {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async (s) => {
        documents += await purgeUserData(String(g._id), s);
      });
    } finally {
      await session.endSession();
    }
  }
  return { guests: guests.length, documents };
}

/** In-progress attempts older than `maxAgeDays` are expired (no rewards). */
export async function expireStaleAttempts(maxAgeDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - maxAgeDays * 86_400_000);
  const res = await MissionAttemptModel.updateMany(
    { status: "in_progress", startedAt: { $lt: cutoff } },
    { $set: { status: "expired", completedAt: now } },
  );
  return { expired: res.modifiedCount };
}
