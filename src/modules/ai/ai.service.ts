import { AI_MODELS, DebriefOutputSchema, type AiSettings, type Debrief } from "@ahq/api-contracts";
import { LEARNER_LEVEL_LABELS, type LearnerLevel } from "@ahq/shared-types";
import type { Logger } from "pino";
import { AppError } from "../../lib/errors.js";
import { MissionAttemptModel } from "../gameplay/attempt.model.js";
import {
  ClinicalReferenceModel,
  MissionModel,
  MissionVersionModel,
} from "../missions/mission.models.js";
import { MissionReviewModel } from "../reviews/review.models.js";
import type { SettingsService } from "../settings/settings.service.js";
import { UserModel, type UserDocument } from "../users/user.model.js";
import { DEFAULT_AI } from "./ai.defaults.js";
import { AiDebriefModel, AiUsageLogModel, type DebriefDocument } from "./ai.models.js";
import {
  ProviderRateLimitedError,
  ProviderUnavailableError,
  type ClaudeClient,
  type GenerationResult,
} from "./claude-client.js";
import {
  DEBRIEF_DISCLAIMER,
  DEBRIEF_PROMPT_VERSION,
  type DebriefCase,
  type LearnerHistory,
} from "./prompts/debrief.js";

const WAIT_MS = 25_000;
const STALE_PENDING_MS = 10 * 60_000;
const HISTORY_ATTEMPTS = 30;
/** Versions a debrief may be generated for: approved by a clinician and not withdrawn or retired. */
const APPROVED_VERSION_STATUSES = ["published", "superseded"];
const MAX_FLAGS = 5;
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

const startOfUtcDay = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const startOfUtcMonth = (d = new Date()) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const stripUrls = (s: string) =>
  s
    .replace(URL_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();

export class AiService {
  constructor(
    private readonly settings: SettingsService,
    private readonly client: ClaudeClient | null,
    private readonly logger: Logger,
  ) {}

  /** Notifies the player when a debrief that was still pending after the wait completes in the background. */
  onReady?: (userId: string, attemptId: string) => Promise<void>;
  /** How long a request waits for generation before answering 202 (shorter in tests). */
  waitMs = WAIT_MS;

  get providerName(): "anthropic" | "fake" | "disabled" {
    return this.client?.name ?? "disabled";
  }

  /** Stored settings merged over defaults (settings saved before a field existed lack it). */
  private async aiSettings(): Promise<AiSettings> {
    return { ...DEFAULT_AI, ...((await this.settings.get("ai")).value as Partial<AiSettings>) };
  }

  /** Provider and model configuration for administrators. The API key is never returned. */
  async providerStatus() {
    const { ok, s } = await this.availability();
    return {
      provider: this.providerName,
      keyConfigured: this.client?.name === "anthropic",
      enabled: s.enabled,
      model: s.model,
      effort: s.effort,
      fallbackModel: s.fallbackModel ?? null,
      refusalFallback: s.refusalFallback,
      promptVersion: DEBRIEF_PROMPT_VERSION,
      availableModels: [...AI_MODELS],
      available: ok,
    };
  }

  private async logQuotaRejection(userId: string, s: AiSettings, level: string) {
    await AiUsageLogModel.create({
      userId,
      provider: this.providerName,
      modelRequested: s.model,
      effort: s.effort,
      outcome: "quota_rejected",
      level,
    });
  }

  async monthSpendUsd(now = new Date()) {
    const [row] = await AiUsageLogModel.aggregate<{ micro: number }>([
      { $match: { createdAt: { $gte: startOfUtcMonth(now) } } },
      { $group: { _id: null, micro: { $sum: "$costMicroUsd" } } },
    ]);
    return (row?.micro ?? 0) / 1e6;
  }

  /** Whether generation can run at all (provider configured, switched on, budget left). */
  private async availability() {
    const s = await this.aiSettings();
    if (!this.client || !s.enabled) return { ok: false as const, s };
    if ((await this.monthSpendUsd()) >= s.monthlyBudgetUsd) return { ok: false as const, s };
    return { ok: true as const, s };
  }

  private async usedToday(userId: string) {
    return AiDebriefModel.countDocuments({
      userId,
      createdAt: { $gte: startOfUtcDay() },
      status: { $in: ["pending", "completed"] },
    });
  }

  async status(user: UserDocument) {
    const { ok, s } = await this.availability();
    const limit = user.isGuest ? s.dailyQuotaGuest : s.dailyQuotaRegistered;
    return {
      enabled: ok,
      consentRequired: !user.consent?.aiProcessingAcceptedAt,
      limit,
      used: await this.usedToday(user.id as string),
      resetsAt: new Date(startOfUtcDay().getTime() + 86_400_000).toISOString(),
    };
  }

  async acceptConsent(user: UserDocument) {
    if (!user.consent?.aiProcessingAcceptedAt) {
      await UserModel.updateOne(
        { _id: user._id },
        { $set: { "consent.aiProcessingAcceptedAt": new Date() } },
      );
    }
  }

  /**
   * Requests a debrief for a completed attempt. Returns the existing one for this level unless `regenerate`.
   * Waits up to 25 s; if still running, returns it as pending (generation continues and the client polls).
   */
  async request(
    user: UserDocument,
    attemptId: string,
    input: { level: LearnerLevel; regenerate?: boolean | undefined },
  ) {
    const userId = user.id as string;
    const attempt = await MissionAttemptModel.findOne({ _id: attemptId, userId });
    if (!attempt) throw AppError.notFound("Attempt not found.");
    if (attempt.status !== "completed") {
      throw new AppError(409, "ATTEMPT_NOT_ACTIVE", "Finish the case before asking for a debrief.");
    }
    // Only clinician-approved content may be explained by AI: never a draft, a withdrawn or a retired version.
    const version = await MissionVersionModel.findById(attempt.missionVersionId)
      .select("status approvedAt")
      .lean();
    if (!version?.approvedAt || !APPROVED_VERSION_STATUSES.includes(version.status)) {
      throw new AppError(
        409,
        "CONFLICT",
        "Debriefs are only available for clinician-approved cases. This case is not currently approved.",
        [{ path: "mission", message: "not_approved" }],
      );
    }
    if (!user.consent?.aiProcessingAcceptedAt) {
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        "Please accept AI processing before your first debrief.",
        [{ path: "consent", message: "consent_required" }],
      );
    }

    const latest = await AiDebriefModel.findOne({
      attemptId,
      level: input.level,
      status: { $ne: "failed" },
    }).sort({
      createdAt: -1,
    });
    if (latest && (latest.status === "pending" || !input.regenerate)) {
      await this.expireIfStale(latest);
      if (latest.status !== "failed") return { created: false, debrief: await this.toDto(latest) };
    }

    const { ok, s } = await this.availability();
    if (!ok)
      throw new AppError(
        503,
        "AI_UNAVAILABLE",
        "Debriefs are resting right now. Your results are saved.",
      );
    const limit = user.isGuest ? s.dailyQuotaGuest : s.dailyQuotaRegistered;
    const resetsAt = new Date(startOfUtcDay().getTime() + 86_400_000).toISOString();
    if ((await this.usedToday(userId)) >= limit) {
      await this.logQuotaRejection(userId, s, input.level);
      throw new AppError(
        429,
        "QUOTA_EXCEEDED",
        "You've used today's debriefs — they reset at midnight UTC.",
        [{ path: "resetsAt", message: resetsAt }],
      );
    }
    const recent = await AiDebriefModel.countDocuments({
      userId,
      createdAt: { $gte: new Date(Date.now() - 60_000) },
    });
    if (recent >= (s.burstPerMinute ?? DEFAULT_AI.burstPerMinute)) {
      await this.logQuotaRejection(userId, s, input.level);
      throw new AppError(
        429,
        "RATE_LIMITED",
        "Please wait a minute before asking for another debrief.",
      );
    }

    const debrief = await AiDebriefModel.create({
      userId,
      attemptId,
      missionKey: attempt.missionKey,
      missionVersionId: attempt.missionVersionId,
      level: input.level,
      status: "pending",
      modelRequested: s.model,
      promptVersion: DEBRIEF_PROMPT_VERSION,
    });
    let answered = false;
    const work = this.generate(debrief, s)
      .then(async () => {
        // The request already returned "pending": tell the player when it's ready.
        if (answered && this.onReady) {
          const done = await AiDebriefModel.findById(debrief._id).lean();
          if (done?.status === "completed") await this.onReady(userId, String(attempt._id));
        }
      })
      .catch((err) => {
        this.logger.error({ err, debriefId: debrief.id }, "debrief generation failed unexpectedly");
      });
    await Promise.race([work, new Promise((r) => setTimeout(r, this.waitMs))]);
    answered = true;
    const fresh = (await AiDebriefModel.findById(debrief._id))!;
    return { created: true, debrief: await this.toDto(fresh) };
  }

  private async buildCase(d: DebriefDocument): Promise<{ c: DebriefCase; refIds: Set<string> }> {
    const [attempt, version] = await Promise.all([
      MissionAttemptModel.findById(d.attemptId).lean(),
      MissionVersionModel.findById(d.missionVersionId).lean(),
    ]);
    if (!attempt || !version?.content) throw new Error("attempt or version missing");
    const content = version.content;
    // Citable references: those a clinician confirmed when approving this exact version, plus any attached to it.
    const approvals = await MissionReviewModel.find({
      missionVersionId: version._id,
      decision: "approved",
      contentHash: version.contentHash,
    })
      .select("referenceIds")
      .lean();
    const refIds = [...version.referenceIds, ...approvals.flatMap((a) => a.referenceIds ?? [])];
    const refs = await ClinicalReferenceModel.find({
      _id: { $in: refIds },
      status: "active",
    }).lean();
    const [history, catalogueTopics] = await Promise.all([
      this.learnerHistory(String(d.userId), String(d.attemptId)),
      this.catalogueTopics(),
    ]);
    const steps = content.steps.map((step) => {
      const answer = attempt.answers.find((a) => a.stepId === step.stepId);
      const official = step.choices.find((c) => c.correct)!;
      const chosen = step.choices.find((c) => c.choiceId === answer?.choiceId);
      return {
        stepId: step.stepId,
        prompt: step.prompt,
        officialAnswer: official.text,
        officialFeedback: official.feedback,
        chosen: chosen?.text ?? "(no answer)",
        matched: Boolean(answer?.correct),
        reasoning: answer?.reasoning ?? null,
      };
    });
    return {
      c: {
        level: d.level as LearnerLevel,
        levelLabel: LEARNER_LEVEL_LABELS[d.level as LearnerLevel] ?? "Learner",
        title: content.title,
        story: content.story,
        learningObjectives: [...(content.learningObjectives ?? [])],
        steps,
        history,
        catalogueTopics,
        references: refs.map((r) => ({
          id: String(r._id),
          label: [r.title, r.organization, r.year].filter(Boolean).join(", "),
        })),
      },
      refIds: new Set(refs.map((r) => String(r._id))),
    };
  }

  /** Topics of currently published (clinician-approved) cases: the only topics the model may recommend. */
  private async catalogueTopics() {
    const topics = await MissionModel.distinct("topics", { status: "published" });
    return (topics as string[]).filter(Boolean).sort();
  }

  /** Anonymous summary of the learner's earlier completed cases, by topic. */
  private async learnerHistory(userId: string, excludeAttemptId: string): Promise<LearnerHistory> {
    const attempts = await MissionAttemptModel.find({
      userId,
      status: "completed",
      _id: { $ne: excludeAttemptId },
    })
      .sort({ completedAt: -1 })
      .limit(HISTORY_ATTEMPTS)
      .select("missionKey passed answers.correct")
      .lean();
    if (!attempts.length) {
      return { casesCompleted: 0, casesPassed: 0, weakTopics: [], strongTopics: [] };
    }
    const missions = await MissionModel.find({
      key: { $in: [...new Set(attempts.map((a) => a.missionKey))] },
    })
      .select("key topics")
      .lean();
    const topicsOf = new Map(missions.map((m) => [m.key, [...(m.topics ?? [])]]));
    const byTopic = new Map<string, { correct: number; total: number }>();
    for (const a of attempts) {
      const correct = a.answers.filter((x) => x.correct).length;
      for (const t of topicsOf.get(a.missionKey) ?? []) {
        const cur = byTopic.get(t) ?? { correct: 0, total: 0 };
        byTopic.set(t, { correct: cur.correct + correct, total: cur.total + a.answers.length });
      }
    }
    const rows = [...byTopic.entries()]
      .filter(([, v]) => v.total >= 2)
      .map(([topic, v]) => ({ topic, ...v, ratio: v.correct / v.total }));
    const pick = (xs: typeof rows) =>
      xs.slice(0, 3).map(({ topic, correct, total }) => ({ topic, correct, total }));
    return {
      casesCompleted: attempts.length,
      casesPassed: attempts.filter((a) => a.passed).length,
      weakTopics: pick(rows.filter((r) => r.ratio < 0.6).sort((a, b) => a.ratio - b.ratio)),
      strongTopics: pick(rows.filter((r) => r.ratio >= 0.8).sort((a, b) => b.ratio - a.ratio)),
    };
  }

  private costMicro(s: AiSettings, model: string, u: GenerationResult["usage"]) {
    const p = s.prices[model] ?? s.prices[s.model];
    if (!p) return 0;
    return Math.round(
      u.input * p.inputPerMTok +
        u.output * p.outputPerMTok +
        u.cacheCreation * 1.25 * p.inputPerMTok +
        u.cacheRead * p.cacheReadPerMTok,
    );
  }

  /** Runs the provider call (with one retry for invalid output), post-processes and stores the result. */
  private async generate(d: DebriefDocument, s: AiSettings) {
    const { c, refIds } = await this.buildCase(d);
    let failure: "provider_unavailable" | "refused" | "invalid_output" = "invalid_output";
    // The configured model, then (once, only if it was unavailable) the administrator's fallback model.
    let model = s.model;
    let usedFallback = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res: GenerationResult;
      try {
        res = await this.client!.generateDebrief(c, s, { model });
      } catch (err) {
        const unavailable = err instanceof ProviderUnavailableError;
        await AiUsageLogModel.create({
          userId: d.userId,
          debriefId: d._id,
          provider: this.providerName,
          modelRequested: model,
          effort: s.effort,
          outcome:
            err instanceof ProviderRateLimitedError
              ? "rate_limited"
              : unavailable
                ? "provider_unavailable"
                : "error",
          fallback: usedFallback,
          level: d.level,
        });
        if (!unavailable) this.logger.error({ err }, "AI provider error");
        failure = "provider_unavailable";
        if (unavailable && !usedFallback && s.fallbackModel && s.fallbackModel !== model) {
          model = s.fallbackModel;
          usedFallback = true;
          attempt--; // the fallback gets its own attempt; it does not use up the invalid-output retry
          continue;
        }
        break;
      }
      const parsed =
        res.stopReason === "end_turn" ? DebriefOutputSchema.safeParse(res.output) : null;
      // Every step must be explained, and only steps of this case.
      const covers =
        parsed?.success &&
        c.steps.every((st) => parsed.data.decisions.some((x) => x.stepId === st.stepId)) &&
        parsed.data.decisions.every((x) => c.steps.some((st) => st.stepId === x.stepId));
      const outcome =
        res.stopReason === "refusal"
          ? "refused"
          : parsed?.success && covers
            ? "completed"
            : "invalid_output";
      await AiUsageLogModel.create({
        userId: d.userId,
        debriefId: d._id,
        provider: this.providerName,
        modelRequested: model,
        modelServed: res.modelServed,
        fallback: usedFallback,
        level: d.level,
        effort: s.effort,
        inputTokens: res.usage.input,
        outputTokens: res.usage.output,
        cacheCreationTokens: res.usage.cacheCreation,
        cacheReadTokens: res.usage.cacheRead,
        latencyMs: res.latencyMs,
        outcome,
        stopReason: res.stopReason,
        requestId: res.requestId,
        costMicroUsd: this.costMicro(s, res.modelServed, res.usage),
      });
      if (outcome === "refused") {
        failure = "refused";
        break;
      }
      if (outcome === "completed" && parsed?.success) {
        const out = parsed.data;
        // Verdicts, prompts and chosen text come from the recorded attempt, never from the model.
        d.set({
          status: "completed",
          overall: stripUrls(out.overall),
          decisions: c.steps.map((st) => ({
            stepId: st.stepId,
            prompt: st.prompt,
            chosenText: st.chosen,
            correct: st.matched,
            explanation: stripUrls(out.decisions.find((x) => x.stepId === st.stepId)!.explanation),
          })),
          strengths: out.strengths.map(stripUrls),
          knowledgeGaps: out.knowledgeGaps.map(stripUrls),
          teachingPoints: out.teachingPoints.map(stripUrls),
          // Only topics of the approved catalogue survive, whatever the model wrote.
          recommendedTopics: [...new Set(out.recommendedTopics)].filter((t) =>
            c.catalogueTopics.includes(t),
          ),
          practiceQuestions: out.practiceQuestions.map(stripUrls),
          referenceIds: [...new Set(out.citedReferenceIds)].filter((id) => refIds.has(id)),
          modelServed: res.modelServed,
          completedAt: new Date(),
        });
        await d.save();
        return;
      }
      failure = "invalid_output";
    }
    d.set({ status: "failed", failureReason: failure, completedAt: new Date() });
    await d.save();
  }

  private async expireIfStale(d: DebriefDocument) {
    if (
      d.status === "pending" &&
      Date.now() - (d.get("createdAt") as Date).getTime() > STALE_PENDING_MS
    ) {
      d.set({ status: "failed", failureReason: "interrupted", completedAt: new Date() });
      await d.save();
    }
  }

  async get(userId: string, id: string) {
    const d = await AiDebriefModel.findOne({ _id: id, userId });
    if (!d) throw AppError.notFound("Debrief not found.");
    await this.expireIfStale(d);
    return this.toDto(d);
  }

  async listForAttempt(userId: string, attemptId: string) {
    if (!(await MissionAttemptModel.exists({ _id: attemptId, userId })))
      throw AppError.notFound("Attempt not found.");
    const items = await AiDebriefModel.find({ attemptId, userId })
      .sort({ createdAt: -1 })
      .limit(20);
    for (const d of items) await this.expireIfStale(d);
    return { items: await Promise.all(items.map((d) => this.toDto(d))) };
  }

  async flag(
    userId: string,
    id: string,
    input: {
      reason: "inaccurate" | "unsafe" | "unhelpful" | "other";
      comment?: string | undefined;
    },
  ) {
    const d = await AiDebriefModel.findOne({ _id: id, userId });
    if (!d) throw AppError.notFound("Debrief not found.");
    if (d.flags.length >= MAX_FLAGS)
      throw AppError.conflict("This debrief has already been reported.");
    d.flags.push({ userId, reason: input.reason, comment: input.comment ?? null, at: new Date() });
    await d.save();
    return { message: "Thank you. A clinician will review this debrief." };
  }

  async flagged(limit = 100) {
    const docs = await AiDebriefModel.find({ "flags.0": { $exists: true } })
      .sort({ updatedAt: -1 })
      .limit(limit);
    const items = [];
    for (const d of docs) {
      const dto = await this.toDto(d);
      for (const f of d.flags) {
        items.push({
          debriefId: dto.id,
          missionKey: d.missionKey,
          level: dto.level,
          reason: f.reason,
          comment: f.comment ?? null,
          flaggedAt: f.at.toISOString(),
          debrief: dto,
        });
      }
    }
    return { items };
  }

  async usage(range: { from: Date; to: Date }) {
    const s = await this.aiSettings();
    const all = await AiUsageLogModel.find({ createdAt: { $gte: range.from, $lt: range.to } })
      .select(
        "createdAt outcome inputTokens outputTokens cacheReadTokens cacheCreationTokens costMicroUsd latencyMs modelServed modelRequested fallback",
      )
      .lean();
    // Quota rejections never reached the provider: reported separately, not as provider calls.
    const logs = all.filter((l) => l.outcome !== "quota_rejected");
    const byDay = new Map<string, typeof logs>();
    const byModel = new Map<string, { requests: number; micro: number }>();
    for (const l of logs) {
      const day = (l.createdAt as Date).toISOString().slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), l]);
      const m = l.modelServed ?? l.modelRequested;
      const cur = byModel.get(m) ?? { requests: 0, micro: 0 };
      byModel.set(m, { requests: cur.requests + 1, micro: cur.micro + (l.costMicroUsd ?? 0) });
    }
    const p95 = (xs: number[]) => {
      if (!xs.length) return null;
      const sorted = [...xs].sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
    };
    const monthUsd = await this.monthSpendUsd();
    const count = (o: string) => logs.filter((l) => l.outcome === o).length;
    const sum = (f: (l: (typeof logs)[number]) => number | null | undefined) =>
      logs.reduce((a, l) => a + (f(l) ?? 0), 0);
    const totalMicro = sum((l) => l.costMicroUsd);
    const levels = await AiDebriefModel.aggregate<{
      _id: string;
      debriefs: number;
      completed: number;
      flagged: number;
    }>([
      { $match: { createdAt: { $gte: range.from, $lt: range.to } } },
      {
        $group: {
          _id: "$level",
          debriefs: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
          flagged: { $sum: { $cond: [{ $gt: [{ $size: "$flags" }, 0] }, 1, 0] } },
        },
      },
      { $sort: { debriefs: -1 } },
    ]);
    return {
      period: { from: range.from.toISOString(), to: range.to.toISOString() },
      provider: this.providerName,
      series: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, ls]) => ({
          day,
          requests: ls.length,
          failed: ls.filter((l) => l.outcome !== "completed" && l.outcome !== "refused").length,
          refused: ls.filter((l) => l.outcome === "refused").length,
          inputTokens: ls.reduce((a, l) => a + (l.inputTokens ?? 0), 0),
          outputTokens: ls.reduce((a, l) => a + (l.outputTokens ?? 0), 0),
          costUsd: Math.round(ls.reduce((a, l) => a + (l.costMicroUsd ?? 0), 0)) / 1e6,
          p95LatencyMs: p95(
            ls.filter((l) => l.outcome === "completed").map((l) => l.latencyMs ?? 0),
          ),
        })),
      byModel: [...byModel.entries()].map(([model, v]) => ({
        model,
        requests: v.requests,
        costUsd: v.micro / 1e6,
      })),
      totals: {
        requests: logs.length,
        completed: count("completed"),
        refused: count("refused"),
        invalidOutput: count("invalid_output"),
        providerUnavailable: count("provider_unavailable") + count("error"),
        rateLimited: count("rate_limited"),
        fallbackCalls: logs.filter((l) => l.fallback).length,
        inputTokens: sum((l) => l.inputTokens),
        outputTokens: sum((l) => l.outputTokens),
        cacheReadTokens: sum((l) => l.cacheReadTokens),
        cacheCreationTokens: sum((l) => l.cacheCreationTokens),
        costUsd: Math.round(totalMicro) / 1e6,
        costPerCompletedDebriefUsd: count("completed")
          ? Math.round(totalMicro / count("completed")) / 1e6
          : null,
      },
      byLevel: levels.map((l) => ({
        level: l._id,
        debriefs: l.debriefs,
        completed: l.completed,
        flagged: l.flagged,
      })),
      quotaRejections: all.length - logs.length,
      budget: {
        monthUsd: Math.round(monthUsd * 1e6) / 1e6,
        capUsd: s.monthlyBudgetUsd,
        percent:
          s.monthlyBudgetUsd > 0 ? Math.round((monthUsd / s.monthlyBudgetUsd) * 1000) / 10 : 100,
      },
    };
  }

  /** Links each recommended topic to published cases on it (excluding the case just played). */
  private async topicLinks(topics: string[], currentKey: string) {
    if (!topics.length) return [];
    const missions = await MissionModel.find({
      status: "published",
      topics: { $in: topics },
      key: { $ne: currentKey },
    })
      .select("key topics published.title")
      .sort({ tier: 1, sortOrder: 1 })
      .lean();
    return topics.map((topic) => ({
      topic,
      missions: missions
        .filter((m) => (m.topics ?? []).includes(topic))
        .slice(0, 3)
        .map((m) => ({ key: m.key, title: m.published?.title ?? m.key })),
    }));
  }

  async toDto(d: DebriefDocument): Promise<Debrief> {
    const refs = d.referenceIds.length
      ? await ClinicalReferenceModel.find({ _id: { $in: d.referenceIds } }).lean()
      : [];
    return {
      id: d.id as string,
      attemptId: String(d.attemptId),
      missionKey: d.missionKey,
      level: d.level as LearnerLevel,
      status: d.status as Debrief["status"],
      failureReason: (d.failureReason as Debrief["failureReason"]) ?? null,
      overall: d.overall ?? null,
      decisions: d.decisions.map((x) => ({
        stepId: x.stepId ?? "",
        prompt: x.prompt ?? "",
        chosenText: x.chosenText ?? "",
        correct: Boolean(x.correct),
        explanation: x.explanation ?? "",
      })),
      strengths: [...(d.strengths ?? [])],
      knowledgeGaps: [...(d.knowledgeGaps ?? [])],
      teachingPoints: [...d.teachingPoints],
      recommendedTopics: await this.topicLinks([...(d.recommendedTopics ?? [])], d.missionKey),
      practiceQuestions: [...d.practiceQuestions],
      references: refs.map((r) => ({
        id: String(r._id),
        title: r.title,
        organization: r.organization ?? null,
        year: r.year ?? null,
        url: r.url ?? null,
      })),
      aiGenerated: true,
      disclaimer: DEBRIEF_DISCLAIMER,
      createdAt: (d.get("createdAt") as Date).toISOString(),
      completedAt: d.completedAt ? d.completedAt.toISOString() : null,
    };
  }
}
