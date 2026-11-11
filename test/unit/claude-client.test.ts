import { DEFAULT_AI } from "../../src/modules/ai/ai.defaults.js";
import { describe, expect, it } from "vitest";
import {
  AnthropicClaudeClient,
  ProviderRateLimitedError,
  ProviderUnavailableError,
} from "../../src/modules/ai/claude-client.js";
import { DEBRIEF_SYSTEM_PROMPT, type DebriefCase } from "../../src/modules/ai/prompts/debrief.js";

const CASE: DebriefCase = {
  level: "medical_student",
  levelLabel: "Medical student",
  learningObjectives: ["Test before treating"],
  history: { casesCompleted: 0, casesPassed: 0, weakTopics: [], strongTopics: [] },
  catalogueTopics: ["malaria"],
  title: "Fever in the Rainy Season",
  story: "A child with fever.",
  steps: [
    {
      stepId: "s1",
      prompt: "First step?",
      officialAnswer: "Test",
      officialFeedback: "Correct.",
      chosen: "Wait",
      matched: false,
      reasoning: "viral",
    },
  ],
  references: [{ id: "r1", label: "WHO 2024" }],
};
const OUTPUT = {
  overall: "Good effort.",
  decisions: [{ stepId: "s1", explanation: "Test first." }],
  strengths: ["Finished the case"],
  knowledgeGaps: ["Testing before treating"],
  teachingPoints: ["a", "b", "c"],
  recommendedTopics: ["malaria"],
  practiceQuestions: ["q1", "q2"],
  citedReferenceIds: ["r1"],
};

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "request-id": "req_123" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

describe("AnthropicClaudeClient (SDK request shape, no network)", () => {
  it("sends the configured model, effort, structured output format, cached system prompt and fallback", async () => {
    const { fn, calls } = fakeFetch(200, {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(OUTPUT) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 1000,
        output_tokens: 400,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 300,
      },
    });
    const client = new AnthropicClaudeClient("sk-test", { fetch: fn, maxRetries: 0 });
    const res = await client.generateDebrief(CASE, DEFAULT_AI);

    expect(calls).toHaveLength(1);
    const { url, headers, body } = calls[0]!;
    expect(url).toContain("/v1/messages");
    expect(headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(`${headers.get("x-api-key") ?? ""} ${headers.get("authorization") ?? ""}`).toContain(
      "sk-test",
    );
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      fallbacks: "default",
    });
    expect(body.thinking).toBeUndefined(); // Opus 5.5 always uses adaptive thinking
    expect(body.temperature).toBeUndefined();
    const oc = body.output_config as { effort: string; format: { type: string; schema: object } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    for (const field of ["citedReferenceIds", "strengths", "knowledgeGaps", "recommendedTopics"])
      expect(JSON.stringify(oc.format.schema)).toContain(field);
    expect(body.system).toEqual([
      { type: "text", text: DEBRIEF_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
    ]);
    const user = (body.messages as { role: string; content: string }[])[0]!;
    expect(user.role).toBe("user");
    expect(user.content).toContain("<learner_reasoning>viral</learner_reasoning>");

    expect(res).toMatchObject({
      output: OUTPUT,
      stopReason: "end_turn",
      modelServed: "claude-opus-5-5",
      usage: { input: 1000, output: 400, cacheCreation: 0, cacheRead: 300 },
    });
  });

  it("omits the fallback beta when disabled, and returns no output on refusal", async () => {
    const { fn, calls } = fakeFetch(200, {
      id: "msg_2",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      stop_reason: "refusal",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const client = new AnthropicClaudeClient("sk-test", { fetch: fn, maxRetries: 0 });
    const res = await client.generateDebrief(CASE, { ...DEFAULT_AI, refusalFallback: false });
    expect(calls[0]!.headers.get("anthropic-beta") ?? "").not.toContain("server-side-fallback");
    expect(calls[0]!.body.fallbacks).toBeUndefined();
    expect(res).toMatchObject({ output: null, stopReason: "refusal" });
  });

  it("sends the fallback model when asked to", async () => {
    const { fn, calls } = fakeFetch(200, {
      id: "msg_3",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify(OUTPUT) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const res = await new AnthropicClaudeClient("sk-test", {
      fetch: fn,
      maxRetries: 0,
    }).generateDebrief(CASE, DEFAULT_AI, { model: "claude-sonnet-5-5" });
    expect(calls[0]!.body.model).toBe("claude-sonnet-5-5");
    expect(res.modelServed).toBe("claude-sonnet-5-5");
  });

  it("maps overload and rate limits to ProviderUnavailableError", async () => {
    const { fn } = fakeFetch(529, {
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    const client = new AnthropicClaudeClient("sk-test", { fetch: fn, maxRetries: 0 });
    await expect(client.generateDebrief(CASE, DEFAULT_AI)).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
    const { fn: f429 } = fakeFetch(429, {
      type: "error",
      error: { type: "rate_limit_error", message: "slow" },
    });
    await expect(
      new AnthropicClaudeClient("sk-test", { fetch: f429, maxRetries: 0 }).generateDebrief(
        CASE,
        DEFAULT_AI,
      ),
    ).rejects.toBeInstanceOf(ProviderRateLimitedError);
  });
});
