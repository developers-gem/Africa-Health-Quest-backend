import type { Tier } from "@ahq/api-contracts";

/** Hospital level: the highest tier whose HP requirement is met. Tiers are validated to be ascending. */
export function tierFor(hp: number, tiers: readonly Tier[]) {
  let current = tiers[0]!;
  for (const t of tiers) if (hp >= t.hpRequired) current = t;
  const next = tiers[current.index + 1] ?? null;
  return {
    tier: current,
    nextTier: next,
    hpToNextTier: next ? Math.max(0, next.hpRequired - hp) : null,
  };
}

export const STAT_KEYS = [
  "storyCompleted",
  "storyPassed",
  "practiceCompleted",
  "perfectScores",
  "correctAnswers",
  "answersTotal",
  "shiftsRun",
  "needsMet",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

export type MetricSource = {
  tierIndex: number;
  unlockedCountryCodes: readonly string[];
  stats: Partial<Record<StatKey, number>>;
};

export type Criterion =
  | "missions_passed"
  | "perfect_scores"
  | "countries_unlocked"
  | "tier_reached"
  | "shifts_run"
  | "correct_answers";

/** Current value of an achievement criterion for a player. */
export function metricFor(criterion: Criterion, p: MetricSource): number {
  switch (criterion) {
    case "missions_passed":
      return p.stats.storyPassed ?? 0;
    case "perfect_scores":
      return p.stats.perfectScores ?? 0;
    case "countries_unlocked":
      return p.unlockedCountryCodes.length;
    case "tier_reached":
      return p.tierIndex;
    case "shifts_run":
      return p.stats.shiftsRun ?? 0;
    case "correct_answers":
      return p.stats.correctAnswers ?? 0;
  }
}
