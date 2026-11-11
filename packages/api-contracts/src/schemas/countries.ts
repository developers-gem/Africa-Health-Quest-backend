import { z } from "../zod.js";

export const AU_REGIONS = ["northern", "western", "central", "eastern", "southern"] as const;
export const CountryRegionSchema = z.enum(AU_REGIONS);
export const COUNTRY_STATUSES = ["active", "coming_soon", "hidden"] as const;
export const CountryStatusSchema = z.enum(COUNTRY_STATUSES);
export const CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2 code")
  .openapi({ example: "NG" });

export const UnlockRequirementsSchema = z
  .object({ minHp: z.number().int().min(0), minTierIndex: z.number().int().min(0).max(19) })
  .openapi("UnlockRequirements");
export type UnlockRequirements = z.infer<typeof UnlockRequirementsSchema>;

export const CountrySchema = z
  .object({
    code: z.string(),
    name: z.string(),
    region: CountryRegionSchema,
    flagEmoji: z.string(),
    flagUrl: z.string().nullable(),
    imageUrl: z.string().nullable(),
    focus: z.string(),
    description: z.string(),
    healthPriorities: z.array(z.string()),
    languages: z.array(z.string()),
    currencyLabel: z.string().nullable(),
    status: CountryStatusSchema,
    unlock: UnlockRequirementsSchema,
    sortOrder: z.number().int(),
    missionCount: z.number().int(),
    unlocked: z.boolean().optional().describe("Present when the caller is signed in"),
  })
  .openapi("Country");
export type Country = z.infer<typeof CountrySchema>;
export const CountryListResponseSchema = z
  .object({ items: z.array(CountrySchema) })
  .openapi("CountryList");

// ---- Administration --------------------------------------------------------------------------

const text = (max: number) => z.string().trim().max(max);
export const CountryContentFieldsSchema = z.object({
  name: z.string().trim().min(2).max(80),
  region: CountryRegionSchema,
  focus: text(160),
  description: text(2000),
  healthPriorities: z.array(z.string().trim().min(1).max(80)).max(10),
  languages: z.array(z.string().trim().min(1).max(40)).max(10),
  currencyLabel: text(40).nullable(),
  status: CountryStatusSchema,
  unlock: UnlockRequirementsSchema,
  sortOrder: z.number().int().min(0).max(100_000),
  flagAssetId: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .nullable(),
  imageAssetId: z
    .string()
    .regex(/^[a-f0-9]{24}$/)
    .nullable(),
});
export const CountryCreateSchema = CountryContentFieldsSchema.partial()
  .extend({
    code: CountryCodeSchema,
    name: z.string().trim().min(2).max(80),
    region: CountryRegionSchema,
  })
  .strict()
  .openapi("CountryCreate");
export type CountryCreate = z.infer<typeof CountryCreateSchema>;
export const CountryUpdateSchema = CountryContentFieldsSchema.partial()
  .strict()
  .openapi("CountryUpdate");
export type CountryUpdate = z.infer<typeof CountryUpdateSchema>;
export const AdminCountrySchema = CountrySchema.extend({
  flagAssetId: z.string().nullable(),
  imageAssetId: z.string().nullable(),
  updatedAt: z.string(),
}).openapi("AdminCountry");
export const AdminCountryListQuerySchema = z.object({
  status: CountryStatusSchema.optional(),
  region: CountryRegionSchema.optional(),
  search: z.string().trim().max(80).optional(),
});
export const AssignMissionsSchema = z
  .object({
    missionKeys: z
      .array(z.string().regex(/^[a-z0-9-]{2,40}$/))
      .min(1)
      .max(100),
  })
  .openapi("AssignMissions");
export const AssignMissionsResultSchema = z
  .object({
    items: z.array(
      z.object({
        missionKey: z.string(),
        action: z.enum(["unchanged", "draft_created", "draft_updated"]),
        versionNumber: z.number().int().nullable(),
      }),
    ),
    note: z.string(),
  })
  .openapi("AssignMissionsResult");
