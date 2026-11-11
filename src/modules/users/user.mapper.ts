import type { Role, User } from "@ahq/api-contracts";
import type { UserDocument } from "./user.model.js";

/** Whitelisting mapper — never spreads the entity, so hashes and secrets cannot leak. */
export function toUserDto(u: UserDocument): User {
  return {
    id: u.id as string,
    email: u.email ?? null,
    displayName: u.displayName,
    roles: [...u.roles] as Role[],
    emailVerified: Boolean(u.emailVerifiedAt),
    isGuest: u.isGuest,
    mfaEnabled: Boolean(u.mfa?.enabledAt),
    suspended: Boolean(u.disabledAt),
    createdAt: (u.get("createdAt") as Date).toISOString(),
  };
}
