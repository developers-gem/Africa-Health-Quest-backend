import mongoose, { Schema } from "mongoose";

/** In-app inbox entry; also the push outbox (pushStatus) so pushes are sent only after the creating transaction commits. */
const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true },
    title: { type: String, required: true, maxlength: 120 },
    body: { type: String, required: true, maxlength: 500 },
    route: { type: String, default: null },
    readAt: { type: Date, default: null },
    pushStatus: { type: String, enum: ["pending", "sent", "skipped", "failed"], required: true },
    pushAttempts: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });
notificationSchema.index(
  { pushStatus: 1, createdAt: 1 },
  { partialFilterExpression: { pushStatus: "pending" } },
);
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86_400 });
export const NotificationModel = mongoose.model(
  "Notification",
  notificationSchema,
  "notifications",
);

/** FCM registration tokens per device. */
const deviceSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true },
    platform: { type: String, enum: ["android", "ios"], required: true },
    appVersion: { type: String, default: null },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true },
);
deviceSchema.index({ token: 1 }, { unique: true });
deviceSchema.index({ userId: 1 });
deviceSchema.index({ lastSeenAt: 1 }, { expireAfterSeconds: 270 * 86_400 });
export const DeviceTokenModel = mongoose.model("DeviceToken", deviceSchema, "deviceTokens");
