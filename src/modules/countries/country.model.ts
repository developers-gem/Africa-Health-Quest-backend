import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const countrySchema = new Schema(
  {
    code: { type: String, required: true, match: /^[A-Z]{2}$/ },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    region: {
      type: String,
      enum: ["northern", "western", "central", "eastern", "southern"],
      required: true,
    },
    flagEmoji: { type: String, required: true, maxlength: 16 },
    flagAssetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    imageAssetId: { type: Schema.Types.ObjectId, ref: "MediaAsset", default: null },
    /** Short line shown on the Countries screen, e.g. "Malaria, sickle cell, road trauma". */
    focus: { type: String, default: "", maxlength: 160 },
    description: { type: String, default: "", maxlength: 2000 },
    healthPriorities: { type: [{ type: String, maxlength: 80 }], default: [] },
    languages: { type: [{ type: String, maxlength: 40 }], default: [] },
    currencyLabel: { type: String, default: null, maxlength: 40 },
    status: { type: String, enum: ["active", "coming_soon", "hidden"], required: true },
    unlock: {
      minHp: { type: Number, required: true, min: 0, default: 0 },
      minTierIndex: { type: Number, required: true, min: 0, default: 0 },
    },
    sortOrder: { type: Number, required: true, default: 1000 },
  },
  { timestamps: true },
);
countrySchema.index({ code: 1 }, { unique: true });
countrySchema.index({ status: 1, sortOrder: 1 });

export type CountryAttrs = InferSchemaType<typeof countrySchema>;
export type CountryDocument = HydratedDocument<CountryAttrs>;
export const CountryModel = mongoose.model("Country", countrySchema);
