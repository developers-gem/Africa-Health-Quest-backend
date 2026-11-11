import { z } from "../zod.js";
import { PaginationQuerySchema, paginated } from "./common.js";
import { CountryCodeSchema } from "./countries.js";
import { MissionKeySchema, ReferenceSchema } from "./missions.js";

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Must be a valid id");

// ---- Clinician (reviewer) profiles ----------------------------------------------------------
export const CLINICIAN_PROFESSIONS = [
  "doctor",
  "nurse",
  "midwife",
  "pharmacist",
  "clinical_officer",
  "community_health_officer",
  "other",
] as const;
export const ClinicianProfileInputSchema = z
  .object({
    fullName: z.string().trim().min(3).max(120),
    credentials: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .describe('As displayed to players, e.g. "MBBS, FWACP (Paediatrics)"'),
    profession: z.enum(CLINICIAN_PROFESSIONS),
    registrationBody: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("e.g. Medical and Dental Council of Nigeria"),
    registrationNumber: z.string().trim().min(2).max(60),
    countryCode: CountryCodeSchema,
    evidenceAssetIds: z.array(objectId).max(5).default([]),
  })
  .strict()
  .openapi("ClinicianProfileInput");
export type ClinicianProfileInput = z.infer<typeof ClinicianProfileInputSchema>;

export const CLINICIAN_STATUSES = ["pending", "verified", "rejected"] as const;
export const ClinicianProfileSchema = z
  .object({
    fullName: z.string(),
    credentials: z.string(),
    profession: z.enum(CLINICIAN_PROFESSIONS),
    registrationBody: z.string(),
    registrationNumberMasked: z.string(),
    countryCode: z.string(),
    evidence: z.array(z.object({ id: z.string(), contentType: z.string() })),
    status: z.enum(CLINICIAN_STATUSES),
    submittedAt: z.string(),
    verifiedAt: z.string().nullable(),
    rejectionReason: z.string().nullable(),
  })
  .openapi("ClinicianProfile");
export type ClinicianProfile = z.infer<typeof ClinicianProfileSchema>;
export const AdminClinicianSchema = ClinicianProfileSchema.extend({
  userId: z.string(),
  email: z.string().nullable(),
  roles: z.array(z.string()),
  registrationNumber: z.string().describe("Decrypted — visible to credential verifiers only"),
}).openapi("AdminClinician");
export const ClinicianVerificationSchema = z
  .object({ decision: z.enum(["verified", "rejected"]), reason: z.string().trim().min(3).max(500) })
  .openapi("ClinicianVerification");

// ---- Authoring (admins, D5) -------------------------------------------------------------------
export const ChoiceInputSchema = z.object({
  choiceId: z.string().regex(/^s\d+c\d+$/),
  text: z.string().trim().min(1).max(200),
  correct: z.boolean(),
  feedback: z.string().trim().min(1).max(500),
  critical: z.boolean().default(false),
});
export const StepInputSchema = z.object({
  stepId: z.string().regex(/^s\d+$/),
  prompt: z.string().trim().min(1).max(300),
  choices: z
    .array(ChoiceInputSchema)
    .min(2)
    .max(6)
    .refine(
      (c) => c.filter((x) => x.correct).length === 1,
      "Each step needs exactly one correct choice",
    )
    .refine(
      (c) => c.every((x) => !(x.correct && x.critical)),
      "A correct choice cannot be critical",
    )
    .refine(
      (c) => new Set(c.map((x) => x.choiceId)).size === c.length,
      "Choice ids must be unique",
    ),
});
export const VersionContentInputSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    story: z.string().trim().min(10).max(2000),
    countryCode: CountryCodeSchema,
    learningObjectives: z.array(z.string().trim().min(3).max(200)).max(5).default([]),
    steps: z
      .array(StepInputSchema)
      .min(1)
      .max(10)
      .refine((s) => new Set(s.map((x) => x.stepId)).size === s.length, "Step ids must be unique")
      .refine(
        (s) =>
          s.every((step) => step.choices.every((c) => c.choiceId.startsWith(`${step.stepId}c`))),
        "Choice ids must start with their step id",
      ),
  })
  .openapi("VersionContentInput");
export type VersionContentInput = z.infer<typeof VersionContentInputSchema>;

export const MissionPlacementSchema = z.object({
  tier: z.number().int().min(0).max(19),
  icon: z.string().trim().min(1).max(16),
  sortOrder: z.number().int().min(0).max(100_000),
  topics: z.array(z.string().trim().min(1).max(40)).max(10),
  offlineEligible: z
    .boolean()
    .describe("Allow players to download this mission (without answer keys) and play it offline"),
});
export const CreateMissionSchema = MissionPlacementSchema.partial()
  .extend({
    key: MissionKeySchema,
    tier: z.number().int().min(0).max(19),
    icon: z.string().trim().min(1).max(16),
    content: VersionContentInputSchema,
    referenceIds: z.array(objectId).max(10).default([]),
  })
  .strict()
  .openapi("CreateMission");
export const UpdatePlacementSchema = MissionPlacementSchema.partial()
  .strict()
  .openapi("UpdatePlacement");
export const UpdateDraftSchema = z
  .object({
    content: VersionContentInputSchema.optional(),
    referenceIds: z.array(objectId).max(10).optional(),
    changeSummary: z.string().trim().max(500).optional(),
    expectedUpdatedAt: z
      .string()
      .describe("updatedAt from your last read (optimistic concurrency)"),
  })
  .strict()
  .openapi("UpdateDraft");
export const SubmitVersionSchema = z
  .object({ changeSummary: z.string().trim().min(3).max(500) })
  .openapi("SubmitVersion");

export const VERSION_STATUSES = [
  "draft",
  "in_review",
  "changes_requested",
  "approved",
  "published",
  "superseded",
  "withdrawn",
] as const;
export const FullChoiceSchema = ChoiceInputSchema.extend({ critical: z.boolean() });
export const FullVersionSchema = z
  .object({
    id: z.string(),
    missionId: z.string(),
    missionKey: z.string(),
    versionNumber: z.number().int(),
    status: z.enum(VERSION_STATUSES),
    locale: z.string(),
    content: z.object({
      title: z.string(),
      story: z.string(),
      countryCode: z.string(),
      learningObjectives: z.array(z.string()),
      steps: z.array(
        z.object({ stepId: z.string(), prompt: z.string(), choices: z.array(FullChoiceSchema) }),
      ),
    }),
    references: z.array(ReferenceSchema),
    contentHash: z.string().nullable(),
    authoredBy: z.array(z.string()),
    changeSummary: z.string().nullable(),
    basedOnVersionNumber: z.number().int().nullable(),
    submittedAt: z.string().nullable(),
    publishedAt: z.string().nullable(),
    updatedAt: z.string(),
  })
  .openapi("FullMissionVersion");
export type FullVersion = z.infer<typeof FullVersionSchema>;

export const VersionDiffSchema = z
  .object({
    against: z.number().int().nullable(),
    changes: z.array(z.object({ path: z.string(), before: z.unknown(), after: z.unknown() })),
  })
  .openapi("VersionDiff");

export const AdminMissionSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    countryCode: z.string(),
    tier: z.number().int(),
    icon: z.string(),
    sortOrder: z.number().int(),
    topics: z.array(z.string()),
    offlineEligible: z.boolean(),
    status: z.enum(["draft", "published", "withdrawn", "retired"]),
    published: z
      .object({
        versionNumber: z.number().int(),
        title: z.string(),
        approvedAt: z.string(),
        reviewerName: z.string(),
      })
      .nullable(),
    openVersion: z
      .object({ id: z.string(), versionNumber: z.number().int(), status: z.enum(VERSION_STATUSES) })
      .nullable(),
    latestVersionNumber: z.number().int(),
    updatedAt: z.string(),
  })
  .openapi("AdminMission");
export const AdminMissionListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["draft", "published", "withdrawn", "retired"]).optional(),
  country: CountryCodeSchema.optional(),
  search: z.string().trim().max(80).optional(),
});
export const AdminMissionPageSchema = paginated(AdminMissionSchema).openapi("AdminMissionPage");
export const RollbackSchema = z
  .object({ versionNumber: z.number().int().min(1), reason: z.string().trim().min(3).max(500) })
  .openapi("Rollback");

// ---- Reviews -----------------------------------------------------------------------------------
export const ReviewDecisionInputSchema = z
  .object({
    decision: z.enum(["approved", "changes_requested"]),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .describe("Hash of the version you reviewed (guards against concurrent edits)"),
    checks: z.object({ scenario: z.boolean(), treatment: z.boolean(), references: z.boolean() }),
    referenceIds: z.array(objectId).max(20).default([]),
    notes: z.string().trim().max(4000).default(""),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "approved") {
      if (!v.checks.scenario || !v.checks.treatment || !v.checks.references)
        ctx.addIssue({
          code: "custom",
          path: ["checks"],
          message: "All three checks are required to approve",
        });
      if (!v.referenceIds.length)
        ctx.addIssue({
          code: "custom",
          path: ["referenceIds"],
          message: "At least one reference is required to approve",
        });
    } else if (v.notes.length < 10) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Describe the changes needed (at least 10 characters)",
      });
    }
  })
  .openapi("ReviewDecisionInput");
export type ReviewDecisionInput = z.infer<typeof ReviewDecisionInputSchema>;

export const ReviewSchema = z
  .object({
    id: z.string(),
    missionKey: z.string(),
    versionNumber: z.number().int(),
    contentHash: z.string(),
    decision: z.enum(["approved", "changes_requested"]),
    checks: z.object({ scenario: z.boolean(), treatment: z.boolean(), references: z.boolean() }),
    references: z.array(ReferenceSchema),
    notes: z.string(),
    reviewer: z.object({
      id: z.string(),
      name: z.string(),
      credentials: z.string(),
      profession: z.string(),
    }),
    createdAt: z.string(),
  })
  .openapi("Review");

export const ReviewQueueItemSchema = z
  .object({
    versionId: z.string(),
    missionKey: z.string(),
    title: z.string(),
    countryCode: z.string(),
    versionNumber: z.number().int(),
    status: z.enum(VERSION_STATUSES),
    submittedAt: z.string().nullable(),
    assignedToMe: z.boolean(),
    assignees: z.array(z.object({ reviewerId: z.string(), name: z.string() })),
    isUpdate: z.boolean().describe("A newer version of an already-published mission"),
  })
  .openapi("ReviewQueueItem");
export const ReviewQueueQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(["in_review", "changes_requested", "published"]).default("in_review"),
  assigned: z.enum(["me", "any"]).default("any"),
  country: CountryCodeSchema.optional(),
});
export const ReviewQueuePageSchema = paginated(ReviewQueueItemSchema).openapi("ReviewQueuePage");
export const ReviewVersionDetailSchema = z
  .object({
    version: FullVersionSchema,
    diffFromPublished: VersionDiffSchema,
    reviews: z.array(ReviewSchema),
    canDecide: z.boolean(),
    cannotDecideReason: z.string().nullable(),
  })
  .openapi("ReviewVersionDetail");
export const MissionHistorySchema = z
  .object({
    missionKey: z.string(),
    versions: z.array(
      z.object({
        id: z.string(),
        versionNumber: z.number().int(),
        status: z.enum(VERSION_STATUSES),
        contentHash: z.string().nullable(),
        submittedAt: z.string().nullable(),
        publishedAt: z.string().nullable(),
        changeSummary: z.string().nullable(),
      }),
    ),
    reviews: z.array(ReviewSchema),
  })
  .openapi("MissionHistory");

export const AssignmentInputSchema = z
  .object({ versionId: objectId, reviewerId: objectId, dueAt: z.iso.datetime().optional() })
  .openapi("AssignmentInput");
export const AssignmentSchema = z
  .object({
    id: z.string(),
    versionId: z.string(),
    missionKey: z.string(),
    versionNumber: z.number().int(),
    reviewerId: z.string(),
    reviewerName: z.string(),
    status: z.enum(["open", "completed", "cancelled"]),
    dueAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("ReviewAssignment");

// ---- References --------------------------------------------------------------------------------
export const REFERENCE_TYPES = [
  "guideline",
  "national_protocol",
  "textbook",
  "journal_article",
  "training_manual",
  "other",
] as const;
export const ReferenceInputSchema = z
  .object({
    title: z.string().trim().min(3).max(300),
    organization: z.string().trim().max(120).nullable().default(null),
    authors: z.string().trim().max(300).nullable().default(null),
    year: z.number().int().min(1950).max(2100).nullable().default(null),
    edition: z.string().trim().max(40).nullable().default(null),
    type: z.enum(REFERENCE_TYPES),
    url: z
      .url({ protocol: /^https$/ })
      .max(2000)
      .nullable()
      .default(null),
    doi: z
      .string()
      .trim()
      .regex(/^10\.\d{4,9}\/\S+$/, "DOI like 10.1000/xyz")
      .nullable()
      .default(null),
    countryCodes: z
      .array(z.string().regex(/^[A-Z]{2}$/))
      .max(54)
      .default([]),
    topics: z.array(z.string().trim().min(1).max(40)).max(10).default([]),
  })
  .openapi("ReferenceInput");
export const ReferenceUpdateSchema = ReferenceInputSchema.partial()
  .extend({
    status: z.enum(["active", "retired"]).optional(),
    markVerified: z.boolean().optional(),
  })
  .openapi("ReferenceUpdate");
export const FullReferenceSchema = ReferenceSchema.extend({
  authors: z.string().nullable(),
  edition: z.string().nullable(),
  countryCodes: z.array(z.string()),
  topics: z.array(z.string()),
  status: z.enum(["active", "retired"]),
  lastVerifiedAt: z.string().nullable(),
}).openapi("FullReference");
export const ReferenceQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["active", "retired"]).optional(),
  topic: z.string().trim().max(40).optional(),
});

/** Administrator overview of clinical approval (GET /admin/content/approvals). */
export const ApprovalMonitorSchema = z
  .object({
    missions: z.object({
      published: z.number().int(),
      draft: z.number().int(),
      withdrawn: z.number().int(),
      retired: z.number().int(),
    }),
    versions: z.object({
      inReview: z.number().int(),
      changesRequested: z.number().int(),
      drafts: z.number().int(),
    }),
    reReviewPending: z
      .number()
      .int()
      .describe(
        "Published missions with an edited version not yet re-approved (edits never change approved content)",
      ),
    oldestInReview: z
      .object({
        missionKey: z.string(),
        versionNumber: z.number().int(),
        submittedAt: z.string(),
        days: z.number(),
      })
      .nullable(),
    assignments: z.object({ open: z.number().int(), overdue: z.number().int() }),
    reviewers: z.object({
      verified: z.number().int(),
      pending: z.number().int(),
      rejected: z.number().int(),
      active: z.number().int().describe("Verified clinicians who hold the reviewer role"),
    }),
    decisionsLast30Days: z.object({
      approved: z.number().int(),
      changesRequested: z.number().int(),
    }),
    publishedWithoutReferences: z
      .array(z.string())
      .describe("Published missions whose approved version cites no clinical reference"),
  })
  .openapi("ApprovalMonitor");
export type ApprovalMonitor = z.infer<typeof ApprovalMonitorSchema>;
