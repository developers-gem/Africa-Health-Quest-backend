import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const counts = {
  staff: { type: Number, required: true, min: 0 },
  beds: { type: Number, required: true, min: 0 },
  ambulances: { type: Number, required: true, min: 0 },
  supplies: { type: Number, required: true, min: 0 },
};

const eventSchema = new Schema(
  {
    key: { type: String, required: true, match: /^[a-z0-9_]{2,40}$/ },
    text: { type: String, required: true, maxlength: 200 },
    needs: counts,
    weight: { type: Number, default: 1, min: 1 },
    minTierIndex: { type: Number, default: 0, min: 0 },
    countryCodes: { type: [String], default: [] },
    status: { type: String, enum: ["active", "retired"], default: "active" },
  },
  { timestamps: true },
);
eventSchema.index({ key: 1 }, { unique: true });
eventSchema.index({ status: 1 });
export type HospitalEventDocument = HydratedDocument<InferSchemaType<typeof eventSchema>>;
export const HospitalEventModel = mongoose.model("HospitalEvent", eventSchema, "hospitalEvents");

const outcomeSchema = new Schema(
  {
    resource: String,
    allocated: Number,
    needed: Number,
    met: Boolean,
    surplus: Number,
    shortfall: Number,
  },
  { _id: false },
);
const runSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    allocation: counts,
    cost: { type: Number, required: true },
    event: { key: String, text: String, needs: counts },
    needsMet: { type: Number, required: true, min: 0, max: 4 },
    outcomes: { type: [outcomeSchema], default: [] },
    performance: {
      coveragePercent: Number,
      efficiencyPercent: Number,
      wastedUnits: Number,
      rating: String,
    },
    rewards: { hp: Number, funding: Number },
    netFundingChange: { type: Number, required: true },
    summary: { type: String, required: true },
    settingsVersion: { type: Number, required: true },
    rng: { roll: Number, total: Number },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
runSchema.index({ userId: 1, createdAt: -1 });
export type HospitalRunDocument = HydratedDocument<InferSchemaType<typeof runSchema>>;
export const HospitalRunModel = mongoose.model("HospitalRun", runSchema, "hospitalRuns");
