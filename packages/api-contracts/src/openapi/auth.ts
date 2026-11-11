import { API_PREFIX } from "@ahq/shared-types";
import { MessageResponseSchema } from "../schemas/common.js";
import {
  AuthResponseSchema,
  EmailRequestSchema,
  GoogleLoginRequestSchema,
  GuestUpgradeResponseSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  MfaChallengeRequestSchema,
  MfaCodeRequestSchema,
  MfaRecoveryCodesSchema,
  MfaSetupResponseSchema,
  ReauthenticateRequestSchema,
  ReauthenticateResponseSchema,
  RefreshRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  SessionListResponseSchema,
  TokenRequestSchema,
  UpdateProfileRequestSchema,
  UserSchema,
} from "../schemas/auth.js";
import { idParam, type Api } from "./helpers.js";

export function registerAuthRoutes({ route }: Api) {
  const A = `${API_PREFIX}/auth`;
  const tag = "Auth";
  route({
    method: "post",
    path: `${A}/register`,
    tag,
    auth: "public",
    summary: "Register with email and password (non-enumerating: always 202)",
    body: RegisterRequestSchema,
    ok: [202, MessageResponseSchema, "Accepted"],
  });
  route({
    method: "post",
    path: `${A}/verify-email`,
    tag,
    auth: "public",
    summary: "Confirm an email address",
    body: TokenRequestSchema,
    ok: [200, MessageResponseSchema, "Verified"],
    errors: [[401, "TOKEN_INVALID"]],
  });
  route({
    method: "post",
    path: `${A}/resend-verification`,
    tag,
    auth: "public",
    summary: "Resend the verification email (always 200)",
    body: EmailRequestSchema,
    ok: [200, MessageResponseSchema, "Accepted"],
  });
  route({
    method: "post",
    path: `${A}/login`,
    tag,
    auth: "public",
    platformHeader: true,
    summary: "Sign in with email and password",
    body: LoginRequestSchema,
    ok: [200, AuthResponseSchema, "Signed in (web: refresh cookie; mobile: refreshToken in body)"],
    errors: [
      [401, "INVALID_CREDENTIALS"],
      [403, "EMAIL_NOT_VERIFIED / ACCOUNT_SUSPENDED"],
    ],
  });
  route({
    method: "post",
    path: `${A}/google`,
    tag,
    auth: "public",
    platformHeader: true,
    summary: "Sign in with a Google ID token",
    body: GoogleLoginRequestSchema,
    ok: [200, AuthResponseSchema, "Signed in"],
    errors: [
      [401, "Google token rejected"],
      [403, "ACCOUNT_SUSPENDED"],
      [503, "SERVICE_UNAVAILABLE"],
    ],
  });
  route({
    method: "post",
    path: `${A}/guest`,
    tag,
    auth: "public",
    platformHeader: true,
    summary: "Start a guest session",
    ok: [201, AuthResponseSchema, "Guest session"],
  });
  route({
    method: "post",
    path: `${A}/guest/upgrade`,
    tag,
    auth: "bearer",
    summary: "Turn the current guest into a registered account (same id, progress kept)",
    body: RegisterRequestSchema,
    ok: [200, GuestUpgradeResponseSchema, "Upgraded"],
    errors: [
      [403, "FORBIDDEN (not a guest)"],
      [409, "CONFLICT (email exists)"],
    ],
  });
  route({
    method: "post",
    path: `${A}/refresh`,
    tag,
    auth: "refresh",
    platformHeader: true,
    summary: "Rotate the refresh token; re-using an old token revokes the session",
    body: RefreshRequestSchema,
    ok: [200, AuthResponseSchema, "Refreshed"],
    errors: [
      [401, "UNAUTHENTICATED"],
      [403, "ACCOUNT_SUSPENDED"],
    ],
  });
  route({
    method: "post",
    path: `${A}/logout`,
    tag,
    auth: "refresh",
    platformHeader: true,
    summary: "Revoke the current session",
    body: LogoutRequestSchema,
    ok: [200, MessageResponseSchema, "Signed out"],
  });
  route({
    method: "post",
    path: `${A}/logout-all`,
    tag,
    auth: "bearer",
    summary: "Revoke every session of the current user (including this one)",
    ok: [200, MessageResponseSchema, "Signed out everywhere"],
  });
  route({
    method: "get",
    path: `${A}/sessions`,
    tag,
    auth: "bearer",
    summary: "List active sessions (devices)",
    ok: [200, SessionListResponseSchema, "Sessions"],
  });
  route({
    method: "delete",
    path: `${A}/sessions/{id}`,
    tag,
    auth: "bearer",
    summary: "Revoke one of your sessions",
    params: idParam(),
    ok: [204, null, "Revoked"],
    errors: [[404, "NOT_FOUND"]],
  });
  route({
    method: "post",
    path: `${A}/reauthenticate`,
    tag,
    auth: "bearer",
    summary: "Confirm identity for sensitive actions (step-up)",
    body: ReauthenticateRequestSchema,
    ok: [200, ReauthenticateResponseSchema, "Re-authenticated"],
    errors: [
      [401, "INVALID_CREDENTIALS"],
      [403, "FORBIDDEN (guest)"],
    ],
  });
  route({
    method: "post",
    path: `${A}/forgot-password`,
    tag,
    auth: "public",
    summary: "Email a password reset link (always 200)",
    body: EmailRequestSchema,
    ok: [200, MessageResponseSchema, "Accepted"],
  });
  route({
    method: "post",
    path: `${A}/reset-password`,
    tag,
    auth: "public",
    summary: "Set a new password; signs out every device",
    body: ResetPasswordRequestSchema,
    ok: [200, MessageResponseSchema, "Changed"],
    errors: [[401, "TOKEN_INVALID"]],
  });
  route({
    method: "post",
    path: `${A}/mfa/totp/setup`,
    tag,
    auth: "bearer",
    stepUp: true,
    summary: "Start authenticator-app (TOTP) setup",
    ok: [200, MfaSetupResponseSchema, "Secret and otpauth URI (shown once)"],
    errors: [
      [403, "FORBIDDEN (guest)"],
      [409, "CONFLICT (already enabled)"],
    ],
  });
  route({
    method: "post",
    path: `${A}/mfa/totp/verify`,
    tag,
    auth: "bearer",
    summary: "Confirm TOTP setup with a first code; returns recovery codes",
    body: MfaCodeRequestSchema,
    ok: [200, MfaRecoveryCodesSchema, "Enabled"],
    errors: [
      [401, "TOKEN_INVALID"],
      [409, "CONFLICT"],
    ],
  });
  route({
    method: "post",
    path: `${A}/mfa/challenge`,
    tag,
    auth: "bearer",
    summary: "Verify MFA for this session (TOTP or recovery code)",
    body: MfaChallengeRequestSchema,
    ok: [200, MessageResponseSchema, "Verified"],
    errors: [
      [401, "TOKEN_INVALID"],
      [409, "CONFLICT (not set up)"],
    ],
  });
  route({
    method: "delete",
    path: `${A}/mfa`,
    tag,
    auth: "bearer",
    stepUp: true,
    summary: "Disable MFA (not allowed for staff)",
    body: MfaCodeRequestSchema,
    ok: [204, null, "Disabled"],
    errors: [
      [401, "TOKEN_INVALID"],
      [409, "CONFLICT"],
    ],
  });

  route({
    method: "get",
    path: `${API_PREFIX}/users/me`,
    tag: "Users",
    auth: "bearer",
    summary: "Current user",
    ok: [200, UserSchema, "User"],
  });
  route({
    method: "patch",
    path: `${API_PREFIX}/users/me`,
    tag: "Users",
    auth: "bearer",
    summary: "Update display name",
    body: UpdateProfileRequestSchema,
    ok: [200, UserSchema, "Updated"],
  });
}
