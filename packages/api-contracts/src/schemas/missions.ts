import { z } from "../zod.js";
import { PaginationQuerySchema, paginated } from "./common.js";
import { CountryCodeSchema } from "./countries.js";
import { ProgressSchema } from "./players.js";
import { TierSchema } from "./settings.js";

export const MissionKeySchema = z
  .string()
  .regex(/^[a-z0-9-]{2,40}$/, "lowercase slug")
  .openapi({ example: "malaria" });
export const MissionModeSchema = z.enum(["story", "practice"]).openapi("MissionMode");
export type MissionMode = z.infer<typeof MissionModeSchema>;

export const ReferenceSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    organization: z.string().nullable(),
    year: z.number().int().nullable(),
    type: z.string(),
    url: z.string().nullable(),
    doi: z.string().nullable(),
  })
  .openapi("Reference");
export type Reference = z.infer<typeof ReferenceSchema>;

export const VerificationSchema = z
  .object({
    reviewerName: z.string(),
    credentials: z.string(),
    approvedAt: z.string(),
    references: z.array(ReferenceSchema),
  })
  .openapi("Verification");

export const MissionSummarySchema = z
  .object({
    key: z.string(),
    title: z.string(),
    icon: z.string(),
    countryCode: z.string(),
    tier: z.number().int(),
    topics: z.array(z.string()),
    stepCount: z.number().int(),
    maxScore: z.number().int(),
    versionNumber: z.number().int(),
    offlineAvailable: z
      .boolean()
      .describe(
        "Can be downloaded as a mission pack and played offline (GET /missions/{key}/pack)",
      ),
    locked: z.boolean().describe("Story mode only; practice is never locked"),
    lockReason: z.enum(["tier", "country"]).nullable(),
    progress: z
      .object({ bestScore: z.number().int(), passed: z.boolean(), attempts: z.number().int() })
      .nullable(),
  })
  .openapi("MissionSummary");
export type MissionSummary = z.infer<typeof MissionSummarySchema>;

export const MissionListQuerySchema = z.object({
  mode: MissionModeSchema.default("story"),
  country: CountryCodeSchema.optional(),
  topic: z.string().trim().max(40).optional(),
});
export const MissionListResponseSchema = z
  .object({ items: z.array(MissionSummarySchema) })
  .openapi("MissionList");

export const MissionDetailSchema = MissionSummarySchema.extend({
  story: z.string(),
  learningObjectives: z.array(z.string()),
  verification: VerificationSchema,
}).openapi("MissionDetail");
export type MissionDetail = z.infer<typeof MissionDetailSchema>;

export const RandomMissionQuerySchema = z.object({
  mode: MissionModeSchema.default("practice"),
  exclude: MissionKeySchema.optional(),
});

// ---- Attempts ----------------------------------------------------------------------------

/** A choice as players see it: never contains correctness or feedback. */
export const PlayerChoiceSchema = z
  .object({ choiceId: z.string(), text: z.string() })
  .openapi("PlayerChoice");
export const PlayerStepSchema = z
  .object({
    stepId: z.string(),
    index: z.number().int(),
    prompt: z.string(),
    choices: z.array(PlayerChoiceSchema),
  })
  .openapi("PlayerStep");
export type PlayerStep = z.infer<typeof PlayerStepSchema>;

export const AnswerRevealSchema = z
  .object({
    choiceId: z.string(),
    correct: z.boolean(),
    correctChoiceId: z.string(),
    feedback: z.string().describe("Feedback for the chosen option (as in the prototype)"),
    critical: z
      .boolean()
      .describe("The chosen option was flagged by clinicians as a dangerous error"),
    reasoning: z.string().nullable(),
    answeredAt: z.string(),
  })
  .openapi("AnswerReveal");
export const AnsweredStepSchema = PlayerStepSchema.extend({ answer: AnswerRevealSchema }).openapi(
  "AnsweredStep",
);
export type AnsweredStep = z.infer<typeof AnsweredStepSchema>;

export const AttemptResultSchema = z
  .object({
    score: z.number().int(),
    maxScore: z.number().int(),
    correctCount: z.number().int(),
    passed: z.boolean(),
    criticalError: z.boolean(),
    firstPass: z.boolean(),
    rewards: z
      .object({ hp: z.number().int(), funding: z.number().int() })
      .describe("Actually awarded, incl. achievements"),
    progress: ProgressSchema,
    newlyUnlocked: z.object({ tiers: z.array(TierSchema), countries: z.array(z.string()) }),
    achievements: z.array(z.object({ key: z.string(), name: z.string() })),
    verification: VerificationSchema,
  })
  .openapi("AttemptResult");
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

export const ATTEMPT_STATUSES = ["in_progress", "completed", "abandoned", "expired"] as const;
export const AttemptSchema = z
  .object({
    id: z.string(),
    missionKey: z.string(),
    title: z.string(),
    icon: z.string(),
    mode: MissionModeSchema,
    status: z.enum(ATTEMPT_STATUSES),
    story: z.string(),
    stepCount: z.number().int(),
    steps: z
      .array(z.union([AnsweredStepSchema, PlayerStepSchema]))
      .describe("Answered steps plus the current step only"),
    currentStepIndex: z.number().int().nullable(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    result: z
      .object({
        score: z.number().int(),
        maxScore: z.number().int(),
        passed: z.boolean(),
        rewards: z.object({ hp: z.number().int(), funding: z.number().int() }),
      })
      .nullable(),
  })
  .openapi("Attempt");
export type Attempt = z.infer<typeof AttemptSchema>;

export const StartAttemptSchema = z
  .object({ missionKey: MissionKeySchema, mode: MissionModeSchema })
  .openapi("StartAttempt");
export type StartAttempt = z.infer<typeof StartAttemptSchema>;
export const SubmitAnswerSchema = z
  .object({
    stepId: z.string().min(1).max(20),
    choiceId: z.string().min(1).max(20),
    reasoning: z.string().trim().max(1500).optional(),
  })
  .openapi("SubmitAnswer");
export type SubmitAnswer = z.infer<typeof SubmitAnswerSchema>;
export const AnswerResponseSchema = z
  .object({
    step: AnsweredStepSchema,
    next: PlayerStepSchema.nullable(),
    result: AttemptResultSchema.nullable(),
  })
  .openapi("AnswerResponse");
export type AnswerResponse = z.infer<typeof AnswerResponseSchema>;

export const AttemptHistoryItemSchema = z
  .object({
    id: z.string(),
    missionKey: z.string(),
    title: z.string(),
    mode: MissionModeSchema,
    status: z.enum(ATTEMPT_STATUSES),
    score: z.number().int().nullable(),
    maxScore: z.number().int(),
    passed: z.boolean().nullable(),
    rewards: z.object({ hp: z.number().int(), funding: z.number().int() }).nullable(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .openapi("AttemptHistoryItem");
export const AttemptHistoryQuerySchema = PaginationQuerySchema.extend({
  missionKey: MissionKeySchema.optional(),
  mode: MissionModeSchema.optional(),
  status: z.enum(ATTEMPT_STATUSES).optional(),
});
export const AttemptHistoryPageSchema =
  paginated(AttemptHistoryItemSchema).openapi("AttemptHistoryPage");

// ---- Offline mission packs -----------------------------------------------------------------------

/**
 * Everything needed to play an offline-eligible mission without a connection — and nothing more:
 * no correct answers, feedback or critical flags (they are revealed by the server when the device syncs).
 */
export const MissionPackSchema = z
  .object({
    key: z.string(),
    versionNumber: z
      .number()
      .int()
      .describe("Send with the offline attempt.start event to detect content changes"),
    title: z.string(),
    icon: z.string(),
    story: z.string(),
    countryCode: z.string(),
    tier: z.number().int(),
    topics: z.array(z.string()),
    learningObjectives: z.array(z.string()),
    maxScore: z.number().int(),
    steps: z.array(PlayerStepSchema),
    verification: VerificationSchema,
    issuedAt: z.string(),
  })
  .openapi("MissionPack");
export type MissionPack = z.infer<typeof MissionPackSchema>;
