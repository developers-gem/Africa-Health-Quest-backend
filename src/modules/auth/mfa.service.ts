import type { Config } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { decryptField, encryptField, randomToken, sha256 } from "../../lib/crypto.js";
import { generateTotpSecret, otpauthUri, verifyTotp } from "../../lib/totp.js";
import { UserModel, isStaff } from "../users/user.model.js";

const PENDING_TTL_MS = 15 * 60_000;
const RECOVERY_CODES = 10;

/** TOTP multi-factor authentication. Mandatory for reviewers and admins when MFA_REQUIRED_FOR_STAFF. */
export class MfaService {
  constructor(private readonly config: Config) {}

  private load(userId: string) {
    return UserModel.findById(userId).select("+mfa");
  }

  async beginSetup(userId: string) {
    const user = await this.load(userId);
    if (!user || user.isGuest || !user.email)
      throw AppError.forbidden("Only registered accounts can enable MFA.");
    if (user.mfa?.enabledAt)
      throw AppError.conflict("Two-factor authentication is already enabled.");
    const secret = generateTotpSecret();
    user.set("mfa", {
      ...(user.mfa ?? {}),
      pendingSecretEnc: encryptField(secret, this.config.DATA_ENCRYPTION_KEY),
      pendingCreatedAt: new Date(),
    });
    await user.save();
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /** Confirms setup with a first code; returns one-time recovery codes. */
  async confirmSetup(userId: string, code: string) {
    const user = await this.load(userId);
    const pending = user?.mfa?.pendingSecretEnc;
    if (!user || !pending || !user.mfa?.pendingCreatedAt)
      throw AppError.conflict("Start two-factor setup first.");
    if (Date.now() - user.mfa.pendingCreatedAt.getTime() > PENDING_TTL_MS) {
      throw AppError.conflict("Two-factor setup expired. Start again.");
    }
    const secret = decryptField(pending, this.config.DATA_ENCRYPTION_KEY);
    const step = verifyTotp(secret, code);
    if (step === null)
      throw new AppError(
        401,
        "TOKEN_INVALID",
        "That code is not valid. Check your authenticator app.",
      );
    const recoveryCodes = Array.from({ length: RECOVERY_CODES }, () => randomToken(6));
    user.set("mfa", {
      secretEnc: pending,
      enabledAt: new Date(),
      lastUsedStep: step,
      recoveryCodeHashes: recoveryCodes.map(sha256),
    });
    await user.save();
    return { recoveryCodes };
  }

  /** Verifies a TOTP or recovery code (recovery codes are single-use). */
  async verify(
    userId: string,
    input: { code?: string | undefined; recoveryCode?: string | undefined },
  ) {
    const user = await this.load(userId);
    const mfa = user?.mfa;
    if (!user || !mfa?.enabledAt || !mfa.secretEnc)
      throw AppError.conflict("Two-factor authentication is not set up.");
    if (input.code) {
      const secret = decryptField(mfa.secretEnc, this.config.DATA_ENCRYPTION_KEY);
      const step = verifyTotp(secret, input.code, { lastUsedStep: mfa.lastUsedStep ?? null });
      if (step === null)
        throw new AppError(401, "TOKEN_INVALID", "That code is not valid or was already used.");
      const res = await UserModel.updateOne(
        {
          _id: user._id,
          $or: [{ "mfa.lastUsedStep": { $lt: step } }, { "mfa.lastUsedStep": null }],
        },
        { $set: { "mfa.lastUsedStep": step } },
      );
      if (res.modifiedCount === 0)
        throw new AppError(401, "TOKEN_INVALID", "That code was already used.");
      return { method: "totp" as const };
    }
    if (input.recoveryCode) {
      const hash = sha256(input.recoveryCode.trim());
      const res = await UserModel.updateOne(
        { _id: user._id, "mfa.recoveryCodeHashes": hash },
        { $pull: { "mfa.recoveryCodeHashes": hash } },
      );
      if (res.modifiedCount === 0)
        throw new AppError(401, "TOKEN_INVALID", "That recovery code is not valid.");
      return { method: "recovery_code" as const };
    }
    throw AppError.badRequest("Provide a code or a recovery code.");
  }

  async disable(userId: string, code: string) {
    const user = await this.load(userId);
    if (!user) throw AppError.notFound();
    if (isStaff(user.roles) && this.config.MFA_REQUIRED_FOR_STAFF) {
      throw AppError.conflict(
        "Reviewers and administrators must keep two-factor authentication enabled.",
      );
    }
    await this.verify(userId, { code });
    await UserModel.updateOne({ _id: user._id }, { $unset: { mfa: 1 } });
  }

  async isEnabled(userId: string) {
    return Boolean((await this.load(userId))?.mfa?.enabledAt);
  }
}
