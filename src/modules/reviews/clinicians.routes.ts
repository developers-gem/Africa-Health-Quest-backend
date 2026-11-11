import {
  ClinicianProfileInputSchema,
  ClinicianVerificationSchema,
  ObjectIdSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import express, { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import { toMediaDto, type MediaService } from "../media/media.service.js";
import { UserModel } from "../users/user.model.js";
import type { CliniciansService } from "./clinicians.service.js";

/** Self-service clinician application (any registered user with a confirmed email). */
export function clinicianProfileRouter(deps: {
  authn: RequestHandler;
  registered: RequestHandler;
  clinicians: CliniciansService;
  media: MediaService;
}) {
  const { authn, registered, clinicians, media } = deps;
  const r = Router();
  r.use(authn, registered);

  r.get("/me/clinician-profile", async (req, res) => {
    const { user } = requireAuth(req);
    if (!user.clinician) throw AppError.notFound("No clinician profile yet.");
    res.json(await clinicians.toDto(user.clinician));
  });

  r.put("/me/clinician-profile", async (req, res) => {
    const { user } = requireAuth(req);
    const { profile, wasVerified } = await clinicians.submit(
      user,
      parseBody(req, ClinicianProfileInputSchema),
    );
    await recordAudit({
      actorId: user.id as string,
      actorRoles: [...user.roles],
      action: wasVerified
        ? "clinician.profile.changed_after_verification"
        : "clinician.profile.submitted",
      targetType: "User",
      targetId: user.id as string,
      requestId: req.requestId,
    });
    res.json(await clinicians.toDto(profile));
  });

  r.post(
    "/me/clinician-evidence",
    express.raw({ type: ["image/png", "image/jpeg", "application/pdf"], limit: "10mb" }),
    async (req, res) => {
      const { user } = requireAuth(req);
      if (!user.emailVerifiedAt) throw AppError.forbidden("Confirm your email first.");
      if (!Buffer.isBuffer(req.body))
        throw AppError.badRequest("Send the file as the raw request body with its Content-Type.");
      const { filename } = parseQuery(req, z.object({ filename: z.string().max(200).optional() }));
      const asset = await media.upload({
        ownerId: user.id as string,
        purpose: "clinician_evidence",
        declaredType: req.get("content-type") ?? "",
        data: req.body,
        originalName: filename,
      });
      res.status(201).json(toMediaDto(asset));
    },
  );

  r.get("/me/clinician-evidence/:id", async (req, res) => {
    const { id } = parseParams(req, z.object({ id: ObjectIdSchema }));
    const asset = await media.find(id);
    if (!asset || String(asset.ownerId) !== requireAuth(req).user.id)
      throw AppError.notFound("File not found.");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.type(asset.contentType).send(await media.read(asset));
  });

  return r;
}

/** Credential verification by administrators. */
export function adminCliniciansRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  recentAuth: RequestHandler;
  clinicians: CliniciansService;
}) {
  const { can, recentAuth, clinicians } = deps;
  const r = Router();
  const idParams = z.object({ userId: ObjectIdSchema });

  const adminDto = async (u: InstanceType<typeof UserModel>) => ({
    ...(await clinicians.toDto(u.clinician!)),
    userId: u.id as string,
    email: u.email ?? null,
    roles: [...u.roles],
    registrationNumber: clinicians.registrationNumber(u.clinician!),
  });

  r.get("/", can("clinicians:verify"), async (req, res) => {
    const { status } = parseQuery(
      req,
      z.object({ status: z.enum(["pending", "verified", "rejected"]).optional() }),
    );
    const users = await clinicians.list(status);
    res.json({ items: await Promise.all(users.map(adminDto)) });
  });

  r.get("/:userId", can("clinicians:verify"), async (req, res) => {
    const { userId } = parseParams(req, idParams);
    const u = await UserModel.findById(userId);
    if (!u?.clinician) throw AppError.notFound("Clinician profile not found.");
    res.json(await adminDto(u));
  });

  r.post("/:userId/verify", can("clinicians:verify"), recentAuth, async (req, res) => {
    const { userId } = parseParams(req, idParams);
    const { decision, reason } = parseBody(req, ClinicianVerificationSchema);
    const actor = requireAuth(req).user;
    const { target, before } = await clinicians.verify(
      userId,
      decision,
      reason,
      actor.id as string,
    );
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: `clinician.${decision}`,
      targetType: "User",
      targetId: userId,
      before: { status: before },
      after: { status: decision },
      reason,
      requestId: req.requestId,
    });
    res.json(await adminDto(target));
  });

  return r;
}
