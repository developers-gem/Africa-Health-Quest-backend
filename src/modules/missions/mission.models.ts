import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";

// ---- Clinical references (curated by reviewers/admins; never AI-created) -------------------
const referenceSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    organization: { type: String, default: null, maxlength: 120 },
    authors: { type: String, default: null, maxlength: 300 },
    year: { type: Number, default: null, min: 1950, max: 2100 },
    edition: { type: String, default: null, maxlength: 40 },
    type: {
      type: String,
      enum: [
        "guideline",
        "national_protocol",
        "textbook",
        "journal_article",
        "training_manual",
        "other",
      ],
      required: true,
    },
    url: { type: String, default: null, maxlength: 2000 },
    doi: { type: String, default: null, maxlength: 200 },
    countryCodes: { type: [String], default: [] },
    topics: { type: [String], default: [] },
    status: { type: String, enum: ["active", "retired"], default: "active" },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    lastVerifiedAt: { type: Date, default: null },
    lastVerifiedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);
referenceSchema.index({ title: "text", organization: "text", authors: "text" });
referenceSchema.index(
  { doi: 1 },
  { unique: true, partialFilterExpression: { doi: { $type: "string" } } },
);
referenceSchema.index({ status: 1, topics: 1 });
export type ReferenceDocument = HydratedDocument<InferSchemaType<typeof referenceSchema>>;
export const ClinicalReferenceModel = mongoose.model(
  "ClinicalReference",
  referenceSchema,
  "clinicalReferences",
);

// ---- Mission (identity, placement, publication pointer) ------------------------------------
const verificationSnapshot = new Schema(
  {
    reviewId: { type: Schema.Types.ObjectId },
    reviewerName: { type: String, required: true },
    credentials: { type: String, required: true },
    approvedAt: { type: Date, required: true },
    referenceIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { _id: false },
);
const missionSchema = new Schema(
  {
    key: { type: String, required: true, match: /^[a-z0-9-]{2,40}$/, immutable: true },
    countryCode: { type: String, required: true, match: /^[A-Z]{2}$/ },
    tier: { type: Number, required: true, min: 0, max: 19 },
    icon: { type: String, required: true, maxlength: 16 },
    sortOrder: { type: Number, required: true, default: 1000 },
    topics: { type: [{ type: String, maxlength: 40 }], default: [] },
    /** Players may download this mission (without answer keys) to play offline. Off unless an admin enables it. */
    offlineEligible: { type: Boolean, default: false },
    status: {
      type: String,
      enum: ["draft", "published", "withdrawn", "retired"],
      required: true,
      default: "draft",
    },
    publishedVersionId: { type: Schema.Types.ObjectId, ref: "MissionVersion", default: null },
    published: {
      type: new Schema(
        {
          versionId: { type: Schema.Types.ObjectId, required: true },
          versionNumber: { type: Number, required: true },
          title: { type: String, required: true },
          countryCode: { type: String, required: true },
          stepCount: { type: Number, required: true },
          contentHash: { type: String, required: true },
          verification: { type: verificationSnapshot, required: true },
        },
        { _id: false },
      ),
      default: null,
    },
    latestVersionNumber: { type: Number, required: true, default: 0 },
    openDraftVersionId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
missionSchema.index({ key: 1 }, { unique: true });
missionSchema.index({ status: 1, countryCode: 1, tier: 1, sortOrder: 1 });
missionSchema.index({ topics: 1 });
export type MissionDocument = HydratedDocument<InferSchemaType<typeof missionSchema>>;
export const MissionModel = mongoose.model("Mission", missionSchema);

// ---- Mission version (immutable once submitted) ---------------------------------------------
export const VERSION_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "published",
  "superseded",
  "withdrawn",
] as const;
export type VersionStatus = (typeof VERSION_STATUSES)[number];

const choiceSchema = new Schema(
  {
    choiceId: { type: String, required: true, match: /^s\d+c\d+$/ },
    text: { type: String, required: true, maxlength: 200 },
    correct: { type: Boolean, required: true },
    feedback: { type: String, required: true, maxlength: 500 },
    critical: { type: Boolean, default: false },
  },
  { _id: false },
);
const stepSchema = new Schema(
  {
    stepId: { type: String, required: true, match: /^s\d+$/ },
    prompt: { type: String, required: true, maxlength: 300 },
    choices: {
      type: [choiceSchema],
      validate: [
        (c: { correct: boolean }[]) =>
          c.length >= 2 && c.length <= 6 && c.filter((x) => x.correct).length === 1,
        "each step needs 2–6 choices with exactly one correct answer",
      ],
    },
  },
  { _id: false },
);
const versionSchema = new Schema(
  {
    missionId: { type: Schema.Types.ObjectId, ref: "Mission", required: true },
    versionNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: VERSION_STATUSES, required: true },
    locale: { type: String, required: true, default: "en" },
    content: {
      title: { type: String, required: true, maxlength: 80 },
      story: { type: String, required: true, maxlength: 2000 },
      countryCode: { type: String, required: true, match: /^[A-Z]{2}$/ },
      learningObjectives: { type: [{ type: String, maxlength: 200 }], default: [] },
      steps: {
        type: [stepSchema],
        validate: [(s: unknown[]) => s.length >= 1 && s.length <= 10, "1–10 steps"],
      },
    },
    referenceIds: { type: [Schema.Types.ObjectId], ref: "ClinicalReference", default: [] },
    contentHash: { type: String, default: null },
    authoredBy: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    basedOnVersionId: { type: Schema.Types.ObjectId, default: null },
    changeSummary: { type: String, default: null, maxlength: 500 },
    submittedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
  },
  { timestamps: true },
);
versionSchema.index({ missionId: 1, versionNumber: -1 }, { unique: true });
versionSchema.index({ status: 1, submittedAt: 1 });
versionSchema.index({ contentHash: 1 });

/** Content and references are frozen once a version leaves the draft state. */
versionSchema.pre("save", function () {
  if (
    !this.isNew &&
    this.status !== "draft" &&
    (this.isModified("content") || this.isModified("referenceIds"))
  ) {
    throw new Error("Mission version content is immutable after submission");
  }
});
for (const op of ["updateOne", "findOneAndUpdate", "updateMany"] as const) {
  versionSchema.pre(op, function () {
    const update = this.getUpdate() as Record<string, unknown> | null;
    const touches = (u: unknown) =>
      !!u &&
      Object.keys(u as object).some(
        (k) => k === "content" || k.startsWith("content.") || k === "referenceIds",
      );
    if (
      update &&
      (touches(update) || touches(update.$set) || touches(update.$unset) || touches(update.$push))
    ) {
      const filter = this.getFilter() as { status?: unknown };
      if (filter.status !== "draft")
        throw new Error("Content updates must target draft versions (filter status: 'draft')");
    }
  });
}
export type MissionVersionDocument = HydratedDocument<InferSchemaType<typeof versionSchema>>;
export const MissionVersionModel = mongoose.model(
  "MissionVersion",
  versionSchema,
  "missionVersions",
);
