import { describe, expect, it } from "vitest";
import * as legacy from "../../../legacy/lovable-prototype/game-data.ts";
import {
  PROTOTYPE_COUNTRIES,
  PROTOTYPE_HOSPITAL_EVENTS,
  PROTOTYPE_MISSIONS,
  PROTOTYPE_TIERS,
  validateMission,
} from "../src/index.js";

describe("prototype content parity (text must be preserved verbatim)", () => {
  it("keeps every mission, step and choice string identical", () => {
    expect(PROTOTYPE_MISSIONS).toHaveLength(legacy.MISSIONS.length);
    legacy.MISSIONS.forEach((m, i) => {
      const n = PROTOTYPE_MISSIONS[i]!;
      expect(n).toMatchObject({
        key: m.id,
        title: m.title,
        story: m.story,
        icon: m.icon,
        tier: m.tier,
      });
      expect(n.countryCode).toBe(m.country.toUpperCase());
      expect(
        n.steps.map((s) => ({
          prompt: s.prompt,
          choices: s.choices.map(({ text, correct, feedback }) => ({ text, correct, feedback })),
        })),
      ).toEqual(m.steps);
    });
  });

  it("matches the audited totals: 10 missions, 17 steps, 38 choices", () => {
    const steps = PROTOTYPE_MISSIONS.flatMap((m) => m.steps);
    expect(PROTOTYPE_MISSIONS).toHaveLength(10);
    expect(steps).toHaveLength(17);
    expect(steps.flatMap((s) => s.choices)).toHaveLength(38);
  });

  it("keeps countries and tiers identical", () => {
    expect(
      PROTOTYPE_COUNTRIES.map((c) => [c.code, c.name, c.flagEmoji, c.focus, c.unlockHp]),
    ).toEqual(legacy.COUNTRIES.map((c) => [c.id.toUpperCase(), c.name, c.flag, c.focus, c.need]));
    expect(PROTOTYPE_TIERS.map((t) => [t.name, t.icon, t.hpRequired])).toEqual(
      legacy.TIERS.map((t) => [t.name, t.icon, t.need]),
    );
  });

  it("has four Commander events", () => {
    expect(PROTOTYPE_HOSPITAL_EVENTS.map((e) => e.key)).toEqual([
      "malaria_surge",
      "bus_crash",
      "cholera_outbreak",
      "maternity_rush",
    ]);
  });
});

describe("structural validation", () => {
  it("accepts every prototype mission", () => {
    for (const m of PROTOTYPE_MISSIONS) expect(validateMission(m)).toEqual([]);
  });

  it("rejects a step with two correct answers", () => {
    const m = structuredClone(PROTOTYPE_MISSIONS[0]!);
    m.steps[0]!.choices[1]!.correct = true;
    expect(validateMission(m)).toContain("malaria/s1: must have exactly one correct choice");
  });

  it("every mission's country exists", () => {
    const codes = new Set(PROTOTYPE_COUNTRIES.map((c) => c.code));
    for (const m of PROTOTYPE_MISSIONS) expect(codes.has(m.countryCode)).toBe(true);
  });
});
