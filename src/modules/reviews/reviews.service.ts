import type { ApprovalMonitor, ReviewDecisionInput } from "@ahq/api-contracts";
import mongoose, { Types, type ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { recordAudit } from "../audit/audit-log.model.js";
import type { AuthoringService } from "../missions/authoring.service.js";
import {
  ClinicalReferenceModel,
  MissionModel,
  MissionVersionModel,
  type MissionVersionDocument,
} from "../missions/mission.models.js";
import type { MissionsService } from "../missions/missions.service.js";
import { UserModel, type UserDocument } from "../users/user.model.js";
import { MissionReviewModel, ReviewAssignmentModel, type ReviewDocument } from "./review.models.js";

type Actor = { user: UserDocument; requestId?: string };

async function inTransaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async (s) => {
      out = await fn(s);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

export class ReviewsService {
  constructor(
    private readonly missions: MissionsService,
    private readonly authoring: AuthoringService,
  ) {}

  /** Why a user may not decide on a version (null = may decide). */
  eligibility(user: UserDocument, version: MissionVersionDocument): string | null {
    if (!user.roles.includes("reviewer")) return "Only clinician reviewers can decide.";
    if (user.clinician?.status !== "verified")
      return "Your clinician credentials must be verified first.";
    if ((version.authoredBy ?? []).some((a) => String(a) === user.id))
      return "You edited this version, so another clinician must review it.";
    if (version.status !== "in_review")
      return `This version is ${version.status.replace("_", " ")}.`;
    return null;
  }

  async toReviewDto(r: ReviewDocument | (ReviewDocument & Record<string, unknown>)) {
    return {
      id: String(r._id),
      missionKey: r.missionKey,
      versionNumber: r.versionNumber,
      contentHash: r.contentHash,
      decision: r.decision as "approved" | "changes_requested",
      checks: {
        scenario: Boolean(r.checks?.scenario),
        treatment: Boolean(r.checks?.treatment),
        references: Boolean(r.checks?.references),
      },
      references: await this.missions.references(r.referenceIds ?? []),
      notes: r.notes ?? "",
      reviewer: {
        id: String(r.reviewerId),
        name: r.reviewer!.name,
        credentials: r.reviewer!.credentials,
        profession: r.reviewer!.profession,
      },
      createdAt: (r.get
        ? (r.get("createdAt") as Date)
        : (r as unknown as { createdAt: Date }).createdAt
      ).toISOString(),
    };
  }

  async queue(
    user: UserDocument,
    q: {
      status: string;
      assigned: "me" | "any";
      country?: string | undefined;
      page: number;
      pageSize: number;
    },
  ) {
    const filter: Record<string, unknown> = { status: q.status };
    if (q.country) filter["content.countryCode"] = q.country;
    if (q.assigned === "me") {
      const mine = await ReviewAssignmentModel.find({
        reviewerId: user._id,
        status: "open",
      }).distinct("missionVersionId");
      filter._id = { $in: mine };
    }
    const [versions, total] = await Promise.all([
      MissionVersionModel.find(filter)
        .sort({ submittedAt: 1, _id: 1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      MissionVersionModel.countDocuments(filter),
    ]);
    const ids = versions.map((v) => v._id);
    const [missions, assignments] = await Promise.all([
      MissionModel.find({ _id: { $in: versions.map((v) => v.missionId) } }).lean(),
      ReviewAssignmentModel.find({ missionVersionId: { $in: ids }, status: "open" }).lean(),
    ]);
    const reviewers = await UserModel.find({
      _id: { $in: assignments.map((a) => a.reviewerId) },
    }).lean();
    const nameOf = new Map(
      reviewers.map((u) => [String(u._id), u.clinician?.fullName ?? u.displayName]),
    );
    const missionOf = new Map(missions.map((m) => [String(m._id), m]));
    return {
      total,
      items: versions.map((v) => {
        const m = missionOf.get(String(v.missionId));
        const assigned = assignments.filter((a) => String(a.missionVersionId) === String(v._id));
        return {
          versionId: v.id as string,
          missionKey: m?.key ?? "",
          title: v.content!.title,
          countryCode: v.content!.countryCode,
          versionNumber: v.versionNumber,
          status: v.status as "in_review",
          submittedAt: v.submittedAt ? v.submittedAt.toISOString() : null,
          assignedToMe: assigned.some((a) => String(a.reviewerId) === user.id),
          assignees: assigned.map((a) => ({
            reviewerId: String(a.reviewerId),
            name: nameOf.get(String(a.reviewerId)) ?? "",
          })),
          isUpdate:
            Boolean(m?.publishedVersionId) && String(m?.publishedVersionId) !== (v.id as string),
        };
      }),
    };
  }

  async versionDetail(user: UserDocument, versionId: string) {
    const v = await this.authoring.getVersion(versionId);
    const reviews = await MissionReviewModel.find({ missionVersionId: v._id }).sort({
      createdAt: -1,
    });
    const reason = this.eligibility(user, v);
    return {
      version: await this.authoring.toFullVersion(v),
      diffFromPublished: await this.authoring.diff(v),
      reviews: await Promise.all(reviews.map((r) => this.toReviewDto(r))),
      canDecide: reason === null,
      cannotDecideReason: reason,
    };
  }

  async history(key: string) {
    const mission = await this.authoring.getMission(key);
    const [versions, reviews] = await Promise.all([
      MissionVersionModel.find({ missionId: mission._id }).sort({ versionNumber: -1 }).lean(),
      MissionReviewModel.find({ missionId: mission._id }).sort({ createdAt: -1 }),
    ]);
    return {
      missionKey: key,
      versions: versions.map((v) => ({
        id: String(v._id),
        versionNumber: v.versionNumber,
        status: v.status as "draft",
        contentHash: v.contentHash ?? null,
        submittedAt: v.submittedAt ? v.submittedAt.toISOString() : null,
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        changeSummary: v.changeSummary ?? null,
      })),
      reviews: await Promise.all(reviews.map((r) => this.toReviewDto(r))),
    };
  }

  /** Records a clinician decision. Approval publishes the version atomically. */
  async decide(actor: Actor, versionId: string, input: ReviewDecisionInput) {
    const { user } = actor;
    const v = await this.authoring.getVersion(versionId);
    const reason = this.eligibility(user, v);
    if (reason) {
      if (v.status !== "in_review") throw new AppError(409, "INVALID_STATE_TRANSITION", reason);
      throw AppError.forbidden(reason);
    }
    if (input.contentHash !== v.contentHash) {
      throw AppError.conflict(
        "The content you reviewed is not the version under review. Reload and review again.",
      );
    }
    if (input.referenceIds.length) {
      const found = await ClinicalReferenceModel.countDocuments({
        _id: { $in: input.referenceIds },
        status: "active",
      });
      if (found !== new Set(input.referenceIds).size)
        throw AppError.badRequest("Every reference must exist and be active.", [
          { path: "referenceIds", message: "invalid" },
        ]);
    }
    const mission = (await MissionModel.findById(v.missionId))!;
    const clinician = user.clinician!;
    return inTransaction(async (s) => {
      const fresh = await MissionVersionModel.findOne(
        { _id: v._id, status: "in_review", contentHash: input.contentHash },
        null,
        { session: s },
      );
      if (!fresh)
        throw new AppError(409, "INVALID_STATE_TRANSITION", "This version was decided meanwhile.");
      const [review] = await MissionReviewModel.create(
        [
          {
            missionId: mission._id,
            missionKey: mission.key,
            missionVersionId: v._id,
            versionNumber: v.versionNumber,
            contentHash: v.contentHash,
            reviewerId: user._id,
            reviewer: {
              name: clinician.fullName,
              credentials: clinician.credentials,
              profession: clinician.profession,
            },
            decision: input.decision,
            checks: input.checks,
            referenceIds: input.referenceIds,
            notes: input.notes,
          },
        ],
        { session: s },
      );
      if (input.decision === "approved") {
        await this.missions.publishVersion(
          v.id as string,
          {
            reviewId: review!.id as string,
            reviewerName: clinician.fullName,
            credentials: clinician.credentials,
            approvedAt: new Date(),
            referenceIds: input.referenceIds,
          },
          s,
        );
      } else {
        await MissionVersionModel.updateOne(
          { _id: v._id, status: "in_review" },
          { $set: { status: "changes_requested" } },
          { session: s },
        );
        await MissionModel.updateOne(
          { _id: mission._id, openDraftVersionId: v._id },
          { $set: { openDraftVersionId: null } },
          { session: s },
        );
      }
      await ReviewAssignmentModel.updateMany(
        { missionVersionId: v._id, status: "open" },
        { $set: { status: "completed", completedAt: new Date() } },
        { session: s },
      );
      await recordAudit(
        {
          actorId: user.id as string,
          actorRoles: [...user.roles],
          action: input.decision === "approved" ? "review.approved" : "review.changes_requested",
          targetType: "MissionVersion",
          targetId: v.id as string,
          after: {
            missionKey: mission.key,
            versionNumber: v.versionNumber,
            contentHash: v.contentHash,
            referenceIds: input.referenceIds,
          },
          ...(input.notes ? { reason: input.notes.slice(0, 500) } : {}),
          ...(actor.requestId ? { requestId: actor.requestId } : {}),
        },
        s,
      );
      return review!;
    });
  }

  /** Re-publishes an earlier version that a clinician approved, unchanged (its approval still applies). */
  async rollback(key: string, versionNumber: number) {
    const mission = await this.authoring.getMission(key);
    const target = await MissionVersionModel.findOne({ missionId: mission._id, versionNumber });
    if (!target) throw AppError.notFound("Version not found.");
    if (String(target._id) === String(mission.publishedVersionId))
      throw AppError.conflict("This version is already the published one.");
    if (target.status !== "superseded")
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        "Only previously published versions can be restored.",
      );
    const approval = await MissionReviewModel.findOne({
      missionVersionId: target._id,
      decision: "approved",
      contentHash: target.contentHash,
    }).sort({ createdAt: -1 });
    // Non-draft content is immutable (model hooks), so a matching approved review still applies.
    if (!approval) throw AppError.conflict("No valid clinician approval exists for this version.");
    return inTransaction(async (s) => {
      if (mission.publishedVersionId) {
        await MissionVersionModel.updateOne(
          { _id: mission.publishedVersionId, status: { $in: ["published", "withdrawn"] } },
          { $set: { status: "superseded", supersededAt: new Date() } },
          { session: s },
        );
      }
      await MissionVersionModel.updateOne(
        { _id: target._id },
        { $set: { status: "in_review" } },
        { session: s },
      ); // transient for publishVersion's state check
      await this.missions.publishVersion(
        target.id as string,
        {
          reviewId: approval.id as string,
          reviewerName: approval.reviewer!.name,
          credentials: approval.reviewer!.credentials,
          approvedAt: approval.get("createdAt") as Date,
          referenceIds: (approval.referenceIds ?? []).map(String),
        },
        s,
      );
      return {
        mission: (await MissionModel.findById(mission._id, null, { session: s }))!,
        version: target,
      };
    });
  }

  // ---- Assignments ----
  async assign(
    input: { versionId: string; reviewerId: string; dueAt?: string | undefined },
    assignedBy: string,
  ) {
    const v = await this.authoring.getVersion(input.versionId);
    if (v.status !== "in_review")
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        "Only versions in review can be assigned.",
      );
    const reviewer = await UserModel.findById(input.reviewerId);
    if (!reviewer) throw AppError.notFound("Reviewer not found.");
    const reason = this.eligibility(reviewer, v);
    if (reason) throw AppError.conflict(reason);
    const mission = await MissionModel.findById(v.missionId).lean();
    try {
      const a = await ReviewAssignmentModel.create({
        missionVersionId: v._id,
        missionKey: mission!.key,
        versionNumber: v.versionNumber,
        reviewerId: reviewer._id,
        assignedBy,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      });
      return { assignment: a, reviewer };
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        throw AppError.conflict("This reviewer is already assigned.");
      throw e;
    }
  }

  async cancelAssignment(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Assignment not found.");
    const a = await ReviewAssignmentModel.findOneAndUpdate(
      { _id: id, status: "open" },
      { $set: { status: "cancelled" } },
      { new: true },
    );
    if (!a) throw AppError.notFound("Open assignment not found.");
    return a;
  }

  async assignmentDto(a: {
    _id: unknown;
    missionVersionId: unknown;
    missionKey: string;
    versionNumber: number;
    reviewerId: unknown;
    status: string;
    dueAt?: Date | null;
    createdAt?: Date;
  }) {
    const reviewer = await UserModel.findById(a.reviewerId).lean();
    return {
      id: String(a._id),
      versionId: String(a.missionVersionId),
      missionKey: a.missionKey,
      versionNumber: a.versionNumber,
      reviewerId: String(a.reviewerId),
      reviewerName: reviewer?.clinician?.fullName ?? reviewer?.displayName ?? "",
      status: a.status as "open",
      dueAt: a.dueAt ? a.dueAt.toISOString() : null,
      createdAt: (a.createdAt ?? new Date()).toISOString(),
    };
  }

  listAssignments(filter: { reviewerId?: string; status?: string }) {
    const q: Record<string, unknown> = {};
    if (filter.reviewerId) q.reviewerId = filter.reviewerId;
    if (filter.status) q.status = filter.status;
    return ReviewAssignmentModel.find(q).sort({ createdAt: -1 }).limit(200).lean();
  }

  /** Approval monitoring for administrators: queue health, re-reviews and the reviewer pool. */
  async approvalMonitor(now = new Date()): Promise<ApprovalMonitor> {
    const DAY = 86_400_000;
    const [missionCounts, versionCounts, oldest, published, open, overdue, decisions, reviewers] =
      await Promise.all([
        MissionModel.aggregate<{ _id: string; n: number }>([
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),
        MissionVersionModel.aggregate<{ _id: string; n: number }>([
          { $match: { status: { $in: ["in_review", "changes_requested", "draft"] } } },
          { $group: { _id: "$status", n: { $sum: 1 } } },
        ]),
        MissionVersionModel.findOne({ status: "in_review" })
          .sort({ submittedAt: 1 })
          .populate<{ missionId: { key: string } }>("missionId", "key")
          .lean(),
        MissionModel.find({ status: "published" }).select("_id key").lean(),
        ReviewAssignmentModel.countDocuments({ status: "open" }),
        ReviewAssignmentModel.countDocuments({ status: "open", dueAt: { $lt: now } }),
        MissionReviewModel.aggregate<{ _id: string; n: number }>([
          { $match: { createdAt: { $gte: new Date(now.getTime() - 30 * DAY) } } },
          { $group: { _id: "$decision", n: { $sum: 1 } } },
        ]),
        UserModel.aggregate<{ _id: { status: string; reviewer: boolean }; n: number }>([
          { $match: { clinician: { $exists: true } } },
          {
            $group: {
              _id: {
                status: "$clinician.status",
                reviewer: { $in: ["reviewer", { $ifNull: ["$roles", []] }] },
              },
              n: { $sum: 1 },
            },
          },
        ]),
      ]);
    const by = (rows: { _id: string; n: number }[], k: string) =>
      rows.find((r) => r._id === k)?.n ?? 0;
    const publishedIds = published.map((m) => m._id);
    const [pendingEdits, liveVersions] = await Promise.all([
      MissionVersionModel.distinct("missionId", {
        missionId: { $in: publishedIds },
        status: { $in: ["draft", "in_review", "changes_requested"] },
      }),
      MissionVersionModel.find({ missionId: { $in: publishedIds }, status: "published" })
        .select("missionId referenceIds contentHash")
        .lean(),
    ]);
    const withoutRefs: string[] = [];
    for (const v of liveVersions) {
      const approvals = await MissionReviewModel.find({
        missionVersionId: v._id,
        decision: "approved",
        contentHash: v.contentHash,
      })
        .select("referenceIds")
        .lean();
      const refs = v.referenceIds.length + approvals.reduce((a, x) => a + x.referenceIds.length, 0);
      if (!refs)
        withoutRefs.push(published.find((m) => String(m._id) === String(v.missionId))!.key);
    }
    const rv = (status: string) =>
      reviewers.filter((r) => r._id.status === status).reduce((a, r) => a + r.n, 0);
    return {
      missions: {
        published: by(missionCounts, "published"),
        draft: by(missionCounts, "draft"),
        withdrawn: by(missionCounts, "withdrawn"),
        retired: by(missionCounts, "retired"),
      },
      versions: {
        inReview: by(versionCounts, "in_review"),
        changesRequested: by(versionCounts, "changes_requested"),
        drafts: by(versionCounts, "draft"),
      },
      reReviewPending: pendingEdits.length,
      oldestInReview:
        oldest?.submittedAt && oldest.missionId
          ? {
              missionKey: oldest.missionId.key,
              versionNumber: oldest.versionNumber,
              submittedAt: oldest.submittedAt.toISOString(),
              days: Math.round(((now.getTime() - oldest.submittedAt.getTime()) / DAY) * 10) / 10,
            }
          : null,
      assignments: { open, overdue },
      reviewers: {
        verified: rv("verified"),
        pending: rv("pending"),
        rejected: rv("rejected"),
        active: reviewers
          .filter((r) => r._id.status === "verified" && r._id.reviewer)
          .reduce((a, r) => a + r.n, 0),
      },
      decisionsLast30Days: {
        approved: by(decisions, "approved"),
        changesRequested: by(decisions, "changes_requested"),
      },
      publishedWithoutReferences: withoutRefs.sort(),
    };
  }
}
