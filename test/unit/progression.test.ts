import { describe, expect, it } from "vitest";
import { ProgressionSettingsSchema } from "@ahq/api-contracts";
import { metricFor, tierFor } from "../../src/modules/players/domain/progression.js";
import { DEFAULT_PROGRESSION } from "../../src/modules/settings/settings.defaults.js";

const tiers = DEFAULT_PROGRESSION.tiers;

describe("hospital level (tiers)", () => {
  it("uses the prototype thresholds 0 / 150 / 400 / 800", () => {
    expect(tiers.map((t) => [t.name, t.hpRequired])).toEqual([
      ["Village Clinic", 0],
      ["Community Hospital", 150],
      ["Regional Medical Center", 400],
      ["National Health System", 800],
    ]);
  });

  it.each([
    [0, "Village Clinic", 150],
    [149, "Village Clinic", 1],
    [150, "Community Hospital", 250],
    [799, "Regional Medical Center", 1],
    [800, "National Health System", null],
    [99_999, "National Health System", null],
  ])("hp %i → %s (HP to next: %s)", (hp, name, toNext) => {
    const r = tierFor(hp, tiers);
    expect(r.tier.name).toBe(name);
    expect(r.hpToNextTier).toBe(toNext);
  });

  it("rejects invalid tier configurations", () => {
    const bad = (t: unknown) => ProgressionSettingsSchema.safeParse({ tiers: t }).success;
    expect(bad(tiers)).toBe(true);
    expect(bad([{ ...tiers[0]!, hpRequired: 10 }])).toBe(false);
    expect(bad([tiers[0], { ...tiers[1]!, hpRequired: 0 }])).toBe(false);
    expect(bad([tiers[1]])).toBe(false);
  });
});

describe("achievement metrics", () => {
  const source = {
    tierIndex: 2,
    unlockedCountryCodes: ["NG", "GH", "KE"],
    stats: { storyPassed: 4, perfectScores: 1, shiftsRun: 7, correctAnswers: 12 },
  };
  it.each([
    ["missions_passed", 4],
    ["perfect_scores", 1],
    ["countries_unlocked", 3],
    ["tier_reached", 2],
    ["shifts_run", 7],
    ["correct_answers", 12],
  ] as const)("%s → %i", (criterion, value) => {
    expect(metricFor(criterion, source)).toBe(value);
  });
});
