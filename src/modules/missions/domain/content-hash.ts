import { createHash } from "node:crypto";

/** Deterministic JSON: object keys sorted recursively, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export type HashableContent = {
  title: string;
  story: string;
  countryCode: string;
  locale: string;
  learningObjectives: string[];
  steps: {
    stepId: string;
    prompt: string;
    choices: {
      choiceId: string;
      text: string;
      correct: boolean;
      feedback: string;
      critical?: boolean;
    }[];
  }[];
};

/**
 * SHA-256 fingerprint of everything a clinician approves: scenario, steps, choices, answer key, feedback,
 * critical flags, country (guidelines differ by country), locale and references. Gameplay placement
 * (tier, icon, sort order) is deliberately excluded.
 */
export function contentHash(content: HashableContent, referenceIds: string[]): string {
  const normalised = {
    ...content,
    steps: content.steps.map((s) => ({
      ...s,
      choices: s.choices.map((c) => ({ ...c, critical: Boolean(c.critical) })),
    })),
    referenceIds: [...referenceIds].sort(),
  };
  return createHash("sha256").update(canonicalJson(normalised)).digest("hex");
}
