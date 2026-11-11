import { CLIENT_PLATFORMS } from "@ahq/shared-types";
import { z } from "../zod.js";
import { RoleSchema } from "./common.js";

export { CLIENT_PLATFORM_HEADER, REFRESH_COOKIE_NAME } from "@ahq/shared-types";
/** Header a client sends so the API knows how to deliver the refresh token. */
export const ClientPlatformSchema = z.enum(CLIENT_PLATFORMS);
export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;

export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email("Enter a valid email address"))
  .openapi({ example: "student@example.com" });

export const PasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password must contain letters and numbers");

export const DisplayNameSchema = z.string().trim().min(1).max(60);

export const RegisterRequestSchema = z
  .object({ email: EmailSchema, password: PasswordSchema, displayName: DisplayNameSchema })
  .openapi("RegisterRequest");
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const LoginRequestSchema = z
  .object({ email: EmailSchema, password: z.string().min(1).max(128) })
  .openapi("LoginRequest");
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const GoogleLoginRequestSchema = z
  .object({ idToken: z.string().min(10).max(4096) })
  .openapi("GoogleLoginRequest");
export type GoogleLoginRequest = z.infer<typeof GoogleLoginRequestSchema>;

export const RefreshRequestSchema = z
  .object({
    refreshToken: z
      .string()
      .min(20)
      .max(200)
      .optional()
      .describe("Mobile clients only. Web clients send the httpOnly cookie instead."),
  })
  .openapi("RefreshRequest");
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = RefreshRequestSchema.openapi("LogoutRequest");

export const TokenRequestSchema = z
  .object({ token: z.string().min(20).max(200) })
  .openapi("TokenRequest");
export type TokenRequest = z.infer<typeof TokenRequestSchema>;

export const EmailRequestSchema = z.object({ email: EmailSchema }).openapi("EmailRequest");
export type EmailRequest = z.infer<typeof EmailRequestSchema>;

export const ResetPasswordRequestSchema = z
  .object({ token: z.string().min(20).max(200), password: PasswordSchema })
  .openapi("ResetPasswordRequest");
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const UserSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    displayName: z.string(),
    roles: z.array(RoleSchema),
    emailVerified: z.boolean(),
    isGuest: z.boolean(),
    mfaEnabled: z.boolean(),
    suspended: z.boolean(),
    createdAt: z.string().describe("ISO 8601 timestamp"),
  })
  .openapi("User");
export type User = z.infer<typeof UserSchema>;

export const AuthResponseSchema = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresIn: z.number().int().describe("Seconds until the access token expires"),
    refreshToken: z
      .string()
      .optional()
      .describe("Returned only to mobile clients; web clients receive an httpOnly cookie"),
    user: UserSchema,
    mfaRequired: z
      .boolean()
      .optional()
      .describe(
        "Staff sessions: true until POST /auth/mfa/challenge succeeds; staff endpoints return MFA_REQUIRED",
      ),
  })
  .openapi("AuthResponse");
export type AuthResponse = z.infer<typeof AuthResponseSchema>;

/** Guest upgrade keeps the same account id, so all guest progress carries over. */
export const GuestUpgradeResponseSchema = z
  .object({ user: UserSchema, message: z.string() })
  .openapi("GuestUpgradeResponse");
export type GuestUpgradeResponse = z.infer<typeof GuestUpgradeResponseSchema>;

export const UpdateProfileRequestSchema = z
  .object({ displayName: DisplayNameSchema })
  .openapi("UpdateProfileRequest");
export type UpdateProfileRequest = z.infer<typeof UpdateProfileRequestSchema>;

// ---- Sessions, re-authentication, MFA -------------------------------------------------------

export const SessionSummarySchema = z
  .object({
    id: z.string(),
    platform: ClientPlatformSchema,
    userAgent: z.string().nullable(),
    appVersion: z.string().nullable(),
    createdAt: z.string(),
    lastUsedAt: z.string(),
    current: z.boolean(),
  })
  .openapi("SessionSummary");
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export const SessionListResponseSchema = z
  .object({ items: z.array(SessionSummarySchema) })
  .openapi("SessionList");
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const ReauthenticateRequestSchema = z
  .object({
    password: z.string().min(1).max(128).optional(),
    idToken: z.string().min(10).max(4096).optional(),
  })
  .refine(
    (v) => Boolean(v.password) !== Boolean(v.idToken),
    "Provide exactly one of password or idToken",
  )
  .openapi("ReauthenticateRequest");
export type ReauthenticateRequest = z.infer<typeof ReauthenticateRequestSchema>;
export const ReauthenticateResponseSchema = z
  .object({ authenticatedAt: z.string() })
  .openapi("ReauthenticateResponse");

export const TotpCodeSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");
export const MfaSetupResponseSchema = z
  .object({ secret: z.string(), otpauthUri: z.string() })
  .openapi("MfaSetupResponse");
export const MfaCodeRequestSchema = z.object({ code: TotpCodeSchema }).openapi("MfaCodeRequest");
export type MfaCodeRequest = z.infer<typeof MfaCodeRequestSchema>;
export const MfaRecoveryCodesSchema = z
  .object({ recoveryCodes: z.array(z.string()).describe("Shown once — store them safely") })
  .openapi("MfaRecoveryCodes");
export const MfaChallengeRequestSchema = z
  .object({ code: TotpCodeSchema.optional(), recoveryCode: z.string().min(6).max(40).optional() })
  .refine(
    (v) => Boolean(v.code) !== Boolean(v.recoveryCode),
    "Provide exactly one of code or recoveryCode",
  )
  .openapi("MfaChallengeRequest");
export type MfaChallengeRequest = z.infer<typeof MfaChallengeRequestSchema>;
