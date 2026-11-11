import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

const answerSchema = new Schema(
  {
    stepId: { type: String, required: true },
    choiceId: { type: String, required: true },
    correct: { type: Boolean, required: true },
    critical: { type: Boolean, default: false },
    reasoning: { type: String, default: null, maxlength: 1500 },
    answeredAt: { type: Date, required: true },
    /** Offline answers: client-side time the answer was given (informational). */
    clientAnsweredAt: { type: Date, default: null },
  },
  { _id: false },
);

const attemptSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    missionId: { type: Schema.Types.ObjectId, ref: "Mission", required: true },
    missionKey: { type: String, required: true },
    title: { type: String, required: true },
    icon: { type: String, required: true },
    missionVersionId: { type: Schema.Types.ObjectId, ref: "MissionVersion", required: true },
    countryCode: { type: String, required: true },
    mode: { type: String, enum: ["story", "practice"], required: true },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned", "expired"],
      required: true,
    },
    choiceOrder: { type: Map, of: [String], required: true },
    answers: { type: [answerSchema], default: [] },
    score: { type: Number, default: null },
    maxScore: { type: Number, required: true },
    correctCount: { type: Number, default: null },
    passed: { type: Boolean, default: null },
    criticalError: { type: Boolean, default: null },
    firstCompletion: { type: Boolean, default: null },
    rewards: { type: new Schema({ hp: Number, funding: Number }, { _id: false }), default: null },
    economyVersion: { type: Number, required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    client: {
      platform: { type: String, default: null },
      appVersion: { type: String, default: null },
    },
    mergedFromUserId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
attemptSchema.index({ userId: 1, startedAt: -1 });
attemptSchema.index({ userId: 1, missionKey: 1, mode: 1, status: 1 });
attemptSchema.index({ missionVersionId: 1, status: 1 });
attemptSchema.index(
  { status: 1, startedAt: 1 },
  { partialFilterExpression: { status: "in_progress" } },
);
/** At most one open attempt per player, mission and mode. */
attemptSchema.index(
  { userId: 1, missionKey: 1, mode: 1 },
  { unique: true, partialFilterExpression: { status: "in_progress" }, name: "one_open_attempt" },
);

export type AttemptDocument = HydratedDocument<InferSchemaType<typeof attemptSchema>>;
export const MissionAttemptModel = mongoose.model(
  "MissionAttempt",
  attemptSchema,
  "missionAttempts",
);
