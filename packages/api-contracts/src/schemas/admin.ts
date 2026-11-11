import { z } from "../zod.js";
import { PaginationQuerySchema, RoleSchema, paginated } from "./common.js";
import { UserSchema } from "./auth.js";

export const AdminUserListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  role: RoleSchema.optional(),
  status: z.enum(["active", "suspended"]).optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

export const AdminUserListResponseSchema = paginated(UserSchema).openapi("AdminUserList");
export type AdminUserListResponse = z.infer<typeof AdminUserListResponseSchema>;

export const UpdateRolesRequestSchema = z
  .object({
    roles: z.array(RoleSchema).max(3).describe("Full set of roles. 'player' is always kept."),
    reason: z.string().trim().max(500).optional(),
  })
  .openapi("UpdateRolesRequest");
export type UpdateRolesRequest = z.infer<typeof UpdateRolesRequestSchema>;

export const ReasonRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(500) })
  .openapi("ReasonRequest");
export type ReasonRequest = z.infer<typeof ReasonRequestSchema>;
