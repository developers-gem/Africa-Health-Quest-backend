import type { ClinicianProfile, ClinicianProfileInput } from "@ahq/api-contracts";
import { Types } from "mongoose";
import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { decryptField, encryptField } from "../../lib/crypto.js";
import { MediaAssetModel } from "../media/media.model.js";
import { UserModel, type UserDocument } from "../users/user.model.js";

type ClinicianDoc = NonNullable<UserDocument["clinician"]>;

const mask = (v: string) =>
  v.length <= 3 ? "•••" : `${"•".repeat(Math.min(8, v.length - 3))}${v.slice(-3)}`;

export class CliniciansService {
  constructor(private readonly config: Config) {}

  registrationNumber(c: ClinicianDoc) {
    return decryptField(c.registrationNumberEnc, this.config.DATA_ENCRYPTION_KEY);
  }

  async toDto(c: ClinicianDoc): Promise<ClinicianProfile> {
    const assets = await MediaAssetModel.find({
      _id: { $in: c.evidenceAssetIds ?? [] },
      status: "ready",
    }).lean();
    return {
      fullName: c.fullName,
      credentials: c.credentials,
      profession: c.profession as ClinicianProfile["profession"],
      registrationBody: c.registrationBody,
      registrationNumberMasked: mask(this.registrationNumber(c)),
      countryCode: c.countryCode,
      evidence: assets.map((a) => ({ id: String(a._id), contentType: a.contentType })),
      status: c.status as ClinicianProfile["status"],
      submittedAt: c.submittedAt.toISOString(),
      verifiedAt: c.verifiedAt ? c.verifiedAt.toISOString() : null,
      rejectionReason: c.rejectionReason ?? null,
    };
  }

  /** Submits or updates the caller's profile. Any change to a verified profile requires re-verification. */
  async submit(user: UserDocument, input: ClinicianProfileInput) {
    if (user.isGuest || !user.emailVerifiedAt)
      throw AppError.forbidden("Confirm your email before applying as a clinician reviewer.");
    for (const id of input.evidenceAssetIds) {
      const asset = await MediaAssetModel.findOne({ _id: id, status: "ready" }).lean();
      if (!asset || String(asset.ownerId) !== user.id || asset.purpose !== "clinician_evidence") {
        throw AppError.badRequest("Evidence must be files you uploaded as clinician evidence.", [
          { path: "evidenceAssetIds", message: id },
        ]);
      }
    }
    const previous = user.clinician;
    user.set("clinician", {
      fullName: input.fullName,
      credentials: input.credentials,
      profession: input.profession,
      registrationBody: input.registrationBody,
      registrationNumberEnc: encryptField(
        input.registrationNumber,
        this.config.DATA_ENCRYPTION_KEY,
      ),
      countryCode: input.countryCode,
      evidenceAssetIds: input.evidenceAssetIds.map((id) => new Types.ObjectId(id)),
      status: "pending",
      submittedAt: new Date(),
      verifiedAt: null,
      verifiedBy: null,
      rejectionReason: null,
    });
    await user.save();
    return { profile: user.clinician!, wasVerified: previous?.status === "verified" };
  }

  async verify(
    targetId: string,
    decision: "verified" | "rejected",
    reason: string,
    actorId: string,
  ) {
    const target = await UserModel.findById(targetId);
    if (!target?.clinician) throw AppError.notFound("Clinician profile not found.");
    if (target.id === actorId) throw AppError.conflict("You cannot verify your own credentials.");
    const before = target.clinician.status;
    target.clinician.status = decision;
    target.clinician.verifiedAt = decision === "verified" ? new Date() : null;
    target.clinician.verifiedBy = new Types.ObjectId(actorId);
    target.clinician.rejectionReason = decision === "rejected" ? reason : null;
    await target.save();
    return { target, before };
  }

  list(status?: string) {
    const filter: Record<string, unknown> = { clinician: { $exists: true } };
    if (status) filter["clinician.status"] = status;
    return UserModel.find(filter).sort({ "clinician.submittedAt": 1 }).limit(200);
  }
}
