import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  HospitalEventInputSchema,
  HospitalEventSchema,
  HospitalEventUpdateSchema,
  HospitalRunPageSchema,
  HospitalRunQuerySchema,
  HospitalStateSchema,
  ShiftResultSchema,
  StartShiftSchema,
} from "../schemas/hospital.js";
import type { Api } from "./helpers.js";

export function registerHospitalRoutes({ route }: Api) {
  const H = `${API_PREFIX}/hospital`;
  const tag = "Hospital Commander";
  route({
    method: "get",
    path: `${H}/state`,
    tag,
    auth: "bearer",
    summary: "Budget, hospital level, resources and recent performance",
    ok: [200, HospitalStateSchema, "State"],
  });
  route({
    method: "post",
    path: `${H}/runs`,
    tag,
    auth: "bearer",
    idempotent: true,
    summary:
      "Run a shift: allocate resources; the server rolls an emergency and applies cost and rewards",
    description:
      "Prototype rules: each unit costs `unitCost`; each covered need pays `hpPerNeedMet` HP and `fundingPerNeedMet` funding. The full cost must be affordable.",
    body: StartShiftSchema,
    ok: [201, ShiftResultSchema, "Shift result"],
    errors: [
      [409, "INSUFFICIENT_FUNDS"],
      [503, "SERVICE_UNAVAILABLE (no events)"],
    ],
  });
  route({
    method: "get",
    path: `${H}/runs`,
    tag,
    auth: "bearer",
    summary: "Shift history",
    query: HospitalRunQuerySchema,
    ok: [200, HospitalRunPageSchema, "Runs"],
  });

  const A = `${API_PREFIX}/admin/hospital/events`;
  const atag = "Admin · Hospital Commander";
  const key = z.object({ key: z.string() });
  route({
    method: "get",
    path: A,
    tag: atag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Emergency events",
    ok: [200, z.object({ items: z.array(HospitalEventSchema) }), "Events"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "post",
    path: A,
    tag: atag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Create an emergency event (optionally tier- or country-gated, weighted)",
    body: HospitalEventInputSchema,
    ok: [201, HospitalEventSchema, "Created"],
    errors: [
      [403, "FORBIDDEN"],
      [409, "CONFLICT"],
    ],
  });
  route({
    method: "patch",
    path: `${A}/{key}`,
    tag: atag,
    auth: "bearer",
    mfa: true,
    permission: "catalog:edit",
    summary: "Update or retire an event (one must stay active)",
    params: key,
    body: HospitalEventUpdateSchema,
    ok: [200, HospitalEventSchema, "Updated"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
    ],
  });
}
