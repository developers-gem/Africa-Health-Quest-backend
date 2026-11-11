import { HOSPITAL_RESOURCES } from "@ahq/shared-types";
import { z } from "../zod.js";
import { PaginationQuerySchema, paginated } from "./common.js";
import { ProgressSchema } from "./players.js";
import { TierSchema } from "./settings.js";

export const HospitalResourceSchema = z.enum(HOSPITAL_RESOURCES);
const counts = (min: number, max: number) =>
  z.object(
    Object.fromEntries(
      HOSPITAL_RESOURCES.map((r) => [r, z.number().int().min(min).max(max)]),
    ) as Record<(typeof HOSPITAL_RESOURCES)[number], z.ZodNumber>,
  );

export const HospitalSettingsSchema = z
  .object({
    unitCost: z.number().int().min(1).max(10_000),
    hpPerNeedMet: z.number().int().min(0).max(10_000),
    fundingPerNeedMet: z.number().int().min(0).max(10_000),
    maxUnitsPerResource: z.number().int().min(1).max(1000),
    resources: z
      .array(
        z.object({
          key: HospitalResourceSchema,
          name: z.string().min(1).max(40),
          icon: z.string().min(1).max(16),
        }),
      )
      .length(HOSPITAL_RESOURCES.length),
  })
  .openapi("HospitalSettings");
export type HospitalSettings = z.infer<typeof HospitalSettingsSchema>;

export const AllocationSchema = counts(0, 1000)
  .refine((a) => Object.values(a).some((v) => v > 0), "Allocate at least one unit")
  .openapi("Allocation");
export type Allocation = z.infer<typeof AllocationSchema>;
export const StartShiftSchema = z.object({ allocation: AllocationSchema }).openapi("StartShift");

export const HospitalStateSchema = z
  .object({
    budget: z.number().int().describe("Current funding"),
    hospitalLevel: TierSchema,
    unitCost: z.number().int(),
    maxUnitsPerResource: z.number().int(),
    maxAffordableUnits: z.number().int(),
    resources: HospitalSettingsSchema.shape.resources,
    rewardsPerNeedMet: z.object({ hp: z.number().int(), funding: z.number().int() }),
    recent: z.object({
      shifts: z.number().int(),
      averageNeedsMet: z.number().nullable(),
      averageEfficiencyPercent: z.number().nullable(),
    }),
  })
  .openapi("HospitalState");

export const ResourceOutcomeSchema = z.object({
  resource: HospitalResourceSchema,
  allocated: z.number().int(),
  needed: z.number().int(),
  met: z.boolean(),
  surplus: z.number().int(),
  shortfall: z.number().int(),
});
export const HospitalRunSchema = z
  .object({
    id: z.string(),
    allocation: counts(0, 1000),
    cost: z.number().int(),
    event: z.object({ key: z.string(), text: z.string(), needs: counts(0, 1000) }),
    needsMet: z.number().int(),
    outcomes: z.array(ResourceOutcomeSchema),
    performance: z.object({
      coveragePercent: z.number().int(),
      efficiencyPercent: z.number().int().describe("Share of allocated units that met a need"),
      wastedUnits: z.number().int(),
      rating: z.enum(["excellent", "good", "fair", "poor"]),
    }),
    rewards: z
      .object({ hp: z.number().int(), funding: z.number().int() })
      .describe("Gross rewards (funding before cost)"),
    netFundingChange: z.number().int(),
    summary: z.string().describe('Prototype wording: "{event} You covered k/4 needs. +N HP."'),
    createdAt: z.string(),
  })
  .openapi("HospitalRun");
export type HospitalRun = z.infer<typeof HospitalRunSchema>;
export const ShiftResultSchema = HospitalRunSchema.extend({
  progress: ProgressSchema,
  achievements: z.array(z.object({ key: z.string(), name: z.string() })),
}).openapi("ShiftResult");
export const HospitalRunPageSchema = paginated(HospitalRunSchema).openapi("HospitalRunPage");
export const HospitalRunQuerySchema = PaginationQuerySchema;

export const HospitalEventInputSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]{2,40}$/),
    text: z.string().trim().min(5).max(200),
    needs: counts(0, 50),
    weight: z.number().int().min(1).max(100).default(1),
    minTierIndex: z.number().int().min(0).max(19).default(0),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(54)
      .default([]),
    status: z.enum(["active", "retired"]).default("active"),
  })
  .openapi("HospitalEventInput");
export type HospitalEventInput = z.infer<typeof HospitalEventInputSchema>;
export const HospitalEventUpdateSchema = HospitalEventInputSchema.omit({ key: true })
  .partial()
  .openapi("HospitalEventUpdate");
export const HospitalEventSchema = HospitalEventInputSchema.extend({
  updatedAt: z.string(),
}).openapi("HospitalEvent");
