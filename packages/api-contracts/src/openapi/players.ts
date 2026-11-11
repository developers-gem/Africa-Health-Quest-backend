import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  CountryCodeSchema,
  CountryListResponseSchema,
  CountrySchema,
} from "../schemas/countries.js";
import {
  AchievementInputSchema,
  AchievementUpdateSchema,
  AdminAchievementSchema,
  AdminPlayerSchema,
  LedgerPageSchema,
  LedgerQuerySchema,
  PlayerAchievementsSchema,
  PlayerProfileSchema,
  PlayerStatsSchema,
  ProgressAdjustmentSchema,
  ProgressSchema,
  UpdatePlayerProfileSchema,
} from "../schemas/players.js";
import { idParam, type Api } from "./helpers.js";

export function registerPlayerRoutes({ route }: Api) {
  const P = `${API_PREFIX}/players/me`;
  const tag = "Players";
  route({
    method: "get",
    path: `${P}/profile`,
    tag,
    auth: "bearer",
    summary: "Player profile (created on first access)",
    ok: [200, PlayerProfileSchema, "Profile"],
  });
  route({
    method: "patch",
    path: `${P}/profile`,
    tag,
    auth: "bearer",
    summary: "Update profile (unknown fields rejected)",
    body: UpdatePlayerProfileSchema,
    ok: [200, PlayerProfileSchema, "Updated"],
  });
  route({
    method: "get",
    path: `${P}/progress`,
    tag,
    auth: "bearer",
    summary:
      "Server-authoritative progress: HP, funding, hospital level, unlocks, missions, achievements",
    description: 'Returns `ETag: W/"p<version>"`; send `If-None-Match` for a 304.',
    ok: [200, ProgressSchema, "Progress"],
  });
  route({
    method: "get",
    path: `${P}/stats`,
    tag,
    auth: "bearer",
    summary: "Player statistics",
    ok: [200, PlayerStatsSchema, "Statistics"],
  });
  route({
    method: "get",
    path: `${P}/ledger`,
    tag,
    auth: "bearer",
    summary: "History of every HP/funding change",
    query: LedgerQuerySchema,
    ok: [200, LedgerPageSchema, "Ledger page"],
  });
  route({
    method: "get",
    path: `${P}/achievements`,
    tag,
    auth: "bearer",
    summary: "Earned achievements and progress towards the others",
    ok: [200, PlayerAchievementsSchema, "Achievements"],
  });

  const C = `${API_PREFIX}/countries`;
  route({
    method: "get",
    path: C,
    tag: "Countries",
    auth: "public",
    summary: "Active and coming-soon countries (all 54 AU members); `unlocked` when signed in",
    ok: [200, CountryListResponseSchema, "Countries"],
  });
  route({
    method: "get",
    path: `${C}/{code}`,
    tag: "Countries",
    auth: "public",
    summary: "Country detail",
    params: z.object({ code: CountryCodeSchema }),
    ok: [200, CountrySchema, "Country"],
    errors: [[404, "NOT_FOUND"]],
  });

  const A = `${API_PREFIX}/admin`;
  route({
    method: "get",
    path: `${A}/players/{id}`,
    tag: "Admin · Players",
    auth: "bearer",
    mfa: true,
    permission: "users:read",
    summary: "Player profile and progress",
    params: idParam(),
    ok: [200, AdminPlayerSchema, "Player"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "post",
    path: `${A}/players/{id}/adjustments`,
    tag: "Admin · Players",
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "users:manage",
    summary: "Audited manual HP/funding adjustment (support)",
    params: idParam(),
    body: ProgressAdjustmentSchema,
    ok: [200, ProgressSchema, "Adjusted"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "INSUFFICIENT_FUNDS / CONFLICT"],
    ],
  });
  const keyParam = z.object({ key: z.string() });
  route({
    method: "get",
    path: `${A}/achievements`,
    tag: "Admin · Achievements",
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Achievement catalogue (incl. retired)",
    ok: [200, z.object({ items: z.array(AdminAchievementSchema) }), "Catalogue"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "post",
    path: `${A}/achievements`,
    tag: "Admin · Achievements",
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Create an achievement",
    body: AchievementInputSchema,
    ok: [201, AdminAchievementSchema, "Created"],
    errors: [
      [403, "FORBIDDEN"],
      [409, "CONFLICT"],
    ],
  });
  route({
    method: "patch",
    path: `${A}/achievements/{key}`,
    tag: "Admin · Achievements",
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Update or retire an achievement",
    params: keyParam,
    body: AchievementUpdateSchema,
    ok: [200, AdminAchievementSchema, "Updated"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
}
