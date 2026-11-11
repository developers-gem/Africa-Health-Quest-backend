import type { AppNotification } from "@ahq/api-contracts";
import type { ClientSession } from "mongoose";
import { Types } from "mongoose";
import type { Logger } from "pino";
import { AppError } from "../../lib/errors.js";
import { PlayerProfileModel } from "../players/player.models.js";
import { UserModel } from "../users/user.model.js";
import { DeviceTokenModel, NotificationModel } from "./notification.models.js";
import type { PushSender } from "./push.js";

export type NewNotification = {
  type: AppNotification["type"];
  title: string;
  body: string;
  route?: string | null;
};
const MAX_PUSH_ATTEMPTS = 3;

export class NotificationsService {
  constructor(
    private readonly push: PushSender,
    private readonly logger: Logger,
  ) {}

  get pushEnabled() {
    return this.push.name !== "none";
  }

  /**
   * Adds inbox entries, optionally inside the caller's transaction (so a reward and its notification commit
   * together). Pushes are queued (`pending`) and delivered by `dispatchPending` after the commit.
   */
  async create(userIds: (string | Types.ObjectId)[], n: NewNotification, session?: ClientSession) {
    if (!userIds.length) return 0;
    const pushTo = new Set<string>();
    if (this.pushEnabled) {
      const prefs = await PlayerProfileModel.find({
        userId: { $in: userIds },
        "notificationPrefs.push": false,
      })
        .select("userId")
        .session(session ?? null)
        .lean();
      const optedOut = new Set(prefs.map((p) => String(p.userId)));
      for (const id of userIds) if (!optedOut.has(String(id))) pushTo.add(String(id));
    }
    const docs = userIds.map((userId) => ({
      userId,
      type: n.type,
      title: n.title,
      body: n.body,
      route: n.route ?? null,
      pushStatus: pushTo.has(String(userId)) ? "pending" : "skipped",
    }));
    await NotificationModel.insertMany(docs, session ? { session } : {});
    if (pushTo.size) this.scheduleDispatch();
    return docs.length;
  }

  private scheduleDispatch() {
    // Runs after the current transaction has had a chance to commit; the worker sweeps anything left over.
    setTimeout(
      () =>
        void this.dispatchPending().catch((err) =>
          this.logger.error({ err }, "push dispatch failed"),
        ),
      250,
    ).unref();
  }

  /** Delivers pending pushes (outbox). Invalid device tokens are removed. */
  async dispatchPending(limit = 200) {
    const pending = await NotificationModel.find({ pushStatus: "pending" })
      .sort({ createdAt: 1 })
      .limit(limit);
    let sent = 0;
    for (const n of pending) {
      // Claim the row so concurrent dispatchers don't send it twice.
      const claimed = await NotificationModel.updateOne(
        { _id: n._id, pushStatus: "pending", pushAttempts: n.pushAttempts },
        { $inc: { pushAttempts: 1 } },
      );
      if (claimed.modifiedCount !== 1) continue;
      const devices = await DeviceTokenModel.find({ userId: n.userId }).select("token").lean();
      if (!devices.length) {
        await NotificationModel.updateOne({ _id: n._id }, { $set: { pushStatus: "skipped" } });
        continue;
      }
      try {
        const res = await this.push.send(
          devices.map((d) => d.token),
          {
            title: n.title,
            body: n.body,
            data: { type: n.type, route: n.route ?? "", notificationId: String(n._id) },
          },
        );
        if (res.invalidTokens.length)
          await DeviceTokenModel.deleteMany({ token: { $in: res.invalidTokens } });
        sent += res.sent;
        await NotificationModel.updateOne(
          { _id: n._id },
          { $set: { pushStatus: res.sent > 0 ? "sent" : "failed" } },
        );
      } catch (err) {
        this.logger.warn({ err }, "push send failed");
        await NotificationModel.updateOne(
          { _id: n._id },
          { $set: { pushStatus: n.pushAttempts + 1 >= MAX_PUSH_ATTEMPTS ? "failed" : "pending" } },
        );
      }
    }
    return { processed: pending.length, sent };
  }

  async list(
    userId: string,
    q: { page: number; pageSize: number; unread?: "true" | "false" | undefined },
  ) {
    const filter: Record<string, unknown> = { userId };
    if (q.unread === "true") filter.readAt = null;
    const [items, total, unreadCount] = await Promise.all([
      NotificationModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      NotificationModel.countDocuments(filter),
      NotificationModel.countDocuments({ userId, readAt: null }),
    ]);
    return {
      items: items.map((n) => ({
        id: String(n._id),
        type: n.type as AppNotification["type"],
        title: n.title,
        body: n.body,
        route: n.route ?? null,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: (n.createdAt as Date).toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
      unreadCount,
    };
  }

  async markRead(userId: string, id: string) {
    const res = await NotificationModel.updateOne(
      { _id: id, userId },
      { $set: { readAt: new Date() } },
    );
    if (!res.matchedCount) throw AppError.notFound("Notification not found.");
  }

  async markAllRead(userId: string) {
    await NotificationModel.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  }

  /** Registers (or moves) a device token to the current user. */
  async registerDevice(
    userId: string,
    input: { token: string; platform: "android" | "ios"; appVersion?: string | undefined },
  ) {
    await DeviceTokenModel.updateOne(
      { token: input.token },
      {
        $set: {
          userId,
          platform: input.platform,
          appVersion: input.appVersion ?? null,
          lastSeenAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  async unregisterDevice(userId: string, token: string) {
    await DeviceTokenModel.deleteOne({ token, userId });
  }

  /** Announcement to players matching the audience (registered and guest players alike). */
  async announce(input: {
    title: string;
    body: string;
    route?: string | undefined;
    audience: { roles?: string[] | undefined; countries?: string[] | undefined };
    push: boolean;
  }) {
    const userFilter: Record<string, unknown> = { suspension: { $exists: false } };
    if (input.audience.roles?.length) userFilter.roles = { $in: input.audience.roles };
    let ids = (await UserModel.find(userFilter).select("_id").lean()).map((u) => u._id);
    if (input.audience.countries?.length) {
      const inCountries = await PlayerProfileModel.find({
        userId: { $in: ids },
        homeCountryCode: { $in: input.audience.countries },
      })
        .select("userId")
        .lean();
      ids = inCountries.map((p) => p.userId as Types.ObjectId);
    }
    const n: NewNotification = {
      type: "announcement",
      title: input.title,
      body: input.body,
      route: input.route ?? null,
    };
    let pushQueued = 0;
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      if (input.push && this.pushEnabled) {
        await this.create(chunk, n);
        pushQueued += await NotificationModel.countDocuments({
          userId: { $in: chunk },
          type: "announcement",
          title: input.title,
          pushStatus: "pending",
        });
      } else {
        await NotificationModel.insertMany(
          chunk.map((userId) => ({ userId, ...n, pushStatus: "skipped" })),
        );
      }
    }
    return { recipients: ids.length, pushQueued };
  }
}
