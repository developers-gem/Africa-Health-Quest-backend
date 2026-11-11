import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "@ahq/api-contracts";
import type { AiSettings } from "@ahq/api-contracts";
import { DEBRIEF_SYSTEM_PROMPT, type DebriefCase, buildDebriefMessage } from "./prompts/debrief.js";

/** Response format sent to the model. Length limits are enforced afterwards by DebriefOutputSchema. */
const DebriefFormat = z.object({
  overall: z.string(),
  decisions: z.array(z.object({ stepId: z.string(), explanation: z.string() })),
  strengths: z.array(z.string()),
  knowledgeGaps: z.array(z.string()),
  teachingPoints: z.array(z.string()),
  recommendedTopics: z.array(z.string()),
  practiceQuestions: z.array(z.string()),
  citedReferenceIds: z.array(z.string()),
});

export type GenerationResult = {
  /** The model's JSON (unvalidated), or null when there was no parseable text. */
  output: unknown;
  stopReason: string | null;
  modelServed: string;
  usage: { input: number; output: number; cacheCreation: number; cacheRead: number };
  requestId: string | null;
  latencyMs: number;
};

/** Thrown when the provider could not be reached or kept failing after retries (not counted against quota). */
export class ProviderUnavailableError extends Error {}
/** The provider's rate limit (HTTP 429) was still hit after the SDK's retries. */
export class ProviderRateLimitedError extends ProviderUnavailableError {}

/** Generation options for one call; `model` overrides the configured model (used for the fallback model). */
export type GenerateOptions = { model?: string };

export interface ClaudeClient {
  readonly name: "anthropic" | "fake";
  generateDebrief(
    c: DebriefCase,
    settings: AiSettings,
    opts?: GenerateOptions,
  ): Promise<GenerationResult>;
}

export class AnthropicClaudeClient implements ClaudeClient {
  readonly name = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string, opts: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    this.client = new Anthropic({
      apiKey,
      timeout: 90_000,
      maxRetries: opts.maxRetries ?? 2,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
    });
  }

  async generateDebrief(
    c: DebriefCase,
    settings: AiSettings,
    opts: GenerateOptions = {},
  ): Promise<GenerationResult> {
    const started = Date.now();
    try {
      const res = await this.client.beta.messages.parse({
        model: opts.model ?? settings.model,
        max_tokens: 16_000,
        ...(settings.refusalFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        system: [
          { type: "text", text: DEBRIEF_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: buildDebriefMessage(c) }],
        output_config: { effort: settings.effort, format: zodOutputFormat(DebriefFormat) },
      });
      const text = res.content.find((b) => b.type === "text");
      let output: unknown = null;
      if (res.stop_reason === "end_turn" && text && text.type === "text") {
        try {
          output = JSON.parse(text.text);
        } catch {
          output = null;
        }
      }
      return {
        output,
        stopReason: res.stop_reason ?? null,
        modelServed: res.model,
        usage: {
          input: res.usage.input_tokens,
          output: res.usage.output_tokens,
          cacheCreation: res.usage.cache_creation_input_tokens ?? 0,
          cacheRead: res.usage.cache_read_input_tokens ?? 0,
        },
        requestId: (res as { _request_id?: string | null })._request_id ?? null,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      // The SDK already retried 408/409/429/5xx and connection errors twice.
      if (err instanceof Anthropic.RateLimitError) throw new ProviderRateLimitedError(err.message);
      if (
        err instanceof Anthropic.InternalServerError ||
        err instanceof Anthropic.APIConnectionError
      ) {
        throw new ProviderUnavailableError(err.message);
      }
      throw err;
    }
  }
}

/**
 * Deterministic, schema-valid output for local development and automated tests. Clearly labelled so it can never
 * be mistaken for real feedback; refused in production by configuration validation.
 */
export class FakeClaudeClient implements ClaudeClient {
  readonly name = "fake" as const;
  calls = 0;
  /** Tests can force behaviour: "refusal", "invalid", "unavailable", "rate_limited", "uncovered", "off_list". */
  mode: "ok" | "refusal" | "invalid" | "unavailable" | "rate_limited" | "uncovered" | "off_list" =
    "ok";
  /** Models that fail as unavailable (to exercise the fallback model). */
  unavailableModels = new Set<string>();
  /** Every case sent, for assertions on what the model would see. */
  readonly seen: { c: DebriefCase; model: string }[] = [];

  async generateDebrief(
    c: DebriefCase,
    settings: AiSettings,
    opts: GenerateOptions = {},
  ): Promise<GenerationResult> {
    this.calls++;
    const model = opts.model ?? settings.model;
    this.seen.push({ c, model });
    if (this.mode === "unavailable" || this.unavailableModels.has(model))
      throw new ProviderUnavailableError("fake provider unavailable");
    if (this.mode === "rate_limited") throw new ProviderRateLimitedError("fake rate limit");
    const base = {
      modelServed: model,
      usage: { input: 1200, output: 600, cacheCreation: 0, cacheRead: 0 },
      requestId: `fake_${this.calls}`,
      latencyMs: 5,
    };
    if (this.mode === "refusal") return { ...base, output: null, stopReason: "refusal" };
    if (this.mode === "invalid") return { ...base, output: { overall: 1 }, stopReason: "end_turn" };
    const correct = c.steps.filter((s) => s.matched).length;
    return {
      ...base,
      stopReason: "end_turn",
      output: {
        overall: `[Test output — not generated by AI] You matched ${correct} of ${c.steps.length} official answers in "${c.title}".`,
        decisions: (this.mode === "uncovered" ? c.steps.slice(1) : c.steps).map((s) => ({
          stepId: s.stepId,
          explanation: `[Test output] The official answer was "${s.officialAnswer}". ${s.officialFeedback}`,
        })),
        strengths:
          correct > 0
            ? [`[Test output] You matched ${correct} official answer(s).`]
            : ["[Test output] You completed the whole case."],
        knowledgeGaps: c.steps
          .filter((s) => !s.matched)
          .slice(0, 3)
          .map((s) => `[Test output] Revisit: ${s.prompt}`),
        teachingPoints: [
          "[Test output] Review the official feedback for each step.",
          "[Test output] Check danger signs early.",
          "[Test output] Follow your national guidelines.",
        ],
        practiceQuestions: [
          "[Test output] What was the key first step?",
          "[Test output] Which signs need referral?",
        ],
        recommendedTopics:
          this.mode === "off_list"
            ? ["Invented topic", ...c.catalogueTopics.slice(0, 1)]
            : c.catalogueTopics.slice(0, 2),
        citedReferenceIds: c.references.map((r) => r.id).concat(["000000000000000000000bad"]),
      },
    };
  }
}
