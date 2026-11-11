import {
  MissionKeySchema,
  MissionListQuerySchema,
  RandomMissionQuerySchema,
  z,
} from "@ahq/api-contracts";
import { randomInt } from "node:crypto";
import { Router, type Request, type RequestHandler } from "express";
import { AppError } from "../../lib/errors.js";
import { parseParams, parseQuery } from "../../lib/http.js";
import type { ProgressService } from "../players/progress.service.js";
import type { MissionsService } from "./missions.service.js";

export function missionsRouter(deps: {
  missions: MissionsService;
  progress: ProgressService;
  optionalAuth: RequestHandler;
  authn: RequestHandler;
}) {
  const { missions, progress, optionalAuth, authn } = deps;
  const r = Router();
  const progressOf = (req: Request) =>
    req.auth ? progress.get(req.auth.user.id as string) : Promise.resolve(null);

  r.get("/", optionalAuth, async (req, res) => {
    const q = parseQuery(req, MissionListQuerySchema);
    const [list, p] = await Promise.all([
      missions.listPublished({ country: q.country, topic: q.topic }),
      progressOf(req),
    ]);
    res.json({ items: await Promise.all(list.map((m) => missions.summary(m, p, q.mode))) });
  });

  /** Clinical Challenge "Random Case" — server-side choice; never repeats `exclude` when another exists. */
  r.get("/random", optionalAuth, async (req, res) => {
    const q = parseQuery(req, RandomMissionQuerySchema);
    const [list, p] = await Promise.all([missions.listPublished(), progressOf(req)]);
    let pool = list.filter((m) => m.key !== q.exclude);
    if (!pool.length) pool = list;
    if (q.mode === "story") {
      const open = [];
      for (const m of pool) if (!(await missions.lockState(m, p)).locked) open.push(m);
      pool = open;
    }
    if (!pool.length) throw AppError.notFound("No missions are available yet.");
    res.json(await missions.summary(pool[randomInt(pool.length)]!, p, q.mode));
  });

  /** Offline mission pack (signed-in players; offline-eligible published missions only; no answer keys). */
  r.get("/:key/pack", authn, async (req, res) => {
    const { key } = parseParams(req, z.object({ key: MissionKeySchema }));
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await missions.pack(await missions.getPublished(key)));
  });

  r.get("/:key", optionalAuth, async (req, res) => {
    const { key } = parseParams(req, z.object({ key: MissionKeySchema }));
    const mode = parseQuery(req, z.object({ mode: MissionListQuerySchema.shape.mode })).mode;
    const [m, p] = await Promise.all([missions.getPublished(key), progressOf(req)]);
    res.json(await missions.detail(m, p, mode));
  });

  return r;
}
