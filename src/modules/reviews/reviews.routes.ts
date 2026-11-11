import {
  AdminMissionListQuerySchema,
  AssignmentInputSchema,
  CreateMissionSchema,
  MissionKeySchema,
  ObjectIdSchema,
  ReasonRequestSchema,
  ReferenceInputSchema,
  ReferenceQuerySchema,
  ReferenceUpdateSchema,
  ReviewDecisionInputSchema,
  ReviewQueueQuerySchema,
  RollbackSchema,
  SubmitVersionSchema,
  UpdateDraftSchema,
  UpdatePlacementSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Router, type Request, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit, type AuditEntry } from "../audit/audit-log.model.js";
import type { AuthoringService } from "../missions/authoring.service.js";
import {
  ClinicalReferenceModel,
  MissionModel,
  MissionVersionModel,
  type MissionDocument,
} from "../missions/mission.models.js";
import type { ReviewsService } from "./reviews.service.js";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idParams = z.object({ id: ObjectIdSchema });
const keyParams = z.object({ key: MissionKeySchema });

const audit = (req: Request, e: Omit<AuditEntry, "actorId" | "actorRoles" | "requestId">) => {
  const actor = requireAuth(req).user;
  return recordAudit({
    ...e,
    actorId: actor.id as string,
    actorRoles: [...actor.roles],
    requestId: req.requestId,
  });
};

type RefDoc = InstanceType<typeof ClinicalReferenceModel>;
const fullRef = (r: RefDoc | (RefDoc & Record<string, unknown>)) => ({
  id: String(r._id),
  title: r.title,
  organization: r.organization ?? null,
  authors: r.authors ?? null,
  year: r.year ?? null,
  edition: r.edition ?? null,
  type: r.type,
  url: r.url ?? null,
  doi: r.doi ?? null,
  countryCodes: [...(r.countryCodes ?? [])],
  topics: [...(r.topics ?? [])],
  status: r.status as "active" | "retired",
  lastVerifiedAt: r.lastVerifiedAt ? r.lastVerifiedAt.toISOString() : null,
});

/** Clinical reference library (reviewers and admins; never AI). */
function referencesRouter(can: (...p: Permission[]) => RequestHandler) {
  const r = Router();
  r.get("/", can("review:read"), async (req, res) => {
    const q = parseQuery(req, ReferenceQuerySchema);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.topic) filter.topics = q.topic;
    if (q.search)
      filter.$or = [
        { title: new RegExp(escapeRegex(q.search), "i") },
        { organization: new RegExp(escapeRegex(q.search), "i") },
      ];
    const [items, total] = await Promise.all([
      ClinicalReferenceModel.find(filter)
        .sort({ title: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      ClinicalReferenceModel.countDocuments(filter),
    ]);
    res.json({ items: items.map(fullRef), total, page: q.page, pageSize: q.pageSize });
  });
  r.post("/", can("references:edit"), async (req, res) => {
    const input = parseBody(req, ReferenceInputSchema);
    const doc = await ClinicalReferenceModel.create({
      ...input,
      addedBy: requireAuth(req).user._id,
    }).catch((e) => {
      if ((e as { code?: number }).code === 11000)
        throw AppError.conflict("A reference with this DOI exists.");
      throw e;
    });
    await audit(req, {
      action: "reference.created",
      targetType: "ClinicalReference",
      targetId: doc.id as string,
      after: input,
    });
    res.status(201).json(fullRef(doc));
  });
  r.patch("/:id", can("references:edit"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { markVerified, ...input } = parseBody(req, ReferenceUpdateSchema);
    const set: Record<string, unknown> = { ...input };
    if (markVerified)
      Object.assign(set, { lastVerifiedAt: new Date(), lastVerifiedBy: requireAuth(req).user._id });
    const doc = await ClinicalReferenceModel.findByIdAndUpdate(
      id,
      { $set: set },
      { new: true, runValidators: true },
    );
    if (!doc) throw AppError.notFound("Reference not found.");
    await audit(req, {
      action: input.status === "retired" ? "reference.retired" : "reference.updated",
      targetType: "ClinicalReference",
      targetId: id,
      after: set,
    });
    res.json(fullRef(doc));
  });
  return r;
}

/** Reviewer workspace: /review */
export function reviewRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  reviews: ReviewsService;
}) {
  const { can, reviews } = deps;
  const r = Router();

  r.get("/queue", can("review:read"), async (req, res) => {
    const q = parseQuery(req, ReviewQueueQuerySchema);
    const { items, total } = await reviews.queue(requireAuth(req).user, q);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get("/versions/:id", can("review:read"), async (req, res) => {
    res.json(await reviews.versionDetail(requireAuth(req).user, parseParams(req, idParams).id));
  });

  r.post("/versions/:id/decisions", can("review:decide"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const input = parseBody(req, ReviewDecisionInputSchema);
    const review = await reviews.decide(
      { user: requireAuth(req).user, requestId: req.requestId },
      id,
      input,
    );
    res.status(201).json(await reviews.toReviewDto(review));
  });

  r.get("/missions/:key/history", can("review:read"), async (req, res) => {
    res.json(await reviews.history(parseParams(req, keyParams).key));
  });

  r.get("/assignments", can("review:read"), async (req, res) => {
    const list = await reviews.listAssignments({
      reviewerId: requireAuth(req).user.id as string,
      status: "open",
    });
    res.json({ items: await Promise.all(list.map((a) => reviews.assignmentDto(a))) });
  });

  r.use("/references", referencesRouter(can));
  return r;
}

/** Admin authoring, publishing controls and review assignments. */
export function adminContentRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  recentAuth: RequestHandler;
  authoring: AuthoringService;
  reviews: ReviewsService;
}) {
  const { can, recentAuth, authoring, reviews } = deps;
  const r = Router();

  const missionDto = async (m: MissionDocument) => {
    const open = m.openDraftVersionId
      ? await MissionVersionModel.findById(m.openDraftVersionId).lean()
      : null;
    return {
      id: m.id as string,
      key: m.key,
      countryCode: m.countryCode,
      tier: m.tier,
      icon: m.icon,
      sortOrder: m.sortOrder,
      topics: [...(m.topics ?? [])],
      status: m.status as "draft",
      published: m.published
        ? {
            versionNumber: m.published.versionNumber,
            title: m.published.title,
            approvedAt: m.published.verification!.approvedAt.toISOString(),
            reviewerName: m.published.verification!.reviewerName,
          }
        : null,
      openVersion: open
        ? {
            id: String(open._id),
            versionNumber: open.versionNumber,
            status: open.status as "draft",
          }
        : null,
      offlineEligible: Boolean(m.offlineEligible),
      latestVersionNumber: m.latestVersionNumber,
      updatedAt: (m.get("updatedAt") as Date).toISOString(),
    };
  };

  // ---- Missions ----
  r.get("/missions", can("content:read"), async (req, res) => {
    const q = parseQuery(req, AdminMissionListQuerySchema);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.country) filter.countryCode = q.country;
    if (q.search)
      filter.$or = [
        { key: new RegExp(escapeRegex(q.search), "i") },
        { "published.title": new RegExp(escapeRegex(q.search), "i") },
      ];
    const [items, total] = await Promise.all([
      MissionModel.find(filter)
        .sort({ tier: 1, sortOrder: 1, key: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      MissionModel.countDocuments(filter),
    ]);
    res.json({
      items: await Promise.all(items.map(missionDto)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    });
  });

  r.post("/missions", can("content:edit"), async (req, res) => {
    const input = parseBody(req, CreateMissionSchema);
    const { mission, draft } = await authoring.createMission(
      input,
      requireAuth(req).user.id as string,
    );
    await audit(req, {
      action: "mission.created",
      targetType: "Mission",
      targetId: mission.key,
      after: { versionId: draft.id },
    });
    res
      .status(201)
      .json({ mission: await missionDto(mission), version: await authoring.toFullVersion(draft) });
  });

  r.get("/missions/:key", can("content:read"), async (req, res) => {
    const m = await authoring.getMission(parseParams(req, keyParams).key);
    res.json({ mission: await missionDto(m), history: await reviews.history(m.key) });
  });

  r.patch("/missions/:key", can("content:edit"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const input = parseBody(req, UpdatePlacementSchema);
    if (!Object.keys(input).length) throw AppError.badRequest("Nothing to update.");
    const { mission, before } = await authoring.updatePlacement(key, input);
    await audit(req, {
      action: "mission.placement.updated",
      targetType: "Mission",
      targetId: key,
      before,
      after: input,
    });
    res.json(await missionDto(mission));
  });

  r.post("/missions/:key/drafts", can("content:edit"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const draft = await authoring.newDraft(key, requireAuth(req).user.id as string);
    await audit(req, {
      action: "mission.version.created",
      targetType: "MissionVersion",
      targetId: draft.id as string,
      after: { missionKey: key, versionNumber: draft.versionNumber },
    });
    res.status(201).json(await authoring.toFullVersion(draft));
  });

  const control = (action: "withdraw" | "restore" | "retire") =>
    r.post(
      `/missions/:key/${action}`,
      can("content:publish-control"),
      recentAuth,
      async (req, res) => {
        const { key } = parseParams(req, keyParams);
        const { reason } = parseBody(req, ReasonRequestSchema);
        const result = await authoring[action](key);
        const mission = "mission" in result ? result.mission : result;
        await audit(req, {
          action: `mission.${action === "withdraw" ? "withdrawn" : action === "restore" ? "restored" : "retired"}`,
          targetType: "Mission",
          targetId: key,
          reason,
          ...("attemptsEnded" in result ? { after: { attemptsEnded: result.attemptsEnded } } : {}),
        });
        res.json(await missionDto(mission));
      },
    );
  control("withdraw");
  control("restore");
  control("retire");

  r.post(
    "/missions/:key/rollback",
    can("content:publish-control"),
    recentAuth,
    async (req, res) => {
      const { key } = parseParams(req, keyParams);
      const { versionNumber, reason } = parseBody(req, RollbackSchema);
      const { mission } = await reviews.rollback(key, versionNumber);
      await audit(req, {
        action: "mission.rolled_back",
        targetType: "Mission",
        targetId: key,
        after: { versionNumber },
        reason,
      });
      res.json(await missionDto(mission));
    },
  );

  // ---- Versions ----
  r.get("/versions/:id", can("content:read"), async (req, res) => {
    res.json(
      await authoring.toFullVersion(await authoring.getVersion(parseParams(req, idParams).id)),
    );
  });

  r.get("/versions/:id/diff", can("content:read"), async (req, res) => {
    const { against } = parseQuery(req, z.object({ against: ObjectIdSchema.optional() }));
    res.json(
      await authoring.diff(await authoring.getVersion(parseParams(req, idParams).id), against),
    );
  });

  r.patch("/versions/:id", can("content:edit"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const v = await authoring.updateDraft(
      id,
      parseBody(req, UpdateDraftSchema),
      requireAuth(req).user.id as string,
    );
    await audit(req, {
      action: "mission.version.updated",
      targetType: "MissionVersion",
      targetId: id,
    });
    res.json(await authoring.toFullVersion(v));
  });

  r.post("/versions/:id/submit", can("content:edit"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { changeSummary } = parseBody(req, SubmitVersionSchema);
    const v = await authoring.submit(id, changeSummary, requireAuth(req).user.id as string);
    await audit(req, {
      action: "mission.version.submitted",
      targetType: "MissionVersion",
      targetId: id,
      after: { contentHash: v.contentHash },
    });
    res.json(await authoring.toFullVersion(v));
  });

  r.delete("/versions/:id", can("content:edit"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    await authoring.discardDraft(id);
    await audit(req, {
      action: "mission.version.discarded",
      targetType: "MissionVersion",
      targetId: id,
    });
    res.status(204).end();
  });

  r.get("/content/approvals", can("content:read"), async (_req, res) => {
    res.json(await reviews.approvalMonitor());
  });

  // ---- Review assignments ----
  r.get("/reviews/assignments", can("content:publish-control"), async (req, res) => {
    const q = parseQuery(
      req,
      z.object({
        reviewerId: ObjectIdSchema.optional(),
        status: z.enum(["open", "completed", "cancelled"]).optional(),
      }),
    );
    const list = await reviews.listAssignments(q);
    res.json({ items: await Promise.all(list.map((a) => reviews.assignmentDto(a))) });
  });

  r.post("/reviews/assignments", can("content:publish-control"), async (req, res) => {
    const input = parseBody(req, AssignmentInputSchema);
    const { assignment } = await reviews.assign(input, requireAuth(req).user.id as string);
    await audit(req, {
      action: "review.assigned",
      targetType: "MissionVersion",
      targetId: input.versionId,
      after: { reviewerId: input.reviewerId },
    });
    res.status(201).json(await reviews.assignmentDto(assignment.toObject()));
  });

  r.delete("/reviews/assignments/:id", can("content:publish-control"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    await reviews.cancelAssignment(id);
    await audit(req, {
      action: "review.assignment.cancelled",
      targetType: "ReviewAssignment",
      targetId: id,
    });
    res.status(204).end();
  });

  return r;
}
