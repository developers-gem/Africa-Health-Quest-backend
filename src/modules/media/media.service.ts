import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { CountryModel } from "../countries/country.model.js";
import {
  MEDIA_TYPES,
  pdfHasActiveContent,
  sniffType,
  stripJpegMetadata,
  type MediaType,
} from "./file-inspection.js";
import {
  MediaAssetModel,
  PRIVATE_PURPOSES,
  type MediaDocument,
  type MediaPurpose,
} from "./media.model.js";
import type { ObjectStorage } from "./storage.js";

const ALLOWED: Record<MediaPurpose, MediaType[]> = {
  country_flag: ["image/png", "image/webp", "image/jpeg"],
  country_image: ["image/png", "image/webp", "image/jpeg"],
  mission_image: ["image/png", "image/webp", "image/jpeg"],
  achievement_icon: ["image/png", "image/webp"],
  clinician_evidence: ["application/pdf", "image/png", "image/jpeg"],
};

export function toMediaDto(m: MediaDocument | (MediaDocument & { toObject?: unknown })) {
  return {
    id: m.id as string,
    purpose: m.purpose as MediaPurpose,
    visibility: m.visibility as "public" | "private",
    contentType: m.contentType,
    sizeBytes: m.sizeBytes,
    sha256: m.sha256,
    originalName: m.originalName ?? null,
    url: m.visibility === "public" ? `/media/${m.id as string}` : null,
    createdAt: (m.get("createdAt") as Date).toISOString(),
  };
}

export class MediaService {
  constructor(private readonly storage: ObjectStorage) {}

  async upload(input: {
    ownerId: string;
    purpose: MediaPurpose;
    declaredType: string;
    data: Buffer;
    originalName?: string | undefined;
  }) {
    const declared = input.declaredType.split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED[input.purpose].includes(declared as MediaType)) {
      throw AppError.badRequest(
        `Allowed types for ${input.purpose}: ${ALLOWED[input.purpose].join(", ")}.`,
      );
    }
    if (!input.data.length) throw AppError.badRequest("The file is empty.");
    const detected = sniffType(input.data);
    if (detected !== declared)
      throw AppError.badRequest("The file content does not match its declared type.");
    if (input.data.length > MEDIA_TYPES[detected].maxBytes) {
      throw new AppError(
        413,
        "VALIDATION_ERROR",
        `Files of this type may be at most ${MEDIA_TYPES[detected].maxBytes / 1024 / 1024} MB.`,
      );
    }
    if (detected === "application/pdf" && pdfHasActiveContent(input.data)) {
      throw AppError.badRequest("PDFs with scripts, actions or embedded files are not accepted.");
    }
    const data = detected === "image/jpeg" ? stripJpegMetadata(input.data) : input.data;
    const id = new Types.ObjectId();
    const storageKey = `${input.purpose}/${id.toString()}.${MEDIA_TYPES[detected].ext}`;
    await this.storage.put(storageKey, data);
    try {
      return await MediaAssetModel.create({
        _id: id,
        ownerId: input.ownerId,
        purpose: input.purpose,
        visibility: PRIVATE_PURPOSES.includes(input.purpose) ? "private" : "public",
        storageKey,
        contentType: detected,
        sizeBytes: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        originalName: input.originalName?.replace(/[^\w.\- ]/g, "_").slice(0, 200) ?? null,
      });
    } catch (e) {
      await this.storage.delete(storageKey);
      throw e;
    }
  }

  async find(id: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    return MediaAssetModel.findOne({ _id: id, status: "ready" });
  }

  async read(asset: MediaDocument) {
    const data = await this.storage.get(asset.storageKey);
    if (!data) throw AppError.notFound("File not found.");
    return data;
  }

  /** Checks an asset can be attached where `purposes` are acceptable and it is public. */
  async requireAttachable(id: string, purposes: MediaPurpose[]) {
    const asset = await this.find(id);
    if (!asset || !purposes.includes(asset.purpose as MediaPurpose)) {
      throw AppError.badRequest(`Media ${id} must be an uploaded ${purposes.join(" or ")} asset.`);
    }
    return asset;
  }

  async delete(id: string) {
    const asset = await this.find(id);
    if (!asset) throw AppError.notFound("Media not found.");
    const inUse = await CountryModel.exists({
      $or: [{ flagAssetId: asset._id }, { imageAssetId: asset._id }],
    });
    if (inUse)
      throw AppError.conflict("This file is still used by a country. Replace it there first.");
    asset.status = "deleted";
    await asset.save();
    await this.storage.delete(asset.storageKey);
  }
}
