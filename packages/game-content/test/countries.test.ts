import { describe, expect, it } from "vitest";
import { AFRICAN_COUNTRIES, PROTOTYPE_COUNTRIES, flagEmoji } from "../src/index.js";

describe("African countries reference list", () => {
  it("has the 54 UN-recognised African Union member states with unique ISO codes", () => {
    expect(AFRICAN_COUNTRIES).toHaveLength(54);
    expect(new Set(AFRICAN_COUNTRIES.map((c) => c.code)).size).toBe(54);
    for (const c of AFRICAN_COUNTRIES) expect(c.code).toMatch(/^[A-Z]{2}$/);
  });

  it("covers every prototype country with the same name", () => {
    for (const p of PROTOTYPE_COUNTRIES) {
      expect(AFRICAN_COUNTRIES.find((c) => c.code === p.code)?.name).toBe(p.name);
    }
  });

  it("derives flag emoji that match the prototype's", () => {
    for (const p of PROTOTYPE_COUNTRIES) expect(flagEmoji(p.code)).toBe(p.flagEmoji);
  });

  it("splits regions as the African Union does", () => {
    const count = (r: string) => AFRICAN_COUNTRIES.filter((c) => c.region === r).length;
    expect([
      count("northern"),
      count("western"),
      count("central"),
      count("eastern"),
      count("southern"),
    ]).toEqual([6, 15, 9, 14, 10]);
  });
});
