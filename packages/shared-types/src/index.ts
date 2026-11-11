/**
 * Shared constants and types. No runtime dependencies, safe to import from any app
 * (web, backend, tooling). Never put clinical answer data here.
 */

export const API_PREFIX = "/api/v1";
/** Semantic version of the API implementation (reported by /health and the OpenAPI document). */
export const API_VERSION = "0.2.0";

export const ROLES = ["player", "reviewer", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Permission catalogue (docs/architecture/SECURITY_ARCHITECTURE.md §4). */
export const PERMISSIONS = [
  "game:play",
  "account:manage-own",
  "review:read",
  "review:decide",
  "references:edit",
  "content:read",
  "content:edit",
  "content:publish-control",
  "catalog:edit",
  "users:read",
  "users:manage",
  "users:manage-roles",
  "clinicians:verify",
  "settings:read",
  "settings:edit",
  "analytics:read",
  "audit:read",
  "media:upload",
  "notifications:broadcast",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export type SessionPolicy = { idleHours: number; absoluteDays: number; mfaRequired: boolean };

/** System roles. Admins author content but cannot decide reviews (separation of duties). */
export const SYSTEM_ROLES: Record<
  Role,
  { name: string; description: string; permissions: Permission[]; sessionPolicy: SessionPolicy }
> = {
  player: {
    name: "Player",
    description: "Plays missions and Hospital Commander; manages own account.",
    permissions: ["game:play", "account:manage-own"],
    sessionPolicy: { idleHours: 24 * 30, absoluteDays: 180, mfaRequired: false },
  },
  reviewer: {
    name: "Clinician reviewer",
    description: "Reviews and approves clinical content; curates references.",
    permissions: [
      "review:read",
      "review:decide",
      "references:edit",
      "content:read",
      "media:upload",
    ],
    sessionPolicy: { idleHours: 12, absoluteDays: 7, mfaRequired: true },
  },
  admin: {
    name: "Administrator",
    description: "Manages users, content, countries, settings and operations.",
    permissions: [
      "review:read",
      "references:edit",
      "content:read",
      "content:edit",
      "content:publish-control",
      "catalog:edit",
      "users:read",
      "users:manage",
      "users:manage-roles",
      "clinicians:verify",
      "settings:read",
      "settings:edit",
      "analytics:read",
      "audit:read",
      "media:upload",
      "notifications:broadcast",
    ],
    sessionPolicy: { idleHours: 12, absoluteDays: 7, mfaRequired: true },
  },
};

/** Values of the `X-Client-Platform` header. Web gets a cookie refresh token; mobile gets it in the body. */
export const CLIENT_PLATFORMS = ["web", "mobile"] as const;
export type ClientPlatform = (typeof CLIENT_PLATFORMS)[number];
export const CLIENT_PLATFORM_HEADER = "x-client-platform";
export const REFRESH_COOKIE_NAME = "ahq_rt";

/** Error codes of the API error envelope (docs/api/API_SPECIFICATION.md §3). Additive only. */
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "UNAUTHENTICATED",
  "INVALID_CREDENTIALS",
  "EMAIL_NOT_VERIFIED",
  "TOKEN_INVALID",
  "STEP_UP_REQUIRED",
  "MFA_REQUIRED",
  "FORBIDDEN",
  "ACCOUNT_SUSPENDED",
  "MISSION_LOCKED",
  "NOT_FOUND",
  "CONFLICT",
  "ATTEMPT_NOT_ACTIVE",
  "STEP_ALREADY_ANSWERED",
  "INVALID_STATE_TRANSITION",
  "INSUFFICIENT_FUNDS",
  "PRECONDITION_FAILED",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "AI_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const LEARNER_LEVELS = [
  "nursing_student",
  "medical_student",
  "midwifery_student",
  "pharmacy_student",
  "intern_junior_doctor",
  "community_health_worker",
  "allied_health_student",
  "healthcare_professional",
  "other",
] as const;
export type LearnerLevel = (typeof LEARNER_LEVELS)[number];

/** Labels shown in the prototype's debrief level picker (preserved verbatim). */
export const LEARNER_LEVEL_LABELS: Record<LearnerLevel, string> = {
  nursing_student: "Nursing student",
  medical_student: "Medical student",
  midwifery_student: "Midwifery student",
  pharmacy_student: "Pharmacy student",
  intern_junior_doctor: "Intern / junior doctor",
  community_health_worker: "Community health worker",
  allied_health_student: "Allied health student",
  healthcare_professional: "Healthcare professional",
  other: "Other",
};

export const HOSPITAL_RESOURCES = ["staff", "beds", "ambulances", "supplies"] as const;
export type HospitalResource = (typeof HOSPITAL_RESOURCES)[number];

/** ISO 3166-1 alpha-2, upper case. */
export type CountryCode = string;
/** Stable mission slug, e.g. "malaria". */
export type MissionKey = string;

// ---- Authoring-side content shapes (contain answer keys: backend/tooling only) ----------

export interface ChoiceContent {
  choiceId: string;
  text: string;
  correct: boolean;
  feedback: string;
  critical?: boolean;
}

export interface StepContent {
  stepId: string;
  prompt: string;
  choices: ChoiceContent[];
}

export interface MissionContent {
  key: MissionKey;
  countryCode: CountryCode;
  tier: number;
  icon: string;
  sortOrder: number;
  title: string;
  story: string;
  steps: StepContent[];
}

export interface CountryContent {
  code: CountryCode;
  name: string;
  flagEmoji: string;
  focus: string;
  unlockHp: number;
  sortOrder: number;
}

export interface TierContent {
  index: number;
  key: string;
  name: string;
  icon: string;
  hpRequired: number;
}

export interface HospitalEventContent {
  key: string;
  text: string;
  needs: Record<HospitalResource, number>;
}
