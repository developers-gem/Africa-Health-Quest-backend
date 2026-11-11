import {
  AttemptHistoryQuerySchema,
  ObjectIdSchema,
  StartAttemptSchema,
  SubmitAnswerSchema,
  z,
} from "@ahq/api-contracts";
import { Router, type Request, type RequestHandler } from "express";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import type { GameplayService } from "./gameplay.service.js";

export function attemptsRouter(deps: {
  authn: RequestHandler;
  gameplay: GameplayService;
  idempotent: RequestHandler;
}) {
  const { authn, gameplay, idempotent } = deps;
  const r = Router();
  r.use(authn);
  const uid = (req: Request) => requireAuth(req).user.id as string;
  const idParams = z.object({ id: ObjectIdSchema });

  r.post("/", idempotent, async (req, res) => {
    const input = parseBody(req, StartAttemptSchema);
    const { attempt, created } = await gameplay.start(uid(req), input, {
      platform: req.get("x-client-platform"),
      appVersion: req.get("x-app-version"),
    });
    const { version } = await gameplay.load(uid(req), attempt.id as string);
    res.status(created ? 201 : 200).json(gameplay.toDto(attempt, version));
  });

  r.get("/:id", async (req, res) => {
    const { attempt, version } = await gameplay.load(uid(req), parseParams(req, idParams).id);
    res.json(gameplay.toDto(attempt, version));
  });

  r.post("/:id/answers", idempotent, async (req, res) => {
    const { id } = parseParams(req, idParams);
    res.json(await gameplay.answer(uid(req), id, parseBody(req, SubmitAnswerSchema)));
  });

  r.post("/:id/abandon", async (req, res) => {
    res.json(await gameplay.abandon(uid(req), parseParams(req, idParams).id));
  });

  return r;
}

export function attemptHistoryRouter(deps: { authn: RequestHandler; gameplay: GameplayService }) {
  const r = Router();
  r.get("/me/attempts", deps.authn, async (req, res) => {
    const q = parseQuery(req, AttemptHistoryQuerySchema);
    const { items, total } = await deps.gameplay.history(requireAuth(req).user.id as string, q);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });
  return r;
}
