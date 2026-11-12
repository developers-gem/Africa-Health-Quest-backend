import type { AuthResponse, GuestUpgradeResponse, RegisterRequest } from "@ahq/api-contracts";
import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import {
  getDummyHash,
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from "../../lib/crypto.js";
import type { Logger } from "../../lib/logger.js";
import type { Mailer } from "../../services/mailer.js";
import type { GoogleVerifier } from "../../services/google.js";
import { UserModel, isStaff, type UserDocument } from "../users/user.model.js";
import { toUserDto } from "../users/user.mapper.js";
import { EmailTokenModel, type EmailTokenPurpose } from "./email-token.model.js";
import type { SessionDocument } from "./session.model.js";
import type { ClientMeta, SessionService } from "./session.service.js";
import type { TokenService } from "./token.service.js";

const TOKEN_TTL_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * 3_600_000,
  reset_password: 3_600_000,
};

export const REGISTER_MESSAGE =
  "If this email can be registered, we've sent a confirmation link. Check your inbox to finish signing up.";
export const GENERIC_EMAIL_MESSAGE =
  "If an account exists for this email, we've sent you a message.";

export type IssuedSession = {
  auth: AuthResponse;
  refreshToken: string;
  sessionId: string;
  userId: string;
};

export function suspendedError() {
  return new AppError(
    403,
    "ACCOUNT_SUSPENDED",
    "This account has been suspended. Contact support for help.",
  );
}

export class AuthService {
  constructor(
    private readonly config: Config,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly mailer: Mailer,
    private readonly google: GoogleVerifier | null,
    private readonly logger: Logger,
  ) {}

  // ---- Email/password -------------------------------------------------------------------

  /** Never reveals whether the email is taken: the owner of an existing account gets a notice instead. */
  async register(input: RegisterRequest): Promise<void> {
    const existing = await UserModel.findOne({ email: input.email });
    if (existing) {
      await this.safeSend({
        to: input.email,
        subject: "Someone tried to create an Africa Health Quest account with your email",
        text: `An account already exists for this email address. If this was you, sign in instead or reset your password at ${this.config.WEB_APP_URL}/forgot-password.\n\nIf it wasn't you, you can ignore this message.`,
      });
      return;
    }
    let user: UserDocument;
    const autoVerify = this.config.MAIL_TRANSPORT !== "smtp";
    try {
      user = await UserModel.create({
        email: input.email,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName,
        ...(autoVerify ? { emailVerifiedAt: new Date() } : {}),
      });
    } catch (e) {
      if (isDuplicateKey(e)) return;
      throw e;
    }
    if (!autoVerify) {
      await this.sendVerification(user);
    }
  }

  async resendVerification(email: string) {
    const user = await UserModel.findOne({ email, isGuest: false });
    if (user && !user.emailVerifiedAt) await this.sendVerification(user);
  }

  async verifyEmail(token: string) {
    const record = await this.consumeEmailToken(token, "verify_email");
    const user = await UserModel.findById(record.userId);
    if (!user) throw AppError.tokenInvalid();
    if (!user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      await user.save();
    }
  }

  async login(email: string, password: string, meta: ClientMeta): Promise<IssuedSession> {
    const user = await UserModel.findOne({ email }).select("+passwordHash +mfa");
    const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !user.passwordHash || !ok) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    }
    if (!user.emailVerifiedAt) {
      if (this.config.MAIL_TRANSPORT !== "smtp") {
        user.emailVerifiedAt = new Date();
        await user.save();
      } else {
        throw new AppError(
          403,
          "EMAIL_NOT_VERIFIED",
          "Please confirm your email address before signing in.",
        );
      }
    }
    if (user.disabledAt) throw suspendedError();
    return this.startSession(user, meta);
  }

  /** Re-authentication for sensitive actions (step-up). */
  async reauthenticate(
    user: UserDocument,
    session: SessionDocument,
    input: { password?: string; idToken?: string },
  ) {
    if (input.password) {
      const withHash = await UserModel.findById(user._id).select("+passwordHash");
      if (
        !withHash?.passwordHash ||
        !(await verifyPassword(input.password, withHash.passwordHash))
      ) {
        throw new AppError(401, "INVALID_CREDENTIALS", "Password is incorrect.");
      }
    } else if (input.idToken) {
      if (!this.google) throw AppError.unavailable("Google sign-in is not configured.");
      const identity = await this.google.verify(input.idToken);
      if (!identity || identity.sub !== user.googleSub)
        throw AppError.unauthenticated("Google re-authentication failed.");
    } else {
      throw AppError.badRequest("Provide your password or a Google ID token.");
    }
    await this.sessions.markAuthenticated(session.id as string);
    return { authenticatedAt: new Date().toISOString() };
  }

  async forgotPassword(email: string) {
    const user = await UserModel.findOne({ email, isGuest: false });
    if (!user || user.disabledAt) return;
    const token = await this.createEmailToken(user.id as string, "reset_password");
    await this.safeSend({
      to: email,
      subject: "Reset your Africa Health Quest password",
      text: `Use this link within 1 hour to choose a new password:\n${this.config.WEB_APP_URL}/reset-password?token=${token}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const record = await this.consumeEmailToken(token, "reset_password");
    const user = await UserModel.findById(record.userId);
    if (!user) throw AppError.tokenInvalid();
    user.passwordHash = await hashPassword(password);
    user.emailVerifiedAt ??= new Date();
    await user.save();
    await this.sessions.revokeAllForUser(user.id as string, "password_reset");
    await this.safeSend({
      to: user.email!,
      subject: "Your Africa Health Quest password was changed",
      text: "Your password was just changed and all devices were signed out. If this wasn't you, reset your password immediately and contact support.",
    });
  }

  // ---- Google ---------------------------------------------------------------------------

  async loginWithGoogle(idToken: string, meta: ClientMeta): Promise<IssuedSession> {
    if (!this.google) throw AppError.unavailable("Google sign-in is not configured.");
    const identity = await this.google.verify(idToken);
    if (!identity) throw AppError.unauthenticated("Google sign-in failed. Please try again.");

    let user = await UserModel.findOne({ googleSub: identity.sub }).select("+mfa");
    if (!user && identity.email && identity.emailVerified) {
      user = await UserModel.findOne({ email: identity.email }).select("+passwordHash +mfa");
      if (user) {
        user.googleSub = identity.sub;
        if (!user.emailVerifiedAt) {
          // An unverified password may have been set by someone else (pre-hijack): drop it.
          user.passwordHash = undefined;
          user.emailVerifiedAt = new Date();
        }
        await user.save();
      }
    }
    if (!user) {
      if (!identity.email || !identity.emailVerified) {
        throw AppError.unauthenticated("Your Google account has no verified email address.");
      }
      user = await UserModel.create({
        email: identity.email,
        googleSub: identity.sub,
        emailVerifiedAt: new Date(),
        displayName: (identity.name ?? identity.email.split("@")[0] ?? "Healer").slice(0, 60),
      });
    }
    if (user.disabledAt) throw suspendedError();
    return this.startSession(user, meta);
  }

  // ---- Guests ---------------------------------------------------------------------------

  async createGuest(meta: ClientMeta): Promise<IssuedSession> {
    const user = await UserModel.create({
      displayName: "Guest healer",
      isGuest: true,
      guestLastActiveAt: new Date(),
    });
    return this.startSession(user, meta);
  }

  async upgradeGuest(user: UserDocument, input: RegisterRequest): Promise<GuestUpgradeResponse> {
    if (!user.isGuest) throw AppError.forbidden("Only guest sessions can be upgraded.");
    if (await UserModel.exists({ email: input.email })) {
      throw AppError.conflict("An account with this email already exists. Sign in instead.");
    }
    user.email = input.email;
    user.passwordHash = await hashPassword(input.password);
    user.displayName = input.displayName;
    user.isGuest = false;
    user.guestLastActiveAt = undefined;
    user.convertedFromGuestAt = new Date();
    const autoVerify = this.config.MAIL_TRANSPORT !== "smtp";
    if (autoVerify) {
      user.emailVerifiedAt = new Date();
    }
    try {
      await user.save();
    } catch (e) {
      if (isDuplicateKey(e))
        throw AppError.conflict("An account with this email already exists. Sign in instead.");
      throw e;
    }
    if (!autoVerify) {
      await this.sendVerification(user);
    }
    return {
      user: toUserDto(user),
      message: "Account created. Confirm your email so you can sign in on other devices.",
    };
  }

  // ---- Sessions -------------------------------------------------------------------------

  async refresh(refreshToken: string): Promise<IssuedSession> {
    const holder: { user: UserDocument | null } = { user: null };
    const { session, refreshToken: next } = await this.sessions.rotate(
      refreshToken,
      async (userId) => {
        holder.user = await UserModel.findById(userId).select("+mfa");
        if (!holder.user) return null;
        if (holder.user.disabledAt) throw suspendedError();
        return holder.user.roles;
      },
    );
    const user = holder.user!;
    if (user.isGuest) {
      user.guestLastActiveAt = new Date(); // activity keeps a guest alive
      await user.save();
    }
    return this.issue(user, session, next);
  }

  async logout(refreshToken: string | undefined) {
    if (refreshToken) await this.sessions.revokeByToken(refreshToken, "logout");
  }

  async startSession(user: UserDocument, meta: ClientMeta): Promise<IssuedSession> {
    user.lastLoginAt = new Date();
    if (user.isGuest) user.guestLastActiveAt = new Date();
    await user.save();
    const { session, refreshToken } = await this.sessions.create(
      { id: user.id as string, roles: user.roles },
      meta,
    );
    return this.issue(user, session, refreshToken);
  }

  async issue(
    user: UserDocument,
    session: SessionDocument,
    refreshToken: string,
  ): Promise<IssuedSession> {
    const mfaRequired =
      this.config.MFA_REQUIRED_FOR_STAFF && isStaff(user.roles) && !session.mfaVerifiedAt;
    return {
      auth: {
        accessToken: this.tokens.signAccessToken(user.id as string, session.id as string),
        accessTokenExpiresIn: this.config.JWT_ACCESS_TTL_SECONDS,
        user: toUserDto(user),
        ...(mfaRequired ? { mfaRequired: true } : {}),
      },
      refreshToken,
      sessionId: session.id as string,
      userId: user.id as string,
    };
  }

  // ---- Email tokens ---------------------------------------------------------------------

  private async sendVerification(user: UserDocument) {
    if (!user.email) return;
    const token = await this.createEmailToken(user.id as string, "verify_email");
    await this.safeSend({
      to: user.email,
      subject: "Confirm your Africa Health Quest account",
      text: `Welcome, ${user.displayName}!\n\nConfirm your email within 24 hours:\n${this.config.WEB_APP_URL}/verify-email?token=${token}`,
    });
  }

  private async createEmailToken(userId: string, purpose: EmailTokenPurpose) {
    await EmailTokenModel.updateMany(
      { userId, purpose, usedAt: null },
      { $set: { usedAt: new Date() } },
    );
    const token = randomToken();
    await EmailTokenModel.create({
      userId,
      purpose,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]),
    });
    return token;
  }

  private async consumeEmailToken(token: string, purpose: EmailTokenPurpose) {
    const now = new Date();
    const record = await EmailTokenModel.findOneAndUpdate(
      { tokenHash: sha256(token), purpose, usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
    if (!record) throw AppError.tokenInvalid();
    return record;
  }

  private async safeSend(message: Parameters<Mailer["send"]>[0]) {
    try {
      await this.mailer.send(message);
    } catch (err) {
      this.logger.error({ err, subject: message.subject }, "failed to send email");
    }
  }
}

function isDuplicateKey(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: number }).code === 11000;
}
