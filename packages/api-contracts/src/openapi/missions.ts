import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  AnswerResponseSchema,
  AttemptHistoryPageSchema,
  AttemptHistoryQuerySchema,
  AttemptSchema,
  MissionDetailSchema,
  MissionKeySchema,
  MissionListQuerySchema,
  MissionListResponseSchema,
  MissionSummarySchema,
  RandomMissionQuerySchema,
  StartAttemptSchema,
  SubmitAnswerSchema,
} from "../schemas/missions.js";
import { idParam, type Api } from "./helpers.js";

export function registerMissionRoutes({ route }: Api) {
  const M = `${API_PREFIX}/missions`;
  const tag = "Missions";
  route({
    method: "get",
    path: M,
    tag,
    auth: "public",
    summary: "Published missions (clinician-approved only); story locks when signed in",
    query: MissionListQuerySchema,
    ok: [200, MissionListResponseSchema, "Missions"],
  });
  route({
    method: "get",
    path: `${M}/random`,
    tag,
    auth: "public",
    summary: "Random case (Clinical Challenge) chosen server-side",
    query: RandomMissionQuerySchema,
    ok: [200, MissionSummarySchema, "Mission"],
    errors: [[404, "NOT_FOUND (no missions)"]],
  });
  route({
    method: "get",
    path: `${M}/{key}`,
    tag,
    auth: "public",
    summary: "Mission detail with clinician verification (no steps)",
    params: z.object({ key: MissionKeySchema }),
    query: z.object({ mode: MissionListQuerySchema.shape.mode }),
    ok: [200, MissionDetailSchema, "Mission"],
    errors: [[404, "NOT_FOUND (unpublished or unknown)"]],
  });

  const A = `${API_PREFIX}/attempts`;
  const t2 = "Gameplay";
  route({
    method: "post",
    path: A,
    tag: t2,
    auth: "bearer",
    idempotent: true,
    summary: "Start (or resume) a mission attempt",
    description:
      "Returns 201 for a new attempt or 200 when an open attempt for the same mission and mode is resumed. Steps never include correctness or feedback.",
    body: StartAttemptSchema,
    ok: [201, AttemptSchema, "Attempt"],
    errors: [
      [403, "MISSION_LOCKED (details.lockReason: tier | country)"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "get",
    path: `${A}/{id}`,
    tag: t2,
    auth: "bearer",
    summary: "Attempt state: answered steps (with feedback) plus the current step",
    params: idParam(),
    ok: [200, AttemptSchema, "Attempt"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "post",
    path: `${A}/{id}/answers`,
    tag: t2,
    auth: "bearer",
    idempotent: true,
    summary: "Answer the current step; the last answer completes the attempt and applies rewards",
    params: idParam(),
    body: SubmitAnswerSchema,
    ok: [200, AnswerResponseSchema, "Answer evaluated"],
    errors: [
      [404, "NOT_FOUND"],
      [409, "STEP_ALREADY_ANSWERED / ATTEMPT_NOT_ACTIVE"],
    ],
  });
  route({
    method: "post",
    path: `${A}/{id}/abandon`,
    tag: t2,
    auth: "bearer",
    summary: "Abandon an attempt (no rewards)",
    params: idParam(),
    ok: [200, AttemptSchema, "Abandoned"],
    errors: [
      [404, "NOT_FOUND"],
      [409, "ATTEMPT_NOT_ACTIVE"],
    ],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/players/me/attempts`,
    tag: "Players",
    auth: "bearer",
    summary: "Mission history",
    query: AttemptHistoryQuerySchema,
    ok: [200, AttemptHistoryPageSchema, "History"],
  });
}
