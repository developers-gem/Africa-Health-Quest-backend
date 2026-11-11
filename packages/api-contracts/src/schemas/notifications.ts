import { ROLES } from "@ahq/shared-types";
import { z } from "../zod.js";
import { PaginationQuerySchema, paginated } from "./common.js";

export const NOTIFICATION_TYPES = [
  "achievement",
  "level_up",
  "country_unlocked",
  "debrief_ready",
  "announcement",
] as const;

export const NotificationSchema = z
  .object({
    id: z.string(),
    type: z.enum(NOTIFICATION_TYPES),
    title: z.string(),
    body: z.string(),
    route: z.string().nullable().describe("In-app path to open, e.g. /play/achievements"),
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Notification");
export type AppNotification = z.infer<typeof NotificationSchema>;

export const NotificationQuerySchema = PaginationQuerySchema.extend({
  unread: z.enum(["true", "false"]).optional(),
});
export const NotificationPageSchema = paginated(NotificationSchema)
  .extend({ unreadCount: z.number().int() })
  .openapi("NotificationPage");

export const DEVICE_PLATFORMS = ["android", "ios"] as const;
export const RegisterDeviceSchema = z
  .object({
    token: z
      .string()
      .min(20)
      .max(4096)
      .describe("Firebase Installation ID (FID) from the FCM SDK's onRegistered stream"),
    platform: z.enum(DEVICE_PLATFORMS),
    appVersion: z.string().max(20).optional(),
  })
  .openapi("RegisterDevice");
export const UnregisterDeviceSchema = z
  .object({ token: z.string().min(20).max(4096) })
  .openapi("UnregisterDevice");

/** Path inside the app, never an external URL. */
const RouteSchema = z
  .string()
  .regex(/^\/[A-Za-z0-9/_-]{0,120}$/, "an in-app path such as /play/story");

export const AnnouncementSchema = z
  .object({
    title: z.string().trim().min(3).max(80),
    body: z.string().trim().min(3).max(400),
    route: RouteSchema.optional(),
    audience: z
      .object({
        roles: z.array(z.enum(ROLES)).max(3).optional(),
        countries: z
          .array(z.string().regex(/^[A-Z]{2}$/))
          .max(54)
          .optional()
          .describe("Players whose home country is one of these"),
      })
      .default({}),
    push: z.boolean().default(true),
  })
  .openapi("Announcement");
export const AnnouncementResultSchema = z
  .object({ recipients: z.number().int(), pushQueued: z.number().int() })
  .openapi("AnnouncementResult");
