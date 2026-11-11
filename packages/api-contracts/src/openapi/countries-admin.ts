import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  AdminCountryListQuerySchema,
  AdminCountrySchema,
  AssignMissionsResultSchema,
  AssignMissionsSchema,
  CountryCodeSchema,
  CountryCreateSchema,
  CountryUpdateSchema,
} from "../schemas/countries.js";
import { MediaAssetSchema, MediaPurposeSchema, MediaUploadQuerySchema } from "../schemas/media.js";
import { idParam, type Api } from "./helpers.js";

export function registerCountryAdminRoutes({ route }: Api) {
  const C = `${API_PREFIX}/admin/countries`;
  const tag = "Admin · Countries";
  const code = z.object({ code: CountryCodeSchema });
  route({
    method: "get",
    path: C,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "All countries incl. hidden (54 AU members seeded)",
    query: AdminCountryListQuerySchema,
    ok: [200, z.object({ items: z.array(AdminCountrySchema) }), "Countries"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "get",
    path: `${C}/{code}`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Country detail",
    params: code,
    ok: [200, AdminCountrySchema, "Country"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "post",
    path: C,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Add a country (hidden until activated)",
    body: CountryCreateSchema,
    ok: [201, AdminCountrySchema, "Created"],
    errors: [
      [403, "FORBIDDEN"],
      [409, "CONFLICT"],
    ],
  });
  route({
    method: "patch",
    path: `${C}/{code}`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Edit country content, status, images and unlock requirements",
    params: code,
    body: CountryUpdateSchema,
    ok: [200, AdminCountrySchema, "Updated"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "put",
    path: `${C}/{code}/missions`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "content:edit",
    summary:
      "Assign missions to this country (creates draft versions that need clinician approval)",
    params: code,
    body: AssignMissionsSchema,
    ok: [200, AssignMissionsResultSchema, "Assignment result"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
    ],
  });

  const M = `${API_PREFIX}/admin/media`;
  const mtag = "Admin · Media";
  route({
    method: "post",
    path: M,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "media:upload (+ purpose permission)",
    summary: "Upload a file as the raw request body",
    description:
      "Content-Type must be image/png, image/jpeg, image/webp or application/pdf and must match the file content. Images ≤ 2 MB, PDF ≤ 10 MB. JPEG metadata (EXIF/GPS) is stripped; PDFs with active content are rejected; SVG is not accepted.",
    query: MediaUploadQuerySchema,
    ok: [201, MediaAssetSchema, "Stored"],
    errors: [
      [403, "FORBIDDEN"],
      [413, "Too large"],
    ],
  });
  route({
    method: "get",
    path: M,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "media:upload",
    summary: "List uploads (own uploads unless catalog:edit)",
    query: z.object({
      purpose: MediaPurposeSchema.optional(),
      mine: z.enum(["true", "false"]).optional(),
    }),
    ok: [200, z.object({ items: z.array(MediaAssetSchema) }), "Assets"],
  });
  route({
    method: "get",
    path: `${M}/{id}/content`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "media:upload",
    summary: "Download a file (private evidence: owner or clinicians:verify)",
    params: idParam(),
    ok: [200, null, "File bytes"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "delete",
    path: `${M}/{id}`,
    tag: mtag,
    auth: "bearer",
    mfa: true,
    permission: "media:upload (+ purpose permission)",
    summary: "Delete an unused file",
    params: idParam(),
    ok: [204, null, "Deleted"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT (in use)"],
    ],
  });
  route({
    method: "get",
    path: "/media/{id}",
    tag: "Media",
    auth: "public",
    summary: "Public media (immutable, sandboxed)",
    params: idParam(),
    ok: [200, null, "File bytes"],
    errors: [[404, "NOT_FOUND"]],
  });
}
