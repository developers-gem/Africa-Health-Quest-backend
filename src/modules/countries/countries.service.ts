import type { Country } from "@ahq/api-contracts";
import { AFRICAN_COUNTRIES, PROTOTYPE_COUNTRIES, flagEmoji } from "@ahq/game-content";
import mongoose from "mongoose";
import { CountryModel, type CountryAttrs } from "./country.model.js";

export type UnlockContext = { hp: number; tierIndex: number };

export function isCountryUnlocked(c: Pick<CountryAttrs, "status" | "unlock">, ctx: UnlockContext) {
  return (
    c.status === "active" && ctx.hp >= c.unlock!.minHp && ctx.tierIndex >= c.unlock!.minTierIndex
  );
}

export const mediaUrl = (id: unknown) => (id ? `/media/${String(id)}` : null);

export function toCountryDto(c: CountryAttrs, missionCount: number, ctx?: UnlockContext): Country {
  return {
    code: c.code,
    name: c.name,
    region: c.region as Country["region"],
    flagEmoji: c.flagEmoji,
    flagUrl: mediaUrl(c.flagAssetId),
    imageUrl: mediaUrl(c.imageAssetId),
    focus: c.focus ?? "",
    description: c.description ?? "",
    healthPriorities: [...(c.healthPriorities ?? [])],
    languages: [...(c.languages ?? [])],
    currencyLabel: c.currencyLabel ?? null,
    status: c.status as Country["status"],
    unlock: { minHp: c.unlock!.minHp, minTierIndex: c.unlock!.minTierIndex },
    sortOrder: c.sortOrder,
    missionCount,
    ...(ctx ? { unlocked: isCountryUnlocked(c, ctx) } : {}),
  };
}

export class CountriesService {
  /** Countries visible to players: active and coming soon (hidden ones are admin-only). */
  async listVisible() {
    return CountryModel.find({ status: { $in: ["active", "coming_soon"] } })
      .sort({ sortOrder: 1, name: 1 })
      .lean();
  }

  async findVisible(code: string) {
    return CountryModel.findOne({ code, status: { $in: ["active", "coming_soon"] } }).lean();
  }

  async listActive() {
    return CountryModel.find({ status: "active" }).lean();
  }

  /** Published missions per country (missions collection is owned by the mission engine). */
  async missionCounts(): Promise<Map<string, number>> {
    const rows = await mongoose.connection
      .collection("missions")
      .aggregate<{ _id: string; n: number }>([
        { $match: { status: "published" } },
        { $group: { _id: "$countryCode", n: { $sum: 1 } } },
      ])
      .toArray();
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  async unlockedCodes(ctx: UnlockContext): Promise<string[]> {
    return (await this.listActive())
      .filter((c) => isCountryUnlocked(c, ctx))
      .map((c) => c.code)
      .sort();
  }
}

/**
 * Seeds all 54 countries. Prototype countries are active with their original unlock thresholds and focus text;
 * all others are "coming soon" until an admin adds content. Existing documents are never overwritten.
 */
export async function seedCountries() {
  const prototype = new Map(PROTOTYPE_COUNTRIES.map((c) => [c.code, c]));
  let inserted = 0;
  for (const [i, c] of AFRICAN_COUNTRIES.entries()) {
    const p = prototype.get(c.code);
    const res = await CountryModel.updateOne(
      { code: c.code },
      {
        $setOnInsert: {
          code: c.code,
          name: c.name,
          region: c.region,
          flagEmoji: flagEmoji(c.code),
          focus: p?.focus ?? "",
          status: p ? "active" : "coming_soon",
          unlock: { minHp: p?.unlockHp ?? 0, minTierIndex: 0 },
          sortOrder: p ? p.sortOrder : 100 + i,
        },
      },
      { upsert: true },
    );
    inserted += res.upsertedCount;
  }
  return { inserted, total: AFRICAN_COUNTRIES.length };
}
