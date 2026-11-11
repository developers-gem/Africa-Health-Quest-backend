import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const decisionSchema = new Schema(
  { stepId: String, prompt: String, chosenText: String, correct: Boolean, explanation: String },
  { _id: false },
);
const flagSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, enum: ["inaccurate", "unsafe", "unhelpful", "other"], required: true },
    comment: { type: String, default: null, maxlength: 1000 },
    at: { type: Date, required: true },
  },
  { _id: false },
);

/** One generated (or attempted) learning debrief. Retained 24 months. */
const debriefSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    attemptId: { type: Schema.Types.ObjectId, ref: "MissionAttempt", required: true },
    missionKey: { type: String, required: true },
    missionVersionId: { type: Schema.Types.ObjectId, required: true },
    level: { type: String, required: true },
    status: { type: String, enum: ["pending", "completed", "failed"], required: true },
    failureReason: { type: String, default: null },
    overall: { type: String, default: null },
    decisions: { type: [decisionSchema], default: [] },
    strengths: { type: [String], default: [] },
    knowledgeGaps: { type: [String], default: [] },
    teachingPoints: { type: [String], default: [] },
    recommendedTopics: { type: [String], default: [] },
    practiceQuestions: { type: [String], default: [] },
    referenceIds: { type: [Schema.Types.ObjectId], default: [] },
    modelRequested: { type: String, required: true },
    modelServed: { type: String, default: null },
    promptVersion: { type: String, required: true },
    completedAt: { type: Date, default: null },
    flags: { type: [flagSchema], default: [] },
  },
  { timestamps: true },
);
debriefSchema.index({ userId: 1, createdAt: -1 });
debriefSchema.index({ attemptId: 1, level: 1, createdAt: -1 });
debriefSchema.index(
  { "flags.0": 1 },
  { partialFilterExpression: { "flags.0": { $exists: true } } },
);
debriefSchema.index({ createdAt: 1 }, { expireAfterSeconds: 730 * 86_400 });
export type DebriefDocument = HydratedDocument<InferSchemaType<typeof debriefSchema>>;
export const AiDebriefModel = mongoose.model("AiDebrief", debriefSchema, "aiDebriefs");

/** One provider call (no content). Retained 400 days. */
const usageSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, default: null },
    debriefId: { type: Schema.Types.ObjectId, default: null },
    provider: { type: String, required: true },
    modelRequested: { type: String, required: true },
    modelServed: { type: String, default: null },
    effort: { type: String, required: true },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheCreationTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
    latencyMs: { type: Number, default: 0 },
    outcome: {
      type: String,
      // quota_rejected rows record requests refused before any provider call (daily quota / burst limit).
      enum: [
        "completed",
        "refused",
        "invalid_output",
        "provider_unavailable",
        "rate_limited",
        "error",
        "quota_rejected",
      ],
      required: true,
    },
    stopReason: { type: String, default: null },
    requestId: { type: String, default: null },
    costMicroUsd: { type: Number, default: 0 },
    /** True when this call went to the fallback model because the configured model was unavailable. */
    fallback: { type: Boolean, default: false },
    level: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
usageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 400 * 86_400 });
export const AiUsageLogModel = mongoose.model("AiUsageLog", usageSchema, "aiUsageLogs");
