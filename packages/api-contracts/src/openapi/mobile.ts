import { API_PREFIX } from "@ahq/shared-types";
import { z } from "../zod.js";
import { MissionKeySchema, MissionPackSchema } from "../schemas/missions.js";
import {
  AnnouncementResultSchema,
  AnnouncementSchema,
  NotificationPageSchema,
  NotificationQuerySchema,
  RegisterDeviceSchema,
  UnregisterDeviceSchema,
} from "../schemas/notifications.js";
import { idParam, type Api } from "./helpers.js";

export function registerMobileRoutes({ route }: Api) {
  route({
    method: "get",
    path: `${API_PREFIX}/missions/{key}/pack`,
    tag: "Missions",
    auth: "bearer",
    summary:
      "Download an offline mission pack (offline-eligible published missions; no answer keys)",
    description:
      "Contains the story and every step's prompt and choices, but never correct answers, feedback or critical flags. Play it offline, queue `attempt.start` (with `versionNumber`) and `attempt.answer` events, and the server scores them when the device syncs (`POST /sync/events`). An outdated pack is rejected with `CONFLICT` (`mission_changed`).",
    params: z.object({ key: MissionKeySchema }),
    ok: [200, MissionPackSchema, "Pack"],
    errors: [[404, "NOT_FOUND (not published or not offline-eligible)"]],
  });
  const N = `${API_PREFIX}/notifications`;
  const tag = "Notifications";
  route({
    method: "get",
    path: N,
    tag,
    auth: "bearer",
    summary: "Your notifications (newest first) and unread count",
    query: NotificationQuerySchema,
    ok: [200, NotificationPageSchema, "Inbox"],
  });
  route({
    method: "post",
    path: `${N}/{id}/read`,
    tag,
    auth: "bearer",
    summary: "Mark one notification read",
    params: idParam(),
    ok: [204, null, "Read"],
  });
  route({
    method: "post",
    path: `${N}/read-all`,
    tag,
    auth: "bearer",
    summary: "Mark all notifications read",
    ok: [204, null, "Read"],
  });
  route({
    method: "post",
    path: `${N}/devices`,
    tag,
    auth: "bearer",
    summary: "Register this device's Firebase Cloud Messaging token for push notifications",
    description:
      "Push is sent only when the server has Firebase credentials and the player's push preference is on; the in-app inbox works regardless.",
    body: RegisterDeviceSchema,
    ok: [204, null, "Registered"],
  });
  route({
    method: "post",
    path: `${N}/devices/unregister`,
    tag,
    auth: "bearer",
    summary: "Stop push notifications to this device (e.g. on sign-out)",
    body: UnregisterDeviceSchema,
    ok: [204, null, "Removed"],
  });
  route({
    method: "post",
    path: `${API_PREFIX}/admin/announcements`,
    tag: "Admin: users",
    auth: "bearer",
    mfa: true,
    stepUp: true,
    permission: "notifications:broadcast",
    summary: "Send an announcement to players (in-app, and push when configured)",
    body: AnnouncementSchema,
    ok: [202, AnnouncementResultSchema, "Queued"],
  });
}
