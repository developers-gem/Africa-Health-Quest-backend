import { LEARNER_LEVELS } from "@ahq/shared-types";
import { z } from "../zod.js";
import { paginated, PaginationQuerySchema } from "./common.js";
import { CountryCodeSchema } from "./countries.js";
import { TierSchema } from "./settings.js";

export const LearnerLevelSchema = z.enum(LEARNER_LEVELS).openapi("LearnerLevel");

export const MissionProgressSchema = z
  .object({
    bestScore: z.number().int(),
    maxScore: z.number().int(),
    attempts: z.number().int(),
    passed: z.boolean(),
    firstPassedAt: z.string().nullable(),
    lastPlayedAt: z.string().nullable(),
    practiceAttempts: z.number().int(),
  })
  .openapi("MissionProgress");

export const PlayerStatsCountersSchema = z
  .object({
    storyCompleted: z.number().int(),
    storyPassed: z.number().int(),
    practiceCompleted: z.number().int(),
    perfectScores: z.number().int(),
    correctAnswers: z.number().int(),
    answersTotal: z.number().int(),
    shiftsRun: z.number().int(),
    needsMet: z.number().int(),
  })
  .openapi("PlayerStatsCounters");
export type PlayerStatsCounters = z.infer<typeof PlayerStatsCountersSchema>;

export const ProgressSchema = z
  .object({
    hp: z.number().int(),
    funding: z.number().int(),
    tier: TierSchema.describe("Current hospital level"),
    nextTier: TierSchema.nullable(),
    hpToNextTier: z.number().int().nullable(),
    unlockedCountryCodes: z.array(z.string()),
    missions: z.record(z.string(), MissionProgressSchema),
    achievements: z.array(z.object({ key: z.string(), earnedAt: z.string() })),
    stats: PlayerStatsCountersSchema,
    version: z.number().int().describe("Increments on every server-side change (sync cursor)"),
    updatedAt: z.string(),
  })
  .openapi("Progress");
export type Progress = z.infer<typeof ProgressSchema>;

export const NotificationPrefsSchema = z.object({ push: z.boolean(), email: z.boolean() });
export const PlayerProfileSchema = z
  .object({
    learnerLevel: LearnerLevelSchema.nullable(),
    institution: z.string().nullable(),
    homeCountryCode: z.string().nullable(),
    locale: z.string(),
    notificationPrefs: NotificationPrefsSchema,
    onboardingCompletedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi("PlayerProfile");
export type PlayerProfile = z.infer<typeof PlayerProfileSchema>;

export const UpdatePlayerProfileSchema = z
  .object({
    learnerLevel: LearnerLevelSchema.nullable().optional(),
    institution: z.string().trim().max(120).nullable().optional(),
    homeCountryCode: CountryCodeSchema.nullable().optional(),
    locale: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Z]{2})?$/)
      .optional(),
    notificationPrefs: NotificationPrefsSchema.partial().optional(),
    onboardingCompleted: z.boolean().optional(),
  })
  .strict()
  .openapi("UpdatePlayerProfile");
export type UpdatePlayerProfile = z.infer<typeof UpdatePlayerProfileSchema>;

export const PlayerStatsSchema = z
  .object({
    counters: PlayerStatsCountersSchema,
    accuracy: z.number().nullable().describe("correctAnswers / answersTotal"),
    missionsPassed: z.number().int(),
    countriesUnlocked: z.number().int(),
    achievementsEarned: z.number().int(),
    tier: TierSchema,
  })
  .openapi("PlayerStats");

export const LEDGER_SOURCES = [
  "mission_attempt",
  "hospital_run",
  "achievement",
  "guest_merge",
  "admin_adjustment",
] as const;
export const LedgerEntrySchema = z
  .object({
    id: z.string(),
    source: z.enum(LEDGER_SOURCES),
    sourceId: z.string(),
    delta: z.object({ hp: z.number().int(), funding: z.number().int() }),
    balanceAfter: z.object({ hp: z.number().int(), funding: z.number().int() }),
    createdAt: z.string(),
  })
  .openapi("LedgerEntry");
export const LedgerPageSchema = paginated(LedgerEntrySchema).openapi("LedgerPage");
export const LedgerQuerySchema = PaginationQuerySchema;

export const ACHIEVEMENT_CRITERIA = [
  "missions_passed",
  "perfect_scores",
  "countries_unlocked",
  "tier_reached",
  "shifts_run",
  "correct_answers",
] as const;
export const AchievementCriterionSchema = z.enum(ACHIEVEMENT_CRITERIA);

export const AchievementSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    description: z.string(),
    icon: z.string(),
    criterion: AchievementCriterionSchema,
    threshold: z.number().int(),
    rewards: z.object({ hp: z.number().int(), funding: z.number().int() }),
  })
  .openapi("Achievement");
export const PlayerAchievementsSchema = z
  .object({
    earned: z.array(AchievementSchema.extend({ earnedAt: z.string() })),
    available: z.array(AchievementSchema.extend({ current: z.number().int() })),
  })
  .openapi("PlayerAchievements");

export const AchievementInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_-]{2,40}$/),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().min(1).max(200),
    icon: z.string().trim().min(1).max(16),
    criterion: AchievementCriterionSchema,
    threshold: z.number().int().min(1).max(100_000),
    rewards: z
      .object({
        hp: z.number().int().min(0).max(10_000),
        funding: z.number().int().min(0).max(10_000),
      })
      .default({ hp: 0, funding: 0 }),
    status: z.enum(["active", "retired"]).default("active"),
    sortOrder: z.number().int().min(0).default(0),
  })
  .openapi("AchievementInput");
export type AchievementInput = z.infer<typeof AchievementInputSchema>;
export const AchievementUpdateSchema = AchievementInputSchema.omit({ key: true })
  .partial()
  .openapi("AchievementUpdate");
export const AdminAchievementSchema = AchievementSchema.extend({
  status: z.enum(["active", "retired"]),
  sortOrder: z.number().int(),
}).openapi("AdminAchievement");

export const ProgressAdjustmentSchema = z
  .object({
    hp: z.number().int().min(-100_000).max(100_000),
    funding: z.number().int().min(-100_000).max(100_000),
    reason: z.string().trim().min(3).max(500),
  })
  .refine((v) => v.hp !== 0 || v.funding !== 0, "Adjust HP or funding")
  .openapi("ProgressAdjustment");
export const AdminPlayerSchema = z
  .object({ userId: z.string(), profile: PlayerProfileSchema, progress: ProgressSchema })
  .openapi("AdminPlayer");
