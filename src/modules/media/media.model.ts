import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

export const MEDIA_PURPOSES = [
  "country_flag",
  "country_image",
  "mission_image",
  "achievement_icon",
  "clinician_evidence",
] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];
/** Evidence of clinician credentials is private; everything else is public game artwork. */
export const PRIVATE_PURPOSES: readonly MediaPurpose[] = ["clinician_evidence"];

const mediaSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: MEDIA_PURPOSES, required: true },
    visibility: { type: String, enum: ["public", "private"], required: true },
    storageKey: { type: String, required: true },
    contentType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    originalName: { type: String, default: null, maxlength: 200 },
    status: { type: String, enum: ["ready", "deleted"], default: "ready" },
  },
  { timestamps: true },
);
mediaSchema.index({ ownerId: 1, createdAt: -1 });
mediaSchema.index({ purpose: 1, status: 1, createdAt: -1 });
export type MediaDocument = HydratedDocument<InferSchemaType<typeof mediaSchema>>;
export const MediaAssetModel = mongoose.model("MediaAsset", mediaSchema, "mediaAssets");
