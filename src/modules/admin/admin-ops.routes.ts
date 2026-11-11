import {
  AnalyticsRangeQuerySchema,
  MissionAnalyticsQuerySchema,
  AuditLogQuerySchema,
  EraseUserSchema,
  ObjectIdSchema,
  PaginationQuerySchema,
  SettingKeySchema,
  UpdateSettingSchema,
  z,
} from "@ahq/api-contracts";
import { PERMISSIONS, ROLES, SYSTEM_ROLES, type Permission } from "@ahq/shared-types";
import { Router, type RequestHandler } from "express";
import mongoose from "mongoose";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { AuditLogModel, recordAudit } from "../audit/audit-log.model.js";
import { purgeUserData } from "../jobs/retention.js";
import { MediaAssetModel } from "../media/media.model.js";
import type { MediaService } from "../media/media.service.js";
import { MissionReviewModel } from "../reviews/review.models.js";
import type { SettingsService } from "../settings/settings.service.js";
import { PlatformSettingModel } from "../settings/settings.model.js";
import { UserModel, isStaff } from "../users/user.model.js";
import { analyticsOverview, funnel, missionAnalytics, resolveRange } from "./analytics.service.js";

const keyParams = z.object({ key: SettingKeySchema });
const idParams = z.object({ id: ObjectIdSchema });
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type SettingDoc = {
  key: string;
  version: number;
  status: string;
  value: unknown;
  changeNote: string;
  createdBy: unknown;
  createdAt?: Date;
};
const toSettingDto = (d: SettingDoc) => ({
  key: d.key as "economy",
  version: d.version,
  status: d.status as "active" | "archived",
  value: d.value as Record<string, unknown>,
  changeNote: d.changeNote,
  createdBy: String(d.createdBy),
  createdAt: (d.createdAt ?? new Date(0)).toISOString(),
});

/** Settings, audit log, analytics, role catalogue and account erasure (mounted under /admin). */
export function adminOpsRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  recentAuth: RequestHandler;
  settings: SettingsService;
  media: MediaService;
}) {
  const { can, recentAuth, settings, media } = deps;
  const r = Router();

  // ---- Settings ----------------------------------------------------------------------------------
  r.get("/settings", can("settings:read"), async (_req, res) => {
    for (const key of SettingKeySchema.options) await settings.get(key); // ensures defaults exist
    const docs = await PlatformSettingModel.find({ status: "active" }).sort({ key: 1 }).lean();
    res.json({ items: docs.map(toSettingDto) });
  });

  r.get("/settings/:key", can("settings:read"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    await settings.get(key);
    const doc = await PlatformSettingModel.findOne({ key, status: "active" }).lean();
    res.json(toSettingDto(doc!));
  });

  r.get("/settings/:key/history", can("settings:read"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const q = parseQuery(req, PaginationQuerySchema);
    const { items, total } = await settings.history(key, q.page, q.pageSize);
    res.json({ items: items.map(toSettingDto), page: q.page, pageSize: q.pageSize, total });
  });

  r.put("/settings/:key", can("settings:edit"), recentAuth, async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const body = parseBody(req, UpdateSettingSchema);
    const { user } = requireAuth(req);
    const out = await settings.update(
      key,
      body,
      { id: user.id as string, roles: [...user.roles] },
      req.requestId,
    );
    const doc = await PlatformSettingModel.findOne({ key, version: out.version }).lean();
    res.json(toSettingDto(doc!));
  });

  // ---- Audit log ---------------------------------------------------------------------------------
  r.get("/audit-logs", can("audit:read"), async (req, res) => {
    const q = parseQuery(req, AuditLogQuerySchema);
    const filter: Record<string, unknown> = {};
    if (q.action)
      filter.action = q.action.endsWith(".") ? { $regex: `^${escapeRegex(q.action)}` } : q.action;
    if (q.actorId) filter.actorId = q.actorId;
    if (q.targetType) filter.targetType = q.targetType;
    if (q.targetId) filter.targetId = q.targetId;
    if (q.from || q.to) {
      filter.createdAt = {
        ...(q.from ? { $gte: new Date(q.from) } : {}),
        ...(q.to ? { $lte: new Date(q.to) } : {}),
      };
    }
    const [items, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      AuditLogModel.countDocuments(filter),
    ]);
    res.json({
      items: items.map((a) => ({
        id: String(a._id),
        actorId: String(a.actorId),
        actorRoles: a.actorRoles ?? [],
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        before: a.before ?? null,
        after: a.after ?? null,
        reason: a.reason ?? null,
        requestId: a.requestId ?? null,
        createdAt: (a.createdAt as Date).toISOString(),
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    });
  });

  // ---- Analytics ---------------------------------------------------------------------------------
  r.get("/analytics/overview", can("analytics:read"), async (req, res) => {
    res.json(await analyticsOverview(resolveRange(parseQuery(req, AnalyticsRangeQuerySchema))));
  });

  r.get("/analytics/missions", can("analytics:read"), async (req, res) => {
    const q = parseQuery(req, MissionAnalyticsQuerySchema);
    res.json(await missionAnalytics(resolveRange(q), q.country));
  });

  r.get("/analytics/funnel", can("analytics:read"), async (req, res) => {
    res.json(await funnel(resolveRange(parseQuery(req, AnalyticsRangeQuerySchema))));
  });

  // ---- Roles catalogue ---------------------------------------------------------------------------
  r.get("/roles", can("users:read"), (_req, res) => {
    res.json({
      roles: ROLES.map((role) => ({
        role,
        ...SYSTEM_ROLES[role],
        permissions: [...SYSTEM_ROLES[role].permissions],
      })),
      permissions: [...PERMISSIONS],
    });
  });

  // ---- Account erasure (data-subject request) ----------------------------------------------------
  r.post("/users/:id/erase", can("users:manage"), recentAuth, async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { reason, confirmEmail } = parseBody(req, EraseUserSchema);
    const actor = requireAuth(req).user;
    if (actor.id === id) throw AppError.conflict("You cannot erase your own account here.");
    const target = await UserModel.findById(id);
    if (!target) throw AppError.notFound("User not found.");
    if (target.isGuest || target.email !== confirmEmail.toLowerCase()) {
      throw AppError.badRequest("confirmEmail does not match this account.");
    }
    if (isStaff(target.roles))
      throw AppError.conflict("Remove this user's staff roles before erasing the account.");
    if (await MissionReviewModel.exists({ reviewerId: target._id })) {
      throw AppError.conflict(
        "This user signed clinical reviews, which must be retained for clinical governance.",
      );
    }
    const evidence = await MediaAssetModel.find({ ownerId: target._id, status: { $ne: "deleted" } })
      .select("_id")
      .lean();
    for (const a of evidence) await media.delete(String(a._id));

    let documentsDeleted = 0;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async (s) => {
        documentsDeleted = await purgeUserData(id, s);
        await recordAudit(
          {
            actorId: actor.id as string,
            actorRoles: [...actor.roles],
            action: "user.erased",
            targetType: "User",
            targetId: id,
            after: { documentsDeleted, mediaDeleted: evidence.length },
            reason,
            requestId: req.requestId,
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }
    res.json({ userId: id, documentsDeleted: documentsDeleted + evidence.length });
  });

  return r;
}
