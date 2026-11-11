import { API_PREFIX } from "@ahq/shared-types";
import {
  AdminUserListQuerySchema,
  AdminUserListResponseSchema,
  ReasonRequestSchema,
  UpdateRolesRequestSchema,
} from "../schemas/admin.js";
import { UserSchema } from "../schemas/auth.js";
import { idParam, type Api } from "./helpers.js";

export function registerAdminUserRoutes({ route }: Api) {
  const U = `${API_PREFIX}/admin/users`;
  const tag = "Admin · Users";
  route({
    method: "get",
    path: U,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "users:read",
    summary: "Search users",
    query: AdminUserListQuerySchema,
    ok: [200, AdminUserListResponseSchema, "Users"],
    errors: [[403, "FORBIDDEN"]],
  });
  route({
    method: "get",
    path: `${U}/{id}`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "users:read",
    summary: "User detail",
    params: idParam(),
    ok: [200, UserSchema, "User"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
  route({
    method: "put",
    path: `${U}/{id}/roles`,
    tag,
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "users:manage-roles",
    summary: "Replace a user's roles ('player' always kept; sessions of the user are revoked)",
    params: idParam(),
    body: UpdateRolesRequestSchema,
    ok: [200, UserSchema, "Updated"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT (self-demotion, guest, unverified email)"],
    ],
  });
  route({
    method: "post",
    path: `${U}/{id}/suspend`,
    tag,
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "users:manage",
    summary: "Suspend an account (revokes all its sessions)",
    params: idParam(),
    body: ReasonRequestSchema,
    ok: [200, UserSchema, "Suspended"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT (self / already suspended)"],
    ],
  });
  route({
    method: "post",
    path: `${U}/{id}/unsuspend`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "users:manage",
    summary: "Lift a suspension",
    params: idParam(),
    body: ReasonRequestSchema,
    ok: [200, UserSchema, "Active"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT (not suspended)"],
    ],
  });
  route({
    method: "post",
    path: `${U}/{id}/sessions/revoke`,
    tag,
    auth: "bearer",
    mfa: true,
    permission: "users:manage",
    summary: "Sign a user out of every device",
    params: idParam(),
    body: ReasonRequestSchema,
    ok: [200, null, "Revoked"],
    errors: [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
    ],
  });
}
