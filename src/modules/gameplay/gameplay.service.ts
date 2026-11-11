import type {
  AnswerResponse,
  AnsweredStep,
  Attempt,
  AttemptResult,
  PlayerStep,
  StartAttempt,
  SubmitAnswer,
} from "@ahq/api-contracts";
import mongoose, { type ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import type { MissionsService } from "../missions/missions.service.js";
import {
  MissionModel,
  MissionVersionModel,
  type MissionVersionDocument,
} from "../missions/mission.models.js";
import type { ProgressService } from "../players/progress.service.js";
import type { SettingsService } from "../settings/settings.service.js";
import { MissionAttemptModel, type AttemptDocument } from "./attempt.model.js";
import { evaluateAnswer, rewardsFor, scoreAttempt, shuffle } from "./domain/scoring.js";

type Step = NonNullable<MissionVersionDocument["content"]>["steps"][number];
type ClientInfo = { platform?: string | undefined; appVersion?: string | undefined };

export class GameplayService {
  constructor(
    private readonly settings: SettingsService,
    private readonly missions: MissionsService,
    private readonly progress: ProgressService,
  ) {}

  // ---- Start / load -----------------------------------------------------------------------

  async start(userId: string, input: StartAttempt, client: ClientInfo = {}) {
    const mission = await this.missions.getPublished(input.missionKey);
    if (input.mode === "story") {
      const lock = await this.missions.lockState(mission, await this.progress.get(userId));
      if (lock.locked) {
        throw new AppError(403, "MISSION_LOCKED", "This mission is still locked.", [
          { path: "lockReason", message: lock.lockReason! },
        ]);
      }
    }
    const open = await MissionAttemptModel.findOne({
      userId,
      missionKey: input.missionKey,
      mode: input.mode,
      status: "in_progress",
    });
    if (open) return { attempt: open, created: false };

    const version = await this.missions.publishedVersion(mission);
    const economy = await this.settings.get("economy");
    const choiceOrder = new Map(
      version.content!.steps.map((s) => {
        const ids = s.choices.map((c) => c.choiceId);
        return [s.stepId, economy.value.shuffleChoices ? shuffle(ids) : ids];
      }),
    );
    try {
      const attempt = await MissionAttemptModel.create({
        userId,
        missionId: mission._id,
        missionKey: mission.key,
        title: version.content!.title,
        icon: mission.icon,
        missionVersionId: version._id,
        countryCode: version.content!.countryCode,
        mode: input.mode,
        status: "in_progress",
        choiceOrder,
        maxScore: version.content!.steps.length * economy.value.pointsPerCorrectStep,
        economyVersion: economy.version,
        startedAt: new Date(),
        client: { platform: client.platform ?? null, appVersion: client.appVersion ?? null },
      });
      return { attempt, created: true };
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
      const existing = await MissionAttemptModel.findOne({
        userId,
        missionKey: input.missionKey,
        mode: input.mode,
        status: "in_progress",
      });
      if (!existing) throw e;
      return { attempt: existing, created: false };
    }
  }

  async load(userId: string, attemptId: string) {
    if (!mongoose.isValidObjectId(attemptId)) throw AppError.notFound("Attempt not found.");
    const attempt = await MissionAttemptModel.findOne({ _id: attemptId, userId });
    if (!attempt) throw AppError.notFound("Attempt not found."); // other users' attempts are invisible
    const version = await MissionVersionModel.findById(attempt.missionVersionId);
    if (!version) throw AppError.notFound("Attempt not found.");
    return { attempt, version };
  }

  // ---- DTOs (never expose correctness/feedback for unanswered steps) -----------------------

  private playerStep(attempt: AttemptDocument, step: Step, index: number): PlayerStep {
    const order = attempt.choiceOrder.get(step.stepId) ?? step.choices.map((c) => c.choiceId);
    const byId = new Map(step.choices.map((c) => [c.choiceId, c]));
    return {
      stepId: step.stepId,
      index,
      prompt: step.prompt,
      choices: order.map((id) => ({ choiceId: id, text: byId.get(id)!.text })),
    };
  }

  private answeredStep(attempt: AttemptDocument, step: Step, index: number): AnsweredStep {
    const a = attempt.answers.find((x) => x.stepId === step.stepId)!;
    const chosen = step.choices.find((c) => c.choiceId === a.choiceId)!;
    return {
      ...this.playerStep(attempt, step, index),
      answer: {
        choiceId: a.choiceId,
        correct: a.correct,
        correctChoiceId: step.choices.find((c) => c.correct)!.choiceId,
        feedback: chosen.feedback,
        critical: Boolean(a.critical),
        reasoning: a.reasoning ?? null,
        answeredAt: a.answeredAt.toISOString(),
      },
    };
  }

  toDto(attempt: AttemptDocument, version: MissionVersionDocument): Attempt {
    const steps = version.content!.steps;
    const answered = attempt.answers.length;
    const current = attempt.status === "in_progress" && answered < steps.length ? answered : null;
    return {
      id: attempt.id as string,
      missionKey: attempt.missionKey,
      title: attempt.title,
      icon: attempt.icon,
      mode: attempt.mode as Attempt["mode"],
      status: attempt.status as Attempt["status"],
      story: version.content!.story,
      stepCount: steps.length,
      steps: [
        ...steps.slice(0, answered).map((s, i) => this.answeredStep(attempt, s, i)),
        ...(current !== null ? [this.playerStep(attempt, steps[current]!, current)] : []),
      ],
      currentStepIndex: current,
      startedAt: attempt.startedAt.toISOString(),
      completedAt: attempt.completedAt ? attempt.completedAt.toISOString() : null,
      result:
        attempt.status === "completed"
          ? {
              score: attempt.score!,
              maxScore: attempt.maxScore,
              passed: attempt.passed!,
              rewards: { hp: attempt.rewards?.hp ?? 0, funding: attempt.rewards?.funding ?? 0 },
            }
          : null,
    };
  }

  // ---- Answering ----------------------------------------------------------------------------

  async answer(
    userId: string,
    attemptId: string,
    input: SubmitAnswer,
    opts: { clientAnsweredAt?: Date | undefined } = {},
  ): Promise<AnswerResponse> {
    const { attempt, version } = await this.load(userId, attemptId);
    if (attempt.status !== "in_progress")
      throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "This attempt is no longer active.");
    const steps = version.content!.steps;
    if (attempt.answers.some((a) => a.stepId === input.stepId)) {
      throw new AppError(409, "STEP_ALREADY_ANSWERED", "This step has already been answered.");
    }
    const index = attempt.answers.length;
    const step = steps[index];
    if (!step || step.stepId !== input.stepId) {
      throw AppError.badRequest("Answer the current step.", [
        { path: "stepId", message: `expected ${step?.stepId ?? "none"}` },
      ]);
    }
    const evaluation = evaluateAnswer(step, input.choiceId);
    if (!evaluation)
      throw AppError.badRequest("Unknown choice for this step.", [
        { path: "choiceId", message: "not in this step" },
      ]);

    const answerDoc = {
      stepId: step.stepId,
      choiceId: input.choiceId,
      correct: evaluation.correct,
      critical: evaluation.critical,
      reasoning: input.reasoning ? input.reasoning : null,
      answeredAt: new Date(),
      clientAnsweredAt: opts.clientAnsweredAt ?? null,
    };
    const isLast = index === steps.length - 1;
    const guard = { _id: attempt._id, status: "in_progress", answers: { $size: index } };

    if (!isLast) {
      const res = await MissionAttemptModel.updateOne(guard, { $push: { answers: answerDoc } });
      if (res.modifiedCount !== 1) throw await this.raceError(attempt._id);
      const updated = (await MissionAttemptModel.findById(attempt._id))!;
      return {
        step: this.answeredStep(updated, step, index),
        next: this.playerStep(updated, steps[index + 1]!, index + 1),
        result: null,
      };
    }

    const session = await mongoose.startSession();
    try {
      let result!: AttemptResult;
      let updated!: AttemptDocument;
      await session.withTransaction(async (s) => {
        const pushed = await MissionAttemptModel.findOneAndUpdate(
          guard,
          { $push: { answers: answerDoc } },
          { new: true, session: s },
        );
        if (!pushed) throw await this.raceError(attempt._id);
        ({ result, attempt: updated } = await this.complete(userId, pushed, version, s));
      });
      return { step: this.answeredStep(updated, step, index), next: null, result };
    } finally {
      await session.endSession();
    }
  }

  private async complete(
    userId: string,
    attempt: AttemptDocument,
    version: MissionVersionDocument,
    session: ClientSession,
  ) {
    const economy = await this.settings.getVersion("economy", attempt.economyVersion);
    const steps = version.content!.steps;
    const scored = scoreAttempt(steps, attempt.answers, economy);
    const prior = (await this.progress.get(userId, session)).missions?.get(attempt.missionKey);
    const mode = attempt.mode as "story" | "practice";
    const reward = rewardsFor(
      {
        mode,
        score: scored.score,
        passed: scored.passed,
        prior: {
          attempts: prior?.attempts ?? 0,
          bestScore: prior?.bestScore ?? 0,
          passed: Boolean(prior?.passed),
        },
      },
      economy,
    );
    const story = mode === "story";
    const applied = await this.progress.applyChange(
      userId,
      {
        source: "mission_attempt",
        sourceId: attempt.id as string,
        hp: reward.hp,
        funding: reward.funding,
        economyVersion: attempt.economyVersion,
        mission: {
          key: attempt.missionKey,
          score: scored.score,
          maxScore: scored.maxScore,
          passed: scored.passed,
          mode,
        },
        stats: {
          [story ? "storyCompleted" : "practiceCompleted"]: 1,
          storyPassed: story && reward.firstCompletion && scored.passed ? 1 : 0,
          perfectScores: story && scored.score === scored.maxScore ? 1 : 0,
          correctAnswers: scored.correctCount,
          answersTotal: steps.length,
        },
      },
      session,
    );
    const done = await MissionAttemptModel.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress" },
      {
        $set: {
          status: "completed",
          completedAt: new Date(),
          score: scored.score,
          correctCount: scored.correctCount,
          passed: scored.passed,
          criticalError: scored.criticalError,
          firstCompletion: reward.firstCompletion,
          rewards: applied.delta,
        },
      },
      { new: true, session },
    );
    if (!done) throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "This attempt is no longer active.");
    const mission = (await MissionModel.findById(attempt.missionId, null, { session }))!;
    const result: AttemptResult = {
      score: scored.score,
      maxScore: scored.maxScore,
      correctCount: scored.correctCount,
      passed: scored.passed,
      criticalError: scored.criticalError,
      firstPass: reward.firstCompletion,
      rewards: applied.delta,
      progress: await this.progress.toDto(applied.progress),
      newlyUnlocked: applied.newlyUnlocked,
      achievements: applied.achievements.map((a) => ({ key: a.key, name: a.name })),
      verification: await this.missions.verification(mission),
    };
    return { result, attempt: done };
  }

  private async raceError(id: unknown) {
    const now = await MissionAttemptModel.findById(id).lean();
    return now?.status !== "in_progress"
      ? new AppError(409, "ATTEMPT_NOT_ACTIVE", "This attempt is no longer active.")
      : new AppError(409, "STEP_ALREADY_ANSWERED", "This step has already been answered.");
  }

  async abandon(userId: string, attemptId: string) {
    const { attempt, version } = await this.load(userId, attemptId);
    const res = await MissionAttemptModel.findOneAndUpdate(
      { _id: attempt._id, status: "in_progress" },
      { $set: { status: "abandoned", completedAt: new Date() } },
      { new: true },
    );
    if (!res) throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "This attempt is no longer active.");
    return this.toDto(res, version);
  }

  async history(
    userId: string,
    q: {
      page: number;
      pageSize: number;
      missionKey?: string | undefined;
      mode?: string | undefined;
      status?: string | undefined;
    },
  ) {
    const filter: Record<string, unknown> = { userId };
    if (q.missionKey) filter.missionKey = q.missionKey;
    if (q.mode) filter.mode = q.mode;
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      MissionAttemptModel.find(filter)
        .sort({ startedAt: -1, _id: -1 })
        .skip((q.page - 1) * q.pageSize)
        .limit(q.pageSize)
        .lean(),
      MissionAttemptModel.countDocuments(filter),
    ]);
    return {
      items: items.map((a) => ({
        id: String(a._id),
        missionKey: a.missionKey,
        title: a.title,
        mode: a.mode as "story" | "practice",
        status: a.status as Attempt["status"],
        score: a.score ?? null,
        maxScore: a.maxScore,
        passed: a.passed ?? null,
        rewards: a.rewards ? { hp: a.rewards.hp ?? 0, funding: a.rewards.funding ?? 0 } : null,
        startedAt: a.startedAt.toISOString(),
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      })),
      total,
    };
  }
}
