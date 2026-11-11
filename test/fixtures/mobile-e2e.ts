/**
 * TEST FIXTURE for the Flutter end-to-end test (scripts/mobile/run-e2e.sh). Never run against real data.
 *
 * Prepares a throwaway e2e database: reference data, the prototype "malaria" case published as if a
 * clinician had approved it (exactly what the backend integration tests do; the real clinician approval
 * flow is covered by the web E2E journey), and that case made available offline.
 *
 * Refuses to run in production or against a database whose name does not contain "e2e".
 * Usage: MONGODB_URI=mongodb://…/ahq_e2e_mobile npx tsx test/fixtures/mobile-e2e.ts
 */
import mongoose from "mongoose";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { seedReferenceData } from "../../src/db/seed.js";
import { createLogger } from "../../src/lib/logger.js";
import { MissionModel, MissionVersionModel } from "../../src/modules/missions/mission.models.js";
import { LogMailer } from "../../src/services/mailer.js";

const KEY = "malaria";

async function main() {
  const config = loadConfig();
  const dbName = new URL(config.MONGODB_URI.replace(/^mongodb(\+srv)?:/, "http:")).pathname;
  if (config.NODE_ENV === "production" || !dbName.includes("e2e")) {
    throw new Error(`Refusing to prepare fixtures in ${config.NODE_ENV} / database "${dbName}".`);
  }
  await mongoose.connect(config.MONGODB_URI);
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  const logger = createLogger("warn");
  const { services } = createApp({
    config,
    logger,
    mailer: new LogMailer(logger),
    google: null,
    aiClient: null,
  });
  await seedReferenceData(services.settings);

  const mission = await MissionModel.findOne({ key: KEY });
  if (!mission) throw new Error(`Mission ${KEY} was not seeded.`);
  const version = await MissionVersionModel.findOne({
    missionId: mission._id,
    status: "in_review",
  });
  if (version) {
    const session = await mongoose.startSession();
    await session.withTransaction(async (s) => {
      await services.missions.publishVersion(
        String(version._id),
        {
          reviewerName: "E2E fixture reviewer",
          credentials: "Test fixture — not a clinical approval",
          approvedAt: new Date(),
          referenceIds: [],
        },
        s,
      );
    });
    await session.endSession();
  }
  await MissionModel.updateOne({ key: KEY }, { $set: { offlineEligible: true } });
  console.log(`Mobile e2e fixtures ready: "${KEY}" published (fixture) and available offline.`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await mongoose.disconnect();
  process.exit(1);
});
