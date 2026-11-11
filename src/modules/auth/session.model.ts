import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const SESSION_REVOKE_REASONS = [
  "logout",
  "logout_all",
  "user_revoked",
  "reuse_detected",
  "password_reset",
  "admin",
  "suspended",
  "roles_changed",
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/**
 * One document per signed-in device. Refresh tokens are opaque and stored only as SHA-256 hashes; every
 * refresh rotates the token and keeps the last few hashes so that re-use of an old token (theft) is detected.
 */
const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    currentTokenHash: { type: String, required: true },
    previousTokenHashes: { type: [String], default: [] },
    rotatedAt: { type: Date },
    device: {
      platform: { type: String, enum: ["web", "mobile"], required: true },
      userAgent: { type: String, maxlength: 300 },
      appVersion: { type: String, maxlength: 20 },
    },
    ipHash: { type: String },
    /** Last full authentication (password / Google / re-auth) — used for step-up checks. */
    authenticatedAt: { type: Date, required: true },
    mfaVerifiedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, required: true },
    idleExpiresAt: { type: Date, required: true },
    absoluteExpiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, enum: SESSION_REVOKE_REASONS },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
sessionSchema.index({ currentTokenHash: 1 }, { unique: true });
sessionSchema.index({ previousTokenHashes: 1 });
sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });

export type SessionAttrs = InferSchemaType<typeof sessionSchema>;
export type SessionDocument = HydratedDocument<SessionAttrs>;
export const SessionModel = mongoose.model("UserSession", sessionSchema, "userSessions");
