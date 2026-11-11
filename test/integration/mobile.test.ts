import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MissionModel } from "../../src/modules/missions/mission.models.js";
import {
  DeviceTokenModel,
  NotificationModel,
} from "../../src/modules/notifications/notification.models.js";
import { FakePushSender } from "../../src/modules/notifications/push.js";
import { PlayerProfileModel } from "../../src/modules/players/player.models.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const malaria = PROTOTYPE_MISSIONS.find((m) => m.key === "malaria")!;
const correctOf = (stepId: string) =>
  malaria.steps.find((s) => s.stepId === stepId)!.choices.find((c) => c.correct)!.choiceId;
const ev = (type: string, payload: object) => ({
  eventId: randomUUID(),
  occurredAt: new Date().toISOString(),
  type,
  payload,
});
const settle = () => new Promise((r) => setTimeout(r, 600));

async function setup(push = new FakePushSender()) {
  const ctx = makeApp({ pushSender: push });
  await seedReference(ctx);
  await publishAll(ctx);
  const player = await createVerifiedUser(ctx, "player@example.com");
  const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
  return {
    ctx,
    push,
    token: player.accessToken as string,
    userId: player.user.id as string,
    admin: admin.accessToken as string,
  };
}

describe("offline mission packs", () => {
  it("are only served for missions an admin made offline-eligible", async () => {
    const { ctx, token, admin } = await setup();
    const list = await ctx.http().get("/api/v1/missions").set(bearer(token)).expect(200);
    expect(list.body.items.every((m: { offlineAvailable: boolean }) => !m.offlineAvailable)).toBe(
      true,
    );
    await ctx.http().get("/api/v1/missions/malaria/pack").set(bearer(token)).expect(404);
    await ctx.http().get("/api/v1/missions/malaria/pack").expect(401);

    const placed = await ctx
      .http()
      .patch("/api/v1/admin/missions/malaria")
      .set(bearer(admin))
      .send({ offlineEligible: true })
      .expect(200);
    expect(placed.body.offlineEligible).toBe(true);
    const after = await ctx.http().get("/api/v1/missions/malaria").expect(200);
    expect(after.body.offlineAvailable).toBe(true);
  });

  it("contain every step but no answer keys", async () => {
    const { ctx, token } = await setup();
    await MissionModel.updateOne({ key: "malaria" }, { $set: { offlineEligible: true } });
    const pack = await ctx
      .http()
      .get("/api/v1/missions/malaria/pack")
      .set(bearer(token))
      .expect(200);
    expect(pack.body).toMatchObject({
      key: "malaria",
      versionNumber: 1,
      title: "Fever in the Rainy Season",
      maxScore: 50,
    });
    expect(pack.body.steps).toHaveLength(2);
    expect(pack.headers["cache-control"]).toContain("no-store");
    const text = JSON.stringify(pack.body);
    expect(text).not.toMatch(/"correct"|"feedback"|"critical"|correctChoiceId/);
    for (const c of malaria.steps.flatMap((s) => s.choices)) expect(text).not.toContain(c.feedback);
  });

  it("are scored when the device syncs, and outdated packs are detected as conflicts", async () => {
    const { ctx, token } = await setup();
    await MissionModel.updateOne({ key: "malaria" }, { $set: { offlineEligible: true } });
    const pack = (
      await ctx.http().get("/api/v1/missions/malaria/pack").set(bearer(token)).expect(200)
    ).body;
    const res = await ctx
      .http()
      .post("/api/v1/sync/events")
      .set(bearer(token))
      .send({
        events: [
          ev("attempt.start", {
            missionKey: "malaria",
            mode: "story",
            clientRef: "off1",
            versionNumber: pack.versionNumber,
          }),
          ev("attempt.answer", {
            attempt: "client:off1",
            stepId: "s1",
            choiceId: correctOf("s1"),
            reasoning: "offline",
          }),
          ev("attempt.answer", { attempt: "client:off1", stepId: "s2", choiceId: correctOf("s2") }),
        ],
      })
      .expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    expect(res.body.results[1].data.step.answer).toMatchObject({
      correct: true,
      reasoning: "offline",
    });
    expect(res.body.progress).toMatchObject({ hp: 50, funding: 125 });

    const stale = await ctx
      .http()
      .post("/api/v1/sync/events")
      .set(bearer(token))
      .send({
        events: [
          ev("attempt.start", {
            missionKey: "malaria",
            mode: "practice",
            clientRef: "off2",
            versionNumber: 99,
          }),
        ],
      })
      .expect(200);
    expect(stale.body.results[0]).toMatchObject({ status: "rejected", code: "CONFLICT" });
    expect(stale.body.results[0].message).toMatch(/updated by clinicians/);
  });
});

describe("notifications", () => {
  it("registers devices, notifies rewards in the inbox and pushes them after commit", async () => {
    const { ctx, token, userId, push } = await setup();
    await ctx
      .http()
      .post("/api/v1/notifications/devices")
      .set(bearer(token))
      .send({ token: "fcm-token-aaaaaaaaaaaaaaaaaaaa", platform: "android", appVersion: "1.0.0" })
      .expect(204);
    // Re-registering the same token is an upsert.
    await ctx
      .http()
      .post("/api/v1/notifications/devices")
      .set(bearer(token))
      .send({ token: "fcm-token-aaaaaaaaaaaaaaaaaaaa", platform: "android" })
      .expect(204);
    expect(await DeviceTokenModel.countDocuments({ userId })).toBe(1);

    const { admin } = await (async () => ({
      admin: (
        await ctx
          .http()
          .post("/api/v1/auth/login")
          .set("X-Client-Platform", "mobile")
          .send({ email: "admin@example.com", password: "healthy-nation-1" })
      ).body.accessToken as string,
    }))();
    await ctx
      .http()
      .post("/api/v1/admin/achievements")
      .set(bearer(admin))
      .send({
        key: "first_save",
        name: "First patient saved",
        description: "Pass a story case",
        icon: "❤️",
        criterion: "missions_passed",
        threshold: 1,
      })
      .expect(201);
    // Passing the first case earns that achievement.
    await ctx
      .http()
      .post("/api/v1/sync/events")
      .set(bearer(token))
      .send({
        events: [
          ev("attempt.start", { missionKey: "malaria", mode: "story", clientRef: "a" }),
          ev("attempt.answer", { attempt: "client:a", stepId: "s1", choiceId: correctOf("s1") }),
          ev("attempt.answer", { attempt: "client:a", stepId: "s2", choiceId: correctOf("s2") }),
        ],
      })
      .expect(200);
    await settle();
    const inbox = await ctx.http().get("/api/v1/notifications").set(bearer(token)).expect(200);
    expect(inbox.body.total).toBeGreaterThan(0);
    expect(inbox.body.unreadCount).toBe(inbox.body.total);
    expect(inbox.body.items[0]).toMatchObject({ readAt: null });
    expect(inbox.body.items[0]).toMatchObject({
      type: "achievement",
      body: "First patient saved",
      route: "/play/achievements",
    });
    expect(push.sent.length).toBe(inbox.body.total);
    expect(push.sent[0]!.tokens).toEqual(["fcm-token-aaaaaaaaaaaaaaaaaaaa"]);
    expect(push.sent[0]!.message.data.route).toBe("/play/achievements");

    await ctx
      .http()
      .post(`/api/v1/notifications/${inbox.body.items[0].id}/read`)
      .set(bearer(token))
      .expect(204);
    const unread = await ctx
      .http()
      .get("/api/v1/notifications?unread=true")
      .set(bearer(token))
      .expect(200);
    expect(unread.body.unreadCount).toBe(inbox.body.total - 1);
    await ctx.http().post("/api/v1/notifications/read-all").set(bearer(token)).expect(204);
    expect(
      (await ctx.http().get("/api/v1/notifications").set(bearer(token))).body.unreadCount,
    ).toBe(0);
  });

  it("respects the push preference, removes invalid tokens, and hides other users' notifications", async () => {
    const { ctx, token, userId, push } = await setup();
    const other = await createVerifiedUser(ctx, "other@example.com");
    await ctx
      .http()
      .post("/api/v1/notifications/devices")
      .set(bearer(token))
      .send({ token: "dead-token-bbbbbbbbbbbbbbbbbbb", platform: "ios" })
      .expect(204);
    push.invalid.add("dead-token-bbbbbbbbbbbbbbbbbbb");
    await ctx.services.notifications.create([userId], {
      type: "announcement",
      title: "Hello",
      body: "World",
    });
    await settle();
    expect(await DeviceTokenModel.countDocuments({ userId })).toBe(0);

    await PlayerProfileModel.updateOne(
      { userId },
      { $set: { "notificationPrefs.push": false } },
      { upsert: true },
    );
    await ctx.services.notifications.create([userId], {
      type: "announcement",
      title: "Quiet",
      body: "No push",
    });
    expect((await NotificationModel.findOne({ title: "Quiet" }).lean())!.pushStatus).toBe(
      "skipped",
    );

    const mine = await ctx.http().get("/api/v1/notifications").set(bearer(token)).expect(200);
    await ctx
      .http()
      .post(`/api/v1/notifications/${mine.body.items[0].id}/read`)
      .set(bearer(other.accessToken))
      .expect(404);
  });

  it("lets admins send announcements to an audience (audited, step-up protected)", async () => {
    const { ctx, admin, token } = await setup();
    await PlayerProfileModel.updateOne(
      { userId: (await ctx.http().get("/api/v1/users/me").set(bearer(token))).body.id },
      { $set: { homeCountryCode: "KE" } },
      { upsert: true },
    );
    await ctx
      .http()
      .post("/api/v1/admin/announcements")
      .set(bearer(token))
      .send({ title: "Hi", body: "There" })
      .expect(403);
    const all = await ctx
      .http()
      .post("/api/v1/admin/announcements")
      .set(bearer(admin))
      .send({ title: "New cases this week", body: "Two new cases in Kenya.", route: "/play/story" })
      .expect(202);
    expect(all.body.recipients).toBe(2);
    const kenya = await ctx
      .http()
      .post("/api/v1/admin/announcements")
      .set(bearer(admin))
      .send({ title: "Kenya only", body: "Hello Kenya", audience: { countries: ["KE"] } })
      .expect(202);
    expect(kenya.body.recipients).toBe(1);
    await ctx
      .http()
      .post("/api/v1/admin/announcements")
      .set(bearer(admin))
      .send({ title: "Bad", body: "link", route: "https://evil.example" })
      .expect(400);
    const inbox = await ctx.http().get("/api/v1/notifications").set(bearer(token)).expect(200);
    expect(inbox.body.items.map((n: { title: string }) => n.title)).toEqual([
      "Kenya only",
      "New cases this week",
    ]);
  });
});
