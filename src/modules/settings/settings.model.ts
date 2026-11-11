import mongoose, { Schema } from "mongoose";

export const SETTING_KEYS = ["economy", "progression", "hospital", "ai"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

/** Versioned configuration: exactly one `active` document per key; history is kept. */
const settingSchema = new Schema(
  {
    key: { type: String, enum: SETTING_KEYS, required: true },
    version: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["active", "archived"], required: true },
    value: { type: Schema.Types.Mixed, required: true },
    changeNote: { type: String, required: true, maxlength: 500 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);
settingSchema.index({ key: 1, version: -1 }, { unique: true });
settingSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

export const PlatformSettingModel = mongoose.model(
  "PlatformSetting",
  settingSchema,
  "platformSettings",
);
