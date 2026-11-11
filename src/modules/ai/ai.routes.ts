import {
  AiConsentSchema,
  AiUsageQuerySchema,
  DebriefFlagSchema,
  ObjectIdSchema,
  RequestDebriefSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Router, type RequestHandler } from "express";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { resolveRange } from "../admin/analytics.service.js";
import type { AiService } from "./ai.service.js";

const idParams = z.object({ id: ObjectIdSchema });

/** Mounted at /api/v1 (paths /attempts/:id/debriefs, /debriefs/:id, /ai/*). */
export function aiRouter(deps: {
  authn: RequestHandler;
  idempotent: RequestHandler;
  ai: AiService;
}) {
  const { authn, idempotent, ai } = deps;
  const r = Router();

  r.post("/attempts/:id/debriefs", authn, idempotent, async (req, res) => {
    const { id } = parseParams(req, idParams);
    const body = parseBody(req, RequestDebriefSchema);
    const { created, debrief } = await ai.request(requireAuth(req).user, id, body);
    res.status(debrief.status === "pending" ? 202 : created ? 201 : 200).json(debrief);
  });
  r.get("/attempts/:id/debriefs", authn, async (req, res) => {
    const { id } = parseParams(req, idParams);
    res.json(await ai.listForAttempt(requireAuth(req).user.id as string, id));
  });
  r.get("/debriefs/:id", authn, async (req, res) => {
    const { id } = parseParams(req, idParams);
    res.json(await ai.get(requireAuth(req).user.id as string, id));
  });
  r.post("/debriefs/:id/flags", authn, async (req, res) => {
    const { id } = parseParams(req, idParams);
    res
      .status(201)
      .json(
        await ai.flag(requireAuth(req).user.id as string, id, parseBody(req, DebriefFlagSchema)),
      );
  });
  r.get("/ai/status", authn, async (req, res) => {
    res.json(await ai.status(requireAuth(req).user));
  });
  r.post("/ai/consent", authn, async (req, res) => {
    parseBody(req, AiConsentSchema);
    const { user } = requireAuth(req);
    await ai.acceptConsent(user);
    res.json({ ...(await ai.status(user)), consentRequired: false });
  });
  return r;
}

/** Mounted under /admin. */
export function adminAiRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  ai: AiService;
}) {
  const r = Router();
  r.get("/ai/usage", deps.can("analytics:read"), async (req, res) => {
    res.json(await deps.ai.usage(resolveRange(parseQuery(req, AiUsageQuerySchema))));
  });
  r.get("/ai/provider", deps.can("settings:read"), async (_req, res) => {
    res.json(await deps.ai.providerStatus());
  });
  return r;
}

/** Mounted under /review: flagged debriefs for clinician follow-up. */
export function reviewAiRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  ai: AiService;
}) {
  const r = Router();
  r.get("/ai-flags", deps.can("review:read"), async (_req, res) => {
    res.json(await deps.ai.flagged());
  });
  return r;
}
