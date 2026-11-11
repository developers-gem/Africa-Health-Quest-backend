import { ROLES, type Role } from "@ahq/shared-types";
import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const mfaSchema = new Schema(
  {
    secretEnc: { type: String },
    enabledAt: { type: Date },
    lastUsedStep: { type: Number },
    recoveryCodeHashes: { type: [String], default: undefined },
    pendingSecretEnc: { type: String },
    pendingCreatedAt: { type: Date },
  },
  { _id: false },
);

const suspensionSchema = new Schema(
  {
    reason: { type: String, required: true, maxlength: 500 },
    by: { type: Schema.Types.ObjectId, ref: "User", required: true },
    at: { type: Date, required: true },
  },
  { _id: false },
);

const clinicianSchema = new Schema(
  {
    fullName: { type: String, required: true, maxlength: 120 },
    credentials: { type: String, required: true, maxlength: 200 },
    profession: { type: String, required: true },
    registrationBody: { type: String, required: true, maxlength: 120 },
    registrationNumberEnc: { type: String, required: true },
    countryCode: { type: String, required: true, match: /^[A-Z]{2}$/ },
    evidenceAssetIds: { type: [Schema.Types.ObjectId], default: [] },
    status: { type: String, enum: ["pending", "verified", "rejected"], required: true },
    submittedAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, default: null, maxlength: 500 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    email: { type: String, lowercase: true, trim: true, maxlength: 254 },
    emailVerifiedAt: { type: Date, default: null },
    passwordHash: { type: String, select: false },
    googleSub: { type: String },
    displayName: { type: String, required: true, trim: true, maxlength: 60 },
    roles: {
      type: [{ type: String, enum: ROLES }],
      default: (): Role[] => ["player"],
      validate: [
        (v: string[]) => v.includes("player") && v.length <= 5,
        "roles must include player",
      ],
    },
    isGuest: { type: Boolean, default: false },
    /** Guests inactive for GUEST_TTL_DAYS are purged (with all their data) by the worker. */
    guestLastActiveAt: { type: Date },
    /** Set when a guest account is upgraded to a registered one (conversion analytics). */
    convertedFromGuestAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    suspension: { type: suspensionSchema, default: undefined },
    mfa: { type: mfaSchema, default: undefined, select: false },
    /** Clinician (reviewer) profile; credentials are verified by an admin before review decisions. */
    clinician: { type: clinicianSchema, default: undefined },
    lastLoginAt: { type: Date },
    /** Acceptance of AI processing for learning debriefs (AI architecture §9). */
    consent: { aiProcessingAcceptedAt: { type: Date, default: null } },
  },
  { timestamps: true },
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
userSchema.index(
  { googleSub: 1 },
  { unique: true, partialFilterExpression: { googleSub: { $type: "string" } } },
);
userSchema.index({ roles: 1 });
userSchema.index({ isGuest: 1, guestLastActiveAt: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ "clinician.status": 1 }, { sparse: true });

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserAttrs>;
export const UserModel = mongoose.model("User", userSchema);

export const isStaff = (roles: readonly string[]) => roles.some((r) => r !== "player");
