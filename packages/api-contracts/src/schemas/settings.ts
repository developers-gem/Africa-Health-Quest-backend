import { z } from "../zod.js";

/** Game economy (prototype rules + approved audit recommendations; admins can version changes). */
export const EconomySettingsSchema = z
  .object({
    pointsPerCorrectStep: z.number().int().min(1).max(1000),
    passThreshold: z.number().min(0).max(1),
    criticalChoiceFails: z.boolean(),
    startingHp: z.number().int().min(0),
    startingFunding: z.number().int().min(0),
    firstPassHpFactor: z.number().min(0).max(10),
    firstPassFundingFactor: z.number().min(0).max(10),
    completionRequiresPass: z.boolean(),
    replayHpFactor: z.number().min(0).max(1),
    replayHpBasis: z.enum(["score", "improvement"]),
    replayFundingFactor: z.number().min(0).max(10),
    practiceAwardsRewards: z.boolean(),
    shuffleChoices: z.boolean(),
  })
  .openapi("EconomySettings");
export type EconomySettings = z.infer<typeof EconomySettingsSchema>;

export const TierSchema = z
  .object({
    index: z.number().int().min(0),
    key: z.string().regex(/^[a-z0-9_]{2,40}$/),
    name: z.string().min(1).max(60),
    icon: z.string().min(1).max(16),
    hpRequired: z.number().int().min(0),
  })
  .openapi("Tier");
export type Tier = z.infer<typeof TierSchema>;

export const ProgressionSettingsSchema = z
  .object({
    tiers: z
      .array(TierSchema)
      .min(1)
      .max(20)
      .refine((t) => t.every((x, i) => x.index === i), "tier indexes must be 0..n-1 in order")
      .refine((t) => t[0]?.hpRequired === 0, "the first tier must require 0 HP")
      .refine(
        (t) => t.every((x, i) => i === 0 || x.hpRequired > t[i - 1]!.hpRequired),
        "HP thresholds must increase",
      ),
  })
  .openapi("ProgressionSettings");
export type ProgressionSettings = z.infer<typeof ProgressionSettingsSchema>;
