import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const RUN_ID = "X-Lovable-AIG-Run-ID";

export type DebriefInput = {
  title: string;
  story: string;
  level: string;
  steps: { prompt: string; chosen: string; correct: boolean; bestAnswer: string; reasoning: string }[];
};

const INSTRUCTIONS = `You are a warm, rigorous clinical educator for African healthcare students playing "Africa Health Quest".
Write a personalized learning debrief in Markdown for the student's case decisions and their own written reasoning.
Structure:
## Overall
2-3 sentences on performance and clinical reasoning quality.
## Decision by decision
For each step: what they chose, whether it was right, and a targeted explanation that directly addresses gaps or misconceptions in THEIR reasoning (quote it briefly). Praise sound reasoning specifically.
## Key teaching points
3-5 concise, guideline-based bullets (WHO / IMCI / national guidelines where relevant), adapted to low-resource African settings.
## Practice next
2 short follow-up questions to test understanding.
Match depth to the student's level. Be concise (under 450 words). This is education, not medical advice.`;

export async function handleDebrief(request: Request) {
  const apiKey = process.env['LOVABLE_API_KEY'];
  if (!apiKey) return Response.json({ error: "AI is not configured." }, { status: 500 });
  let body: DebriefInput;
  try {
    body = await request.json();
    if (!body?.title || !Array.isArray(body.steps) || body.steps.length > 10) throw new Error();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  let runId = request.headers.get(RUN_ID)?.trim() || undefined;
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(RUN_ID)) headers.set(RUN_ID, runId);
      const res = await fetch(input, { ...init, headers });
      runId ??= res.headers.get(RUN_ID)?.trim() || undefined;
      if (!res.ok) {
        const text = await res.clone().text().catch(() => "");
        statusError = { status: res.status, text };
      }
      return res;
    },
  });
  let statusError: { status: number; text: string } | null = null;

  const caseText = [
    `Student level: ${String(body.level).slice(0, 80) || "unspecified"}`,
    `Case: ${body.title}`,
    `Scenario: ${String(body.story).slice(0, 1500)}`,
    ...body.steps.map(
      (s, i) =>
        `Step ${i + 1}: ${s.prompt}\n- Student chose: ${s.chosen} (${s.correct ? "correct" : "incorrect"})\n- Best answer: ${s.bestAnswer}\n- Student reasoning: ${String(s.reasoning || "(none given)").slice(0, 1500)}`,
    ),
  ].join("\n\n");

  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: INSTRUCTIONS,
    messages: [{ role: "user", content: caseText }],
    abortSignal: request.signal,
    providerOptions: {
      openai: {
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        store: false,
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.textStream) controller.enqueue(encoder.encode(chunk));
        controller.close();
      } catch {
        const s = (statusError as { status: number } | null)?.status;
        const msg =
          s === 402 ? "AI credits are used up. Add credits in Settings → Plans & credits."
          : s === 429 ? "Too many requests right now. Please wait a moment and try again."
          : "The debrief could not be generated. Please try again.";
        controller.enqueue(encoder.encode(`\n\n[[ERROR]]${msg}`));
        controller.close();
      }
    },
  });
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  if (runId) headers.set(RUN_ID, runId);
  return new Response(stream, { headers });
}
