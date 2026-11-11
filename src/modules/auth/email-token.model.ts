import mongoose, { Schema, type InferSchemaType } from "mongoose";

export const EMAIL_TOKEN_PURPOSES = ["verify_email", "reset_password"] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

const emailTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: EMAIL_TOKEN_PURPOSES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
emailTokenSchema.index({ userId: 1, purpose: 1 });
emailTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type EmailTokenAttrs = InferSchemaType<typeof emailTokenSchema>;
export const EmailTokenModel = mongoose.model("EmailToken", emailTokenSchema);
