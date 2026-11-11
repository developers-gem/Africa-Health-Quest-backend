import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import {
  AiConsentSchema,
  AiFlagListSchema,
  AiStatusSchema,
  AiUsageQuerySchema,
  AiProviderStatusSchema,
  AiUsageSchema,
  DebriefFlagSchema,
  DebriefListSchema,
  DebriefSchema,
  RequestDebriefSchema,
} from "../schemas/ai.js";
import { idParam, type Api } from "./helpers.js";

export function registerAiRoutes({ route }: Api) {
  const tag = "AI debriefs";
  route({
    method: "post",
    path: `${API_PREFIX}/attempts/{id}/debriefs`,
    tag,
    auth: "bearer",
    idempotent: true,
    summary: "Request a learning debrief for a completed attempt (Anthropic Claude, server-side)",
    description: [
      "Built from the server-recorded attempt and the clinician-approved case; correctness verdicts are copied from the attempt, never from the model, and only the version's approved references can be cited.",
      "`201` new debrief generated; `200` existing debrief for this level (pass `regenerate: true` for a new one); `202` still generating after 25 s — poll `GET /debriefs/{id}`.",
      "A failed generation (`status: failed`) does not count against the daily quota.",
      "`409 CONFLICT` (detail `mission: not_approved`) when the attempt's case version is not clinician-approved (withdrawn or retired).",
      "The debrief is AI-generated educational feedback (`aiGenerated: true`) and must be labelled so; it never replaces clinical instruction.",
    ].join("\n\n"),
    params: idParam(),
    body: RequestDebriefSchema,
    ok: [201, DebriefSchema, "Debrief"],
    errors: [
      [409, "ATTEMPT_NOT_ACTIVE (attempt not completed)"],
      [412, "PRECONDITION_FAILED (AI consent required)"],
      [429, "QUOTA_EXCEEDED / RATE_LIMITED"],
      [503, "AI_UNAVAILABLE"],
    ],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/attempts/{id}/debriefs`,
    tag,
    auth: "bearer",
    summary: "Debriefs for one of your attempts (newest first)",
    params: idParam(),
    ok: [200, DebriefListSchema, "Debriefs"],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/debriefs/{id}`,
    tag,
    auth: "bearer",
    summary: "One of your debriefs (poll while `pending`)",
    params: idParam(),
    ok: [200, DebriefSchema, "Debrief"],
  });
  route({
    method: "post",
    path: `${API_PREFIX}/debriefs/{id}/flags`,
    tag,
    auth: "bearer",
    summary: "Report a debrief as inaccurate, unsafe or unhelpful (clinicians review reports)",
    params: idParam(),
    body: DebriefFlagSchema,
    ok: [201, z.object({ message: z.string() }), "Reported"],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/ai/status`,
    tag,
    auth: "bearer",
    summary: "Whether debriefs are available, consent state and today's quota",
    ok: [200, AiStatusSchema, "Status"],
  });
  route({
    method: "post",
    path: `${API_PREFIX}/ai/consent`,
    tag,
    auth: "bearer",
    summary:
      "Accept AI processing of your case choices and reasoning (no names or emails are sent)",
    body: AiConsentSchema,
    ok: [200, AiStatusSchema, "Status"],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/review/ai-flags`,
    tag: "Clinician review",
    auth: "bearer",
    mfa: true,
    permission: "review:read",
    summary: "Debriefs reported by players, for clinician follow-up",
    ok: [200, AiFlagListSchema, "Reports"],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/admin/ai/usage`,
    tag: "Admin: analytics",
    auth: "bearer",
    mfa: true,
    permission: "analytics:read",
    summary:
      "AI requests, tokens, cost, failures and latency per day and model, plus the monthly budget",
    description:
      "Configure the model, effort, quotas, kill switch and budget via `PUT /admin/settings/ai`.",
    query: AiUsageQuerySchema,
    ok: [200, AiUsageSchema, "Usage"],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/admin/ai/provider`,
    tag: "Admin: analytics",
    auth: "bearer",
    mfa: true,
    permission: "settings:read",
    summary: "AI provider, model and fallback configuration, and whether generation is available",
    description:
      "The provider is set by server configuration (`AI_PROVIDER`, `ANTHROPIC_API_KEY`); the key is never returned. Change the model, effort, fallback model and limits via `PUT /admin/settings/ai`.",
    ok: [200, AiProviderStatusSchema, "Provider status"],
  });
}
