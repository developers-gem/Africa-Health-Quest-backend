import { SYSTEM_ROLES, type Permission, type Role, type SessionPolicy } from "@ahq/shared-types";
import mongoose, { Schema } from "mongoose";

/** Persisted copy of the system roles (for admin listing and audit). Authorization uses the code definition. */
const roleSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    description: { type: String, required: true },
    permissions: { type: [String], required: true },
    system: { type: Boolean, default: true },
    sessionPolicy: { idleHours: Number, absoluteDays: Number, mfaRequired: Boolean },
  },
  { timestamps: true },
);
export const RoleModel = mongoose.model("Role", roleSchema);

export async function syncSystemRoles() {
  await Promise.all(
    (Object.keys(SYSTEM_ROLES) as Role[]).map((key) =>
      RoleModel.updateOne(
        { key },
        { $set: { key, ...SYSTEM_ROLES[key], system: true } },
        { upsert: true },
      ),
    ),
  );
}

export function permissionsFor(roles: readonly string[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const r of roles) for (const p of SYSTEM_ROLES[r as Role]?.permissions ?? []) out.add(p);
  return out;
}

/** The strictest policy of all roles held wins. */
export function sessionPolicyFor(roles: readonly string[]): SessionPolicy {
  const policies = roles
    .map((r) => SYSTEM_ROLES[r as Role]?.sessionPolicy)
    .filter(Boolean) as SessionPolicy[];
  return policies.reduce(
    (acc, p) => ({
      idleHours: Math.min(acc.idleHours, p.idleHours),
      absoluteDays: Math.min(acc.absoluteDays, p.absoluteDays),
      mfaRequired: acc.mfaRequired || p.mfaRequired,
    }),
    SYSTEM_ROLES.player.sessionPolicy,
  );
}
