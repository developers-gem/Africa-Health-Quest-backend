import mongoose from "mongoose";
import type { Logger } from "../lib/logger.js";

mongoose.set("strictQuery", true);
// Query-operator injection is prevented at the edge: every request input is parsed by a zod
// schema into scalars before it reaches a query, so no client object can become a filter.

export async function connectDatabase(uri: string, logger: Logger) {
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB disconnected"));
  mongoose.connection.on("reconnected", () => logger.info("MongoDB reconnected"));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000, autoIndex: false });
  // Create (never drop) declared indexes so several instances can start safely.
  await Promise.all(Object.values(mongoose.models).map((m) => m.createIndexes()));
  logger.info("MongoDB connected");
  return mongoose.connection;
}

export function isDatabaseUp() {
  return mongoose.connection.readyState === 1;
}
