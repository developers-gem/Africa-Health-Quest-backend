import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  AnalyticsOverviewSchema,
  AnalyticsRangeQuerySchema,
  FunnelSchema,
  MissionAnalyticsQuerySchema,
  MissionAnalyticsSchema,
  AuditLogPageSchema,
  AuditLogQuerySchema,
  EraseUserResultSchema,
  EraseUserSchema,
  RoleCatalogSchema,
  SettingHistoryPageSchema,
  SettingKeySchema,
  SettingListSchema,
  SettingVersionSchema,
  UpdateSettingSchema,
} from "../schemas/admin-ops.js";
import { PaginationQuerySchema } from "../schemas/common.js";
import { idParam, type Api } from "./helpers.js";

export function registerAdminOpsRoutes({ route }: Api) {
  const A = `${API_PREFIX}/admin`;
  const keyParam = z.object({ key: SettingKeySchema });
  const staff = { auth: "bearer" as const, mfa: true };

  route({
    ...staff,
    method: "get",
    path: `${A}/settings`,
    tag: "Admin: settings",
    permission: "settings:read",
    summary: "Active version of every platform setting (economy, progression, hospital)",
    ok: [200, SettingListSchema, "Settings"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/settings/{key}`,
    tag: "Admin: settings",
    permission: "settings:read",
    summary: "Active version of one setting",
    params: keyParam,
    ok: [200, SettingVersionSchema, "Setting"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/settings/{key}/history`,
    tag: "Admin: settings",
    permission: "settings:read",
    summary: "Version history (newest first)",
    params: keyParam,
    query: PaginationQuerySchema,
    ok: [200, SettingHistoryPageSchema, "History"],
  });
  route({
    ...staff,
    method: "put",
    path: `${A}/settings/{key}`,
    tag: "Admin: settings",
    permission: "settings:edit",
    stepUp: true,
    summary: "Publish a new version of a setting",
    description:
      "The complete value is validated for the key. Attempts in progress keep the economy version they started with. Audited as `settings.updated`. Other API instances pick up the change within 30 seconds.",
    params: keyParam,
    body: UpdateSettingSchema,
    ok: [200, SettingVersionSchema, "New active version"],
    errors: [[412, "PRECONDITION_FAILED"]],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/audit-logs`,
    tag: "Admin: audit",
    permission: "audit:read",
    summary: "Search the append-only audit log (newest first)",
    query: AuditLogQuerySchema,
    ok: [200, AuditLogPageSchema, "Entries"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/analytics/overview`,
    tag: "Admin: analytics",
    permission: "analytics:read",
    summary:
      "Active players, registrations, conversions, gameplay, shifts, content and sync metrics",
    description: "Counts and rates only; no personal data.",
    query: AnalyticsRangeQuerySchema,
    ok: [200, AnalyticsOverviewSchema, "Overview"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/analytics/missions`,
    tag: "Admin: analytics",
    permission: "analytics:read",
    summary: "Per mission version: completion, pass rate, average score and choice distribution",
    query: MissionAnalyticsQuerySchema,
    ok: [200, MissionAnalyticsSchema, "Mission analytics"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/analytics/funnel`,
    tag: "Admin: analytics",
    permission: "analytics:read",
    summary: "Guest funnel: started → played a mission → registered (or merged)",
    query: AnalyticsRangeQuerySchema,
    ok: [200, FunnelSchema, "Funnel"],
  });
  route({
    ...staff,
    method: "get",
    path: `${A}/roles`,
    tag: "Admin: users",
    permission: "users:read",
    summary: "System roles with their permissions and session policies",
    ok: [200, RoleCatalogSchema, "Roles"],
  });
  route({
    ...staff,
    method: "post",
    path: `${A}/users/{id}/erase`,
    tag: "Admin: users",
    permission: "users:manage",
    stepUp: true,
    summary: "Erase a player account and all its personal data (data-subject request)",
    description:
      "Deletes the user, sessions, profile, progress, ledger, attempts, shifts, sync records and uploaded evidence. The audit record of the erasure is kept. Refused for staff accounts, the acting admin, and users who signed clinical reviews (retained for clinical governance).",
    params: idParam(),
    body: EraseUserSchema,
    ok: [200, EraseUserResultSchema, "Erased"],
    errors: [
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
    ],
  });
}
