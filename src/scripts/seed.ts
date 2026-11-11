/** Seeds reference data (roles, settings, countries). Safe to run repeatedly. Usage: npm run seed -w @ahq/backend */
import mongoose from "mongoose";
import { loadConfig } from "../config/env.js";
import { seedReferenceData } from "../db/seed.js";
import { SettingsService } from "../modules/settings/settings.service.js";

async function main() {
  const config = loadConfig();
  await mongoose.connect(config.MONGODB_URI);
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  const result = await seedReferenceData(new SettingsService());
  console.log(
    `Seeded: countries inserted ${result.countries.inserted}/${result.countries.total}; missions inserted ${result.missions.inserted}/${result.missions.total} (awaiting clinician review); roles and settings ensured.`,
  );
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});
