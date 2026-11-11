import { PERMISSIONS, ROLES } from "@ahq/shared-types";
import { z } from "../zod.js";
import { ObjectIdSchema, PaginationQuerySchema, paginated } from "./common.js";

// ---- Platform settings -------------------------------------------------------------------------

export const SETTING_KEYS = ["economy", "progression", "hospital", "ai"] as const;
export const SettingKeySchema = z.enum(SETTING_KEYS).openapi("SettingKey");
export type SettingKeyName = z.infer<typeof SettingKeySchema>;

export const SettingVersionSchema = z
  .object({
    key: SettingKeySchema,
    version: z.number().int(),
    status: z.enum(["active", "archived"]),
    value: z.record(z.string(), z.unknown()),
    changeNote: z.string(),
    createdBy: z.string(),
    createdAt: z.string(),
  })
  .openapi("SettingVersion");
export const SettingListSchema = z
  .object({ items: z.array(SettingVersionSchema) })
  .openapi("SettingList");
export const SettingHistoryPageSchema =
  paginated(SettingVersionSchema).openapi("SettingHistoryPage");

export const UpdateSettingSchema = z
  .object({
    value: z.record(z.string(), z.unknown()).describe("Complete new value (validated per key)"),
    changeNote: z.string().trim().min(3).max(500),
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .describe("Active version you edited; 412 PRECONDITION_FAILED if it changed meanwhile"),
  })
  .openapi("UpdateSetting");

// ---- Audit log ---------------------------------------------------------------------------------

export const AuditLogQuerySchema = PaginationQuerySchema.extend({
  action: z
    .string()
    .regex(/^[a-z0-9_.-]{2,60}$/)
    .optional()
    .describe("Exact action, or a prefix ending in '.' (e.g. `user.`)"),
  actorId: ObjectIdSchema.optional(),
  targetType: z
    .string()
    .regex(/^[A-Za-z]{2,40}$/)
    .optional(),
  targetId: z.string().max(80).optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});
export const AuditLogEntrySchema = z
  .object({
    id: z.string(),
    actorId: z.string(),
    actorRoles: z.array(z.string()),
    action: z.string(),
    targetType: z.string(),
    targetId: z.string(),
    before: z.unknown().nullable(),
    after: z.unknown().nullable(),
    reason: z.string().nullable(),
    requestId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("AuditLogEntry");
export const AuditLogPageSchema = paginated(AuditLogEntrySchema).openapi("AuditLogPage");

// ---- Analytics ---------------------------------------------------------------------------------

export const AnalyticsRangeQuerySchema = z.object({
  from: z.iso.datetime().optional().describe("Start (inclusive); default 30 days before `to`"),
  to: z.iso.datetime().optional().describe("End (exclusive); default now. Maximum range 366 days"),
});
export const MissionAnalyticsQuerySchema = AnalyticsRangeQuerySchema.extend({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});
const PeriodSchema = z.object({ from: z.string(), to: z.string() });

export const AnalyticsOverviewSchema = z
  .object({
    period: PeriodSchema,
    activePlayers: z
      .object({ daily: z.number().int(), weekly: z.number().int(), monthly: z.number().int() })
      .describe("Distinct users with a session used in the 1/7/30 days before `to`"),
    users: z.object({
      registered: z.number().int(),
      guests: z.number().int(),
      suspended: z.number().int(),
      byRole: z.record(z.string(), z.number().int()),
    }),
    newRegistrations: z.number().int(),
    guestConversions: z
      .number()
      .int()
      .describe("Guests who registered (upgrade or merge) in the period"),
    attemptsStarted: z.number().int(),
    attemptsCompleted: z.number().int(),
    attemptsAbandoned: z.number().int(),
    storyPassRate: z.number().nullable(),
    averageScorePct: z.number().nullable(),
    shifts: z.number().int(),
    averageNeedsMetPct: z.number().nullable(),
    content: z.object({
      missionsByStatus: z.record(z.string(), z.number().int()),
      versionsAwaitingReview: z.number().int(),
      openReviewAssignments: z.number().int(),
      pendingClinicianVerifications: z.number().int(),
    }),
    sync: z.object({ eventsProcessed: z.number().int(), eventsRejected: z.number().int() }),
  })
  .openapi("AnalyticsOverview");

export const MissionAnalyticsSchema = z
  .object({
    period: PeriodSchema,
    items: z.array(
      z.object({
        missionKey: z.string(),
        versionNumber: z.number().int(),
        countryCode: z.string(),
        attempts: z.number().int(),
        completed: z.number().int(),
        completionRate: z.number().nullable(),
        passRate: z.number().nullable(),
        avgScorePct: z.number().nullable(),
        choiceDistribution: z
          .array(z.object({ stepId: z.string(), choiceId: z.string(), count: z.number().int() }))
          .describe("How often each option was chosen (helps clinicians spot confusing steps)"),
      }),
    ),
  })
  .openapi("MissionAnalytics");

export const FunnelSchema = z
  .object({
    period: PeriodSchema,
    steps: z.array(z.object({ name: z.string(), count: z.number().int() })),
    note: z.string(),
  })
  .openapi("Funnel");

// ---- Roles catalogue and erasure ---------------------------------------------------------------

export const RoleCatalogSchema = z
  .object({
    roles: z.array(
      z.object({
        role: z.enum(ROLES),
        name: z.string(),
        description: z.string(),
        permissions: z.array(z.enum(PERMISSIONS)),
        sessionPolicy: z.object({
          idleHours: z.number(),
          absoluteDays: z.number(),
          mfaRequired: z.boolean(),
        }),
      }),
    ),
    permissions: z.array(z.enum(PERMISSIONS)),
  })
  .openapi("RoleCatalog");

export const EraseUserSchema = z
  .object({
    reason: z.string().trim().min(3).max(500),
    confirmEmail: z
      .email()
      .describe("Must match the account's email (guards against wrong-target deletes)"),
  })
  .openapi("EraseUser");
export const EraseUserResultSchema = z
  .object({ userId: z.string(), documentsDeleted: z.number().int() })
  .openapi("EraseUserResult");
