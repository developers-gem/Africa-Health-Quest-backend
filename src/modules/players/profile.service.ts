import type { PlayerProfile, UpdatePlayerProfile } from "@ahq/api-contracts";
import { PlayerProfileModel, type PlayerProfileDocument } from "./player.models.js";

export function toProfileDto(p: PlayerProfileDocument): PlayerProfile {
  return {
    learnerLevel: (p.learnerLevel as PlayerProfile["learnerLevel"]) ?? null,
    institution: p.institution ?? null,
    homeCountryCode: p.homeCountryCode ?? null,
    locale: p.locale ?? "en",
    notificationPrefs: {
      push: p.notificationPrefs?.push ?? true,
      email: p.notificationPrefs?.email ?? false,
    },
    onboardingCompletedAt: p.onboardingCompletedAt ? p.onboardingCompletedAt.toISOString() : null,
    updatedAt: (p.get("updatedAt") as Date).toISOString(),
  };
}

export class ProfileService {
  async get(userId: string): Promise<PlayerProfileDocument> {
    return (await PlayerProfileModel.findOneAndUpdate(
      { userId },
      // Reading must not touch updatedAt (sync clients use it to detect changes).
      { $setOnInsert: { userId, createdAt: new Date(), updatedAt: new Date() } },
      { upsert: true, new: true, setDefaultsOnInsert: true, timestamps: false },
    ))!;
  }

  /**
   * Applies a profile edit. `clientUpdatedAt` (offline edits) enables last-writer-wins: an edit made on a device
   * earlier than the last applied edit is ignored and reported as stale.
   */
  async update(userId: string, input: UpdatePlayerProfile, clientUpdatedAt?: Date) {
    const profile = await this.get(userId);
    if (clientUpdatedAt && profile.clientUpdatedAt && clientUpdatedAt <= profile.clientUpdatedAt) {
      return { profile, applied: false as const };
    }
    if (input.learnerLevel !== undefined) profile.learnerLevel = input.learnerLevel;
    if (input.institution !== undefined) profile.institution = input.institution || null;
    if (input.homeCountryCode !== undefined) profile.homeCountryCode = input.homeCountryCode;
    if (input.locale !== undefined) profile.locale = input.locale;
    if (input.notificationPrefs) {
      profile.set("notificationPrefs", {
        ...profile.notificationPrefs,
        ...input.notificationPrefs,
      });
    }
    if (input.onboardingCompleted !== undefined) {
      profile.onboardingCompletedAt = input.onboardingCompleted
        ? (profile.onboardingCompletedAt ?? new Date())
        : null;
    }
    if (clientUpdatedAt) profile.clientUpdatedAt = clientUpdatedAt;
    await profile.save();
    return { profile, applied: true as const };
  }
}
