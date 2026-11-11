import type { Allocation, HospitalSettings } from "@ahq/api-contracts";
import { HOSPITAL_RESOURCES, type HospitalResource } from "@ahq/shared-types";

export type EventLike = {
  key: string;
  text: string;
  needs: Record<HospitalResource, number>;
  weight?: number | null;
};

/** Weighted random choice; `rand(n)` returns an integer in [0, n). */
export function pickEvent<T extends EventLike>(events: T[], rand: (n: number) => number): T {
  if (!events.length) throw new Error("no events available");
  const total = events.reduce((a, e) => a + Math.max(1, e.weight ?? 1), 0);
  let roll = rand(total);
  for (const e of events) {
    roll -= Math.max(1, e.weight ?? 1);
    if (roll < 0) return e;
  }
  return events[events.length - 1]!;
}

/**
 * Prototype rules: each resource whose allocation meets the event's need counts as covered;
 * +hpPerNeedMet HP and +fundingPerNeedMet funding per covered need; every allocated unit costs unitCost.
 * Performance metrics are informational and do not change rewards.
 */
export function simulateShift(
  allocation: Allocation,
  event: EventLike,
  settings: HospitalSettings,
) {
  const outcomes = HOSPITAL_RESOURCES.map((resource) => {
    const allocated = allocation[resource];
    const needed = event.needs[resource];
    return {
      resource,
      allocated,
      needed,
      met: allocated >= needed,
      surplus: Math.max(0, allocated - needed),
      shortfall: Math.max(0, needed - allocated),
    };
  });
  const units = outcomes.reduce((a, o) => a + o.allocated, 0);
  const useful = outcomes.reduce((a, o) => a + Math.min(o.allocated, o.needed), 0);
  const needsMet = outcomes.filter((o) => o.met).length;
  const cost = units * settings.unitCost;
  const rewards = {
    hp: needsMet * settings.hpPerNeedMet,
    funding: needsMet * settings.fundingPerNeedMet,
  };
  return {
    outcomes,
    needsMet,
    cost,
    rewards,
    netFundingChange: rewards.funding - cost,
    performance: {
      coveragePercent: Math.round((needsMet / HOSPITAL_RESOURCES.length) * 100),
      efficiencyPercent: units ? Math.round((useful / units) * 100) : 0,
      wastedUnits: outcomes.reduce((a, o) => a + o.surplus, 0),
      rating: (needsMet === 4
        ? "excellent"
        : needsMet === 3
          ? "good"
          : needsMet === 2
            ? "fair"
            : "poor") as "excellent" | "good" | "fair" | "poor",
    },
    /** Exact prototype result line. */
    summary: `${event.text} You covered ${needsMet}/4 needs. +${rewards.hp} HP.`,
  };
}
