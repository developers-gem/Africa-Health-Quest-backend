import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import { describe, expect, it } from "vitest";
import { MissionAttemptModel } from "../../src/modules/gameplay/attempt.model.js";
import { MissionModel, MissionVersionModel } from "../../src/modules/missions/mission.models.js";
import { hashVersion } from "../../src/modules/missions/missions.service.js";
import {
  PlayerProgressModel,
  ProgressLedgerModel,
} from "../../src/modules/players/player.models.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";
import { publishAll } from "./missions-helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const malaria = PROTOTYPE_MISSIONS.find((m) => m.key === "malaria")!;
const correctOf = (stepId: string) =>
  malaria.steps.find((s) => s.stepId === stepId)!.choices.find((c) => c.correct)!.choiceId;
const wrongOf = (stepId: string) =>
  malaria.steps.find((s) => s.stepId === stepId)!.choices.find((c) => !c.correct)!.choiceId;
const ALL_FEEDBACK = PROTOTYPE_MISSIONS.flatMap((m) =>
  m.steps.flatMap((s) => s.choices.map((c) => c.feedback)),
);

/** Fails if a payload carries answer data for steps that have not been answered. */
function assertNoAnswerKey(body: unknown, revealed: Set<string>) {
  const walk = (node: unknown, insideAnswer: boolean) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, insideAnswer));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      if (!insideAnswer && ["correct", "feedback", "critical", "correctChoiceId"].includes(k)) {
        throw new Error(`answer data "${k}" leaked outside a revealed answer`);
      }
      walk(v, insideAnswer || k === "answer");
    }
  };
  walk(body, false);
  const text = JSON.stringify(body);
  for (const f of ALL_FEEDBACK)
    if (!revealed.has(f) && text.includes(f)) throw new Error(`feedback leaked: ${f}`);
}

async function setup(publish = true) {
  const ctx = makeApp();
  await seedReference(ctx);
  if (publish) await publishAll(ctx);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return { ctx, player, token: player.accessToken as string, userId: player.user.id as string };
}

const start = (
  ctx: ReturnType<typeof makeApp>,
  token: string,
  missionKey: string,
  mode: "story" | "practice" = "story",
) => ctx.http().post("/api/v1/attempts").set(bearer(token)).send({ missionKey, mode });
const answer = (
  ctx: ReturnType<typeof makeApp>,
  token: string,
  id: string,
  stepId: string,
  choiceId: string,
  reasoning?: string,
) =>
  ctx
    .http()
    .post(`/api/v1/attempts/${id}/answers`)
    .set(bearer(token))
    .send({ stepId, choiceId, ...(reasoning ? { reasoning } : {}) });

describe("mission catalogue and clinical governance (D4)", () => {
  it("seeds the 10 prototype missions as version 1 awaiting review, with correct content hashes", async () => {
    await setup(false);
    const versions = await MissionVersionModel.find().lean();
    expect(versions).toHaveLength(10);
    for (const v of versions) {
      expect(v.status).toBe("in_review");
      expect(v.contentHash).toBe(hashVersion(v as never));
    }
  });

  it("shows players nothing until a clinician approves", async () => {
    const { ctx, token } = await setup(false);
    expect(
      (await ctx.http().get("/api/v1/missions").set(bearer(token)).expect(200)).body.items,
    ).toEqual([]);
    await ctx.http().get("/api/v1/missions/malaria").expect(404);
    expect((await start(ctx, token, "malaria")).status).toBe(404);
  });

  it("lists published missions with story locks based on hospital level and countries", async () => {
    const { ctx, token } = await setup();
    const res = await ctx.http().get("/api/v1/missions").set(bearer(token)).expect(200);
    expect(res.body.items).toHaveLength(10);
    const byKey = Object.fromEntries(res.body.items.map((m: { key: string }) => [m.key, m]));
    expect(byKey.malaria).toMatchObject({
      locked: false,
      lockReason: null,
      stepCount: 2,
      maxScore: 50,
      versionNumber: 1,
    });
    expect(byKey.birth).toMatchObject({ locked: true, lockReason: "country" }); // Ghana needs 100 HP
    expect(byKey.bp).toMatchObject({ locked: true, lockReason: "tier" }); // Community Hospital needs 150 HP
    const practice = await ctx
      .http()
      .get("/api/v1/missions?mode=practice")
      .set(bearer(token))
      .expect(200);
    expect(practice.body.items.every((m: { locked: boolean }) => !m.locked)).toBe(true);
    const kenya = await ctx.http().get("/api/v1/missions?country=KE").expect(200);
    expect(kenya.body.items.map((m: { key: string }) => m.key)).toEqual(["cholera", "child"]);
    assertNoAnswerKey(res.body, new Set());
  });

  it("returns mission detail with verification but no steps", async () => {
    const { ctx } = await setup();
    const res = await ctx.http().get("/api/v1/missions/malaria").expect(200);
    expect(res.body).toMatchObject({
      title: "Fever in the Rainy Season",
      story: malaria.story,
      verification: { reviewerName: "Dr Ama Mensah" },
    });
    expect(res.body.steps).toBeUndefined();
    assertNoAnswerKey(res.body, new Set());
  });

  it("picks a random case server-side and honours exclude", async () => {
    const { ctx } = await setup();
    for (let i = 0; i < 5; i++) {
      const r = await ctx.http().get("/api/v1/missions/random?exclude=malaria").expect(200);
      expect(r.body.key).not.toBe("malaria");
    }
  });
});

describe("playing a mission (server-authoritative)", () => {
  it("plays Fever in the Rainy Season end to end without leaking the answer key", async () => {
    const { ctx, token, userId } = await setup();
    const revealed = new Set<string>();
    const started = await start(ctx, token, "malaria").expect(201);
    assertNoAnswerKey(started.body, revealed);
    expect(started.body).toMatchObject({
      status: "in_progress",
      stepCount: 2,
      currentStepIndex: 0,
      story: malaria.story,
    });
    expect(started.body.steps).toHaveLength(1);
    const shown = started.body.steps[0].choices.map((c: { choiceId: string }) => c.choiceId).sort();
    expect(shown).toEqual(["s1c1", "s1c2", "s1c3"]);

    const a1 = await answer(
      ctx,
      token,
      started.body.id,
      "s1",
      wrongOf("s1"),
      "probably just a viral fever",
    ).expect(200);
    expect(a1.body.step.answer).toMatchObject({
      correct: false,
      correctChoiceId: correctOf("s1"),
      critical: false,
      reasoning: "probably just a viral fever",
    });
    revealed.add(a1.body.step.answer.feedback);
    assertNoAnswerKey({ next: a1.body.next }, revealed);
    expect(a1.body.result).toBeNull();

    const reload = await ctx
      .http()
      .get(`/api/v1/attempts/${started.body.id}`)
      .set(bearer(token))
      .expect(200);
    assertNoAnswerKey(reload.body, revealed);
    expect(reload.body.currentStepIndex).toBe(1);

    const a2 = await answer(ctx, token, started.body.id, "s2", correctOf("s2")).expect(200);
    expect(a2.body.next).toBeNull();
    // 1 of 2 correct = 25/50 = "Patient saved" (prototype 50 % rule); first pass pays 25 HP and round(12.5) = ₵13.
    expect(a2.body.result).toMatchObject({
      score: 25,
      maxScore: 50,
      correctCount: 1,
      passed: true,
      firstPass: true,
      rewards: { hp: 25, funding: 13 },
    });
    expect(a2.body.result.progress).toMatchObject({ hp: 25, funding: 113 });
    expect(a2.body.result.verification.reviewerName).toBe("Dr Ama Mensah");

    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p!.missions!.malaria).toMatchObject({ bestScore: 25, passed: true, attempts: 1 });
    expect(p!.stats).toMatchObject({
      storyCompleted: 1,
      storyPassed: 1,
      correctAnswers: 1,
      answersTotal: 2,
    });
    expect(await ProgressLedgerModel.countDocuments({ userId, source: "mission_attempt" })).toBe(1);
  });

  it("locks story missions but allows practice, which never pays (Q1)", async () => {
    const { ctx, token, userId } = await setup();
    const locked = await start(ctx, token, "birth");
    expect(locked.status).toBe(403);
    expect(locked.body.error).toMatchObject({
      code: "MISSION_LOCKED",
      details: [{ path: "lockReason", message: "country" }],
    });

    const s = await start(ctx, token, "birth", "practice").expect(201);
    const birth = PROTOTYPE_MISSIONS.find((m) => m.key === "birth")!;
    for (const step of birth.steps)
      await answer(
        ctx,
        token,
        s.body.id,
        step.stepId,
        step.choices.find((c) => c.correct)!.choiceId,
      ).expect(200);
    const done = await ctx
      .http()
      .get(`/api/v1/attempts/${s.body.id}`)
      .set(bearer(token))
      .expect(200);
    expect(done.body.result).toMatchObject({
      score: 50,
      passed: true,
      rewards: { hp: 0, funding: 0 },
    });
    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p).toMatchObject({ hp: 0, funding: 100 });
    expect(p!.stats).toMatchObject({ practiceCompleted: 1, correctAnswers: 2 });
  });

  it("enforces step order, single answers and ownership", async () => {
    const { ctx, token } = await setup();
    const other = await createVerifiedUser(ctx, "other@example.com");
    const s = await start(ctx, token, "malaria").expect(201);
    const id = s.body.id;
    await answer(ctx, token, id, "s2", correctOf("s2")).expect(400);
    await answer(ctx, token, id, "s1", "s9c9").expect(400);
    await answer(ctx, other.accessToken, id, "s1", correctOf("s1")).expect(404);
    await ctx.http().get(`/api/v1/attempts/${id}`).set(bearer(other.accessToken)).expect(404);
    await answer(ctx, token, id, "s1", correctOf("s1")).expect(200);
    const dup = await answer(ctx, token, id, "s1", wrongOf("s1"));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("STEP_ALREADY_ANSWERED");
    await answer(ctx, token, id, "s2", correctOf("s2")).expect(200);
    const late = await answer(ctx, token, id, "s2", correctOf("s2"));
    expect(late.body.error.code).toBe("ATTEMPT_NOT_ACTIVE");
  });

  it("resumes the open attempt instead of starting a second one", async () => {
    const { ctx, token } = await setup();
    const a = await start(ctx, token, "malaria").expect(201);
    await answer(ctx, token, a.body.id, "s1", correctOf("s1")).expect(200);
    const b = await start(ctx, token, "malaria").expect(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.steps).toHaveLength(2);
    expect(b.body.steps[0].answer.correct).toBe(true);
  });

  it("awards a completed mission exactly once under concurrent final answers", async () => {
    const { ctx, token, userId } = await setup();
    const s = await start(ctx, token, "malaria").expect(201);
    await answer(ctx, token, s.body.id, "s1", correctOf("s1")).expect(200);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => answer(ctx, token, s.body.id, "s2", correctOf("s2"))),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await PlayerProgressModel.findOne({ userId }).lean())!.hp).toBe(50);
  });

  it("failing first costs nothing; first pass pays in full; replays pay 30 % of the improvement (Q2, Q8)", async () => {
    const { ctx, token, userId } = await setup();
    const play = async (choices: string[]) => {
      const s = await start(ctx, token, "malaria").expect(201);
      let last;
      for (const [i, c] of choices.entries())
        last = await answer(ctx, token, s.body.id, `s${i + 1}`, c).expect(200);
      return last!.body.result;
    };
    expect(await play([wrongOf("s1"), wrongOf("s2")])).toMatchObject({
      score: 0,
      passed: false,
      firstPass: false,
      rewards: { hp: 0, funding: 0 },
    });
    expect(await play([correctOf("s1"), wrongOf("s2")])).toMatchObject({
      score: 25,
      firstPass: true,
      rewards: { hp: 25, funding: 13 },
    });
    expect(await play([correctOf("s1"), correctOf("s2")])).toMatchObject({
      score: 50,
      firstPass: false,
      rewards: { hp: 8, funding: 0 },
    });
    expect(await play([correctOf("s1"), correctOf("s2")])).toMatchObject({
      rewards: { hp: 0, funding: 0 },
    });
    const p = await PlayerProgressModel.findOne({ userId }).lean();
    expect(p).toMatchObject({ hp: 33, funding: 113 });
    expect(p!.missions!.malaria).toMatchObject({ attempts: 4, bestScore: 50, passed: true });
    expect(p!.stats).toMatchObject({ storyPassed: 1, perfectScores: 2 });
  });

  it("shuffles answer order per attempt and serves it consistently", async () => {
    const { ctx, token } = await setup();
    const orders = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const s = await start(ctx, token, "malaria", "practice").expect(201);
      const order = s.body.steps[0].choices.map((c: { choiceId: string }) => c.choiceId).join();
      const again = await ctx
        .http()
        .get(`/api/v1/attempts/${s.body.id}`)
        .set(bearer(token))
        .expect(200);
      expect(again.body.steps[0].choices.map((c: { choiceId: string }) => c.choiceId).join()).toBe(
        order,
      );
      orders.add(order);
      await ctx.http().post(`/api/v1/attempts/${s.body.id}/abandon`).set(bearer(token)).expect(200);
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("abandons attempts and lists history with filters", async () => {
    const { ctx, token } = await setup();
    const s = await start(ctx, token, "malaria").expect(201);
    const ab = await ctx
      .http()
      .post(`/api/v1/attempts/${s.body.id}/abandon`)
      .set(bearer(token))
      .expect(200);
    expect(ab.body.status).toBe("abandoned");
    await ctx.http().post(`/api/v1/attempts/${s.body.id}/abandon`).set(bearer(token)).expect(409);
    const s2 = await start(ctx, token, "malaria").expect(201);
    await answer(ctx, token, s2.body.id, "s1", correctOf("s1")).expect(200);
    await answer(ctx, token, s2.body.id, "s2", correctOf("s2")).expect(200);
    const all = await ctx.http().get("/api/v1/players/me/attempts").set(bearer(token)).expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items[0]).toMatchObject({
      missionKey: "malaria",
      title: "Fever in the Rainy Season",
      status: "completed",
      score: 50,
      passed: true,
      rewards: { hp: 50, funding: 25 },
    });
    const done = await ctx
      .http()
      .get("/api/v1/players/me/attempts?status=abandoned")
      .set(bearer(token))
      .expect(200);
    expect(done.body.items.map((a: { status: string }) => a.status)).toEqual(["abandoned"]);
    expect(await MissionAttemptModel.countDocuments({ status: "in_progress" })).toBe(0);
  });

  it("keeps mission placement data out of the content hash", async () => {
    await setup();
    const before = await MissionModel.findOne({ key: "malaria" }).lean();
    await MissionModel.updateOne({ key: "malaria" }, { $set: { icon: "🩺", tier: 1 } });
    const v = await MissionVersionModel.findById(before!.publishedVersionId).lean();
    expect(hashVersion(v as never)).toBe(before!.published!.contentHash);
  });

  it("refuses edits to submitted or published version content", async () => {
    await setup();
    const v = await MissionVersionModel.findOne({ status: "published" });
    v!.content!.title = "Tampered";
    await expect(v!.save()).rejects.toThrow(/immutable/);
    await expect(
      MissionVersionModel.updateOne({ _id: v!._id }, { $set: { "content.title": "x" } }),
    ).rejects.toThrow(/draft/);
  });
});

describe("answer-key leak detector (self-test)", () => {
  it("detects answer data outside revealed answers", () => {
    expect(() =>
      assertNoAnswerKey({ steps: [{ choices: [{ choiceId: "s1c1", correct: true }] }] }, new Set()),
    ).toThrow(/correct/);
    expect(() => assertNoAnswerKey({ note: ALL_FEEDBACK[0] }, new Set())).toThrow(
      /feedback leaked/,
    );
    expect(() =>
      assertNoAnswerKey(
        { step: { answer: { correct: true, feedback: ALL_FEEDBACK[0] } } },
        new Set([ALL_FEEDBACK[0]!]),
      ),
    ).not.toThrow();
  });
});
