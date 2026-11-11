import { OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { API_PREFIX, API_VERSION } from "@ahq/shared-types";
import { makeApi, type Api } from "./openapi/helpers.js";
import { registerAdminOpsRoutes } from "./openapi/admin-ops.js";
import { registerAiRoutes } from "./openapi/ai.js";
import { registerMobileRoutes } from "./openapi/mobile.js";
import { registerAdminUserRoutes } from "./openapi/admin-users.js";
import { registerAuthRoutes } from "./openapi/auth.js";
import { registerCountryAdminRoutes } from "./openapi/countries-admin.js";
import { registerHospitalRoutes } from "./openapi/hospital.js";
import { registerMissionRoutes } from "./openapi/missions.js";
import { registerPlayerRoutes } from "./openapi/players.js";
import { registerReviewRoutes } from "./openapi/reviews.js";
import { registerSyncRoutes } from "./openapi/sync.js";
import { registerSystemRoutes } from "./openapi/system.js";

export { API_PREFIX };

/** Module registrations, in documentation order. Each backend module adds its file here. */
const MODULES: ((api: Api) => void)[] = [
  registerSystemRoutes,
  registerAuthRoutes,
  registerAdminUserRoutes,
  registerPlayerRoutes,
  registerMissionRoutes,
  registerCountryAdminRoutes,
  registerHospitalRoutes,
  registerReviewRoutes,
  registerSyncRoutes,
  registerAdminOpsRoutes,
  registerAiRoutes,
  registerMobileRoutes,
];

export function buildOpenApiDocument(version = API_VERSION) {
  const registry = new OpenAPIRegistry();
  const bearer = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });
  const api = makeApi(registry, bearer.name);
  for (const register of MODULES) register(api);

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Africa Health Quest API",
      version,
      description:
        "Save Lives. Build Healthier Nations. All scoring and clinical answer keys are server-side. Errors use the ErrorResponse envelope.",
    },
    servers: [{ url: "/" }],
  });
}
