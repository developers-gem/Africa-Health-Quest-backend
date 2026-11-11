import { LEARNER_LEVELS } from "@ahq/shared-types";
import { describe, expect, it } from "vitest";
import { LEVEL_GUIDANCE, redactPersonalDetails } from "../../src/modules/ai/prompts/debrief.js";

describe("debrief prompt helpers", () => {
  it("redacts emails and phone/ID numbers but keeps clinical numbers", () => {
    expect(redactPersonalDetails("email me at nurse.ama@clinic.gh")).toBe(
      "email me at [email removed]",
    );
    expect(redactPersonalDetails("call 0244 123 456 7 now")).toContain("[number removed]");
    expect(redactPersonalDetails("+234 803 555 0101")).toBe("[number removed]");
    const clinical =
      "Temp 38.9°C, HR 140, BP 90/60, weight 12 kg, artesunate 2.4 mg/kg at 0, 12 and 24 h, Hb 6.5 g/dL, SpO2 91%";
    expect(redactPersonalDetails(clinical)).toBe(clinical);
  });

  it("has guidance for every learner level", () => {
    for (const level of LEARNER_LEVELS) expect(LEVEL_GUIDANCE[level].length).toBeGreaterThan(40);
  });
});
