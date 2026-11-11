import type {
  AnalyticsOverviewSchema,
  FunnelSchema,
  MissionAnalyticsSchema,
  z,
} from "@ahq/api-contracts";
import { ROLES } from "@ahq/shared-types";
import { AppError } from "../../lib/errors.js";
import { AuditLogModel } from "../audit/audit-log.model.js";
import { SessionModel } from "../auth/session.model.js";
import { MissionAttemptModel } from "../gameplay/attempt.model.js";
import { HospitalRunModel } from "../hospital/hospital.models.js";
import { MissionModel, MissionVersionModel } from "../missions/mission.models.js";
import { ReviewAssignmentModel } from "../reviews/review.models.js";
import { SyncEventModel } from "../sync/sync.models.js";
import { UserModel } from "../users/user.model.js";

const DAY = 86_400_000;
const round = (n: number) => Math.round(n * 1000) / 1000;
const ratio = (a: number, b: number) => (b > 0 ? round(a / b) : null);

export type Range = { from: Date; to: Date };

/** Resolves an optional ISO range (default: last 30 days, at most 366 days). */
export function resolveRange(
  q: { from?: string | undefined; to?: string | undefined },
  now = new Date(),
): Range {
  const to = q.to ? new Date(q.to) : now;
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
  if (from >= to) throw AppError.badRequest("`from` must be before `to`.");
  if (to.getTime() - from.getTime() > 366 * DAY)
    throw AppError.badRequest("The range can be at most 366 days.");
  return { from, to };
}
const inRange = (r: Range) => ({ $gte: r.from, $lt: r.to });
const period = (r: Range) => ({ from: r.from.toISOString(), to: r.to.toISOString() });

/** Aggregate, non-identifying operational metrics for administrators. */
export async function analyticsOverview(
  r: Range,
): Promise<z.infer<typeof AnalyticsOverviewSchema>> {
  const active = (days: number) =>
    SessionModel.distinct("userId", {
      lastUsedAt: { $gte: new Date(r.to.getTime() - days * DAY), $lt: r.to },
    });
  const [
    daily,
    weekly,
    monthly,
    registered,
    guests,
    suspended,
    roleCounts,
    newRegistrations,
    upgraded,
    merged,
    attemptStatus,
    story,
    hospital,
    missionStatus,
    versionsAwaitingReview,
    openReviewAssignments,
    pendingClinicianVerifications,
    syncStatus,
  ] = await Promise.all([
    active(1),
    active(7),
    active(30),
    UserModel.countDocuments({ isGuest: false }),
    UserModel.countDocuments({ isGuest: true }),
    UserModel.countDocuments({ suspension: { $exists: true, $ne: null } }),
    UserModel.aggregate<{ _id: string; n: number }>([
      { $match: { isGuest: false } },
      { $unwind: "$roles" },
      { $group: { _id: "$roles", n: { $sum: 1 } } },
    ]),
    UserModel.countDocuments({ isGuest: false, createdAt: inRange(r), convertedFromGuestAt: null }),
    UserModel.countDocuments({ convertedFromGuestAt: inRange(r) }),
    AuditLogModel.countDocuments({ action: "guest.merged", createdAt: inRange(r) }),
    MissionAttemptModel.aggregate<{ _id: string; n: number }>([
      { $match: { startedAt: inRange(r) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    MissionAttemptModel.aggregate<{
      _id: null;
      completed: number;
      passed: number;
      score: number | null;
    }>([
      { $match: { startedAt: inRange(r), status: "completed" } },
      {
        $group: {
          _id: null,
          completed: { $sum: { $cond: [{ $eq: ["$mode", "story"] }, 1, 0] } },
          passed: {
            $sum: {
              $cond: [{ $and: [{ $eq: ["$mode", "story"] }, { $eq: ["$passed", true] }] }, 1, 0],
            },
          },
          score: {
            $avg: {
              $cond: [{ $gt: ["$maxScore", 0] }, { $divide: ["$score", "$maxScore"] }, null],
            },
          },
        },
      },
    ]),
    HospitalRunModel.aggregate<{ _id: null; n: number; met: number }>([
      { $match: { createdAt: inRange(r) } },
      { $group: { _id: null, n: { $sum: 1 }, met: { $avg: { $divide: ["$needsMet", 4] } } } },
    ]),
    MissionModel.aggregate<{ _id: string; n: number }>([
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
    MissionVersionModel.countDocuments({ status: "in_review" }),
    ReviewAssignmentModel.countDocuments({ status: "open" }),
    UserModel.countDocuments({ "clinician.status": "pending" }),
    SyncEventModel.aggregate<{ _id: string; n: number }>([
      { $match: { createdAt: inRange(r) } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]),
  ]);

  const byStatus = Object.fromEntries(attemptStatus.map((s) => [s._id, s.n]));
  const sync = Object.fromEntries(syncStatus.map((s) => [s._id, s.n]));
  return {
    period: period(r),
    activePlayers: { daily: daily.length, weekly: weekly.length, monthly: monthly.length },
    users: {
      registered,
      guests,
      suspended,
      byRole: Object.fromEntries(
        ROLES.map((role) => [role, roleCounts.find((c) => c._id === role)?.n ?? 0]),
      ),
    },
    newRegistrations,
    guestConversions: upgraded + merged,
    attemptsStarted: Object.values(byStatus).reduce((a, n) => a + n, 0),
    attemptsCompleted: byStatus.completed ?? 0,
    attemptsAbandoned: byStatus.abandoned ?? 0,
    storyPassRate: ratio(story[0]?.passed ?? 0, story[0]?.completed ?? 0),
    averageScorePct: story[0]?.score == null ? null : round(story[0].score),
    shifts: hospital[0]?.n ?? 0,
    averageNeedsMetPct: hospital[0] ? round(hospital[0].met) : null,
    content: {
      missionsByStatus: Object.fromEntries(missionStatus.map((s) => [s._id, s.n])),
      versionsAwaitingReview,
      openReviewAssignments,
      pendingClinicianVerifications,
    },
    sync: {
      eventsProcessed: Object.entries(sync).reduce(
        (a, [k, n]) => (k === "processing" ? a : a + n),
        0,
      ),
      eventsRejected: sync.rejected ?? 0,
    },
  };
}

/** Per mission version: completion, pass rate, score and how often each option was chosen. */
export async function missionAnalytics(
  r: Range,
  country?: string,
): Promise<z.infer<typeof MissionAnalyticsSchema>> {
  const match = { startedAt: inRange(r), ...(country ? { countryCode: country } : {}) };
  const [stats, choices] = await Promise.all([
    MissionAttemptModel.aggregate<{
      _id: { v: unknown; key: string; country: string };
      attempts: number;
      completed: number;
      passed: number;
      score: number | null;
    }>([
      { $match: match },
      {
        $group: {
          _id: { v: "$missionVersionId", key: "$missionKey", country: "$countryCode" },
          attempts: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          passed: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$status", "completed"] }, { $eq: ["$passed", true] }] },
                1,
                0,
              ],
            },
          },
          score: {
            $avg: {
              $cond: [
                { $and: [{ $eq: ["$status", "completed"] }, { $gt: ["$maxScore", 0] }] },
                { $divide: ["$score", "$maxScore"] },
                null,
              ],
            },
          },
        },
      },
      { $sort: { attempts: -1, "_id.key": 1 } },
    ]),
    MissionAttemptModel.aggregate<{
      _id: { v: unknown; stepId: string; choiceId: string };
      count: number;
    }>([
      { $match: match },
      { $unwind: "$answers" },
      {
        $group: {
          _id: { v: "$missionVersionId", stepId: "$answers.stepId", choiceId: "$answers.choiceId" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.stepId": 1, "_id.choiceId": 1 } },
    ]),
  ]);
  const versions = await MissionVersionModel.find({ _id: { $in: stats.map((s) => s._id.v) } })
    .select("versionNumber")
    .lean();
  const number = new Map(versions.map((v) => [String(v._id), v.versionNumber as number]));
  return {
    period: period(r),
    items: stats.map((s) => ({
      missionKey: s._id.key,
      versionNumber: number.get(String(s._id.v)) ?? 0,
      countryCode: s._id.country,
      attempts: s.attempts,
      completed: s.completed,
      completionRate: ratio(s.completed, s.attempts),
      passRate: ratio(s.passed, s.completed),
      avgScorePct: s.score == null ? null : round(s.score),
      choiceDistribution: choices
        .filter((c) => String(c._id.v) === String(s._id.v))
        .map((c) => ({ stepId: c._id.stepId, choiceId: c._id.choiceId, count: c.count })),
    })),
  };
}

/** Guest funnel for accounts created in the range. Visits are not tracked server-side (no client analytics). */
export async function funnel(r: Range): Promise<z.infer<typeof FunnelSchema>> {
  const cohort = {
    createdAt: inRange(r),
    $or: [{ isGuest: true }, { convertedFromGuestAt: { $ne: null } }],
  };
  const ids = (await UserModel.find(cohort).select("_id").lean()).map((u) => u._id);
  const [played, upgraded, merged] = await Promise.all([
    MissionAttemptModel.distinct("userId", { userId: { $in: ids } }),
    UserModel.countDocuments({ _id: { $in: ids }, convertedFromGuestAt: { $ne: null } }),
    AuditLogModel.countDocuments({ action: "guest.merged", createdAt: inRange(r) }),
  ]);
  return {
    period: period(r),
    steps: [
      { name: "guest_started", count: ids.length },
      { name: "guest_played_mission", count: played.length },
      { name: "guest_registered", count: upgraded },
      { name: "guest_merged_into_account", count: merged },
    ],
    note: "Visits are not tracked. Guests purged after the inactivity period and merged guests no longer appear in the first two steps.",
  };
}
