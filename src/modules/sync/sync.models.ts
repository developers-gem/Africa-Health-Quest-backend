import mongoose, { Schema } from "mongoose";

/** Idempotency-Key records: replay the first successful response for 24 h. */
const idempotencySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    key: { type: String, required: true, maxlength: 64 },
    requestHash: { type: String, required: true },
    status: { type: String, enum: ["processing", "completed"], required: true },
    responseStatus: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
idempotencySchema.index({ userId: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const IdempotencyRecordModel = mongoose.model(
  "IdempotencyRecord",
  idempotencySchema,
  "idempotencyRecords",
);

/** Processed offline events (deduplication by device-generated eventId). */
const syncEventSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    status: {
      type: String,
      enum: ["processing", "applied", "duplicate", "stale", "rejected"],
      required: true,
    },
    code: { type: String, default: null },
    message: { type: String, default: null },
    data: { type: Schema.Types.Mixed, default: null },
    clientRef: { type: String, default: null },
    attemptId: { type: Schema.Types.ObjectId, default: null },
    occurredAt: { type: Date, required: true },
  },
  { timestamps: true, minimize: false },
);
syncEventSchema.index({ userId: 1, eventId: 1 }, { unique: true });
syncEventSchema.index(
  { userId: 1, clientRef: 1 },
  { partialFilterExpression: { clientRef: { $type: "string" } } },
);
syncEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86_400 });
export const SyncEventModel = mongoose.model("SyncEvent", syncEventSchema, "syncEvents");

/** Distributed lease so only one worker instance runs scheduled jobs. */
const lockSchema = new Schema(
  { _id: { type: String }, owner: String, lockedUntil: Date },
  { versionKey: false },
);
export const JobLockModel = mongoose.model("JobLock", lockSchema, "jobLocks");
