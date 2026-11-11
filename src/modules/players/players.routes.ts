import { LedgerQuerySchema, UpdatePlayerProfileSchema } from "@ahq/api-contracts";
import { Router, type RequestHandler } from "express";
import { parseBody, parseQuery, requireAuth } from "../../lib/http.js";
import { playerAchievements, statsFrom } from "./achievements.js";
import { toProfileDto, type ProfileService } from "./profile.service.js";
import type { ProgressService } from "./progress.service.js";

export function playersRouter(deps: {
  authn: RequestHandler;
  profiles: ProfileService;
  progress: ProgressService;
}) {
  const { authn, profiles, progress } = deps;
  const r = Router();
  r.use(authn);
  const uid = (req: Parameters<RequestHandler>[0]) => requireAuth(req).user.id as string;

  r.get("/me/profile", async (req, res) => {
    res.json(toProfileDto(await profiles.get(uid(req))));
  });

  r.patch("/me/profile", async (req, res) => {
    const { profile } = await profiles.update(uid(req), parseBody(req, UpdatePlayerProfileSchema));
    res.json(toProfileDto(profile));
  });

  r.get("/me/progress", async (req, res) => {
    const p = await progress.get(uid(req));
    const etag = `W/"p${p.version}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, no-cache");
    if (req.get("if-none-match") === etag) {
      res.status(304).end();
      return;
    }
    res.json(await progress.toDto(p));
  });

  r.get("/me/stats", async (req, res) => {
    res.json(statsFrom(await progress.toDto(await progress.get(uid(req)))));
  });

  r.get("/me/ledger", async (req, res) => {
    const q = parseQuery(req, LedgerQuerySchema);
    const { items, total } = await progress.ledger(uid(req), q.page, q.pageSize);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  r.get("/me/achievements", async (req, res) => {
    res.json(await playerAchievements(await progress.get(uid(req))));
  });

  return r;
}
