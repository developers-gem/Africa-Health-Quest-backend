import type { OpenAPIRegistry, RouteConfig } from "@asteasolutions/zod-to-openapi";
import type { ErrorCode } from "@ahq/shared-types";
import { CLIENT_PLATFORM_HEADER } from "@ahq/shared-types";
import { z } from "../zod.js";
import { ErrorResponseSchema } from "../schemas/common.js";
import { ClientPlatformSchema } from "../schemas/auth.js";

type Method = "get" | "post" | "put" | "patch" | "delete";
type Auth = "public" | "bearer" | "refresh";

export type RouteSpec = {
  method: Method;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: Auth;
  /** Permission(s) required (documented in the description). */
  permission?: string;
  stepUp?: boolean;
  mfa?: boolean;
  idempotent?: boolean;
  platformHeader?: boolean;
  body?: z.ZodTypeAny;
  query?: z.ZodObject;
  params?: z.ZodObject;
  ok: [number, z.ZodTypeAny | null, string];
  errors?: [number, ErrorCode | string][];
};

export type Api = { route: (spec: RouteSpec) => void; registry: OpenAPIRegistry };

export function makeApi(registry: OpenAPIRegistry, bearerName: string): Api {
  const route = (s: RouteSpec) => {
    const notes = [
      s.description,
      s.permission ? `**Permission:** \`${s.permission}\`.` : undefined,
      s.mfa ? "**Staff MFA** must be verified in this session." : undefined,
      s.stepUp
        ? "**Step-up:** requires re-authentication within the last 15 minutes (`STEP_UP_REQUIRED`)."
        : undefined,
      s.idempotent
        ? "Send an `Idempotency-Key` header; retries with the same key replay the first response."
        : undefined,
    ].filter(Boolean);
    const headers = z.object({
      ...(s.platformHeader ? { [CLIENT_PLATFORM_HEADER]: ClientPlatformSchema.optional() } : {}),
      ...(s.idempotent ? { "idempotency-key": z.string().min(8).max(64).optional() } : {}),
    });
    const errorResponses: RouteConfig["responses"] = {};
    const defaults: [number, string][] = [
      [400, "Invalid input (VALIDATION_ERROR)"],
      [429, "Too many requests (RATE_LIMITED)"],
    ];
    if (s.auth === "bearer")
      defaults.push([401, "Not signed in or session ended (UNAUTHENTICATED)"]);
    for (const [status, text] of [
      ...defaults,
      ...(s.errors ?? []).map(([c, d]) => [c, String(d)] as [number, string]),
    ]) {
      const existing = errorResponses[status] as { description: string } | undefined;
      errorResponses[status] = {
        description: existing ? `${existing.description}; ${text}` : text,
        content: { "application/json": { schema: ErrorResponseSchema } },
      };
    }
    registry.registerPath({
      method: s.method,
      path: s.path,
      tags: [s.tag],
      summary: s.summary,
      ...(notes.length ? { description: notes.join("\n\n") } : {}),
      ...(s.auth === "bearer" ? { security: [{ [bearerName]: [] }] } : {}),
      request: {
        ...(s.body ? { body: { content: { "application/json": { schema: s.body } } } } : {}),
        ...(s.query ? { query: s.query } : {}),
        ...(s.params ? { params: s.params } : {}),
        ...(Object.keys(headers.shape).length ? { headers } : {}),
      },
      responses: {
        [s.ok[0]]: s.ok[1]
          ? { description: s.ok[2], content: { "application/json": { schema: s.ok[1] } } }
          : { description: s.ok[2] },
        ...errorResponses,
      },
    });
  };
  return { route, registry };
}

export const idParam = (name = "id") =>
  z.object({
    [name]: z
      .string()
      .regex(/^[a-f0-9]{24}$/i)
      .openapi({ example: "665f1c2e9b1d8a0012345678" }),
  });
