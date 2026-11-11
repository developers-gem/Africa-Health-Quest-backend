import type { SyncEvent } from "@ahq/api-contracts";
import mongoose, { Types } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { MissionAttemptModel } from "../gameplay/attempt.model.js";
import { MissionModel } from "../missions/mission.models.js";
import { rewardsFor } from "../gameplay/domain/scoring.js";
import type { GameplayService } from "../gameplay/gameplay.service.js";
import type { HospitalService } from "../hospital/hospital.service.js";
import { HospitalRunModel } from "../hospital/hospital.models.js";
import { toRunDto } from "../hospital/hospital.service.js";
import { purgeUserData } from "../jobs/retention.js";
import type { SessionService } from "../auth/session.service.js";
import type { TokenService } from "../auth/token.service.js";
import { toProfileDto, type ProfileService } from "../players/profile.service.js";
import type { ProgressService } from "../players/progress.service.js";
import type { SettingsService } from "../settings/settings.service.js";
import { UserModel, type UserDocument } from "../users/user.model.js";
import { SyncEventModel } from "./sync.models.js";

type Result = {
  eventId: string;
  type: string;
  status: "applied" | "duplicate" | "stale" | "rejected";
  code: string | null;
  message: string | null;
  data: unknown;
};
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export class SyncService {
  constructor(
    private readonly deps: {
      gameplay: GameplayService;
      hospital: HospitalService;
      profiles: ProfileService;
      progress: ProgressService;
      settings: SettingsService;
      tokens: TokenService;
      sessions: SessionService;
    },
  ) {}

  // ---- Offline event queue ---------------------------------------------------------------------

  /**
   * Applies queued offline events in order. Each event is processed independently; results are stored by eventId
   * so re-sending a batch (e.g. after a dropped connection) never applies anything twice.
   * Conflict policy: server-authoritative; first answer to a step wins; profile edits are last-writer-wins by
   * device time; funding is checked when the event is processed.
   */
  async processBatch(user: UserDocument, events: SyncEvent[]) {
    const userId = user.id as string;
    const results: Result[] = [];
    for (const event of events) {
      // Claim the event before applying it: the unique (userId, eventId) index guarantees that concurrent
      // uploads of the same queue apply each event at most once.
      const claimed = await SyncEventModel.create({
        userId,
        eventId: event.eventId,
        type: event.type,
        status: "processing",
        occurredAt: clamp(event.occurredAt),
      }).then(
        () => true,
        (e: { code?: number }) => {
          if (e.code === 11000) return false;
          throw e;
        },
      );
      if (!claimed) {
        results.push(await this.storedResult(userId, event));
        continue;
      }
      let result: Result;
      let extra: { clientRef?: string; attemptId?: unknown } = {};
      try {
        const out = await this.apply(userId, event);
        result = {
          eventId: event.eventId,
          type: event.type,
          status: out.status,
          code: null,
          message: null,
          data: out.data,
        };
        extra = out.extra ?? {};
      } catch (e) {
        if (!(e instanceof AppError)) {
          await SyncEventModel.deleteOne({ userId, eventId: event.eventId, status: "processing" }); // allow a retry
          throw e;
        }
        const resolved = await this.resolveConflict(userId, event, e);
        result = resolved ?? {
          eventId: event.eventId,
          type: event.type,
          status: "rejected",
          code: e.code,
          message: e.message,
          data: null,
        };
      }
      await SyncEventModel.updateOne(
        { userId, eventId: event.eventId },
        {
          $set: {
            status: result.status,
            code: result.code,
            message: result.message,
            data: result.data ?? null,
            ...extra,
          },
        },
      );
      results.push(result);
    }
    const progress = await this.deps.progress.toDto(await this.deps.progress.get(userId));
    return { serverTime: new Date().toISOString(), results, progress };
  }

  /** The stored outcome of an event that was already received; waits briefly if another request is applying it. */
  private async storedResult(userId: string, event: SyncEvent): Promise<Result> {
    for (let i = 0; i < 50; i++) {
      const stored = await SyncEventModel.findOne({ userId, eventId: event.eventId }).lean();
      if (stored && stored.status !== "processing") {
        return {
          eventId: event.eventId,
          type: event.type,
          status: "duplicate",
          code: stored.code ?? null,
          message: stored.message ?? null,
          data: stored.data ?? null,
        };
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return {
      eventId: event.eventId,
      type: event.type,
      status: "duplicate",
      code: "SYNC_IN_PROGRESS",
      message: "This event is still being processed; fetch /sync/state shortly.",
      data: null,
    };
  }

  private async resolveAttempt(userId: string, ref: string) {
    if (!ref.startsWith("client:")) return ref;
    const started = await SyncEventModel.findOne({
      userId,
      clientRef: ref.slice(7),
      type: "attempt.start",
      attemptId: { $ne: null },
    }).lean();
    if (!started?.attemptId)
      throw AppError.notFound("The offline attempt this answer belongs to was not started.");
    return String(started.attemptId);
  }

  private async apply(
    userId: string,
    e: SyncEvent,
  ): Promise<{
    status: "applied" | "stale";
    data: unknown;
    extra?: { clientRef?: string; attemptId?: unknown };
  }> {
    const { gameplay, hospital, profiles } = this.deps;
    switch (e.type) {
      case "attempt.start": {
        // An offline pack is tied to the version it was downloaded from; refuse to score it against new content.
        if (e.payload.versionNumber !== undefined) {
          const mission = await MissionModel.findOne({ key: e.payload.missionKey })
            .select("published.versionNumber")
            .lean();
          const current = mission?.published?.versionNumber;
          if (current !== undefined && current !== e.payload.versionNumber) {
            throw new AppError(
              409,
              "CONFLICT",
              "This case was updated by clinicians after you downloaded it. Download the new version and play again.",
              [{ path: "versionNumber", message: "mission_changed" }],
            );
          }
        }
        const { attempt } = await gameplay.start(
          userId,
          { missionKey: e.payload.missionKey, mode: e.payload.mode },
          { platform: "mobile" },
        );
        const { version } = await gameplay.load(userId, attempt.id as string);
        return {
          status: "applied",
          data: gameplay.toDto(attempt, version),
          extra: { clientRef: e.payload.clientRef, attemptId: attempt._id },
        };
      }
      case "attempt.answer": {
        const attemptId = await this.resolveAttempt(userId, e.payload.attempt);
        const data = await gameplay.answer(
          userId,
          attemptId,
          {
            stepId: e.payload.stepId,
            choiceId: e.payload.choiceId,
            reasoning: e.payload.reasoning,
          },
          { clientAnsweredAt: clamp(e.occurredAt) },
        );
        return { status: "applied", data };
      }
      case "attempt.abandon":
        return {
          status: "applied",
          data: await gameplay.abandon(
            userId,
            await this.resolveAttempt(userId, e.payload.attempt),
          ),
        };
      case "hospital.run":
        return { status: "applied", data: await hospital.run(userId, e.payload.allocation) };
      case "profile.update": {
        const { profile, applied } = await profiles.update(userId, e.payload, clamp(e.occurredAt));
        return { status: applied ? "applied" : "stale", data: toProfileDto(profile) };
      }
    }
  }

  /** An answer for a step another device already answered with the same choice is a duplicate, not an error. */
  private async resolveConflict(
    userId: string,
    e: SyncEvent,
    err: AppError,
  ): Promise<Result | null> {
    if (e.type !== "attempt.answer" || err.code !== "STEP_ALREADY_ANSWERED") return null;
    const attemptId = await this.resolveAttempt(userId, e.payload.attempt).catch(() => null);
    if (!attemptId) return null;
    const { attempt, version } = await this.deps.gameplay.load(userId, attemptId);
    const existing = attempt.answers.find((a) => a.stepId === e.payload.stepId);
    const state = this.deps.gameplay.toDto(attempt, version);
    if (existing?.choiceId === e.payload.choiceId) {
      return {
        eventId: e.eventId,
        type: e.type,
        status: "duplicate",
        code: null,
        message: "Already answered with the same choice.",
        data: state,
      };
    }
    return {
      eventId: e.eventId,
      type: e.type,
      status: "rejected",
      code: err.code,
      message: "This step was already answered on another device; the first answer stands.",
      data: state,
    };
  }

  // ---- Sync state -------------------------------------------------------------------------------

  async state(
    userId: string,
    q: { since?: string | undefined; progressVersion?: number | undefined },
  ) {
    const serverTime = new Date();
    const since = q.since ? new Date(q.since) : null;
    const [p, profile, attempts, runs] = await Promise.all([
      this.deps.progress.get(userId),
      this.deps.profiles.get(userId),
      MissionAttemptModel.find(
        since
          ? { userId, $or: [{ status: "in_progress" }, { updatedAt: { $gt: since } }] }
          : { userId, status: "in_progress" },
      )
        .sort({ updatedAt: -1 })
        .limit(100)
        .lean(),
      since
        ? HospitalRunModel.find({ userId, createdAt: { $gt: since } })
            .sort({ createdAt: -1 })
            .limit(100)
        : Promise.resolve([]),
    ]);
    return {
      serverTime: serverTime.toISOString(),
      progress: q.progressVersion === p.version ? null : await this.deps.progress.toDto(p),
      profile: !since || (profile.get("updatedAt") as Date) > since ? toProfileDto(profile) : null,
      attempts: attempts.map((a) => ({
        id: String(a._id),
        missionKey: a.missionKey,
        title: a.title,
        mode: a.mode as "story" | "practice",
        status: a.status as "in_progress",
        score: a.score ?? null,
        maxScore: a.maxScore,
        passed: a.passed ?? null,
        rewards: a.rewards ? { hp: a.rewards.hp ?? 0, funding: a.rewards.funding ?? 0 } : null,
        startedAt: a.startedAt.toISOString(),
        completedAt: a.completedAt ? a.completedAt.toISOString() : null,
      })),
      hospitalRuns: runs.map(toRunDto),
    };
  }

  // ---- Guest merge ------------------------------------------------------------------------------

  /**
   * Merges a guest's play into the signed-in account by replaying the guest's completed missions under
   * first-completion rules (never by taking the maximum of totals). Hospital shifts are not transferred because
   * they spent the guest's separate budget. The guest account and its remaining data are then deleted.
   */
  async mergeGuest(target: UserDocument, guestAccessToken: string) {
    if (target.isGuest)
      throw AppError.forbidden("Sign in to a registered account before merging guest progress.");
    const claims = this.deps.tokens.verifyAccessToken(guestAccessToken);
    const guest = await UserModel.findById(claims.userId);
    const session = guest
      ? await this.deps.sessions.findActive(claims.sessionId, claims.userId)
      : null;
    if (!guest?.isGuest || !session) throw AppError.forbidden("That guest session is not valid.");
    if (guest.id === target.id) throw AppError.conflict("Cannot merge an account into itself.");

    const targetId = target.id as string;
    const attempts = await MissionAttemptModel.find({
      userId: guest._id,
      status: "completed",
    }).sort({ completedAt: 1 });
    let hpAdded = 0;
    let fundingAdded = 0;
    let missionsCompleted = 0;
    const tx = await mongoose.startSession();
    try {
      await tx.withTransaction(async (s) => {
        hpAdded = 0;
        fundingAdded = 0;
        missionsCompleted = 0;
        for (const a of attempts) {
          const economy = await this.deps.settings.getVersion("economy", a.economyVersion);
          const mode = a.mode as "story" | "practice";
          const prior = (await this.deps.progress.get(targetId, s)).missions?.get(a.missionKey);
          const reward = rewardsFor(
            {
              mode,
              score: a.score ?? 0,
              passed: Boolean(a.passed),
              prior: {
                attempts: prior?.attempts ?? 0,
                bestScore: prior?.bestScore ?? 0,
                passed: Boolean(prior?.passed),
              },
            },
            economy,
          );
          const applied = await this.deps.progress.applyChange(
            targetId,
            {
              source: "guest_merge",
              sourceId: a.id as string,
              hp: reward.hp,
              funding: reward.funding,
              economyVersion: a.economyVersion,
              mission: {
                key: a.missionKey,
                score: a.score ?? 0,
                maxScore: a.maxScore,
                passed: Boolean(a.passed),
                mode,
              },
              stats: {
                [mode === "story" ? "storyCompleted" : "practiceCompleted"]: 1,
                storyPassed: mode === "story" && reward.firstCompletion && a.passed ? 1 : 0,
                perfectScores: mode === "story" && a.score === a.maxScore ? 1 : 0,
                correctAnswers: a.correctCount ?? 0,
                answersTotal: a.answers.length,
              },
            },
            s,
          );
          hpAdded += applied.delta.hp;
          fundingAdded += applied.delta.funding;
          if (reward.firstCompletion) missionsCompleted++;
          await MissionAttemptModel.updateOne(
            { _id: a._id },
            { $set: { userId: new Types.ObjectId(targetId), mergedFromUserId: guest._id } },
            { session: s },
          );
        }
        await purgeUserData(guest.id as string, s);
      });
    } finally {
      await tx.endSession();
    }
    const progress = await this.deps.progress.toDto(await this.deps.progress.get(targetId));
    return { attemptsMerged: attempts.length, missionsCompleted, hpAdded, fundingAdded, progress };
  }
}

function clamp(iso: string) {
  const t = new Date(iso).getTime();
  return new Date(Math.min(t, Date.now() + MAX_FUTURE_SKEW_MS));
}
