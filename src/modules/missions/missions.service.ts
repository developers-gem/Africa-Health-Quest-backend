import { randomInt } from "node:crypto";
import type { MissionDetail, MissionPack, MissionSummary, Reference } from "@ahq/api-contracts";
import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import mongoose, { Types, type ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { SYSTEM_ACTOR_ID } from "../audit/audit-log.model.js";
import { isCountryUnlocked } from "../countries/countries.service.js";
import { CountryModel } from "../countries/country.model.js";
import type { ProgressDocument } from "../players/player.models.js";
import { tierFor } from "../players/domain/progression.js";
import type { SettingsService } from "../settings/settings.service.js";
import { contentHash } from "./domain/content-hash.js";
import {
  ClinicalReferenceModel,
  MissionModel,
  MissionVersionModel,
  type MissionDocument,
  type MissionVersionDocument,
} from "./mission.models.js";

export type LockState = { locked: boolean; lockReason: "tier" | "country" | null };
export type VerificationInput = {
  reviewId?: string;
  reviewerName: string;
  credentials: string;
  approvedAt: Date;
  referenceIds: string[];
};

export function hashVersion(
  v: Pick<MissionVersionDocument, "content" | "locale" | "referenceIds">,
) {
  const c = v.content!;
  return contentHash(
    {
      title: c.title,
      story: c.story,
      countryCode: c.countryCode,
      locale: v.locale,
      learningObjectives: [...(c.learningObjectives ?? [])],
      steps: c.steps.map((s) => ({
        stepId: s.stepId,
        prompt: s.prompt,
        choices: s.choices.map((ch) => ({
          choiceId: ch.choiceId,
          text: ch.text,
          correct: ch.correct,
          feedback: ch.feedback,
          critical: Boolean(ch.critical),
        })),
      })),
    },
    (v.referenceIds ?? []).map(String),
  );
}

export function toReferenceDto(r: {
  _id: unknown;
  title: string;
  organization?: string | null;
  year?: number | null;
  type: string;
  url?: string | null;
  doi?: string | null;
}): Reference {
  return {
    id: String(r._id),
    title: r.title,
    organization: r.organization ?? null,
    year: r.year ?? null,
    type: r.type,
    url: r.url ?? null,
    doi: r.doi ?? null,
  };
}

export class MissionsService {
  constructor(private readonly settings: SettingsService) {}

  async maxScore(stepCount: number) {
    const { value } = await this.settings.get("economy");
    return stepCount * value.pointsPerCorrectStep;
  }

  /** Story-mode lock: mission tier above the hospital level, or the mission's country not unlocked. */
  async lockState(
    m: Pick<MissionDocument, "tier" | "countryCode">,
    progress: ProgressDocument | null,
  ): Promise<LockState> {
    if (!progress) return { locked: true, lockReason: m.tier > 0 ? "tier" : "country" };
    const { value: progression } = await this.settings.get("progression");
    const tierIndex = tierFor(progress.hp, progression.tiers).tier.index;
    if (m.tier > tierIndex) return { locked: true, lockReason: "tier" };
    const country = await CountryModel.findOne({ code: m.countryCode }).lean();
    if (!country || !isCountryUnlocked(country, { hp: progress.hp, tierIndex }))
      return { locked: true, lockReason: "country" };
    return { locked: false, lockReason: null };
  }

  listPublished(filter: { country?: string; topic?: string } = {}) {
    const q: Record<string, unknown> = { status: "published" };
    if (filter.country) q.countryCode = filter.country;
    if (filter.topic) q.topics = filter.topic;
    return MissionModel.find(q).sort({ tier: 1, sortOrder: 1, key: 1 });
  }

  async getPublished(key: string) {
    const m = await MissionModel.findOne({ key, status: "published" });
    if (!m?.published) throw AppError.notFound("Mission not found.");
    return m;
  }

  async publishedVersion(m: MissionDocument) {
    const v = await MissionVersionModel.findById(m.publishedVersionId);
    if (!v) throw AppError.notFound("Mission not found.");
    return v;
  }

  async references(ids: unknown[]): Promise<Reference[]> {
    if (!ids.length) return [];
    const refs = await ClinicalReferenceModel.find({ _id: { $in: ids } }).lean();
    const byId = new Map(refs.map((r) => [String(r._id), r]));
    return ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((r) => toReferenceDto(r!));
  }

  async summary(
    m: MissionDocument,
    progress: ProgressDocument | null,
    mode: "story" | "practice",
  ): Promise<MissionSummary> {
    const lock =
      mode === "practice" ? { locked: false, lockReason: null } : await this.lockState(m, progress);
    const mp = progress?.missions?.get(m.key);
    return {
      key: m.key,
      title: m.published!.title,
      icon: m.icon,
      countryCode: m.countryCode,
      tier: m.tier,
      topics: [...(m.topics ?? [])],
      stepCount: m.published!.stepCount,
      maxScore: await this.maxScore(m.published!.stepCount),
      versionNumber: m.published!.versionNumber,
      offlineAvailable: Boolean(m.offlineEligible),
      locked: lock.locked,
      lockReason: lock.lockReason,
      progress: mp
        ? { bestScore: mp.bestScore ?? 0, passed: Boolean(mp.passed), attempts: mp.attempts ?? 0 }
        : null,
    };
  }

  async verification(m: MissionDocument) {
    const v = m.published!.verification!;
    return {
      reviewerName: v.reviewerName,
      credentials: v.credentials,
      approvedAt: v.approvedAt.toISOString(),
      references: await this.references(v.referenceIds ?? []),
    };
  }

  async detail(
    m: MissionDocument,
    progress: ProgressDocument | null,
    mode: "story" | "practice",
  ): Promise<MissionDetail> {
    const version = await this.publishedVersion(m);
    return {
      ...(await this.summary(m, progress, mode)),
      story: version.content!.story,
      learningObjectives: [...(version.content!.learningObjectives ?? [])],
      verification: await this.verification(m),
    };
  }

  /**
   * Offline mission pack: story and every step's prompt and choices, but no correct answers, feedback or
   * critical flags — those stay on the server and are revealed when the device syncs its answers.
   */
  async pack(m: MissionDocument): Promise<MissionPack> {
    if (!m.offlineEligible) throw AppError.notFound("This mission isn't available offline.");
    const [version, economy] = await Promise.all([
      this.publishedVersion(m),
      this.settings.get("economy"),
    ]);
    const content = version.content!;
    const shuffle = <T>(xs: T[]) => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    return {
      key: m.key,
      versionNumber: m.published!.versionNumber,
      title: content.title,
      icon: m.icon,
      story: content.story,
      countryCode: m.countryCode,
      tier: m.tier,
      topics: [...(m.topics ?? [])],
      learningObjectives: [...(content.learningObjectives ?? [])],
      maxScore: await this.maxScore(content.steps.length),
      steps: content.steps.map((s, index) => {
        const choices = s.choices.map((c) => ({ choiceId: c.choiceId, text: c.text }));
        return {
          stepId: s.stepId,
          index,
          prompt: s.prompt,
          choices: economy.value.shuffleChoices ? shuffle(choices) : choices,
        };
      }),
      verification: await this.verification(m),
      issuedAt: new Date().toISOString(),
    };
  }

  /**
   * Publishes an approved version: supersedes the previous published version and updates the mission's
   * published snapshot. Must run inside the review transaction (M6) — exported for that and for tests.
   */
  async publishVersion(versionId: string, verification: VerificationInput, session: ClientSession) {
    const version = await MissionVersionModel.findById(versionId, null, { session });
    if (!version) throw AppError.notFound("Version not found.");
    if (!["in_review", "approved"].includes(version.status)) {
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        `A ${version.status} version cannot be published.`,
      );
    }
    const mission = await MissionModel.findById(version.missionId, null, { session });
    if (!mission) throw AppError.notFound("Mission not found.");
    const now = new Date();
    if (mission.publishedVersionId && String(mission.publishedVersionId) !== versionId) {
      await MissionVersionModel.updateOne(
        { _id: mission.publishedVersionId, status: "published" },
        { $set: { status: "superseded", supersededAt: now } },
        { session },
      );
    }
    version.status = "published";
    version.approvedAt = verification.approvedAt;
    version.publishedAt = now;
    await version.save({ session });
    mission.status = "published";
    mission.publishedVersionId = version._id;
    if (mission.openDraftVersionId && String(mission.openDraftVersionId) === versionId)
      mission.openDraftVersionId = null;
    mission.countryCode = version.content!.countryCode;
    mission.set("published", {
      versionId: version._id,
      versionNumber: version.versionNumber,
      title: version.content!.title,
      countryCode: version.content!.countryCode,
      stepCount: version.content!.steps.length,
      contentHash: version.contentHash,
      verification: {
        ...(verification.reviewId ? { reviewId: new Types.ObjectId(verification.reviewId) } : {}),
        reviewerName: verification.reviewerName,
        credentials: verification.credentials,
        approvedAt: verification.approvedAt,
        referenceIds: verification.referenceIds.map((id) => new Types.ObjectId(id)),
      },
    });
    await mission.save({ session });
    return { mission, version };
  }
}

/**
 * Imports the 10 prototype missions verbatim as version 1, submitted for clinician review. Per decision D4
 * nothing is visible to players until a reviewer approves it. Existing missions are left untouched.
 */
export async function seedMissions() {
  let inserted = 0;
  for (const m of PROTOTYPE_MISSIONS) {
    if (await MissionModel.exists({ key: m.key })) continue;
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const [mission] = await MissionModel.create(
          [
            {
              key: m.key,
              countryCode: m.countryCode,
              tier: m.tier,
              icon: m.icon,
              sortOrder: m.sortOrder,
              status: "draft",
              latestVersionNumber: 1,
              createdBy: SYSTEM_ACTOR_ID,
            },
          ],
          { session },
        );
        const version = new MissionVersionModel({
          missionId: mission!._id,
          versionNumber: 1,
          status: "in_review",
          locale: "en",
          content: {
            title: m.title,
            story: m.story,
            countryCode: m.countryCode,
            learningObjectives: [],
            steps: m.steps.map((s) => ({
              stepId: s.stepId,
              prompt: s.prompt,
              choices: s.choices.map((c) => ({
                choiceId: c.choiceId,
                text: c.text,
                correct: c.correct,
                feedback: c.feedback,
                critical: false,
              })),
            })),
          },
          referenceIds: [],
          authoredBy: [SYSTEM_ACTOR_ID],
          changeSummary: "Imported verbatim from the Lovable prototype",
          submittedAt: new Date(),
        });
        version.contentHash = hashVersion(version);
        await version.save({ session });
        await MissionModel.updateOne(
          { _id: mission!._id },
          { $set: { openDraftVersionId: version._id } },
          { session },
        );
      });
      inserted++;
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e;
    } finally {
      await session.endSession();
    }
  }
  return { inserted, total: PROTOTYPE_MISSIONS.length };
}
