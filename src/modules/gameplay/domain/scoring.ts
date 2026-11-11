import type { EconomySettings } from "@ahq/api-contracts";
import { randomInt } from "node:crypto";

export type StepKey = {
  stepId: string;
  choices: { choiceId: string; correct: boolean; critical?: boolean | null }[];
};
export type GivenAnswer = { stepId: string; choiceId: string };

/** Evaluates a single answer against the server-side answer key. */
export function evaluateAnswer(step: StepKey, choiceId: string) {
  const chosen = step.choices.find((c) => c.choiceId === choiceId);
  if (!chosen) return null;
  const correctChoice = step.choices.find((c) => c.correct)!;
  return {
    correct: chosen.correct,
    critical: Boolean(chosen.critical) && !chosen.correct,
    correctChoiceId: correctChoice.choiceId,
  };
}

/** Scores a completed attempt: +pointsPerCorrectStep per correct step; pass at ≥ passThreshold unless a critical error. */
export function scoreAttempt(steps: StepKey[], answers: GivenAnswer[], economy: EconomySettings) {
  let correctCount = 0;
  let criticalError = false;
  for (const a of answers) {
    const step = steps.find((s) => s.stepId === a.stepId);
    const r = step ? evaluateAnswer(step, a.choiceId) : null;
    if (r?.correct) correctCount++;
    if (r?.critical) criticalError = true;
  }
  const maxScore = steps.length * economy.pointsPerCorrectStep;
  const score = correctCount * economy.pointsPerCorrectStep;
  const passed =
    score >= economy.passThreshold * maxScore && !(economy.criticalChoiceFails && criticalError);
  return { score, maxScore, correctCount, criticalError, passed };
}

export type PriorRecord = { attempts: number; bestScore: number; passed: boolean };

/**
 * Rewards for a finished attempt. Prototype rules (completionRequiresPass=false, replayHpBasis="score",
 * replayFundingFactor=0.5): first completion pays score HP + score/2 funding; replays pay 30 % HP and score/2 funding.
 * Approved defaults: only a pass counts as completion (failing first costs nothing), replays pay 30 % of the
 * improvement over the best score and no funding; practice pays nothing. JS Math.round matches the prototype.
 */
export function rewardsFor(
  input: { mode: "story" | "practice"; score: number; passed: boolean; prior: PriorRecord },
  economy: EconomySettings,
) {
  const none = { hp: 0, funding: 0, firstCompletion: false };
  if (input.mode === "practice" && !economy.practiceAwardsRewards) return none;
  const { prior, score } = input;
  const alreadyCompleted = economy.completionRequiresPass ? prior.passed : prior.attempts > 0;
  const completesNow = economy.completionRequiresPass ? input.passed : true;
  if (!alreadyCompleted) {
    if (!completesNow) return none;
    return {
      hp: Math.round(score * economy.firstPassHpFactor),
      funding: Math.round(score * economy.firstPassFundingFactor),
      firstCompletion: true,
    };
  }
  const basis =
    economy.replayHpBasis === "improvement" ? Math.max(0, score - prior.bestScore) : score;
  return {
    hp: Math.round(basis * economy.replayHpFactor),
    funding: Math.round(
      (economy.replayHpBasis === "improvement" ? basis : score) * economy.replayFundingFactor,
    ),
    firstCompletion: false,
  };
}

/** Unbiased Fisher–Yates shuffle using the CSPRNG. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
