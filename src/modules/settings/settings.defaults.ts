import type { EconomySettings, ProgressionSettings } from "@ahq/api-contracts";
import { PROTOTYPE_TIERS } from "@ahq/game-content";

/**
 * Defaults = prototype rules + the audit's recommended answers to Q1, Q2, Q5, Q8 and decision A-6.
 * Prototype differences are noted inline; the owner can change any value through the admin settings API.
 */
export const DEFAULT_ECONOMY: EconomySettings = {
  pointsPerCorrectStep: 25,
  passThreshold: 0.5,
  criticalChoiceFails: true, // Q5
  startingHp: 0,
  startingFunding: 100,
  firstPassHpFactor: 1,
  firstPassFundingFactor: 0.5,
  completionRequiresPass: true, // Q2 (prototype marked failed missions done)
  replayHpFactor: 0.3,
  replayHpBasis: "improvement", // Q8 (prototype: 30 % of the full score)
  replayFundingFactor: 0, // Q8 (prototype: score / 2 on every replay)
  practiceAwardsRewards: false, // Q1 (prototype awarded HP/funding in Clinical Challenge)
  shuffleChoices: true, // A-6
};

export const DEFAULT_PROGRESSION: ProgressionSettings = {
  tiers: PROTOTYPE_TIERS.map((t) => ({
    index: t.index,
    key: t.key,
    name: t.name,
    icon: t.icon,
    hpRequired: t.hpRequired,
  })),
};
