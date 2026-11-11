import mongoose from "mongoose";
import { MissionVersionModel } from "../../src/modules/missions/mission.models.js";
import type { makeApp } from "./helpers.js";

/** Publishes every in-review version as if a verified clinician had approved it (the review module does this). */
export async function publishAll(ctx: ReturnType<typeof makeApp>, keys?: string[]) {
  const versions = await MissionVersionModel.find({ status: "in_review" }).populate<{
    missionId: { key: string };
  }>("missionId");
  for (const v of versions) {
    if (keys && !keys.includes(v.missionId.key)) continue;
    const session = await mongoose.startSession();
    await session.withTransaction(async (s) => {
      await ctx.services.missions.publishVersion(
        String(v._id),
        {
          reviewerName: "Dr Ama Mensah",
          credentials: "MBChB, FWACP (Paediatrics)",
          approvedAt: new Date(),
          referenceIds: [],
        },
        s,
      );
    });
    await session.endSession();
  }
}
