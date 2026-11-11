import {
  HospitalSettingsSchema,
  type Allocation,
  type HospitalEventInput,
  type HospitalRun,
  type HospitalSettings,
} from "@ahq/api-contracts";
import { randomInt } from "node:crypto";
import mongoose from "mongoose";
import { AppError } from "../../lib/errors.js";
import type { ProgressService } from "../players/progress.service.js";
import { tierFor } from "../players/domain/progression.js";
import type { SettingsService } from "../settings/settings.service.js";
import { DEFAULT_HOSPITAL } from "./hospital.defaults.js";
import {
  HospitalEventModel,
  HospitalRunModel,
  type HospitalRunDocument,
} from "./hospital.models.js";
import { pickEvent, simulateShift } from "./domain/simulation.js";

export function toRunDto(
  r: HospitalRunDocument | (HospitalRunDocument & Record<string, unknown>),
): HospitalRun {
  const c = (
    x:
      | {
          staff?: number | null;
          beds?: number | null;
          ambulances?: number | null;
          supplies?: number | null;
        }
      | null
      | undefined,
  ) => ({
    staff: x?.staff ?? 0,
    beds: x?.beds ?? 0,
    ambulances: x?.ambulances ?? 0,
    supplies: x?.supplies ?? 0,
  });
  return {
    id: String(r._id),
    allocation: c(r.allocation),
    cost: r.cost,
    event: { key: r.event!.key!, text: r.event!.text!, needs: c(r.event!.needs) },
    needsMet: r.needsMet,
    outcomes: (r.outcomes ?? []).map((o) => ({
      resource: o.resource as HospitalRun["outcomes"][number]["resource"],
      allocated: o.allocated!,
      needed: o.needed!,
      met: o.met!,
      surplus: o.surplus!,
      shortfall: o.shortfall!,
    })),
    performance: {
      coveragePercent: r.performance!.coveragePercent!,
      efficiencyPercent: r.performance!.efficiencyPercent!,
      wastedUnits: r.performance!.wastedUnits!,
      rating: r.performance!.rating as HospitalRun["performance"]["rating"],
    },
    rewards: { hp: r.rewards!.hp!, funding: r.rewards!.funding! },
    netFundingChange: r.netFundingChange,
    summary: r.summary,
    createdAt: (r.get
      ? (r.get("createdAt") as Date)
      : (r as unknown as { createdAt: Date }).createdAt
    ).toISOString(),
  };
}

export class HospitalService {
  constructor(
    private readonly settings: SettingsService,
    private readonly progress: ProgressService,
  ) {
    settings.register("hospital", HospitalSettingsSchema, DEFAULT_HOSPITAL);
  }

  private async config() {
    return (await this.settings.get("hospital")) as { value: HospitalSettings; version: number };
  }

  async state(userId: string) {
    const [{ value: cfg }, p, { value: progression }, recent] = await Promise.all([
      this.config(),
      this.progress.get(userId),
      this.settings.get("progression"),
      HospitalRunModel.find({ userId }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
    const avg = (xs: number[]) =>
      xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null;
    return {
      budget: p.funding,
      hospitalLevel: tierFor(p.hp, progression.tiers).tier,
      unitCost: cfg.unitCost,
      maxUnitsPerResource: cfg.maxUnitsPerResource,
      maxAffordableUnits: Math.floor(p.funding / cfg.unitCost),
      resources: cfg.resources,
      rewardsPerNeedMet: { hp: cfg.hpPerNeedMet, funding: cfg.fundingPerNeedMet },
      recent: {
        shifts: recent.length,
        averageNeedsMet: avg(recent.map((r) => r.needsMet)),
        averageEfficiencyPercent: avg(recent.map((r) => r.performance?.efficiencyPercent ?? 0)),
      },
    };
  }

  /** Runs a shift: server-side event roll, cost and rewards applied atomically with the run record. */
  async run(userId: string, allocation: Allocation) {
    const { value: cfg, version } = await this.config();
    for (const [k, v] of Object.entries(allocation)) {
      if (v > cfg.maxUnitsPerResource) {
        throw AppError.badRequest(`At most ${cfg.maxUnitsPerResource} units per resource.`, [
          { path: `allocation.${k}`, message: "too many" },
        ]);
      }
    }
    const p = await this.progress.get(userId);
    const { value: progression } = await this.settings.get("progression");
    const tierIndex = tierFor(p.hp, progression.tiers).tier.index;
    const unlocked = new Set(await this.progress.toDto(p).then((d) => d.unlockedCountryCodes));
    const eligible = (
      await HospitalEventModel.find({ status: "active", minTierIndex: { $lte: tierIndex } }).lean()
    ).filter((e) => !e.countryCodes?.length || e.countryCodes.some((c) => unlocked.has(c)));
    if (!eligible.length) throw AppError.unavailable("No emergency events are configured.");
    let roll = { roll: 0, total: 0 };
    const event = pickEvent(
      eligible.map((e) => ({
        ...e,
        needs: {
          staff: e.needs!.staff,
          beds: e.needs!.beds,
          ambulances: e.needs!.ambulances,
          supplies: e.needs!.supplies,
        },
      })),
      (n) => {
        roll = { roll: randomInt(n), total: n };
        return roll.roll;
      },
    );
    const sim = simulateShift(allocation, event, cfg);

    const session = await mongoose.startSession();
    try {
      let run!: HospitalRunDocument;
      let applied!: Awaited<ReturnType<ProgressService["applyChange"]>>;
      await session.withTransaction(async (s) => {
        const [created] = await HospitalRunModel.create(
          [
            {
              userId,
              allocation,
              cost: sim.cost,
              event: { key: event.key, text: event.text, needs: event.needs },
              needsMet: sim.needsMet,
              outcomes: sim.outcomes,
              performance: sim.performance,
              rewards: sim.rewards,
              netFundingChange: sim.netFundingChange,
              summary: sim.summary,
              settingsVersion: version,
              rng: roll,
            },
          ],
          { session: s },
        );
        run = created!;
        applied = await this.progress.applyChange(
          userId,
          {
            source: "hospital_run",
            sourceId: run.id as string,
            hp: sim.rewards.hp,
            funding: sim.netFundingChange,
            minFundingBefore: sim.cost, // the full cost must be affordable, as in the prototype
            stats: { shiftsRun: 1, needsMet: sim.needsMet },
          },
          s,
        );
      });
      return {
        ...toRunDto(run),
        progress: await this.progress.toDto(applied.progress),
        achievements: applied.achievements.map((a) => ({ key: a.key, name: a.name })),
      };
    } finally {
      await session.endSession();
    }
  }

  async history(userId: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      HospitalRunModel.find({ userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
      HospitalRunModel.countDocuments({ userId }),
    ]);
    return { items: items.map(toRunDto), total };
  }

  // ---- Event administration ----
  listEvents() {
    return HospitalEventModel.find().sort({ key: 1 }).lean();
  }

  async createEvent(input: HospitalEventInput) {
    return HospitalEventModel.create(input).catch((e) => {
      if ((e as { code?: number }).code === 11000)
        throw AppError.conflict("An event with this key exists.");
      throw e;
    });
  }

  async updateEvent(key: string, input: Partial<HospitalEventInput>) {
    const before = await HospitalEventModel.findOne({ key }).lean();
    if (!before) throw AppError.notFound("Event not found.");
    if (input.status === "retired" && before.status === "active") {
      const others = await HospitalEventModel.countDocuments({
        status: "active",
        key: { $ne: key },
      });
      if (!others) throw AppError.conflict("At least one event must stay active.");
    }
    const after = await HospitalEventModel.findOneAndUpdate(
      { key },
      { $set: input },
      { new: true, runValidators: true },
    ).lean();
    return { before, after: after! };
  }
}
