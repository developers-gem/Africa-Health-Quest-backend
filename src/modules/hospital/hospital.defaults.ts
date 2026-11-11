import type { HospitalSettings } from "@ahq/api-contracts";
import { PROTOTYPE_HOSPITAL_EVENTS } from "@ahq/game-content";
import { HospitalEventModel } from "./hospital.models.js";

/** Prototype values (src/routes/index.tsx RES and Commander formula). */
export const DEFAULT_HOSPITAL: HospitalSettings = {
  unitCost: 10,
  hpPerNeedMet: 15,
  fundingPerNeedMet: 8,
  maxUnitsPerResource: 50,
  resources: [
    { key: "staff", name: "Staff", icon: "👩🏾‍⚕️" },
    { key: "beds", name: "Beds", icon: "🛏️" },
    { key: "ambulances", name: "Ambulances", icon: "🚑" },
    { key: "supplies", name: "Supplies", icon: "💊" },
  ],
};

/** Seeds the four prototype events verbatim; existing events are never overwritten. */
export async function seedHospitalEvents() {
  let inserted = 0;
  for (const e of PROTOTYPE_HOSPITAL_EVENTS) {
    const res = await HospitalEventModel.updateOne(
      { key: e.key },
      {
        $setOnInsert: {
          key: e.key,
          text: e.text,
          needs: e.needs,
          weight: 1,
          minTierIndex: 0,
          countryCodes: [],
          status: "active",
        },
      },
      { upsert: true },
    );
    inserted += res.upsertedCount;
  }
  return { inserted, total: PROTOTYPE_HOSPITAL_EVENTS.length };
}
