import {
  AdminUserListQuerySchema,
  ObjectIdSchema,
  ReasonRequestSchema,
  UpdateRolesRequestSchema,
  z,
  type AdminUserListResponse,
  type Role,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import type { SessionService } from "../auth/session.service.js";
import { toUserDto } from "../users/user.mapper.js";
import { UserModel, isStaff } from "../users/user.model.js";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const idParams = z.object({ id: ObjectIdSchema });
const hadReviewerRole = (roles: readonly string[]) => roles.includes("reviewer");

export function adminUsersRouter(deps: {
  sessions: SessionService;
  can: (...p: Permission[]) => RequestHandler;
  requireRecentAuth: RequestHandler;
}) {
  const { sessions, can, requireRecentAuth } = deps;
  const r = Router();

  const loadTarget = async (id: string) => {
    const target = await UserModel.findById(id).select("+mfa");
    if (!target) throw AppError.notFound("User not found.");
    return target;
  };

  r.get("/", can("users:read"), async (req, res) => {
    const q = parseQuery(req, AdminUserListQuerySchema);
    const filter: Record<string, unknown> = { isGuest: false };
    if (q.role) filter.roles = q.role;
    if (q.status === "suspended") filter.disabledAt = { $ne: null };
    if (q.status === "active") filter.disabledAt = null;
    if (q.search) {
      const rx = new RegExp(escapeRegex(q.search), "i");
      filter.$or = [{ email: rx }, { displayName: rx }];
    }
    const [items, total] = await Promise.all([
      UserModel.find(filter)
        .select("+mfa")
        .sort({ createdAt: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize),
      UserModel.countDocuments(filter),
    ]);
    res.json({
      items: items.map(toUserDto),
      page: q.page,
      pageSize: q.pageSize,
      total,
    } satisfies AdminUserListResponse);
  });

  r.get("/:id", can("users:read"), async (req, res) => {
    res.json(toUserDto(await loadTarget(parseParams(req, idParams).id)));
  });

  r.put("/:id/roles", can("users:manage-roles"), requireRecentAuth, async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { roles, reason } = parseBody(req, UpdateRolesRequestSchema);
    const actor = requireAuth(req).user;
    const target = await loadTarget(id);

    const next = Array.from(new Set<Role>(["player", ...roles]));
    if (target.isGuest && next.length > 1)
      throw AppError.conflict("Guest accounts cannot hold staff roles.");
    if (target.id === actor.id && !next.includes("admin"))
      throw AppError.conflict("You cannot remove your own admin role.");
    if (
      next.includes("reviewer") &&
      !hadReviewerRole(target.roles) &&
      target.clinician?.status !== "verified"
    ) {
      throw AppError.conflict(
        "Verify the user's clinician credentials before granting the reviewer role.",
      );
    }
    if (isStaff(next) && !target.emailVerifiedAt) {
      throw AppError.conflict("The user must confirm their email before receiving staff roles.");
    }

    const before = [...target.roles];
    const changed = before.length !== next.length || before.some((r) => !next.includes(r as Role));
    target.roles = next;
    await target.save();
    // New session policy (MFA, shorter lifetime) applies from the next sign-in.
    if (changed && target.id !== actor.id)
      await sessions.revokeAllForUser(target.id as string, "roles_changed");
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "user.roles.update",
      targetType: "User",
      targetId: target.id as string,
      before: { roles: before },
      after: { roles: next },
      ...(reason ? { reason } : {}),
      requestId: req.requestId,
    });
    res.json(toUserDto(target));
  });

  r.post("/:id/suspend", can("users:manage"), requireRecentAuth, async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { reason } = parseBody(req, ReasonRequestSchema);
    const actor = requireAuth(req).user;
    const target = await loadTarget(id);
    if (target.id === actor.id) throw AppError.conflict("You cannot suspend your own account.");
    if (target.disabledAt) throw AppError.conflict("This account is already suspended.");
    target.disabledAt = new Date();
    target.set("suspension", { reason, by: actor._id, at: target.disabledAt });
    await target.save();
    const revoked = await sessions.revokeAllForUser(target.id as string, "suspended");
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "user.suspended",
      targetType: "User",
      targetId: target.id as string,
      after: { sessionsRevoked: revoked },
      reason,
      requestId: req.requestId,
    });
    res.json(toUserDto(target));
  });

  r.post("/:id/unsuspend", can("users:manage"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { reason } = parseBody(req, ReasonRequestSchema);
    const actor = requireAuth(req).user;
    const target = await loadTarget(id);
    if (!target.disabledAt) throw AppError.conflict("This account is not suspended.");
    target.disabledAt = null;
    target.set("suspension", undefined);
    await target.save();
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "user.unsuspended",
      targetType: "User",
      targetId: target.id as string,
      reason,
      requestId: req.requestId,
    });
    res.json(toUserDto(target));
  });

  r.post("/:id/sessions/revoke", can("users:manage"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { reason } = parseBody(req, ReasonRequestSchema);
    const actor = requireAuth(req).user;
    const target = await loadTarget(id);
    const revoked = await sessions.revokeAllForUser(target.id as string, "admin");
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "user.sessions.revoked",
      targetType: "User",
      targetId: target.id as string,
      after: { sessionsRevoked: revoked },
      reason,
      requestId: req.requestId,
    });
    res.status(200).json({ revoked });
  });

  return r;
}
