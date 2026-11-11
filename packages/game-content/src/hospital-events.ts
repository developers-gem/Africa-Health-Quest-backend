import type { HospitalEventContent } from "@ahq/shared-types";

/** Hospital Commander events, verbatim from the prototype (src/routes/index.tsx EVENTS). */
export const PROTOTYPE_HOSPITAL_EVENTS: HospitalEventContent[] = [
  {
    key: "malaria_surge",
    text: "Malaria surge! 40 febrile patients arrive.",
    needs: { staff: 2, beds: 2, supplies: 3, ambulances: 0 },
  },
  {
    key: "bus_crash",
    text: "Bus crash on the highway — mass casualties.",
    needs: { staff: 3, beds: 2, supplies: 1, ambulances: 3 },
  },
  {
    key: "cholera_outbreak",
    text: "Cholera outbreak in the river village.",
    needs: { staff: 1, beds: 3, supplies: 3, ambulances: 1 },
  },
  {
    key: "maternity_rush",
    text: "Maternity rush — 12 deliveries tonight.",
    needs: { staff: 3, beds: 3, supplies: 1, ambulances: 1 },
  },
];
