import { CountryCodeSchema, z, type Country } from "@ahq/api-contracts";
import { Router, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseParams } from "../../lib/http.js";
import type { ProgressService } from "../players/progress.service.js";
import { toCountryDto, type CountriesService, type UnlockContext } from "./countries.service.js";

export function countriesRouter(deps: {
  countries: CountriesService;
  progress: ProgressService;
  optionalAuth: RequestHandler;
}) {
  const { countries, progress, optionalAuth } = deps;
  const r = Router();

  const unlockContext = async (userId?: string): Promise<UnlockContext | undefined> => {
    if (!userId) return undefined;
    const p = await progress.get(userId);
    return { hp: p.hp, tierIndex: p.tierIndex };
  };

  r.get("/", optionalAuth, async (req, res) => {
    const [list, counts, ctx] = await Promise.all([
      countries.listVisible(),
      countries.missionCounts(),
      unlockContext(req.auth?.user.id as string | undefined),
    ]);
    res.json({
      items: list.map((c) => toCountryDto(c, counts.get(c.code) ?? 0, ctx)) satisfies Country[],
    });
  });

  r.get("/:code", optionalAuth, async (req, res) => {
    const { code } = parseParams(req, z.object({ code: CountryCodeSchema }));
    const c = await countries.findVisible(code);
    if (!c) throw AppError.notFound("Country not found.");
    const [counts, ctx] = await Promise.all([
      countries.missionCounts(),
      unlockContext(req.auth?.user.id as string | undefined),
    ]);
    res.json(toCountryDto(c, counts.get(c.code) ?? 0, ctx));
  });

  return r;
}
