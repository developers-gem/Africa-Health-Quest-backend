import type { EconomySettings } from "@ahq/api-contracts";
import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import { describe, expect, it } from "vitest";
import {
  evaluateAnswer,
  rewardsFor,
  scoreAttempt,
  shuffle,
} from "../../src/modules/gameplay/domain/scoring.js";
import { DEFAULT_ECONOMY } from "../../src/modules/settings/settings.defaults.js";

/** The prototype's exact rules, expressed as economy settings. */
const PROTOTYPE: EconomySettings = {
  ...DEFAULT_ECONOMY,
  criticalChoiceFails: false,
  completionRequiresPass: false,
  replayHpBasis: "score",
  replayFundingFactor: 0.5,
  practiceAwardsRewards: true,
};
const fresh = { attempts: 0, bestScore: 0, passed: false };

/** Prototype reference implementation (src/routes/index.tsx), used as the oracle. */
function prototypeOutcome(stepsCorrect: boolean[], first: boolean) {
  const score = stepsCorrect.filter(Boolean).length * 25;
  const max = stepsCorrect.length * 25;
  return {
    score,
    saved: score >= max * 0.5,
    hp: Math.round(score * (first ? 1 : 0.3)),
    funding: Math.round(score / 2),
  };
}

describe("scoring — golden tests against the prototype for every mission", () => {
  for (const m of PROTOTYPE_MISSIONS) {
    const patterns = [
      m.steps.map(() => true),
      m.steps.map(() => false),
      m.steps.map((_, i) => i === 0),
    ];
    for (const pattern of patterns) {
      it(`${m.key}: ${pattern.map((c) => (c ? "✓" : "✗")).join("")}`, () => {
        const answers = m.steps.map((s, i) => ({
          stepId: s.stepId,
          choiceId:
            s.choices.find((c) => c.correct === pattern[i])?.choiceId ?? s.choices[0]!.choiceId,
        }));
        const scored = scoreAttempt(m.steps, answers, PROTOTYPE);
        for (const first of [true, false]) {
          const oracle = prototypeOutcome(pattern, first);
          const reward = rewardsFor(
            {
              mode: "story",
              score: scored.score,
              passed: scored.passed,
              prior: first ? fresh : { attempts: 1, bestScore: 0, passed: true },
            },
            PROTOTYPE,
          );
          expect(scored.score).toBe(oracle.score);
          expect(scored.passed).toBe(oracle.saved);
          expect(reward.hp).toBe(oracle.hp);
          expect(reward.funding).toBe(oracle.funding);
        }
      });
    }
  }
});

describe("rewards — approved defaults (Q1, Q2, Q5, Q8)", () => {
  it("first pass pays full score in HP and score/2 funding", () => {
    expect(
      rewardsFor({ mode: "story", score: 50, passed: true, prior: fresh }, DEFAULT_ECONOMY),
    ).toEqual({ hp: 50, funding: 25, firstCompletion: true });
  });

  it("failing before the first pass awards nothing and keeps the full reward available (Q2)", () => {
    expect(
      rewardsFor({ mode: "story", score: 0, passed: false, prior: fresh }, DEFAULT_ECONOMY),
    ).toEqual({ hp: 0, funding: 0, firstCompletion: false });
    expect(
      rewardsFor(
        {
          mode: "story",
          score: 50,
          passed: true,
          prior: { attempts: 1, bestScore: 0, passed: false },
        },
        DEFAULT_ECONOMY,
      ),
    ).toMatchObject({ hp: 50, firstCompletion: true });
  });

  it("replays pay 30 % of the improvement and no funding (Q8)", () => {
    const prior = { attempts: 2, bestScore: 25, passed: true };
    expect(rewardsFor({ mode: "story", score: 50, passed: true, prior }, DEFAULT_ECONOMY)).toEqual({
      hp: 8,
      funding: 0,
      firstCompletion: false,
    });
    expect(rewardsFor({ mode: "story", score: 25, passed: true, prior }, DEFAULT_ECONOMY)).toEqual({
      hp: 0,
      funding: 0,
      firstCompletion: false,
    });
  });

  it("practice (Clinical Challenge) never pays (Q1)", () => {
    expect(
      rewardsFor({ mode: "practice", score: 50, passed: true, prior: fresh }, DEFAULT_ECONOMY),
    ).toEqual({ hp: 0, funding: 0, firstCompletion: false });
  });

  it("a critical error fails the case regardless of score (Q5)", () => {
    const steps = [
      {
        stepId: "s1",
        choices: [
          { choiceId: "s1c1", correct: true },
          { choiceId: "s1c2", correct: false, critical: true },
        ],
      },
      {
        stepId: "s2",
        choices: [
          { choiceId: "s2c1", correct: true },
          { choiceId: "s2c2", correct: false },
        ],
      },
    ];
    const r = scoreAttempt(
      steps,
      [
        { stepId: "s1", choiceId: "s1c2" },
        { stepId: "s2", choiceId: "s2c1" },
      ],
      DEFAULT_ECONOMY,
    );
    expect(r).toMatchObject({ score: 25, criticalError: true, passed: false });
    expect(
      scoreAttempt(
        steps,
        [
          { stepId: "s1", choiceId: "s1c2" },
          { stepId: "s2", choiceId: "s2c1" },
        ],
        PROTOTYPE,
      ).passed,
    ).toBe(true);
  });

  it("evaluates unknown choices as invalid", () => {
    expect(
      evaluateAnswer({ stepId: "s1", choices: [{ choiceId: "s1c1", correct: true }] }, "s9c9"),
    ).toBeNull();
  });
});

describe("shuffle", () => {
  it("is a permutation and is not always the identity", () => {
    const ids = ["a", "b", "c", "d"];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = shuffle(ids);
      expect([...s].sort()).toEqual(ids);
      seen.add(s.join(""));
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});
