import {
  AdminCountryListQuerySchema,
  AssignMissionsSchema,
  CountryCodeSchema,
  CountryCreateSchema,
  CountryUpdateSchema,
  z,
  type CountryUpdate,
} from "@ahq/api-contracts";
import { flagEmoji } from "@ahq/game-content";
import type { Permission } from "@ahq/shared-types";
import { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import type { MediaService } from "../media/media.service.js";
import type { AuthoringService } from "../missions/authoring.service.js";
import { toCountryDto, type CountriesService } from "./countries.service.js";
import { CountryModel, type CountryAttrs } from "./country.model.js";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function adminCountriesRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  countries: CountriesService;
  media: MediaService;
  authoring: AuthoringService;
}) {
  const { can, countries, media, authoring } = deps;
  const r = Router();
  const codeParams = z.object({ code: CountryCodeSchema });

  const adminDto = (c: CountryAttrs & { updatedAt?: Date }, count: number) => ({
    ...toCountryDto(c, count),
    flagAssetId: c.flagAssetId ? String(c.flagAssetId) : null,
    imageAssetId: c.imageAssetId ? String(c.imageAssetId) : null,
    updatedAt: (c.updatedAt ?? new Date()).toISOString(),
  });

  const checkAssets = async (input: Pick<CountryUpdate, "flagAssetId" | "imageAssetId">) => {
    if (input.flagAssetId) await media.requireAttachable(input.flagAssetId, ["country_flag"]);
    if (input.imageAssetId) await media.requireAttachable(input.imageAssetId, ["country_image"]);
  };

  r.get("/", can("catalog:edit"), async (req, res) => {
    const q = parseQuery(req, AdminCountryListQuerySchema);
    const filter: Record<string, unknown> = {};
    if (q.status) filter.status = q.status;
    if (q.region) filter.region = q.region;
    if (q.search)
      filter.$or = [
        { name: new RegExp(escapeRegex(q.search), "i") },
        { code: q.search.toUpperCase() },
      ];
    const [list, counts] = await Promise.all([
      CountryModel.find(filter).sort({ sortOrder: 1, name: 1 }).lean(),
      countries.missionCounts(),
    ]);
    res.json({ items: list.map((c) => adminDto(c, counts.get(c.code) ?? 0)) });
  });

  r.get("/:code", can("catalog:edit"), async (req, res) => {
    const { code } = parseParams(req, codeParams);
    const c = await CountryModel.findOne({ code }).lean();
    if (!c) throw AppError.notFound("Country not found.");
    res.json(adminDto(c, (await countries.missionCounts()).get(code) ?? 0));
  });

  r.post("/", can("catalog:edit"), async (req, res) => {
    const input = parseBody(req, CountryCreateSchema);
    await checkAssets(input);
    const actor = requireAuth(req).user;
    const created = await CountryModel.create({
      status: "hidden",
      unlock: { minHp: 0, minTierIndex: 0 },
      flagEmoji: flagEmoji(input.code),
      ...input,
    }).catch((e) => {
      if ((e as { code?: number }).code === 11000)
        throw AppError.conflict(`Country ${input.code} already exists.`);
      throw e;
    });
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "country.created",
      targetType: "Country",
      targetId: input.code,
      after: input,
      requestId: req.requestId,
    });
    res.status(201).json(adminDto(created.toObject(), 0));
  });

  r.patch("/:code", can("catalog:edit"), async (req, res) => {
    const { code } = parseParams(req, codeParams);
    const input = parseBody(req, CountryUpdateSchema);
    if (!Object.keys(input).length) throw AppError.badRequest("Nothing to update.");
    await checkAssets(input);
    const actor = requireAuth(req).user;
    const before = await CountryModel.findOne({ code }).lean();
    if (!before) throw AppError.notFound("Country not found.");
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      if (k === "unlock" && v) {
        set["unlock.minHp"] = (v as { minHp: number }).minHp;
        set["unlock.minTierIndex"] = (v as { minTierIndex: number }).minTierIndex;
      } else set[k] = v;
    }
    const updated = await CountryModel.findOneAndUpdate(
      { code },
      { $set: set },
      { new: true, runValidators: true },
    ).lean();
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "country.updated",
      targetType: "Country",
      targetId: code,
      before: Object.fromEntries(
        Object.keys(input).map((k) => [k, (before as Record<string, unknown>)[k]]),
      ),
      after: input,
      requestId: req.requestId,
    });
    res.json(adminDto(updated!, (await countries.missionCounts()).get(code) ?? 0));
  });

  r.put("/:code/missions", can("content:edit"), async (req, res) => {
    const { code } = parseParams(req, codeParams);
    const { missionKeys } = parseBody(req, AssignMissionsSchema);
    if (!(await CountryModel.exists({ code }))) throw AppError.notFound("Country not found.");
    const actor = requireAuth(req).user;
    const items = await authoring.assignToCountry(missionKeys, code, actor.id as string);
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "country.missions.assigned",
      targetType: "Country",
      targetId: code,
      after: { items },
      requestId: req.requestId,
    });
    res.json({
      items,
      note: "Country assignment is clinical content: changed missions have a draft version that must be submitted and approved by a clinician before players see the change.",
    });
  });

  return r;
}
