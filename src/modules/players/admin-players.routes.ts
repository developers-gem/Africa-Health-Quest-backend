import {
  AchievementInputSchema,
  AchievementUpdateSchema,
  ObjectIdSchema,
  ProgressAdjustmentSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Types } from "mongoose";
import { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import { UserModel } from "../users/user.model.js";
import { listCatalogue, toAchievementDto } from "./achievements.js";
import { AchievementModel } from "./player.models.js";
import { toProfileDto, type ProfileService } from "./profile.service.js";
import type { ProgressService } from "./progress.service.js";

export function adminPlayersRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  recentAuth: RequestHandler;
  profiles: ProfileService;
  progress: ProgressService;
}) {
  const { can, recentAuth, profiles, progress } = deps;
  const r = Router();
  const idParams = z.object({ id: ObjectIdSchema });

  r.get("/players/:id", can("users:read"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    if (!(await UserModel.exists({ _id: id }))) throw AppError.notFound("Player not found.");
    const [profile, p] = await Promise.all([profiles.get(id), progress.get(id)]);
    res.json({ userId: id, profile: toProfileDto(profile), progress: await progress.toDto(p) });
  });

  r.post("/players/:id/adjustments", can("users:manage"), recentAuth, async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { hp, funding, reason } = parseBody(req, ProgressAdjustmentSchema);
    if (!(await UserModel.exists({ _id: id }))) throw AppError.notFound("Player not found.");
    const actor = requireAuth(req).user;
    const result = await progress.applyChange(id, {
      source: "admin_adjustment",
      sourceId: new Types.ObjectId().toString(),
      hp,
      funding,
      note: reason,
    });
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "progress.admin_adjustment",
      targetType: "User",
      targetId: id,
      after: { hp, funding },
      reason,
      requestId: req.requestId,
    });
    res.json(await progress.toDto(result.progress));
  });

  // ---- Achievement catalogue ----
  const keyParams = z.object({ key: z.string().regex(/^[a-z0-9_-]{2,40}$/) });
  const adminDto = (a: Awaited<ReturnType<typeof listCatalogue>>[number]) => ({
    ...toAchievementDto(a),
    status: a.status as "active" | "retired",
    sortOrder: a.sortOrder ?? 0,
  });

  r.get("/achievements", can("catalog:edit"), async (_req, res) => {
    res.json({ items: (await listCatalogue(true)).map(adminDto) });
  });

  r.post("/achievements", can("catalog:edit"), async (req, res) => {
    const input = parseBody(req, AchievementInputSchema);
    const actor = requireAuth(req).user;
    const doc = await AchievementModel.create(input).catch((e) => {
      if ((e as { code?: number }).code === 11000)
        throw AppError.conflict("An achievement with this key exists.");
      throw e;
    });
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "achievement.created",
      targetType: "Achievement",
      targetId: input.key,
      after: input,
      requestId: req.requestId,
    });
    res.status(201).json(adminDto(doc.toObject()));
  });

  r.patch("/achievements/:key", can("catalog:edit"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const input = parseBody(req, AchievementUpdateSchema);
    const actor = requireAuth(req).user;
    const before = await AchievementModel.findOne({ key }).lean();
    if (!before) throw AppError.notFound("Achievement not found.");
    const doc = await AchievementModel.findOneAndUpdate(
      { key },
      { $set: input },
      { new: true, runValidators: true },
    ).lean();
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "achievement.updated",
      targetType: "Achievement",
      targetId: key,
      before,
      after: input,
      requestId: req.requestId,
    });
    res.json(adminDto(doc!));
  });

  return r;
}
