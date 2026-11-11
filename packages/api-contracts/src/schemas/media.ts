import { z } from "../zod.js";

export const MEDIA_PURPOSES = [
  "country_flag",
  "country_image",
  "mission_image",
  "achievement_icon",
  "clinician_evidence",
] as const;
export const MediaPurposeSchema = z.enum(MEDIA_PURPOSES);
export const MediaAssetSchema = z
  .object({
    id: z.string(),
    purpose: MediaPurposeSchema,
    visibility: z.enum(["public", "private"]),
    contentType: z.string(),
    sizeBytes: z.number().int(),
    sha256: z.string(),
    originalName: z.string().nullable(),
    url: z.string().nullable().describe("Public URL for public assets; null for private ones"),
    createdAt: z.string(),
  })
  .openapi("MediaAsset");
export const MediaUploadQuerySchema = z.object({
  purpose: MediaPurposeSchema,
  filename: z.string().max(200).optional(),
});
