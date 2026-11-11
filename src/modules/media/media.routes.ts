import { ObjectIdSchema, z } from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import express, { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import { MEDIA_PURPOSES, MediaAssetModel, type MediaPurpose } from "./media.model.js";
import { toMediaDto, type MediaService } from "./media.service.js";

/** Which permission may upload/manage each purpose. Reviewers upload their own credential evidence. */
const PURPOSE_PERMISSION: Record<MediaPurpose, Permission> = {
  country_flag: "catalog:edit",
  country_image: "catalog:edit",
  achievement_icon: "catalog:edit",
  mission_image: "content:edit",
  clinician_evidence: "media:upload",
};

const idParams = z.object({ id: ObjectIdSchema });

/** Public delivery of public assets: immutable, sniff-proof, sandboxed. */
export function publicMediaRouter(deps: { media: MediaService }) {
  const r = Router();
  r.get("/:id", async (req, res) => {
    const asset = await deps.media.find(String(req.params.id));
    if (!asset || asset.visibility !== "public") throw AppError.notFound("File not found.");
    const etag = `"${asset.sha256}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    res.type(asset.contentType).send(await deps.media.read(asset));
  });
  return r;
}

export function adminMediaRouter(deps: {
  media: MediaService;
  can: (...p: Permission[]) => RequestHandler;
}) {
  const { media, can } = deps;
  const r = Router();
  const purposeOf = (req: express.Request) =>
    parseQuery(
      req,
      z.object({ purpose: z.enum(MEDIA_PURPOSES), filename: z.string().max(200).optional() }),
    );
  const permits = (req: express.Request, purpose: MediaPurpose) =>
    requireAuth(req).permissions.has(PURPOSE_PERMISSION[purpose]);

  r.post(
    "/",
    can("media:upload"),
    express.raw({
      type: ["image/png", "image/jpeg", "image/webp", "application/pdf"],
      limit: "10mb",
    }),
    async (req, res) => {
      const { purpose, filename } = purposeOf(req);
      if (!permits(req, purpose)) throw AppError.forbidden();
      if (!Buffer.isBuffer(req.body))
        throw AppError.badRequest("Send the file as the raw request body with its Content-Type.");
      const actor = requireAuth(req).user;
      const asset = await media.upload({
        ownerId: actor.id as string,
        purpose,
        declaredType: req.get("content-type") ?? "",
        data: req.body,
        originalName: filename,
      });
      await recordAudit({
        actorId: actor.id as string,
        actorRoles: [...actor.roles],
        action: "media.uploaded",
        targetType: "MediaAsset",
        targetId: asset.id as string,
        after: { purpose, sha256: asset.sha256, sizeBytes: asset.sizeBytes },
        requestId: req.requestId,
      });
      res.status(201).json(toMediaDto(asset));
    },
  );

  r.get("/", can("media:upload"), async (req, res) => {
    const q = parseQuery(
      req,
      z.object({
        purpose: z.enum(MEDIA_PURPOSES).optional(),
        mine: z.enum(["true", "false"]).optional(),
      }),
    );
    const auth = requireAuth(req);
    const filter: Record<string, unknown> = { status: "ready" };
    if (q.purpose) filter.purpose = q.purpose;
    // Without catalog/clinician permissions, users only see their own uploads.
    if (q.mine === "true" || !auth.permissions.has("catalog:edit")) filter.ownerId = auth.user._id;
    const items = await MediaAssetModel.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ items: items.map(toMediaDto) });
  });

  /** Authenticated download (needed for private evidence). */
  r.get("/:id/content", can("media:upload"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const asset = await media.find(id);
    const auth = requireAuth(req);
    if (!asset) throw AppError.notFound("File not found.");
    const own = String(asset.ownerId) === auth.user.id;
    const allowed =
      asset.visibility === "public" || own || auth.permissions.has("clinicians:verify");
    if (!allowed) throw AppError.notFound("File not found.");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader(
      "Content-Disposition",
      `${asset.contentType === "application/pdf" ? "attachment" : "inline"}; filename="${asset.id as string}"`,
    );
    res.type(asset.contentType).send(await media.read(asset));
  });

  r.delete("/:id", can("media:upload"), async (req, res) => {
    const { id } = parseParams(req, idParams);
    const asset = await media.find(id);
    if (!asset) throw AppError.notFound("File not found.");
    const auth = requireAuth(req);
    if (
      !permits(req, asset.purpose as MediaPurpose) ||
      (asset.purpose === "clinician_evidence" &&
        String(asset.ownerId) !== auth.user.id &&
        !auth.permissions.has("clinicians:verify"))
    ) {
      throw AppError.forbidden();
    }
    await media.delete(id);
    await recordAudit({
      actorId: auth.user.id as string,
      actorRoles: [...auth.user.roles],
      action: "media.deleted",
      targetType: "MediaAsset",
      targetId: id,
      requestId: req.requestId,
    });
    res.status(204).end();
  });

  return r;
}
