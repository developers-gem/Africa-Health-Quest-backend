import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import { ReasonRequestSchema } from "../schemas/admin.js";
import { MediaAssetSchema } from "../schemas/media.js";
import { MissionKeySchema } from "../schemas/missions.js";
import {
  AdminClinicianSchema,
  AdminMissionListQuerySchema,
  AdminMissionPageSchema,
  AdminMissionSchema,
  AssignmentInputSchema,
  AssignmentSchema,
  ClinicianProfileInputSchema,
  ClinicianProfileSchema,
  ClinicianVerificationSchema,
  CreateMissionSchema,
  FullReferenceSchema,
  FullVersionSchema,
  MissionHistorySchema,
  ReferenceInputSchema,
  ReferenceQuerySchema,
  ReferenceUpdateSchema,
  ReviewDecisionInputSchema,
  ReviewQueuePageSchema,
  ReviewQueueQuerySchema,
  ReviewSchema,
  ReviewVersionDetailSchema,
  RollbackSchema,
  SubmitVersionSchema,
  UpdateDraftSchema,
  UpdatePlacementSchema,
  VersionDiffSchema,
  ApprovalMonitorSchema,
} from "../schemas/reviews.js";
import { idParam, type Api } from "./helpers.js";

export function registerReviewRoutes({ route }: Api) {
  const U = `${API_PREFIX}/users/me`;
  const ctag = "Clinician profile";
  route({
    method: "get",
    path: `${U}/clinician-profile`,
    tag: ctag,
    auth: "bearer",
    summary: "Your clinician (reviewer) application",
    ok: [200, ClinicianProfileSchema, "Profile"],
    errors: [
      [403, "FORBIDDEN (guest)"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "put",
    path: `${U}/clinician-profile`,
    tag: ctag,
    auth: "bearer",
    summary: "Submit or update your clinician profile (re-verification required after changes)",
    body: ClinicianProfileInputSchema,
    ok: [200, ClinicianProfileSchema, "Submitted (pending verification)"],
    errors: [[403, "FORBIDDEN (guest / unconfirmed email)"]],
  });
  route({
    method: "post",
    path: `${U}/clinician-evidence`,
    tag: ctag,
    auth: "bearer",
    summary: "Upload credential evidence (raw body: PDF/PNG/JPEG); private to you and verifiers",
    query: z.object({ filename: z.string().max(200).optional() }),
    ok: [201, MediaAssetSchema, "Stored"],
    errors: [[413, "Too large"]],
  });
  route({
    method: "get",
    path: `${U}/clinician-evidence/{id}`,
    tag: ctag,
    auth: "bearer",
    summary: "Download your own evidence file",
    params: idParam(),
    ok: [200, null, "File"],
    errors: [[404, "NOT_FOUND"]],
  });

  const C = `${API_PREFIX}/admin/clinicians`;
  const vtag = "Admin · Clinician verification";
  const uid = idParam("userId");
  route({
    method: "get",
    path: C,
    tag: vtag,
    auth: "bearer",
    mfa: true,
    permission: "clinicians:verify",
    summary: "Clinician applications",
    query: z.object({ status: z.enum(["pending", "verified", "rejected"]).optional() }),
    ok: [200, z.object({ items: z.array(AdminClinicianSchema) }), "Applications"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "get",
    path: `${C}/{userId}`,
    tag: vtag,
    auth: "bearer",
    mfa: true,
    permission: "clinicians:verify",
    summary: "Application detail (decrypted registration number)",
    params: uid,
    ok: [200, AdminClinicianSchema, "Application"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "post",
    path: `${C}/{userId}/verify`,
    tag: vtag,
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "clinicians:verify",
    summary: "Verify or reject credentials (never your own)",
    params: uid,
    body: ClinicianVerificationSchema,
    ok: [200, AdminClinicianSchema, "Decided"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT (self)"],
    ],
  });

  const R = `${API_PREFIX}/review`;
  const rtag = "Clinician review";
  route({
    method: "get",
    path: `${R}/queue`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "Versions awaiting review (or other states); filter to your assignments",
    query: ReviewQueueQuerySchema,
    ok: [200, ReviewQueuePageSchema, "Queue"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "get",
    path: `${R}/versions/{id}`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "Full version (incl. answer key), diff from published, review history, eligibility",
    params: idParam(),
    ok: [200, ReviewVersionDetailSchema, "Version"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "post",
    path: `${R}/versions/{id}/decisions`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:decide",
    summary: "Approve (publishes atomically) or request changes",
    description:
      "Requires a verified clinician profile; reviewers cannot decide on versions they edited. Approval needs all three checks and ≥ 1 active reference; changes need notes. `contentHash` must match the version reviewed.",
    params: idParam(),
    body: ReviewDecisionInputSchema,
    ok: [201, ReviewSchema, "Decision recorded"],
    errors: [
      [403, "FORBIDDEN (not eligible)"],
      [404, "NOT_FOUND"],
      [409, "INVALID_STATE_TRANSITION / CONFLICT (hash)"],
    ],
  });
  route({
    method: "get",
    path: `${R}/missions/{key}/history`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "All versions and reviews of a mission",
    params: z.object({ key: MissionKeySchema }),
    ok: [200, MissionHistorySchema, "History"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "get",
    path: `${R}/assignments`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "Your open review assignments",
    ok: [200, z.object({ items: z.array(AssignmentSchema) }), "Assignments"],
  });
  route({
    method: "get",
    path: `${R}/references`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "Clinical reference library",
    query: ReferenceQuerySchema,
    ok: [
      200,
      z.object({
        items: z.array(FullReferenceSchema),
        total: z.number().int(),
        page: z.number().int(),
        pageSize: z.number().int(),
      }),
      "References",
    ],
  });
  route({
    method: "post",
    path: `${R}/references`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "references:edit",
    summary: "Add a reference (https links only; never AI-generated)",
    body: ReferenceInputSchema,
    ok: [201, FullReferenceSchema, "Created"],
    errors: [[409, "CONFLICT (DOI)"]],
  });
  route({
    method: "patch",
    path: `${R}/references/{id}`,
    tag: rtag,
    auth: "bearer",
    mfa: true,
    permission: "references:edit",
    summary: "Update, verify or retire a reference",
    params: idParam(),
    body: ReferenceUpdateSchema,
    ok: [200, FullReferenceSchema, "Updated"],
    errors: [[404, "NOT_FOUND"]],
  });

  const M = `${API_PREFIX}/admin/missions`;
  const mtag = "Admin · Content";
  const key = z.object({ key: MissionKeySchema });
  route({
    method: "get",
    path: M,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:read",
    summary: "Missions with publication state",
    query: AdminMissionListQuerySchema,
    ok: [200, AdminMissionPageSchema, "Missions"],
  });
  route({
    method: "post",
    path: M,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Create a mission (version 1 as draft; hidden until approved)",
    body: CreateMissionSchema,
    ok: [201, z.object({ mission: AdminMissionSchema, version: FullVersionSchema }), "Created"],
    errors: [[409, "CONFLICT (key)"]],
  });
  route({
    method: "get",
    path: `${M}/{key}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:read",
    summary: "Mission with full version and review history",
    params: key,
    ok: [200, z.object({ mission: AdminMissionSchema, history: MissionHistorySchema }), "Mission"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "patch",
    path: `${M}/{key}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Gameplay placement (tier, icon, order, topics) — not clinical content",
    params: key,
    body: UpdatePlacementSchema,
    ok: [200, AdminMissionSchema, "Updated"],
  });
  route({
    method: "post",
    path: `${M}/{key}/drafts`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Start a new draft from the latest version",
    params: key,
    ok: [201, FullVersionSchema, "Draft"],
    errors: [[409, "CONFLICT (open version / retired)"]],
  });
  for (const [action, summary] of [
    ["withdraw", "Hide a published mission immediately (ends in-progress attempts)"],
    ["restore", "Re-publish a withdrawn mission unchanged"],
    ["retire", "Permanently remove a mission from play (history kept)"],
  ] as const) {
    route({
      method: "post",
      path: `${M}/{key}/${action}`,
      tag: mtag,
      auth: "bearer",
      mfa: true,
      stepUp: true,
      permission: "content:publish-control",
      summary,
      params: key,
      body: ReasonRequestSchema,
      ok: [200, AdminMissionSchema, "Done"],
      errors: [[409, "INVALID_STATE_TRANSITION"]],
    });
  }
  route({
    method: "post",
    path: `${M}/{key}/rollback`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "content:publish-control",
    summary: "Re-publish an earlier clinician-approved version",
    params: key,
    body: RollbackSchema,
    ok: [200, AdminMissionSchema, "Rolled back"],
    errors: [[409, "CONFLICT / INVALID_STATE_TRANSITION"]],
  });

  const V = `${API_PREFIX}/admin/versions`;
  route({
    method: "get",
    path: `${V}/{id}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:read",
    summary: "Full version incl. answer key",
    params: idParam(),
    ok: [200, FullVersionSchema, "Version"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "get",
    path: `${V}/{id}/diff`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:read",
    summary: "Field-level diff against the published (or another) version",
    params: idParam(),
    query: z.object({ against: z.string().optional() }),
    ok: [200, VersionDiffSchema, "Diff"],
  });
  route({
    method: "patch",
    path: `${V}/{id}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Edit a draft (optimistic concurrency via expectedUpdatedAt)",
    params: idParam(),
    body: UpdateDraftSchema,
    ok: [200, FullVersionSchema, "Updated"],
    errors: [
      [409, "INVALID_STATE_TRANSITION (not a draft)"],
      [412, "PRECONDITION_FAILED"],
    ],
  });
  route({
    method: "post",
    path: `${V}/{id}/submit`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Freeze the draft, compute its content hash and send it to review",
    params: idParam(),
    body: SubmitVersionSchema,
    ok: [200, FullVersionSchema, "In review"],
    errors: [[409, "INVALID_STATE_TRANSITION"]],
  });
  route({
    method: "delete",
    path: `${V}/{id}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary: "Discard a draft",
    params: idParam(),
    ok: [204, null, "Discarded"],
    errors: [[409, "INVALID_STATE_TRANSITION"]],
  });

  const A = `${API_PREFIX}/admin/reviews/assignments`;
  route({
    method: "get",
    path: A,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:publish-control",
    summary: "Review assignments",
    query: z.object({
      reviewerId: z.string().optional(),
      status: z.enum(["open", "completed", "cancelled"]).optional(),
    }),
    ok: [200, z.object({ items: z.array(AssignmentSchema) }), "Assignments"],
  });
  route({
    method: "post",
    path: A,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:publish-control",
    summary: "Assign a verified, non-author reviewer to a version in review",
    body: AssignmentInputSchema,
    ok: [201, AssignmentSchema, "Assigned"],
    errors: [[409, "CONFLICT (ineligible / duplicate)"]],
  });
  route({
    method: "delete",
    path: `${A}/{id}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:publish-control",
    summary: "Cancel an open assignment",
    params: idParam(),
    ok: [204, null, "Cancelled"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/admin/content/approvals`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "content:read",
    summary: "Clinical approval monitoring: review queue, re-reviews pending, reviewers and gaps",
    ok: [200, ApprovalMonitorSchema, "Approval overview"],
  });
}
