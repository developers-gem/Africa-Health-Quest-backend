import type { Permission } from "@ahq/shared-types";
import type { SessionDocument } from "../modules/auth/session.model.js";
import type { UserDocument } from "../modules/users/user.model.js";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { user: UserDocument; session: SessionDocument; permissions: Set<Permission> };
    }
  }
}

export {};
