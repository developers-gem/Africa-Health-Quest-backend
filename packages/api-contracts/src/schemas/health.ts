import { z } from "../zod.js";

export const HealthResponseSchema = z
  .object({
    status: z.enum(["ok", "degraded"]),
    version: z.string(),
    database: z.enum(["up", "down"]).optional(),
  })
  .openapi("HealthResponse");
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
