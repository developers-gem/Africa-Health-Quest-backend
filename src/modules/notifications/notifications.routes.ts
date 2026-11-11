import {
  AnnouncementSchema,
  NotificationQuerySchema,
  ObjectIdSchema,
  RegisterDeviceSchema,
  UnregisterDeviceSchema,
  z,
} from "@ahq/api-contracts";
import type { Permission } from "@ahq/shared-types";
import { Router, type RequestHandler } from "express";
import { parseBody, parseParams, parseQuery, requireAuth } from "../../lib/http.js";
import { recordAudit } from "../audit/audit-log.model.js";
import type { NotificationsService } from "./notifications.service.js";

export function notificationsRouter(deps: {
  authn: RequestHandler;
  notifications: NotificationsService;
}) {
  const { authn, notifications } = deps;
  const r = Router();
  r.use(authn);
  const uid = (req: Parameters<RequestHandler>[0]) => requireAuth(req).user.id as string;

  r.get("/", async (req, res) => {
    res.json(await notifications.list(uid(req), parseQuery(req, NotificationQuerySchema)));
  });
  r.post("/read-all", async (req, res) => {
    await notifications.markAllRead(uid(req));
    res.status(204).end();
  });
  r.post("/:id/read", async (req, res) => {
    const { id } = parseParams(req, z.object({ id: ObjectIdSchema }));
    await notifications.markRead(uid(req), id);
    res.status(204).end();
  });
  r.post("/devices", async (req, res) => {
    await notifications.registerDevice(uid(req), parseBody(req, RegisterDeviceSchema));
    res.status(204).end();
  });
  r.post("/devices/unregister", async (req, res) => {
    await notifications.unregisterDevice(uid(req), parseBody(req, UnregisterDeviceSchema).token);
    res.status(204).end();
  });
  return r;
}

/** Mounted under /admin. */
export function adminAnnouncementsRouter(deps: {
  can: (...p: Permission[]) => RequestHandler;
  recentAuth: RequestHandler;
  notifications: NotificationsService;
}) {
  const r = Router();
  r.post(
    "/announcements",
    deps.can("notifications:broadcast"),
    deps.recentAuth,
    async (req, res) => {
      const input = parseBody(req, AnnouncementSchema);
      const { user } = requireAuth(req);
      const result = await deps.notifications.announce(input);
      await recordAudit({
        actorId: user.id as string,
        actorRoles: [...user.roles],
        action: "notifications.announced",
        targetType: "Announcement",
        targetId: input.title.slice(0, 80),
        after: { ...input, ...result },
        requestId: req.requestId,
      });
      res.status(202).json(result);
    },
  );
  return r;
}
