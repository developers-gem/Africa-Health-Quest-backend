import type { Progress } from "@ahq/api-contracts";
import { metricFor, type Criterion, type StatKey } from "./domain/progression.js";
import { AchievementModel, type ProgressDocument } from "./player.models.js";

type CatalogueEntry = Awaited<ReturnType<typeof listCatalogue>>[number];

export function listCatalogue(includeRetired = false) {
  return AchievementModel.find(includeRetired ? {} : { status: "active" })
    .sort({ sortOrder: 1, key: 1 })
    .lean();
}

export function toAchievementDto(a: CatalogueEntry) {
  return {
    key: a.key,
    name: a.name,
    description: a.description,
    icon: a.icon,
    criterion: a.criterion as Criterion,
    threshold: a.threshold,
    rewards: { hp: a.rewards?.hp ?? 0, funding: a.rewards?.funding ?? 0 },
  };
}

export async function playerAchievements(p: ProgressDocument) {
  const earnedAt = new Map((p.achievements ?? [] as any).map((a) => [a.key!, a.earnedAt!]));
  const catalogue = await listCatalogue(true);
  const source = {
    tierIndex: p.tierIndex,
    unlockedCountryCodes: p.unlockedCountryCodes ?? [],
    stats: (p.stats ?? {}) as Partial<Record<StatKey, number>>,
  };
  return {
    earned: catalogue
      .filter((a) => earnedAt.has(a.key))
      .map((a) => ({ ...toAchievementDto(a), earnedAt: earnedAt.get(a.key as any)!.toISOString() })),
    available: catalogue
      .filter((a) => a.status === "active" && !earnedAt.has(a.key))
      .map((a) => ({
        ...toAchievementDto(a),
        current: Math.min(metricFor(a.criterion as Criterion, source), a.threshold),
      })),
  };
}

export function statsFrom(dto: Progress) {
  const c = dto.stats;
  return {
    counters: c,
    accuracy: c.answersTotal ? Math.round((c.correctAnswers / c.answersTotal) * 1000) / 1000 : null,
    missionsPassed: Object.values(dto.missions).filter((m) => m.passed).length,
    countriesUnlocked: dto.unlockedCountryCodes.length,
    achievementsEarned: dto.achievements.length,
    tier: dto.tier,
  };
}
