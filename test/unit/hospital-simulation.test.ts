import { PROTOTYPE_HOSPITAL_EVENTS } from "@ahq/game-content";
import { describe, expect, it } from "vitest";
import { pickEvent, simulateShift } from "../../src/modules/hospital/domain/simulation.js";
import { DEFAULT_HOSPITAL } from "../../src/modules/hospital/hospital.defaults.js";

const event = (key: string) => PROTOTYPE_HOSPITAL_EVENTS.find((e) => e.key === key)!;
const alloc = (a: Partial<Record<"staff" | "beds" | "ambulances" | "supplies", number>>) => ({
  staff: 0,
  beds: 0,
  ambulances: 0,
  supplies: 0,
  ...a,
});

describe("shift simulation (prototype rules)", () => {
  it("reproduces the prototype run observed in the audit: 6 staff vs a maternity rush", () => {
    const r = simulateShift(alloc({ staff: 6 }), event("maternity_rush"), DEFAULT_HOSPITAL);
    expect(r).toMatchObject({
      needsMet: 1,
      cost: 60,
      rewards: { hp: 15, funding: 8 },
      netFundingChange: -52,
    });
    expect(r.summary).toBe(
      "Maternity rush — 12 deliveries tonight. You covered 1/4 needs. +15 HP.",
    );
    // Audit capture L08: funding 113 → 61 after this shift.
    expect(113 + r.netFundingChange).toBe(61);
  });

  it("covers a need when allocation ≥ need (ambulances 0 need is always met)", () => {
    const r = simulateShift(
      alloc({ staff: 2, beds: 2, supplies: 3 }),
      event("malaria_surge"),
      DEFAULT_HOSPITAL,
    );
    expect(r.needsMet).toBe(4);
    expect(r.rewards).toEqual({ hp: 60, funding: 32 });
    expect(r.performance).toEqual({
      coveragePercent: 100,
      efficiencyPercent: 100,
      wastedUnits: 0,
      rating: "excellent",
    });
  });

  it("reports surplus, shortfall and efficiency", () => {
    const r = simulateShift(
      alloc({ staff: 5, beds: 1, ambulances: 3, supplies: 1 }),
      event("bus_crash"),
      DEFAULT_HOSPITAL,
    );
    expect(r.outcomes.find((o) => o.resource === "staff")).toMatchObject({
      met: true,
      surplus: 2,
      shortfall: 0,
    });
    expect(r.outcomes.find((o) => o.resource === "beds")).toMatchObject({
      met: false,
      surplus: 0,
      shortfall: 1,
    });
    expect(r.needsMet).toBe(3);
    expect(r.performance).toMatchObject({ wastedUnits: 2, efficiencyPercent: 80, rating: "good" });
  });
});

describe("event selection", () => {
  it("is weighted and uses the provided random source", () => {
    const events = [
      { ...event("bus_crash"), weight: 1 },
      { ...event("cholera_outbreak"), weight: 3 },
    ];
    expect(pickEvent(events, () => 0).key).toBe("bus_crash");
    expect(pickEvent(events, () => 1).key).toBe("cholera_outbreak");
    expect(pickEvent(events, () => 3).key).toBe("cholera_outbreak");
    expect(() => pickEvent([], () => 0)).toThrow();
  });
});
