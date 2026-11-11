import type { MissionContent } from "@ahq/shared-types";

/** Structural rules every mission must satisfy before it can be seeded or submitted for review. */
export function validateMission(m: MissionContent): string[] {
  const errors: string[] = [];
  if (!/^[a-z0-9-]{2,40}$/.test(m.key)) errors.push(`${m.key}: invalid key`);
  if (!/^[A-Z]{2}$/.test(m.countryCode)) errors.push(`${m.key}: invalid country code`);
  if (m.steps.length < 1 || m.steps.length > 10) errors.push(`${m.key}: must have 1–10 steps`);
  const ids = new Set<string>();
  for (const s of m.steps) {
    if (ids.has(s.stepId)) errors.push(`${m.key}: duplicate step ${s.stepId}`);
    ids.add(s.stepId);
    if (s.choices.length < 2 || s.choices.length > 6)
      errors.push(`${m.key}/${s.stepId}: must have 2–6 choices`);
    if (s.choices.filter((c) => c.correct).length !== 1) {
      errors.push(`${m.key}/${s.stepId}: must have exactly one correct choice`);
    }
    for (const c of s.choices) {
      if (ids.has(c.choiceId)) errors.push(`${m.key}: duplicate choice ${c.choiceId}`);
      ids.add(c.choiceId);
      if (!c.text.trim() || !c.feedback.trim())
        errors.push(`${m.key}/${c.choiceId}: text and feedback required`);
    }
  }
  return errors;
}
