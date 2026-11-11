import { syncSystemRoles } from "../modules/auth/roles.js";
import { seedCountries } from "../modules/countries/countries.service.js";
import { seedHospitalEvents } from "../modules/hospital/hospital.defaults.js";
import { seedMissions } from "../modules/missions/missions.service.js";
import type { SettingsService } from "../modules/settings/settings.service.js";

/** Idempotent reference data: never overwrites admin changes. */
export async function seedReferenceData(settings: SettingsService) {
  await syncSystemRoles();
  await Promise.all([
    settings.ensureDefault("economy"),
    settings.ensureDefault("progression"),
    settings.ensureDefault("ai"),
  ]);
  const countries = await seedCountries();
  const missions = await seedMissions();
  const hospitalEvents = await seedHospitalEvents();
  return { countries, missions, hospitalEvents };
}
