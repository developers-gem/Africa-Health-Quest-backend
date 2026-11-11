import { PROTOTYPE_MISSIONS } from "@ahq/game-content";
import { describe, expect, it } from "vitest";
import { AuditLogModel } from "../../src/modules/audit/audit-log.model.js";
import { MissionModel, MissionVersionModel } from "../../src/modules/missions/mission.models.js";
import {
  MissionReviewModel,
  ReviewAssignmentModel,
} from "../../src/modules/reviews/review.models.js";
import { SessionModel } from "../../src/modules/auth/session.model.js";
import { PNG_1X1 } from "../fixtures/media.js";
import { createVerifiedUser, makeApp, seedReference, useTestDatabase } from "./helpers.js";

useTestDatabase();
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
type Ctx = ReturnType<typeof makeApp>;
const profile = (name: string) => ({
  fullName: name,
  credentials: "MBChB, FWACP (Paediatrics)",
  profession: "doctor",
  registrationBody: "Medical and Dental Council of Nigeria",
  registrationNumber: "MDCN/R/123456",
  countryCode: "NG",
});

async function setup() {
  const ctx = makeApp();
  await seedReference(ctx);
  const admin = await createVerifiedUser(ctx, "admin@example.com", ["player", "admin"]);
  const player = await createVerifiedUser(ctx, "player@example.com");
  return {
    ctx,
    admin: admin.accessToken as string,
    adminId: admin.user.id as string,
    player: player.accessToken as string,
  };
}

async function makeReviewer(
  ctx: Ctx,
  admin: string,
  email: string,
  name: string,
  extraRoles: "admin"[] = [],
) {
  const u = await createVerifiedUser(ctx, email, ["player", "reviewer", ...extraRoles]);
  await ctx
    .http()
    .put("/api/v1/users/me/clinician-profile")
    .set(bearer(u.accessToken))
    .send(profile(name))
    .expect(200);
  await ctx
    .http()
    .post(`/api/v1/admin/clinicians/${u.user.id}/verify`)
    .set(bearer(admin))
    .send({ decision: "verified", reason: "Registration checked" })
    .expect(200);
  return { token: u.accessToken as string, id: u.user.id as string };
}

async function addReference(ctx: Ctx, token: string, title = "WHO Guidelines for malaria") {
  const r = await ctx
    .http()
    .post("/api/v1/review/references")
    .set(bearer(token))
    .send({
      title,
      organization: "World Health Organization",
      year: 2024,
      type: "guideline",
      url: "https://www.who.int/publications",
    })
    .expect(201);
  return r.body.id as string;
}

const versionOf = async (key: string, status = "in_review") => {
  const m = await MissionModel.findOne({ key }).lean();
  return (await MissionVersionModel.findOne({ missionId: m!._id, status }).lean())!;
};

async function approve(ctx: Ctx, reviewer: string, versionId: string, refId: string) {
  const detail = await ctx
    .http()
    .get(`/api/v1/review/versions/${versionId}`)
    .set(bearer(reviewer))
    .expect(200);
  return ctx
    .http()
    .post(`/api/v1/review/versions/${versionId}/decisions`)
    .set(bearer(reviewer))
    .send({
      decision: "approved",
      contentHash: detail.body.version.contentHash,
      checks: { scenario: true, treatment: true, references: true },
      referenceIds: [refId],
      notes: "",
    });
}

describe("clinician profiles and credential verification", () => {
  it("lets a registered user apply with evidence and an admin verify them", async () => {
    const { ctx, admin } = await setup();
    const applicant = await createVerifiedUser(ctx, "dr.ada@example.com");
    const ev = await ctx
      .http()
      .post("/api/v1/users/me/clinician-evidence?filename=licence.png")
      .set(bearer(applicant.accessToken))
      .set("Content-Type", "image/png")
      .send(PNG_1X1)
      .expect(201);
    expect(ev.body).toMatchObject({
      purpose: "clinician_evidence",
      visibility: "private",
      url: null,
    });
    await ctx
      .http()
      .get(`/api/v1/users/me/clinician-evidence/${ev.body.id}`)
      .set(bearer(applicant.accessToken))
      .expect(200);

    const sub = await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(applicant.accessToken))
      .send({ ...profile("Dr Ada Obi"), evidenceAssetIds: [ev.body.id] })
      .expect(200);
    expect(sub.body).toMatchObject({
      status: "pending",
      registrationNumberMasked: "••••••••456",
      evidence: [{ id: ev.body.id }],
    });
    expect(JSON.stringify(sub.body)).not.toContain("MDCN/R/123456");

    const pending = await ctx
      .http()
      .get("/api/v1/admin/clinicians?status=pending")
      .set(bearer(admin))
      .expect(200);
    expect(pending.body.items[0]).toMatchObject({
      fullName: "Dr Ada Obi",
      registrationNumber: "MDCN/R/123456",
    });
    await ctx
      .http()
      .post(`/api/v1/admin/clinicians/${applicant.user.id}/verify`)
      .set(bearer(admin))
      .send({ decision: "rejected", reason: "Licence image unreadable" })
      .expect(200);
    expect(
      (
        await ctx
          .http()
          .get("/api/v1/users/me/clinician-profile")
          .set(bearer(applicant.accessToken))
          .expect(200)
      ).body,
    ).toMatchObject({ status: "rejected", rejectionReason: "Licence image unreadable" });
    await ctx
      .http()
      .post(`/api/v1/admin/clinicians/${applicant.user.id}/verify`)
      .set(bearer(admin))
      .send({ decision: "verified", reason: "Resubmitted and confirmed" })
      .expect(200);

    // Changing a verified profile requires re-verification.
    const changed = await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(applicant.accessToken))
      .send({ ...profile("Dr Ada Obi"), credentials: "MBBS" })
      .expect(200);
    expect(changed.body.status).toBe("pending");
    expect(
      await AuditLogModel.countDocuments({
        action: "clinician.profile.changed_after_verification",
      }),
    ).toBe(1);
  });

  it("guards evidence ownership, self-verification and access", async () => {
    const { ctx, admin, adminId, player } = await setup();
    const other = await createVerifiedUser(ctx, "other@example.com");
    const ev = await ctx
      .http()
      .post("/api/v1/users/me/clinician-evidence")
      .set(bearer(other.accessToken))
      .set("Content-Type", "image/png")
      .send(PNG_1X1)
      .expect(201);
    await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(player))
      .send({ ...profile("Dr P"), evidenceAssetIds: [ev.body.id] })
      .expect(400);
    await ctx
      .http()
      .get(`/api/v1/users/me/clinician-evidence/${ev.body.id}`)
      .set(bearer(player))
      .expect(404);
    await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(admin))
      .send(profile("Dr Admin"))
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/clinicians/${adminId}/verify`)
      .set(bearer(admin))
      .send({ decision: "verified", reason: "Self" })
      .expect(409);
    await ctx.http().get("/api/v1/admin/clinicians").set(bearer(player)).expect(403);
    const guest = await ctx
      .http()
      .post("/api/v1/auth/guest")
      .set("X-Client-Platform", "mobile")
      .expect(201);
    await ctx
      .http()
      .put("/api/v1/users/me/clinician-profile")
      .set(bearer(guest.body.accessToken))
      .send(profile("Guest"))
      .expect(403);
  });
});

describe("review workflow", () => {
  it("approves a seeded mission with references and publishes it with the reviewer's verified identity", async () => {
    const { ctx, admin, player } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const queue = await ctx.http().get("/api/v1/review/queue").set(bearer(rev.token)).expect(200);
    expect(queue.body.total).toBe(10);
    const v = await versionOf("malaria");
    const detail = await ctx
      .http()
      .get(`/api/v1/review/versions/${v._id}`)
      .set(bearer(rev.token))
      .expect(200);
    expect(detail.body).toMatchObject({
      canDecide: true,
      cannotDecideReason: null,
      diffFromPublished: { against: null, changes: [] },
    });
    expect(
      detail.body.version.content.steps[0].choices.some((c: { correct: boolean }) => c.correct),
    ).toBe(true); // reviewers see the key

    const ref = await addReference(ctx, rev.token);
    const wrongHash = await ctx
      .http()
      .post(`/api/v1/review/versions/${v._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "approved",
        contentHash: "0".repeat(64),
        checks: { scenario: true, treatment: true, references: true },
        referenceIds: [ref],
      });
    expect(wrongHash.status).toBe(409);
    const noRefs = await ctx
      .http()
      .post(`/api/v1/review/versions/${v._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "approved",
        contentHash: v.contentHash,
        checks: { scenario: true, treatment: true, references: true },
        referenceIds: [],
      });
    expect(noRefs.status).toBe(400);
    const partial = await ctx
      .http()
      .post(`/api/v1/review/versions/${v._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "approved",
        contentHash: v.contentHash,
        checks: { scenario: true, treatment: false, references: true },
        referenceIds: [ref],
      });
    expect(partial.status).toBe(400);

    const ok = await approve(ctx, rev.token, String(v._id), ref);
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      decision: "approved",
      reviewer: { name: "Dr Ama Mensah", credentials: "MBChB, FWACP (Paediatrics)" },
      references: [{ title: "WHO Guidelines for malaria" }],
    });

    const pub = await ctx.http().get("/api/v1/missions/malaria").set(bearer(player)).expect(200);
    expect(pub.body.verification).toMatchObject({
      reviewerName: "Dr Ama Mensah",
      references: [
        { title: "WHO Guidelines for malaria", organization: "World Health Organization" },
      ],
    });
    expect(await AuditLogModel.countDocuments({ action: "review.approved" })).toBe(1);
    const decided = await ctx
      .http()
      .post(`/api/v1/review/versions/${v._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "approved",
        contentHash: v.contentHash,
        checks: { scenario: true, treatment: true, references: true },
        referenceIds: [ref],
      });
    expect(decided.status).toBe(409);
    await expect(MissionReviewModel.updateOne({}, { $set: { notes: "x" } })).rejects.toThrow(
      /immutable/,
    );
  });

  it("requests changes, then reviews a corrected draft", async () => {
    const { ctx, admin } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const v1 = await versionOf("sickle");
    await ctx
      .http()
      .post(`/api/v1/review/versions/${v1._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "changes_requested",
        contentHash: v1.contentHash,
        checks: { scenario: true, treatment: false, references: false },
        notes: "short",
      })
      .expect(400);
    await ctx
      .http()
      .post(`/api/v1/review/versions/${v1._id}/decisions`)
      .set(bearer(rev.token))
      .send({
        decision: "changes_requested",
        contentHash: v1.contentHash,
        checks: { scenario: true, treatment: false, references: false },
        notes: "Add hydroxyurea counselling and opioid dosing guidance.",
      })
      .expect(201);
    expect((await MissionVersionModel.findById(v1._id).lean())!.status).toBe("changes_requested");

    const draft = await ctx
      .http()
      .post("/api/v1/admin/missions/sickle/drafts")
      .set(bearer(admin))
      .expect(201);
    expect(draft.body).toMatchObject({
      versionNumber: 2,
      status: "draft",
      basedOnVersionNumber: 1,
    });
    const content = structuredClone(draft.body.content);
    content.steps[0].choices[0].feedback =
      "Yes — fast analgesia (including opioids when needed) and hydration are key in a vaso-occlusive crisis.";
    const edited = await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content, expectedUpdatedAt: draft.body.updatedAt })
      .expect(200);
    await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content, expectedUpdatedAt: draft.body.updatedAt })
      .expect(412);
    const bad = structuredClone(content);
    bad.steps[0].choices[1].correct = true;
    await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content: bad, expectedUpdatedAt: edited.body.updatedAt })
      .expect(400);

    const submitted = await ctx
      .http()
      .post(`/api/v1/admin/versions/${draft.body.id}/submit`)
      .set(bearer(admin))
      .send({ changeSummary: "Analgesia guidance clarified" })
      .expect(200);
    expect(submitted.body.status).toBe("in_review");
    await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content, expectedUpdatedAt: submitted.body.updatedAt })
      .expect(409);
    const ref = await addReference(ctx, rev.token, "Sickle cell disease management guideline");
    expect((await approve(ctx, rev.token, draft.body.id, ref)).status).toBe(201);
    const history = await ctx
      .http()
      .get("/api/v1/review/missions/sickle/history")
      .set(bearer(rev.token))
      .expect(200);
    expect(
      history.body.versions.map((v: { versionNumber: number; status: string }) => [
        v.versionNumber,
        v.status,
      ]),
    ).toEqual([
      [2, "published"],
      [1, "changes_requested"],
    ]);
    expect(history.body.reviews.map((r: { decision: string }) => r.decision)).toEqual([
      "approved",
      "changes_requested",
    ]);
  });

  it("enforces separation of duties and verified credentials", async () => {
    const { ctx, admin } = await setup();
    const both = await makeReviewer(ctx, admin, "both@example.com", "Dr Both", ["admin"]);
    const unverified = await createVerifiedUser(ctx, "unverified@example.com", [
      "player",
      "reviewer",
    ]);
    const v = await versionOf("birth");
    const ref = await addReference(ctx, both.token);
    // Admins without the reviewer role cannot decide at all.
    const asAdmin = await ctx
      .http()
      .post(`/api/v1/review/versions/${v._id}/decisions`)
      .set(bearer(admin))
      .send({
        decision: "approved",
        contentHash: v.contentHash,
        checks: { scenario: true, treatment: true, references: true },
        referenceIds: [ref],
      });
    expect(asAdmin.status).toBe(403);
    const asUnverified = await approve(ctx, unverified.accessToken, String(v._id), ref);
    expect(asUnverified.status).toBe(403);
    expect(asUnverified.body.error.message).toMatch(/credentials must be verified/);

    // An admin-reviewer who authored a version cannot approve it.
    expect((await approve(ctx, both.token, String(v._id), ref)).status).toBe(201);
    const draft = await ctx
      .http()
      .post("/api/v1/admin/missions/birth/drafts")
      .set(bearer(both.token))
      .expect(201);
    await ctx
      .http()
      .post(`/api/v1/admin/versions/${draft.body.id}/submit`)
      .set(bearer(both.token))
      .send({ changeSummary: "Minor wording" })
      .expect(200);
    const own = await approve(ctx, both.token, draft.body.id, ref);
    expect(own.status).toBe(403);
    expect(own.body.error.message).toMatch(/another clinician/);
  });
});

describe("updating published missions", () => {
  it("keeps players on the published version during review and pins in-progress attempts", async () => {
    const { ctx, admin, player } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const ref = await addReference(ctx, rev.token);
    expect(
      (await approve(ctx, rev.token, String((await versionOf("malaria"))._id), ref)).status,
    ).toBe(201);

    const attempt = await ctx
      .http()
      .post("/api/v1/attempts")
      .set(bearer(player))
      .send({ missionKey: "malaria", mode: "story" })
      .expect(201);
    const draft = await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/drafts")
      .set(bearer(admin))
      .expect(201);
    const content = structuredClone(draft.body.content);
    content.title = "Fever in the Rainy Season (updated)";
    const edited = await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content, expectedUpdatedAt: draft.body.updatedAt })
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/versions/${edited.body.id}/submit`)
      .set(bearer(admin))
      .send({ changeSummary: "Title update" })
      .expect(200);

    const detail = await ctx
      .http()
      .get(`/api/v1/review/versions/${draft.body.id}`)
      .set(bearer(rev.token))
      .expect(200);
    expect(detail.body.diffFromPublished).toMatchObject({
      against: 1,
      changes: [
        {
          path: "title",
          before: "Fever in the Rainy Season",
          after: "Fever in the Rainy Season (updated)",
        },
      ],
    });
    expect((await ctx.http().get("/api/v1/missions/malaria").expect(200)).body.title).toBe(
      "Fever in the Rainy Season",
    );

    expect((await approve(ctx, rev.token, draft.body.id, ref)).status).toBe(201);
    expect((await ctx.http().get("/api/v1/missions/malaria").expect(200)).body).toMatchObject({
      title: "Fever in the Rainy Season (updated)",
      versionNumber: 2,
    });
    // The attempt started on v1 continues on v1.
    const s1 = PROTOTYPE_MISSIONS[0]!.steps[0]!;
    const ans = await ctx
      .http()
      .post(`/api/v1/attempts/${attempt.body.id}/answers`)
      .set(bearer(player))
      .send({ stepId: "s1", choiceId: s1.choices.find((c) => c.correct)!.choiceId })
      .expect(200);
    expect(ans.body.next.prompt).toBe(PROTOTYPE_MISSIONS[0]!.steps[1]!.prompt);
    expect(
      (await ctx.http().get(`/api/v1/attempts/${attempt.body.id}`).set(bearer(player)).expect(200))
        .body.title,
    ).toBe("Fever in the Rainy Season");
  });

  it("withdraws, restores, rolls back and retires missions", async () => {
    const { ctx, admin, player } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const ref = await addReference(ctx, rev.token);
    expect(
      (await approve(ctx, rev.token, String((await versionOf("malaria"))._id), ref)).status,
    ).toBe(201);
    const attempt = await ctx
      .http()
      .post("/api/v1/attempts")
      .set(bearer(player))
      .send({ missionKey: "malaria", mode: "story" })
      .expect(201);

    const w = await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/withdraw")
      .set(bearer(admin))
      .send({ reason: "Safety concern raised by a clinician" })
      .expect(200);
    expect(w.body.status).toBe("withdrawn");
    await ctx.http().get("/api/v1/missions/malaria").expect(404);
    const blocked = await ctx
      .http()
      .post(`/api/v1/attempts/${attempt.body.id}/answers`)
      .set(bearer(player))
      .send({ stepId: "s1", choiceId: "s1c1" });
    expect(blocked.body.error.code).toBe("ATTEMPT_NOT_ACTIVE");
    await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/restore")
      .set(bearer(admin))
      .send({ reason: "Concern resolved" })
      .expect(200);
    await ctx.http().get("/api/v1/missions/malaria").expect(200);

    // Publish v2, then roll back to the approved v1.
    const draft = await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/drafts")
      .set(bearer(admin))
      .expect(201);
    const content = structuredClone(draft.body.content);
    content.story = `${content.story} It is the rainy season.`;
    await ctx
      .http()
      .patch(`/api/v1/admin/versions/${draft.body.id}`)
      .set(bearer(admin))
      .send({ content, expectedUpdatedAt: draft.body.updatedAt })
      .expect(200);
    await ctx
      .http()
      .post(`/api/v1/admin/versions/${draft.body.id}/submit`)
      .set(bearer(admin))
      .send({ changeSummary: "Story detail" })
      .expect(200);
    expect((await approve(ctx, rev.token, draft.body.id, ref)).status).toBe(201);
    expect((await ctx.http().get("/api/v1/missions/malaria").expect(200)).body.versionNumber).toBe(
      2,
    );
    await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/rollback")
      .set(bearer(admin))
      .send({ versionNumber: 1, reason: "Revert story change" })
      .expect(200);
    expect((await ctx.http().get("/api/v1/missions/malaria").expect(200)).body).toMatchObject({
      versionNumber: 1,
      verification: { reviewerName: "Dr Ama Mensah" },
    });
    await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/rollback")
      .set(bearer(admin))
      .send({ versionNumber: 1, reason: "Again" })
      .expect(409);

    await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/retire")
      .set(bearer(admin))
      .send({ reason: "Replaced by a new case" })
      .expect(200);
    await ctx.http().get("/api/v1/missions/malaria").expect(404);
    await ctx
      .http()
      .post("/api/v1/admin/missions/malaria/restore")
      .set(bearer(admin))
      .send({ reason: "Undo" })
      .expect(409);
    await ctx.http().post("/api/v1/admin/missions/malaria/drafts").set(bearer(admin)).expect(409);

    await SessionModel.updateMany(
      {},
      { $set: { authenticatedAt: new Date(Date.now() - 3_600_000) } },
    );
    const stale = await ctx
      .http()
      .post("/api/v1/admin/missions/sickle/withdraw")
      .set(bearer(admin))
      .send({ reason: "Testing step-up" });
    expect(stale.body.error.code).toBe("STEP_UP_REQUIRED");
  });
});

describe("authoring, assignments and references", () => {
  it("creates a new mission as a draft that stays hidden until approved", async () => {
    const { ctx, admin } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const create = await ctx
      .http()
      .post("/api/v1/admin/missions")
      .set(bearer(admin))
      .send({
        key: "neonatal-sepsis",
        tier: 0,
        icon: "🍼",
        content: {
          title: "A Floppy Newborn",
          story: "A 5-day-old baby in Kano is feeding poorly and feels hot.",
          countryCode: "NG",
          steps: [
            {
              stepId: "s1",
              prompt: "What do you do first?",
              choices: [
                {
                  choiceId: "s1c1",
                  text: "Check danger signs and refer",
                  correct: true,
                  feedback: "Right.",
                },
                {
                  choiceId: "s1c2",
                  text: "Send home",
                  correct: false,
                  feedback: "Danger.",
                  critical: true,
                },
              ],
            },
          ],
        },
      })
      .expect(201);
    expect(create.body.mission).toMatchObject({
      status: "draft",
      openVersion: { versionNumber: 1, status: "draft" },
    });
    await ctx.http().get("/api/v1/missions/neonatal-sepsis").expect(404);
    await ctx
      .http()
      .post("/api/v1/admin/missions")
      .set(bearer(admin))
      .send({ ...create.body, key: "neonatal-sepsis" })
      .expect(400);
    const sub = await ctx
      .http()
      .post(`/api/v1/admin/versions/${create.body.version.id}/submit`)
      .set(bearer(admin))
      .send({ changeSummary: "New case" })
      .expect(200);
    const ref = await addReference(ctx, rev.token, "IMCI chart booklet");
    expect((await approve(ctx, rev.token, sub.body.id, ref)).status).toBe(201);
    const pub = await ctx.http().get("/api/v1/missions/neonatal-sepsis").expect(200);
    expect(pub.body).toMatchObject({ title: "A Floppy Newborn", stepCount: 1 });
    const placement = await ctx
      .http()
      .patch("/api/v1/admin/missions/neonatal-sepsis")
      .set(bearer(admin))
      .send({ icon: "👶", topics: ["neonatal"] })
      .expect(200);
    expect(placement.body).toMatchObject({
      icon: "👶",
      topics: ["neonatal"],
      published: { versionNumber: 1 },
    });
  });

  it("assigns reviewers and completes assignments on decision", async () => {
    const { ctx, admin } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const unverified = await createVerifiedUser(ctx, "nov@example.com", ["player", "reviewer"]);
    const v = await versionOf("cholera");
    const a = await ctx
      .http()
      .post("/api/v1/admin/reviews/assignments")
      .set(bearer(admin))
      .send({ versionId: String(v._id), reviewerId: rev.id })
      .expect(201);
    expect(a.body).toMatchObject({
      missionKey: "cholera",
      reviewerName: "Dr Ama Mensah",
      status: "open",
    });
    await ctx
      .http()
      .post("/api/v1/admin/reviews/assignments")
      .set(bearer(admin))
      .send({ versionId: String(v._id), reviewerId: rev.id })
      .expect(409);
    await ctx
      .http()
      .post("/api/v1/admin/reviews/assignments")
      .set(bearer(admin))
      .send({ versionId: String(v._id), reviewerId: unverified.user.id })
      .expect(409);
    const mine = await ctx
      .http()
      .get("/api/v1/review/queue?assigned=me")
      .set(bearer(rev.token))
      .expect(200);
    expect(
      mine.body.items.map((i: { missionKey: string; assignedToMe: boolean }) => [
        i.missionKey,
        i.assignedToMe,
      ]),
    ).toEqual([["cholera", true]]);
    const ref = await addReference(ctx, rev.token, "Global Task Force on Cholera Control guidance");
    expect((await approve(ctx, rev.token, String(v._id), ref)).status).toBe(201);
    expect((await ReviewAssignmentModel.findById(a.body.id).lean())!.status).toBe("completed");
    await ctx
      .http()
      .delete(`/api/v1/admin/reviews/assignments/${a.body.id}`)
      .set(bearer(admin))
      .expect(404);
  });

  it("curates the reference library", async () => {
    const { ctx, admin, player } = await setup();
    const rev = await makeReviewer(ctx, admin, "rev@example.com", "Dr Ama Mensah");
    const body = {
      title: "Pocket book of hospital care for children",
      organization: "WHO",
      year: 2013,
      type: "guideline",
      doi: "10.1000/xyz123",
      url: "https://www.who.int/pocketbook",
    };
    const r = await ctx
      .http()
      .post("/api/v1/review/references")
      .set(bearer(rev.token))
      .send(body)
      .expect(201);
    await ctx
      .http()
      .post("/api/v1/review/references")
      .set(bearer(rev.token))
      .send(body)
      .expect(409);
    await ctx
      .http()
      .post("/api/v1/review/references")
      .set(bearer(rev.token))
      .send({ ...body, doi: null, url: "http://insecure.example" })
      .expect(400);
    const upd = await ctx
      .http()
      .patch(`/api/v1/review/references/${r.body.id}`)
      .set(bearer(rev.token))
      .send({ markVerified: true, status: "retired" })
      .expect(200);
    expect(upd.body.status).toBe("retired");
    expect(upd.body.lastVerifiedAt).toBeTruthy();
    const v = await versionOf("child");
    const retiredRef = await approve(ctx, rev.token, String(v._id), r.body.id);
    expect(retiredRef.status).toBe(400);
    await ctx.http().get("/api/v1/review/references").set(bearer(player)).expect(403);
  });
});
