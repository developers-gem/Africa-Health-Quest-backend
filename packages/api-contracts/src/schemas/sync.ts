import { z } from "../zod.js";
import { CountrySchema } from "./countries.js";
import { AllocationSchema, HospitalRunSchema, HospitalSettingsSchema } from "./hospital.js";
import {
  AttemptHistoryItemSchema,
  MissionKeySchema,
  MissionModeSchema,
  MissionSummarySchema,
} from "./missions.js";
import { PlayerProfileSchema, ProgressSchema, UpdatePlayerProfileSchema } from "./players.js";
import { TierSchema } from "./settings.js";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "8–64 characters: letters, digits, - or _");

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
/** Refers to a server attempt id, or to an attempt started earlier in the same offline queue ("client:<ref>"). */
const AttemptRefSchema = z.union([objectId, z.string().regex(/^client:[A-Za-z0-9_-]{1,64}$/)]);

const base = {
  eventId: z.uuid(),
  occurredAt: z.iso.datetime().describe("Device time the action happened"),
};
export const SyncEventSchema = z
  .discriminatedUnion("type", [
    z.object({
      ...base,
      type: z.literal("attempt.start"),
      payload: z.object({
        missionKey: MissionKeySchema,
        mode: MissionModeSchema,
        clientRef: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        versionNumber: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            "Mission pack version played offline; rejected with CONFLICT (mission_changed) if outdated",
          ),
      }),
    }),
    z.object({
      ...base,
      type: z.literal("attempt.answer"),
      payload: z.object({
        attempt: AttemptRefSchema,
        stepId: z.string().max(20),
        choiceId: z.string().max(20),
        reasoning: z.string().trim().max(1500).optional(),
      }),
    }),
    z.object({
      ...base,
      type: z.literal("attempt.abandon"),
      payload: z.object({ attempt: AttemptRefSchema }),
    }),
    z.object({
      ...base,
      type: z.literal("hospital.run"),
      payload: z.object({ allocation: AllocationSchema }),
    }),
    z.object({ ...base, type: z.literal("profile.update"), payload: UpdatePlayerProfileSchema }),
  ])
  .openapi("SyncEvent");
export type SyncEvent = z.infer<typeof SyncEventSchema>;

export const SyncBatchSchema = z
  .object({ events: z.array(SyncEventSchema).min(1).max(50) })
  .openapi("SyncBatch");
export const SyncEventResultSchema = z
  .object({
    eventId: z.string(),
    type: z.string(),
    status: z
      .enum(["applied", "duplicate", "stale", "rejected"])
      .describe(
        "applied: processed now · duplicate: already processed (stored result returned) · stale: superseded by a newer change · rejected: not applicable (see code)",
      ),
    code: z.string().nullable(),
    message: z.string().nullable(),
    data: z.unknown().nullable().describe("Outcome (e.g. answer reveal, attempt id, shift result)"),
  })
  .openapi("SyncEventResult");
export const SyncBatchResultSchema = z
  .object({
    serverTime: z.string(),
    results: z.array(SyncEventResultSchema),
    progress: ProgressSchema,
  })
  .openapi("SyncBatchResult");

export const SyncStateQuerySchema = z.object({
  since: z.iso.datetime().optional().describe("serverTime from your previous sync"),
  progressVersion: z.coerce.number().int().min(0).optional(),
});
export const SyncStateSchema = z
  .object({
    serverTime: z.string().describe("Use as `since` next time"),
    progress: ProgressSchema.nullable().describe("null when progressVersion is current"),
    profile: PlayerProfileSchema.nullable().describe("null when unchanged since `since`"),
    attempts: z
      .array(AttemptHistoryItemSchema)
      .describe("In-progress attempts plus attempts changed since `since`"),
    hospitalRuns: z.array(HospitalRunSchema).describe("Runs since `since`"),
  })
  .openapi("SyncState");

export const CatalogSchema = z
  .object({
    etag: z.string(),
    tiers: z.array(TierSchema),
    countries: z.array(CountrySchema),
    missions: z.array(MissionSummarySchema),
    hospital: HospitalSettingsSchema.pick({
      unitCost: true,
      maxUnitsPerResource: true,
      resources: true,
    }),
    minAppVersion: z.object({ android: z.string(), ios: z.string() }),
  })
  .openapi("Catalog");

export const MergeGuestSchema = z
  .object({
    guestAccessToken: z
      .string()
      .min(20)
      .max(4096)
      .describe("Access token of the guest session being merged"),
  })
  .openapi("MergeGuest");
export const MergeGuestResultSchema = z
  .object({
    attemptsMerged: z.number().int(),
    missionsCompleted: z.number().int(),
    hpAdded: z.number().int(),
    fundingAdded: z.number().int(),
    progress: ProgressSchema,
  })
  .openapi("MergeGuestResult");
