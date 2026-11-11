import type { Progress, Tier } from "@ahq/api-contracts";
import mongoose, { type ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import type { CountriesService } from "../countries/countries.service.js";
import type { SettingsService } from "../settings/settings.service.js";
import {
  STAT_KEYS,
  metricFor,
  tierFor,
  type Criterion,
  type StatKey,
} from "./domain/progression.js";
import {
  AchievementModel,
  PlayerProgressModel,
  ProgressLedgerModel,
  type LedgerSource,
  type ProgressDocument,
} from "./player.models.js";

export type ProgressChange = {
  source: LedgerSource;
  sourceId: string;
  hp: number;
  funding: number;
  economyVersion?: number;
  note?: string;
  /** Funding that must be available before the change (gross cost), checked atomically. */
  minFundingBefore?: number;
  mission?: {
    key: string;
    score: number;
    maxScore: number;
    passed: boolean;
    mode: "story" | "practice";
  };
  stats?: Partial<Record<StatKey, number>>;
};

export type ApplyResult = {
  progress: ProgressDocument;
  delta: { hp: number; funding: number };
  newlyUnlocked: { tiers: Tier[]; countries: string[] };
  achievements: { key: string; name: string; rewards: { hp: number; funding: number } }[];
};

export class DuplicateChangeError extends AppError {
  constructor() {
    super(409, "CONFLICT", "This change has already been applied.");
  }
}

/** Server-authoritative progress. The only writer of HP, funding, tiers, unlocks and achievements. */
export class ProgressService {
  /** Called inside the same transaction when a change earns achievements or unlocks (e.g. notifications). */
  onAwarded?: (userId: string, result: ApplyResult, session: ClientSession) => Promise<void>;

  constructor(
    private readonly settings: SettingsService,
    private readonly countries: CountriesService,
  ) {}

  async get(userId: string, session?: ClientSession): Promise<ProgressDocument> {
    const existing = await PlayerProgressModel.findOne({ userId }, null, { session });
    if (existing) return existing;
    const [{ value: economy }, { value: progression }] = await Promise.all([
      this.settings.get("economy"),
      this.settings.get("progression"),
    ]);
    // Derived state is correct from the start (e.g. 0-HP countries are unlocked immediately).
    const tierIndex = tierFor(economy.startingHp, progression.tiers).tier.index;
    const unlockedCountryCodes = await this.countries.unlockedCodes({
      hp: economy.startingHp,
      tierIndex,
    });
    try {
      return (await PlayerProgressModel.findOneAndUpdate(
        { userId },
        {
          $setOnInsert: {
            userId,
            hp: economy.startingHp,
            funding: economy.startingFunding,
            tierIndex,
            unlockedCountryCodes,
            version: 0,
          },
        },
        { upsert: true, new: true, session, setDefaultsOnInsert: true },
      ))!;
    } catch (e) {
      if ((e as { code?: number }).code === 11000)
        return (await PlayerProgressModel.findOne({ userId }, null, { session }))!;
      throw e;
    }
  }

  async toDto(p: ProgressDocument): Promise<Progress> {
    const { value: progression } = await this.settings.get("progression");
    const t = tierFor(p.hp, progression.tiers);
    const missions: Progress["missions"] = {};
    for (const [key, m] of p.missions ?? new Map()) {
      missions[key] = {
        bestScore: m.bestScore ?? 0,
        maxScore: m.maxScore ?? 0,
        attempts: m.attempts ?? 0,
        passed: Boolean(m.passed),
        firstPassedAt: m.firstPassedAt ? m.firstPassedAt.toISOString() : null,
        lastPlayedAt: m.lastPlayedAt ? m.lastPlayedAt.toISOString() : null,
        practiceAttempts: m.practiceAttempts ?? 0,
      };
    }
    const stats = Object.fromEntries(
      STAT_KEYS.map((k) => [k, (p.stats as Record<string, number> | undefined)?.[k] ?? 0]),
    );
    return {
      hp: p.hp,
      funding: p.funding,
      tier: t.tier,
      nextTier: t.nextTier,
      hpToNextTier: t.hpToNextTier,
      // Computed live so admin changes to unlock requirements are reflected immediately.
      unlockedCountryCodes: await this.countries.unlockedCodes({
        hp: p.hp,
        tierIndex: t.tier.index,
      }),
      missions,
      achievements: (p.achievements ?? []).map((a) => ({
        key: a.key!,
        earnedAt: a.earnedAt!.toISOString(),
      })),
      stats: stats as Progress["stats"],
      version: p.version,
      updatedAt: (p.get("updatedAt") as Date).toISOString(),
    };
  }

  /**
   * Applies a change atomically: progress counters, ledger entry (unique per source → no double rewards),
   * derived hospital level and country unlocks, and newly earned achievements (with their own ledger entries).
   * Joins the caller's transaction when `session` is given; otherwise runs its own.
   */
  async applyChange(
    userId: string,
    change: ProgressChange,
    session?: ClientSession,
  ): Promise<ApplyResult> {
    if (session) return this.applyInSession(userId, change, session);
    const own = await mongoose.startSession();
    try {
      let result!: ApplyResult;
      await own.withTransaction(async (s) => {
        result = await this.applyInSession(userId, change, s);
      });
      return result;
    } finally {
      await own.endSession();
    }
  }

  private async applyInSession(
    userId: string,
    change: ProgressChange,
    session: ClientSession,
  ): Promise<ApplyResult> {
    const before = await this.get(userId, session);
    const { value: progression } = await this.settings.get("progression");
    const tierBefore = tierFor(before.hp, progression.tiers).tier.index;
    const unlockedBefore = new Set(before.unlockedCountryCodes ?? []);

    let progress = await this.incrementAndRecord(userId, change, session);
    const achievements: ApplyResult["achievements"] = [];
    let totalHp = change.hp;
    let totalFunding = change.funding;

    // Derived state, then achievements (whose rewards can change derived state once more).
    for (let pass = 0; pass < 2; pass++) {
      progress = await this.syncDerived(progress, progression.tiers, session);
      const earned = await this.awardAchievements(progress, session);
      if (!earned.length) break;
      achievements.push(...earned.map((e) => ({ key: e.key, name: e.name, rewards: e.rewards })));
      const hp = earned.reduce((a, e) => a + e.rewards.hp, 0);
      const funding = earned.reduce((a, e) => a + e.rewards.funding, 0);
      totalHp += hp;
      totalFunding += funding;
      progress = (await PlayerProgressModel.findOne({ userId }, null, { session }))!;
    }

    const tiersUnlocked = progression.tiers.filter(
      (t) => t.index > tierBefore && t.index <= progress.tierIndex,
    );
    const countriesUnlocked = (progress.unlockedCountryCodes ?? []).filter(
      (c) => !unlockedBefore.has(c),
    );
    const result: ApplyResult = {
      progress,
      delta: { hp: totalHp, funding: totalFunding },
      newlyUnlocked: { tiers: tiersUnlocked, countries: countriesUnlocked },
      achievements,
    };
    if (
      this.onAwarded &&
      (achievements.length || tiersUnlocked.length || countriesUnlocked.length)
    ) {
      await this.onAwarded(userId, result, session);
    }
    return result;
  }

  private async incrementAndRecord(userId: string, change: ProgressChange, session: ClientSession) {
    const now = new Date();
    const inc: Record<string, number> = { hp: change.hp, funding: change.funding, version: 1 };
    for (const [k, v] of Object.entries(change.stats ?? {})) if (v) inc[`stats.${k}`] = v;
    const set: Record<string, unknown> = {};
    const max: Record<string, unknown> = {};
    const min: Record<string, unknown> = {};
    if (change.mission) {
      const m = `missions.${change.mission.key}`;
      inc[change.mission.mode === "practice" ? `${m}.practiceAttempts` : `${m}.attempts`] = 1;
      set[`${m}.lastPlayedAt`] = now;
      if (change.mission.mode === "story") {
        max[`${m}.bestScore`] = change.mission.score;
        max[`${m}.maxScore`] = change.mission.maxScore;
        if (change.mission.passed) {
          set[`${m}.passed`] = true;
          min[`${m}.firstPassedAt`] = now;
        }
      }
    }
    const filter: Record<string, unknown> = { userId };
    const fundingNeeded = Math.max(change.minFundingBefore ?? 0, -change.funding);
    if (fundingNeeded > 0) filter.funding = { $gte: fundingNeeded };
    if (change.hp < 0) filter.hp = { $gte: -change.hp };
    const updated = await PlayerProgressModel.findOneAndUpdate(
      filter,
      {
        $inc: inc,
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(max).length ? { $max: max } : {}),
        ...(Object.keys(min).length ? { $min: min } : {}),
      },
      { new: true, session },
    );
    if (!updated) {
      if (fundingNeeded > 0)
        throw new AppError(409, "INSUFFICIENT_FUNDS", "Not enough funding for this action.");
      throw AppError.conflict("Not enough Health Points for this adjustment.");
    }
    await this.writeLedger(userId, change, updated, session);
    return updated;
  }

  private async writeLedger(
    userId: string,
    change: Pick<
      ProgressChange,
      "source" | "sourceId" | "hp" | "funding" | "economyVersion" | "note"
    >,
    after: ProgressDocument,
    session: ClientSession,
  ) {
    try {
      await ProgressLedgerModel.create(
        [
          {
            userId,
            source: change.source,
            sourceId: change.sourceId,
            delta: { hp: change.hp, funding: change.funding },
            balanceAfter: { hp: after.hp, funding: after.funding },
            economyVersion: change.economyVersion,
            note: change.note,
          },
        ],
        { session },
      );
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new DuplicateChangeError();
      throw e;
    }
  }

  private async syncDerived(p: ProgressDocument, tiers: readonly Tier[], session: ClientSession) {
    const tierIndex = tierFor(p.hp, tiers).tier.index;
    const unlocked = await this.countries.unlockedCodes({ hp: p.hp, tierIndex });
    const same =
      tierIndex === p.tierIndex &&
      unlocked.length === (p.unlockedCountryCodes ?? []).length &&
      unlocked.every((c) => p.unlockedCountryCodes!.includes(c));
    if (same) return p;
    return (await PlayerProgressModel.findOneAndUpdate(
      { _id: p._id },
      { $set: { tierIndex, unlockedCountryCodes: unlocked } },
      { new: true, session },
    ))!;
  }

  private async awardAchievements(p: ProgressDocument, session: ClientSession) {
    const have = new Set((p.achievements ?? []).map((a) => a.key));
    const catalogue = await AchievementModel.find({ status: "active" }, null, { session }).lean();
    const earned = catalogue.filter(
      (a) =>
        !have.has(a.key) &&
        metricFor(a.criterion as Criterion, {
          tierIndex: p.tierIndex,
          unlockedCountryCodes: p.unlockedCountryCodes ?? [],
          stats: (p.stats ?? {}) as Partial<Record<StatKey, number>>,
        }) >= a.threshold,
    );
    const out: { key: string; name: string; rewards: { hp: number; funding: number } }[] = [];
    for (const a of earned) {
      const rewards = { hp: a.rewards?.hp ?? 0, funding: a.rewards?.funding ?? 0 };
      const updated = await PlayerProgressModel.findOneAndUpdate(
        { _id: p._id, "achievements.key": { $ne: a.key } },
        {
          $push: { achievements: { key: a.key, earnedAt: new Date() } },
          $inc: { hp: rewards.hp, funding: rewards.funding, version: 1 },
        },
        { new: true, session },
      );
      if (!updated) continue;
      await this.writeLedger(
        p.userId.toString(),
        {
          source: "achievement",
          sourceId: a._id.toString(),
          hp: rewards.hp,
          funding: rewards.funding,
          note: a.key,
        },
        updated,
        session,
      );
      out.push({ key: a.key, name: a.name, rewards });
    }
    return out;
  }

  async ledger(userId: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      ProgressLedgerModel.find({ userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      ProgressLedgerModel.countDocuments({ userId }),
    ]);
    return {
      items: items.map((l) => ({
        id: l._id.toString(),
        source: l.source as LedgerSource,
        sourceId: l.sourceId,
        delta: { hp: l.delta!.hp, funding: l.delta!.funding },
        balanceAfter: { hp: l.balanceAfter!.hp, funding: l.balanceAfter!.funding },
        createdAt: (l.createdAt as Date).toISOString(),
      })),
      total,
    };
  }
}
