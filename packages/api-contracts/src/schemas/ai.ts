import { z } from "../zod.js";
import { LearnerLevelSchema } from "./players.js";

// ---- Settings (platformSettings key "ai") -------------------------------------------------------

export const AI_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] as const;
export const AiModelSchema = z.enum(AI_MODELS);
const PriceSchema = z.object({
  inputPerMTok: z.number().min(0),
  outputPerMTok: z.number().min(0),
  cacheReadPerMTok: z.number().min(0),
});
export const AiSettingsSchema = z
  .object({
    enabled: z.boolean().describe("Kill switch: false stops all debrief generation"),
    model: AiModelSchema,
    effort: z.enum(["low", "medium", "high"]),
    refusalFallback: z
      .boolean()
      .describe(
        "Let the API re-run a safety-declined request on Anthropic's recommended fallback model",
      ),
    dailyQuotaRegistered: z.number().int().min(0).max(100),
    dailyQuotaGuest: z.number().int().min(0).max(100),
    monthlyBudgetUsd: z.number().min(0).max(1_000_000),
    burstPerMinute: z
      .number()
      .int()
      .min(1)
      .max(30)
      .default(3)
      .describe("Debrief requests one user may start per minute"),
    fallbackModel: AiModelSchema.nullable()
      .default(null)
      .describe(
        "Model to retry once on when the configured model is unavailable (overloaded, rate-limited); null = no fallback",
      ),
    prices: z.record(z.string(), PriceSchema).describe("USD per million tokens, per model"),
  })
  .openapi("AiSettings");
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** Response format sent to the model (AI architecture §6), validated after every generation. */
export const DebriefOutputSchema = z.object({
  overall: z.string().min(1).max(1200),
  decisions: z
    .array(z.object({ stepId: z.string(), explanation: z.string().min(1).max(1200) }))
    .min(1)
    .max(10),
  strengths: z.array(z.string().min(1).max(300)).min(1).max(3),
  knowledgeGaps: z.array(z.string().min(1).max(300)).max(3),
  teachingPoints: z.array(z.string().min(1).max(300)).min(3).max(5),
  recommendedTopics: z.array(z.string()).max(3),
  practiceQuestions: z.array(z.string().min(1).max(300)).length(2),
  citedReferenceIds: z.array(z.string()).max(10),
});
export type DebriefOutput = z.infer<typeof DebriefOutputSchema>;

// ---- Player-facing ------------------------------------------------------------------------------

export const DEBRIEF_STATUSES = ["pending", "completed", "failed"] as const;
export const DEBRIEF_FAILURES = [
  "provider_unavailable",
  "refused",
  "invalid_output",
  "interrupted",
] as const;
export const DebriefSchema = z
  .object({
    id: z.string(),
    attemptId: z.string(),
    missionKey: z.string(),
    level: LearnerLevelSchema,
    status: z.enum(DEBRIEF_STATUSES),
    failureReason: z.enum(DEBRIEF_FAILURES).nullable(),
    overall: z.string().nullable(),
    decisions: z.array(
      z.object({
        stepId: z.string(),
        prompt: z.string(),
        chosenText: z.string(),
        correct: z.boolean().describe("From the recorded attempt, never from the model"),
        explanation: z.string(),
      }),
    ),
    strengths: z.array(z.string()).describe("Empty for debriefs generated before prompt v2"),
    knowledgeGaps: z.array(z.string()),
    teachingPoints: z.array(z.string()),
    recommendedTopics: z
      .array(
        z.object({
          topic: z.string().describe("A topic of the approved case catalogue"),
          missions: z
            .array(z.object({ key: z.string(), title: z.string() }))
            .describe("Approved cases on this topic the learner can open"),
        }),
      )
      .describe("Chosen by the model only from topics of clinician-approved cases"),
    practiceQuestions: z.array(z.string()),
    references: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        organization: z.string().nullable(),
        year: z.number().int().nullable(),
        url: z.string().nullable(),
      }),
    ),
    aiGenerated: z
      .literal(true)
      .describe(
        "Always true: this is AI-generated educational feedback, labelled as such in every client",
      ),
    disclaimer: z.string(),
    createdAt: z.string(),
    completedAt: z.string().nullable(),
  })
  .openapi("Debrief");
export type Debrief = z.infer<typeof DebriefSchema>;

export const RequestDebriefSchema = z
  .object({
    level: LearnerLevelSchema,
    regenerate: z
      .boolean()
      .optional()
      .describe("Generate a new debrief even if one exists for this level"),
  })
  .openapi("RequestDebrief");
export const DebriefListSchema = z.object({ items: z.array(DebriefSchema) }).openapi("DebriefList");

export const DebriefFlagSchema = z
  .object({
    reason: z.enum(["inaccurate", "unsafe", "unhelpful", "other"]),
    comment: z.string().trim().max(1000).optional(),
  })
  .openapi("DebriefFlag");

export const AiStatusSchema = z
  .object({
    enabled: z
      .boolean()
      .describe("False when AI is switched off, not configured, or the monthly budget is used"),
    consentRequired: z
      .boolean()
      .describe("The user must accept AI processing before the first debrief"),
    limit: z.number().int(),
    used: z.number().int(),
    resetsAt: z.string(),
  })
  .openapi("AiStatus");
export const AiConsentSchema = z.object({ accepted: z.literal(true) }).openapi("AiConsent");

// ---- Admin / reviewer ---------------------------------------------------------------------------

export const AiUsageQuerySchema = z.object({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export const AiUsageSchema = z
  .object({
    period: z.object({ from: z.string(), to: z.string() }),
    provider: z.enum(["anthropic", "fake", "disabled"]),
    series: z.array(
      z.object({
        day: z.string(),
        requests: z.number().int(),
        failed: z.number().int(),
        refused: z.number().int(),
        inputTokens: z.number().int(),
        outputTokens: z.number().int(),
        costUsd: z.number(),
        p95LatencyMs: z.number().nullable(),
      }),
    ),
    byModel: z.array(
      z.object({ model: z.string(), requests: z.number().int(), costUsd: z.number() }),
    ),
    budget: z.object({ monthUsd: z.number(), capUsd: z.number(), percent: z.number() }),
    totals: z.object({
      requests: z.number().int(),
      completed: z.number().int(),
      refused: z.number().int(),
      invalidOutput: z.number().int(),
      providerUnavailable: z.number().int(),
      rateLimited: z.number().int().describe("Provider calls rejected by Anthropic's rate limits"),
      fallbackCalls: z.number().int().describe("Calls served by the fallback model"),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cacheReadTokens: z.number().int(),
      cacheCreationTokens: z.number().int(),
      costUsd: z.number(),
      costPerCompletedDebriefUsd: z.number().nullable(),
    }),
    byLevel: z.array(
      z.object({
        level: z.string(),
        debriefs: z.number().int(),
        completed: z.number().int(),
        flagged: z.number().int(),
      }),
    ),
    quotaRejections: z
      .number()
      .int()
      .describe(
        "Requests refused by the per-user daily quota or burst limit (not sent to the provider)",
      ),
  })
  .openapi("AiUsage");

export const AiProviderStatusSchema = z
  .object({
    provider: z.enum(["anthropic", "fake", "disabled"]),
    keyConfigured: z
      .boolean()
      .describe("Whether the server has an API key (the key itself is never returned)"),
    enabled: z.boolean(),
    model: AiModelSchema,
    effort: z.enum(["low", "medium", "high"]),
    fallbackModel: AiModelSchema.nullable(),
    refusalFallback: z.boolean(),
    promptVersion: z.string(),
    availableModels: z.array(AiModelSchema),
    available: z
      .boolean()
      .describe("False when switched off, not configured or the monthly budget is used"),
  })
  .openapi("AiProviderStatus");

export const AiFlagItemSchema = z
  .object({
    debriefId: z.string(),
    missionKey: z.string(),
    level: LearnerLevelSchema,
    reason: z.string(),
    comment: z.string().nullable(),
    flaggedAt: z.string(),
    debrief: DebriefSchema,
  })
  .openapi("AiFlagItem");
export const AiFlagListSchema = z
  .object({ items: z.array(AiFlagItemSchema) })
  .openapi("AiFlagList");
