import { LEARNER_LEVELS } from "@ahq/shared-types";
import mongoose, { Schema, type HydratedDocument, type InferSchemaType } from "mongoose";
import { STAT_KEYS } from "./domain/progression.js";

// ---- Profile ----------------------------------------------------------------------------
const profileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    learnerLevel: { type: String, enum: LEARNER_LEVELS, default: null },
    institution: { type: String, default: null, maxlength: 120 },
    homeCountryCode: { type: String, default: null, match: /^[A-Z]{2}$/ },
    locale: { type: String, default: "en", maxlength: 10 },
    notificationPrefs: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },
    onboardingCompletedAt: { type: Date, default: null },
    /** Client-side modification time of the last applied offline profile edit (last-writer-wins). */
    clientUpdatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);
profileSchema.index({ userId: 1 }, { unique: true });
export type PlayerProfileDocument = HydratedDocument<InferSchemaType<typeof profileSchema>>;
export const PlayerProfileModel = mongoose.model("PlayerProfile", profileSchema, "playerProfiles");

// ---- Progress (authoritative projection, one per user) -----------------------------------
const missionProgressSchema = new Schema(
  {
    bestScore: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    practiceAttempts: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    firstPassedAt: { type: Date, default: null },
    lastPlayedAt: { type: Date, default: null },
  },
  { _id: false },
);
const statsDefinition = Object.fromEntries(STAT_KEYS.map((k) => [k, { type: Number, default: 0 }]));

const progressSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    hp: { type: Number, required: true, min: 0 },
    funding: { type: Number, required: true, min: 0 },
    tierIndex: { type: Number, required: true, default: 0 },
    unlockedCountryCodes: { type: [String], default: [] },
    missions: { type: Map, of: missionProgressSchema, default: {} },
    stats: statsDefinition,
    achievements: { type: [{ key: String, earnedAt: Date, _id: false }], default: [] },
    /** Increments on every change — clients use it as a sync cursor / ETag. */
    version: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);
progressSchema.index({ userId: 1 }, { unique: true });
progressSchema.index({ hp: -1 });
export type ProgressDocument = HydratedDocument<InferSchemaType<typeof progressSchema>>;
export const PlayerProgressModel = mongoose.model(
  "PlayerProgress",
  progressSchema,
  "playerProgress",
);

// ---- Ledger (append-only; unique per source prevents double rewards) ---------------------
export const LEDGER_SOURCES = [
  "mission_attempt",
  "hospital_run",
  "achievement",
  "guest_merge",
  "admin_adjustment",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];
const ledgerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    source: { type: String, enum: LEDGER_SOURCES, required: true },
    sourceId: { type: String, required: true },
    delta: { hp: { type: Number, required: true }, funding: { type: Number, required: true } },
    balanceAfter: {
      hp: { type: Number, required: true },
      funding: { type: Number, required: true },
    },
    economyVersion: { type: Number },
    note: { type: String, maxlength: 500 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
ledgerSchema.index({ userId: 1, source: 1, sourceId: 1 }, { unique: true });
ledgerSchema.index({ userId: 1, createdAt: -1 });
export const ProgressLedgerModel = mongoose.model("ProgressLedger", ledgerSchema, "progressLedger");

// ---- Achievement catalogue ---------------------------------------------------------------
const achievementSchema = new Schema(
  {
    key: { type: String, required: true, match: /^[a-z0-9_-]{2,40}$/ },
    name: { type: String, required: true, maxlength: 60 },
    description: { type: String, required: true, maxlength: 200 },
    icon: { type: String, required: true, maxlength: 16 },
    criterion: {
      type: String,
      enum: [
        "missions_passed",
        "perfect_scores",
        "countries_unlocked",
        "tier_reached",
        "shifts_run",
        "correct_answers",
      ],
      required: true,
    },
    threshold: { type: Number, required: true, min: 1 },
    rewards: {
      hp: { type: Number, default: 0, min: 0 },
      funding: { type: Number, default: 0, min: 0 },
    },
    status: { type: String, enum: ["active", "retired"], default: "active" },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);
achievementSchema.index({ key: 1 }, { unique: true });
achievementSchema.index({ status: 1, sortOrder: 1 });
export type AchievementDocument = HydratedDocument<InferSchemaType<typeof achievementSchema>>;
export const AchievementModel = mongoose.model("Achievement", achievementSchema);
