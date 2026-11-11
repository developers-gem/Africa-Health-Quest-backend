import { ERROR_CODES, ROLES } from "@ahq/shared-types";
import { z } from "../zod.js";

export { ERROR_CODES, ROLES };

export const RoleSchema = z.enum(ROLES).openapi("Role");
export type Role = z.infer<typeof RoleSchema>;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      details: z
        .array(z.object({ path: z.string(), message: z.string() }))
        .optional()
        .describe("Field-level problems, present for VALIDATION_ERROR"),
      requestId: z.string().optional(),
    }),
  })
  .openapi("ErrorResponse");
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const MessageResponseSchema = z.object({ message: z.string() }).openapi("MessageResponse");
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const ObjectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Must be a valid id")
  .openapi({ example: "665f1c2e9b1d8a0012345678" });

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}
