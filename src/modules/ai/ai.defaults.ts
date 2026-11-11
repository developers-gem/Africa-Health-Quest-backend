import type { AiSettings } from "@ahq/api-contracts";

/**
 * Defaults from the AI architecture (§5, §7). The monthly budget is a placeholder the owner must set (decision AI-4);
 * prices are the Anthropic list prices as of 2026-10 and should be checked against the live price list.
 */
export const DEFAULT_AI: AiSettings = {
  enabled: true,
  model: "claude-opus-5-5",
  effort: "medium",
  refusalFallback: true,
  dailyQuotaRegistered: 10,
  dailyQuotaGuest: 3,
  monthlyBudgetUsd: 200,
  burstPerMinute: 3,
  fallbackModel: null,
  prices: {
    "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2 },
    "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2 },
    "claude-haiku-5-5": { inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01 },
  },
};
