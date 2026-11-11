import mongoose from "mongoose";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase } from "./db/connect.js";
import { createLogger } from "./lib/logger.js";
import { seedReferenceData } from "./db/seed.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);
  await connectDatabase(config.MONGODB_URI, logger);
  const { app, services } = createApp({ config, logger });
  await seedReferenceData(services.settings);
  const server = app.listen(config.PORT, () => logger.info({ port: config.PORT }, "API listening"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
