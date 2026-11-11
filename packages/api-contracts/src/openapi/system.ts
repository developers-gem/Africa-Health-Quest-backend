import { HealthResponseSchema } from "../schemas/health.js";
import type { Api } from "./helpers.js";

export function registerSystemRoutes({ route }: Api) {
  route({
    method: "get",
    path: "/health",
    tag: "System",
    auth: "public",
    summary: "Liveness check",
    ok: [200, HealthResponseSchema, "Running"],
  });
  route({
    method: "get",
    path: "/ready",
    tag: "System",
    auth: "public",
    summary: "Readiness (database connectivity)",
    ok: [200, HealthResponseSchema, "Ready"],
    errors: [[503, "Not ready"]],
  });
}
