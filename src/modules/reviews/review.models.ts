import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

/** Immutable record of a clinician's decision on one exact content version. */
const reviewSchema = new Schema(
  {
    missionId: { type: Schema.Types.ObjectId, ref: "Mission", required: true },
    missionKey: { type: String, required: true },
    missionVersionId: { type: Schema.Types.ObjectId, ref: "MissionVersion", required: true },
    versionNumber: { type: Number, required: true },
    contentHash: { type: String, required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewer: {
      name: { type: String, required: true },
      credentials: { type: String, required: true },
      profession: { type: String, required: true },
    },
    decision: { type: String, enum: ["approved", "changes_requested"], required: true },
    checks: { scenario: Boolean, treatment: Boolean, references: Boolean },
    referenceIds: { type: [Schema.Types.ObjectId], default: [] },
    notes: { type: String, default: "", maxlength: 4000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
reviewSchema.index({ missionVersionId: 1, createdAt: -1 });
reviewSchema.index({ missionId: 1, createdAt: -1 });
reviewSchema.index({ reviewerId: 1, createdAt: -1 });
for (const op of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const) {
  reviewSchema.pre(op, function () {
    throw new Error("Mission reviews are immutable");
  });
}
export type ReviewDocument = HydratedDocument<InferSchemaType<typeof reviewSchema>>;
export const MissionReviewModel = mongoose.model("MissionReview", reviewSchema, "missionReviews");

const assignmentSchema = new Schema(
  {
    missionVersionId: { type: Schema.Types.ObjectId, ref: "MissionVersion", required: true },
    missionKey: { type: String, required: true },
    versionNumber: { type: Number, required: true },
    reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["open", "completed", "cancelled"], default: "open" },
    dueAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
assignmentSchema.index({ reviewerId: 1, status: 1 });
assignmentSchema.index(
  { missionVersionId: 1, reviewerId: 1 },
  { unique: true, partialFilterExpression: { status: "open" } },
);
export type AssignmentDocument = HydratedDocument<InferSchemaType<typeof assignmentSchema>>;
export const ReviewAssignmentModel = mongoose.model(
  "ReviewAssignment",
  assignmentSchema,
  "reviewAssignments",
);
