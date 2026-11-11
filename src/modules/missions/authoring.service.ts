import type { FullVersion, VersionContentInput } from "@ahq/api-contracts";
import mongoose, { Types, type ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { CountryModel } from "../countries/country.model.js";
import { MissionAttemptModel } from "../gameplay/attempt.model.js";
import { diffContent } from "./domain/diff.js";
import {
  ClinicalReferenceModel,
  MissionModel,
  MissionVersionModel,
  type MissionDocument,
  type MissionVersionDocument,
} from "./mission.models.js";
import { hashVersion, type MissionsService } from "./missions.service.js";

const plainContent = (v: MissionVersionDocument) => {
  const c = v.toObject().content!;
  return {
    title: c.title,
    story: c.story,
    countryCode: c.countryCode,
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
  };
};

async function inTransaction<T>(fn: (s: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let out!: T;
    await session.withTransaction(async (s) => {
      out = await fn(s);
    });
    return out;
  } finally {
    await session.endSession();
  }
}

/**
 * Content authoring (admins only, decision D5) and publishing controls. A mission has at most one open
 * version (draft or in review) — tracked by `openDraftVersionId`. Published content changes only when a
 * clinician approves a submitted version.
 */
export class AuthoringService {
  constructor(private readonly missions?: MissionsService) {}

  // ---- Reading ------------------------------------------------------------------------------
  async getMission(key: string) {
    const m = await MissionModel.findOne({ key });
    if (!m) throw AppError.notFound("Mission not found.");
    return m;
  }

  async getVersion(id: string) {
    if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Version not found.");
    const v = await MissionVersionModel.findById(id);
    if (!v) throw AppError.notFound("Version not found.");
    return v;
  }

  async toFullVersion(v: MissionVersionDocument): Promise<FullVersion> {
    const mission = await MissionModel.findById(v.missionId).lean();
    const based = v.basedOnVersionId
      ? await MissionVersionModel.findById(v.basedOnVersionId).lean()
      : null;
    const refs = this.missions ? await this.missions.references(v.referenceIds ?? []) : [];
    return {
      id: v.id as string,
      missionId: String(v.missionId),
      missionKey: mission?.key ?? "",
      versionNumber: v.versionNumber,
      status: v.status as FullVersion["status"],
      locale: v.locale,
      content: plainContent(v),
      references: refs,
      contentHash: v.contentHash ?? null,
      authoredBy: (v.authoredBy ?? []).map(String),
      changeSummary: v.changeSummary ?? null,
      basedOnVersionNumber: based?.versionNumber ?? null,
      submittedAt: v.submittedAt ? v.submittedAt.toISOString() : null,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      updatedAt: (v.get("updatedAt") as Date).toISOString(),
    };
  }

  /** Field-level diff of a version against the currently published version (or another version). */
  async diff(v: MissionVersionDocument, againstId?: string) {
    const mission = await MissionModel.findById(v.missionId).lean();
    const baseId =
      againstId ?? (mission?.publishedVersionId ? String(mission.publishedVersionId) : null);
    if (!baseId || baseId === (v.id as string)) return { against: null, changes: [] };
    const base = await MissionVersionModel.findById(baseId);
    if (!base || String(base.missionId) !== String(v.missionId))
      throw AppError.notFound("Comparison version not found.");
    return {
      against: base.versionNumber,
      changes: diffContent(
        { ...plainContent(base), referenceIds: (base.referenceIds ?? []).map(String).sort() },
        { ...plainContent(v), referenceIds: (v.referenceIds ?? []).map(String).sort() },
      ),
    };
  }

  // ---- Validation helpers -------------------------------------------------------------------
  private async checkCountry(code: string) {
    if (!(await CountryModel.exists({ code })))
      throw AppError.badRequest(`Unknown country ${code}.`, [
        { path: "content.countryCode", message: "unknown" },
      ]);
  }

  private async checkReferences(ids: string[]) {
    if (!ids.length) return;
    const found = await ClinicalReferenceModel.countDocuments({
      _id: { $in: ids },
      status: "active",
    });
    if (found !== new Set(ids).size)
      throw AppError.badRequest("Every reference must exist and be active.", [
        { path: "referenceIds", message: "invalid" },
      ]);
  }

  // ---- Creating and editing drafts -------------------------------------------------------------
  async createMission(
    input: {
      key: string;
      tier: number;
      icon: string;
      sortOrder?: number | undefined;
      topics?: string[] | undefined;
      content: VersionContentInput;
      referenceIds: string[];
    },
    actorId: string,
  ) {
    await this.checkCountry(input.content.countryCode);
    await this.checkReferences(input.referenceIds);
    if (await MissionModel.exists({ key: input.key }))
      throw AppError.conflict(`A mission with key "${input.key}" exists.`);
    return inTransaction(async (s) => {
      const [mission] = await MissionModel.create(
        [
          {
            key: input.key,
            countryCode: input.content.countryCode,
            tier: input.tier,
            icon: input.icon,
            sortOrder: input.sortOrder ?? 1000,
            topics: input.topics ?? [],
            status: "draft",
            latestVersionNumber: 1,
            createdBy: actorId,
          },
        ],
        { session: s },
      );
      const [draft] = await MissionVersionModel.create(
        [
          {
            missionId: mission!._id,
            versionNumber: 1,
            status: "draft",
            locale: "en",
            content: input.content,
            referenceIds: input.referenceIds,
            authoredBy: [actorId],
          },
        ],
        { session: s },
      );
      mission!.openDraftVersionId = draft!._id;
      await mission!.save({ session: s });
      return { mission: mission!, draft: draft! };
    });
  }

  /** Creates a draft from the latest version (or `basedOn`) with optional overrides. */
  async createDraft(
    mission: MissionDocument,
    actorId: string,
    overrides: { countryCode?: string } = {},
    session?: ClientSession,
  ) {
    if (mission.openDraftVersionId)
      throw AppError.conflict("This mission already has a version in draft or review.");
    const latest = await MissionVersionModel.findOne({ missionId: mission._id }, null, {
      session,
    }).sort({ versionNumber: -1 });
    if (!latest) throw AppError.notFound("Mission has no versions.");
    const versionNumber = latest.versionNumber + 1;
    const content = latest.toObject().content!;
    const [draft] = await MissionVersionModel.create(
      [
        {
          missionId: mission._id,
          versionNumber,
          status: "draft",
          locale: latest.locale,
          content: {
            ...content,
            ...(overrides.countryCode ? { countryCode: overrides.countryCode } : {}),
          },
          referenceIds: latest.referenceIds,
          authoredBy: [actorId],
          basedOnVersionId: latest._id,
        },
      ],
      { session },
    );
    const res = await MissionModel.updateOne(
      { _id: mission._id, openDraftVersionId: null },
      { $set: { openDraftVersionId: draft!._id, latestVersionNumber: versionNumber } },
      { session },
    );
    if (res.modifiedCount !== 1)
      throw AppError.conflict("This mission already has a version in draft or review.");
    return draft!;
  }

  async newDraft(key: string, actorId: string) {
    const mission = await this.getMission(key);
    if (mission.status === "retired") throw AppError.conflict("Retired missions cannot be edited.");
    return inTransaction((s) => this.createDraft(mission, actorId, {}, s));
  }

  async updateDraft(
    versionId: string,
    input: {
      content?: VersionContentInput | undefined;
      referenceIds?: string[] | undefined;
      changeSummary?: string | undefined;
      expectedUpdatedAt: string;
    },
    actorId: string,
  ) {
    const v = await this.getVersion(versionId);
    if (v.status !== "draft")
      throw new AppError(409, "INVALID_STATE_TRANSITION", "Only drafts can be edited.");
    if ((v.get("updatedAt") as Date).toISOString() !== input.expectedUpdatedAt) {
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        "This draft was changed by someone else. Reload and try again.",
      );
    }
    if (input.content) await this.checkCountry(input.content.countryCode);
    if (input.referenceIds) await this.checkReferences(input.referenceIds);
    const set: Record<string, unknown> = {};
    if (input.content) set.content = input.content;
    if (input.referenceIds) set.referenceIds = input.referenceIds;
    if (input.changeSummary !== undefined) set.changeSummary = input.changeSummary;
    const updated = await MissionVersionModel.findOneAndUpdate(
      { _id: v._id, status: "draft", updatedAt: v.get("updatedAt") },
      { $set: set, $addToSet: { authoredBy: new Types.ObjectId(actorId) } },
      { new: true, runValidators: true },
    );
    if (!updated)
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        "This draft was changed by someone else. Reload and try again.",
      );
    return updated;
  }

  /** Freezes the draft, computes its content hash and sends it to clinician review. */
  async submit(versionId: string, changeSummary: string, actorId: string) {
    const v = await this.getVersion(versionId);
    if (v.status !== "draft")
      throw new AppError(409, "INVALID_STATE_TRANSITION", "Only drafts can be submitted.");
    const hash = hashVersion(v);
    const res = await MissionVersionModel.updateOne(
      { _id: v._id, status: "draft" },
      {
        $set: { status: "in_review", contentHash: hash, submittedAt: new Date(), changeSummary },
        $addToSet: { authoredBy: new Types.ObjectId(actorId) },
      },
    );
    if (res.modifiedCount !== 1)
      throw new AppError(409, "INVALID_STATE_TRANSITION", "Only drafts can be submitted.");
    return this.getVersion(versionId);
  }

  async discardDraft(versionId: string) {
    const v = await this.getVersion(versionId);
    if (v.status !== "draft")
      throw new AppError(409, "INVALID_STATE_TRANSITION", "Only drafts can be discarded.");
    await inTransaction(async (s) => {
      await MissionVersionModel.deleteOne({ _id: v._id, status: "draft" }, { session: s });
      const mission = await MissionModel.findById(v.missionId, null, { session: s });
      const latest = await MissionVersionModel.findOne({ missionId: v.missionId }, null, {
        session: s,
      }).sort({ versionNumber: -1 });
      await MissionModel.updateOne(
        { _id: v.missionId },
        { $set: { openDraftVersionId: null, latestVersionNumber: latest?.versionNumber ?? 0 } },
        { session: s },
      );
      if (mission && !latest) await MissionModel.deleteOne({ _id: mission._id }, { session: s }); // never-submitted mission
    });
  }

  async updatePlacement(
    key: string,
    input: {
      tier?: number | undefined;
      icon?: string | undefined;
      sortOrder?: number | undefined;
      topics?: string[] | undefined;
      offlineEligible?: boolean | undefined;
    },
  ) {
    const mission = await this.getMission(key);
    const before = {
      tier: mission.tier,
      icon: mission.icon,
      sortOrder: mission.sortOrder,
      topics: [...(mission.topics ?? [])],
      offlineEligible: Boolean(mission.offlineEligible),
    };
    Object.assign(
      mission,
      Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    );
    await mission.save();
    return { mission, before };
  }

  /**
   * Assigns missions to a country. Country is clinical content (guidelines differ), so the change is made in a
   * draft version that needs clinician approval; the live mission changes country only when that version publishes.
   */
  async assignToCountry(missionKeys: string[], countryCode: string, actorId: string) {
    const out: {
      missionKey: string;
      action: "unchanged" | "draft_created" | "draft_updated";
      versionNumber: number | null;
    }[] = [];
    for (const key of missionKeys) {
      const mission = await this.getMission(key);
      const open = mission.openDraftVersionId
        ? await MissionVersionModel.findById(mission.openDraftVersionId)
        : null;
      const currentCountry = open?.content?.countryCode ?? mission.countryCode;
      if (currentCountry === countryCode) {
        out.push({
          missionKey: key,
          action: "unchanged",
          versionNumber: open?.versionNumber ?? null,
        });
        continue;
      }
      if (open && open.status !== "draft") {
        throw AppError.conflict(
          `Mission ${key} has a version in clinician review; wait for the decision first.`,
        );
      }
      if (open) {
        await MissionVersionModel.updateOne(
          { _id: open._id, status: "draft" },
          {
            $set: { "content.countryCode": countryCode },
            $addToSet: { authoredBy: new Types.ObjectId(actorId) },
          },
        );
        out.push({ missionKey: key, action: "draft_updated", versionNumber: open.versionNumber });
        continue;
      }
      const created = await inTransaction((s) =>
        this.createDraft(mission, actorId, { countryCode }, s),
      );
      out.push({ missionKey: key, action: "draft_created", versionNumber: created.versionNumber });
    }
    return out;
  }

  // ---- Publishing controls --------------------------------------------------------------------
  /** Hides a mission from players immediately (e.g. a safety concern) and ends in-progress attempts. */
  async withdraw(key: string) {
    const mission = await this.getMission(key);
    if (mission.status !== "published")
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        "Only published missions can be withdrawn.",
      );
    return inTransaction(async (s) => {
      mission.status = "withdrawn";
      await mission.save({ session: s });
      await MissionVersionModel.updateOne(
        { _id: mission.publishedVersionId, status: "published" },
        { $set: { status: "withdrawn", withdrawnAt: new Date() } },
        { session: s },
      );
      const expired = await MissionAttemptModel.updateMany(
        { missionId: mission._id, status: "in_progress" },
        { $set: { status: "expired", completedAt: new Date() } },
        { session: s },
      );
      return { mission, attemptsEnded: expired.modifiedCount };
    });
  }

  /** Re-publishes the withdrawn, previously approved version unchanged. */
  async restore(key: string) {
    const mission = await this.getMission(key);
    if (mission.status !== "withdrawn")
      throw new AppError(
        409,
        "INVALID_STATE_TRANSITION",
        "Only withdrawn missions can be restored.",
      );
    return inTransaction(async (s) => {
      await MissionVersionModel.updateOne(
        { _id: mission.publishedVersionId, status: "withdrawn" },
        { $set: { status: "published", withdrawnAt: null } },
        { session: s },
      );
      mission.status = "published";
      await mission.save({ session: s });
      return mission;
    });
  }

  /** Permanently removes a mission from play (history is kept). */
  async retire(key: string) {
    const mission = await this.getMission(key);
    if (mission.status === "retired")
      throw new AppError(409, "INVALID_STATE_TRANSITION", "Already retired.");
    return inTransaction(async (s) => {
      if (mission.publishedVersionId) {
        await MissionVersionModel.updateOne(
          { _id: mission.publishedVersionId, status: { $in: ["published", "withdrawn"] } },
          { $set: { status: "withdrawn", withdrawnAt: new Date() } },
          { session: s },
        );
      }
      await MissionAttemptModel.updateMany(
        { missionId: mission._id, status: "in_progress" },
        { $set: { status: "expired", completedAt: new Date() } },
        { session: s },
      );
      mission.status = "retired";
      await mission.save({ session: s });
      return mission;
    });
  }
}
