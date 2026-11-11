import {
  HospitalEventInputSchema,
  HospitalEventUpdateSchema,
  HospitalRunQuerySchema,
  StartShiftSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Router, type Request, type RequestHandler } from "express";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import type { HospitalService } from "./hospital.service.js";

type EventRecord = {
  key: string;
  text: string;
  needs?: { staff: number; beds: number; ambulances: number; supplies: number } | null;
  weight?: number | null;
  minTierIndex?: number | null;
  countryCodes?: string[] | null;
  status?: string | null;
  updatedAt?: Date | null;
};
const eventDto = (e: EventRecord) => ({
  key: e.key,
  text: e.text,
  needs: {
    staff: e.needs?.staff ?? 0,
    beds: e.needs?.beds ?? 0,
    ambulances: e.needs?.ambulances ?? 0,
    supplies: e.needs?.supplies ?? 0,
  },
  weight: e.weight ?? 1,
  minTierIndex: e.minTierIndex ?? 0,
  countryCodes: [...(e.countryCodes ?? [])],
  status: (e.status ?? "active") as "active" | "retired",
  updatedAt: (e.updatedAt ?? new Date()).toISOString(),
});

export function hospitalRouter(deps: {
  authn: RequestHandler;
  hospital: HospitalService;
  idempotent: RequestHandler;
}) {
  const { authn, hospital, idempotent } = deps;
  const r = Router();
  r.use(authn);
  const uid = (req: Request) => requireAuth(req).user.id as string;

  r.get("/state", async (req, res) => {
    res.json(await hospital.state(uid(req)));
  });

  r.post("/runs", idempotent, async (req, res) => {
    const { allocation } = parseBody(req, StartShiftSchema);
    res.status(201).json(await hospital.run(uid(req), allocation));
  });

  r.get("/runs", async (req, res) => {
    const q = parseQuery(req, HospitalRunQuerySchema);
    const { items, total } = await hospital.history(uid(req), q.page, q.pageSize);
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

  return r;
}

export function adminHospitalRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  hospital: HospitalService;
}) {
  const { can, hospital } = deps;
  const r = Router();
  const keyParams = z.object({ key: z.string().regex(/^[a-z0-9_]{2,40}$/) });

  r.get("/events", can("catalog:edit"), async (_req, res) => {
    res.json({ items: (await hospital.listEvents()).map(eventDto) });
  });

  r.post("/events", can("catalog:edit"), async (req, res) => {
    const input = parseBody(req, HospitalEventInputSchema);
    const actor = requireAuth(req).user;
    const created = await hospital.createEvent(input);
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "hospital.event.created",
      targetType: "HospitalEvent",
      targetId: input.key,
      after: input,
      requestId: req.requestId,
    });
    res.status(201).json(eventDto(created.toObject()));
  });

  r.patch("/events/:key", can("catalog:edit"), async (req, res) => {
    const { key } = parseParams(req, keyParams);
    const input = parseBody(req, HospitalEventUpdateSchema);
    const actor = requireAuth(req).user;
    const { before, after } = await hospital.updateEvent(key, input);
    await recordAudit({
      actorId: actor.id as string,
      actorRoles: [...actor.roles],
      action: "hospital.event.updated",
      targetType: "HospitalEvent",
      targetId: key,
      before,
      after: input,
      requestId: req.requestId,
    });
    res.json(eventDto(after));
  });

  return r;
}
