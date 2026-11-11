import { MergeGuestSchema, SyncBatchSchema, SyncStateQuerySchema } from "@ahq/api-contracts";
import { createHash } from "node:crypto";
import { Router, type RequestHandler } from "express";
import type { Config } from "../../config/env.js";
import { parseBody, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import { toCountryDto, type CountriesService } from "../countries/countries.service.js";
import type { HospitalService } from "../hospital/hospital.service.js";
import type { MissionsService } from "../missions/missions.service.js";
import type { ProgressService } from "../players/progress.service.js";
import { tierFor } from "../players/domain/progression.js";
import type { SettingsService } from "../settings/settings.service.js";
import type { SyncService } from "./sync.service.js";

export function syncRouter(deps: {
  authn: RequestHandler;
  registered: RequestHandler;
  idempotent: RequestHandler;
  sync: SyncService;
}) {
  const { authn, registered, idempotent, sync } = deps;
  const r = Router();
  r.use(authn);

  r.post("/events", idempotent, async (req, res) => {
    const { events } = parseBody(req, SyncBatchSchema);
    res.json(await sync.processBatch(requireAuth(req).user, events));
  });

  r.get("/state", async (req, res) => {
    res.json(
      await sync.state(requireAuth(req).user.id as string, parseQuery(req, SyncStateQuerySchema)),
    );
  });

  r.post("/merge-guest", registered, async (req, res) => {
    const { guestAccessToken } = parseBody(req, MergeGuestSchema);
    const { user } = requireAuth(req);
    const result = await sync.mergeGuest(user, guestAccessToken);
    await recordAudit({
      actorId: user.id as string,
      actorRoles: [...user.roles],
      action: "guest.merged",
      targetType: "User",
      targetId: user.id as string,
      after: {
        attemptsMerged: result.attemptsMerged,
        hpAdded: result.hpAdded,
        fundingAdded: result.fundingAdded,
      },
      requestId: req.requestId,
    });
    res.json(result);
  });

  return r;
}

/** One cacheable call for app start / offline caches. Personalised when signed in. */
export function catalogRouter(deps: {
  config: Config;
  optionalAuth: RequestHandler;
  settings: SettingsService;
  countries: CountriesService;
  missions: MissionsService;
  progress: ProgressService;
  hospital: HospitalService;
}) {
  const r = Router();
  r.get("/", deps.optionalAuth, async (req, res) => {
    const userId = req.auth?.user.id as string | undefined;
    const p = userId ? await deps.progress.get(userId) : null;
    const [{ value: progression }, list, counts, missions, hospital] = await Promise.all([
      deps.settings.get("progression"),
      deps.countries.listVisible(),
      deps.countries.missionCounts(),
      deps.missions.listPublished(),
      deps.settings.get("hospital"),
    ]);
    const ctx = p
      ? { hp: p.hp, tierIndex: tierFor(p.hp, progression.tiers).tier.index }
      : undefined;
    const h = hospital.value as {
      unitCost: number;
      maxUnitsPerResource: number;
      resources: unknown[];
    };
    const body = {
      tiers: progression.tiers,
      countries: list.map((c) => toCountryDto(c, counts.get(c.code) ?? 0, ctx)),
      missions: await Promise.all(missions.map((m) => deps.missions.summary(m, p, "story"))),
      hospital: {
        unitCost: h.unitCost,
        maxUnitsPerResource: h.maxUnitsPerResource,
        resources: h.resources,
      },
      minAppVersion: {
        android: deps.config.MIN_APP_VERSION_ANDROID,
        ios: deps.config.MIN_APP_VERSION_IOS,
      },
    };
    const etag = `W/"c${createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32)}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", userId ? "private, no-cache" : "public, max-age=60");
    res.setHeader("Vary", "Authorization");
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    res.json({ etag, ...body });
  });
  return r;
}
