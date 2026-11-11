import mongoose, { Schema, type ClientSession, type InferSchemaType } from "mongoose";

/** Append-only record of privileged and security-relevant actions. */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    actorRoles: { type: [String], default: undefined },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    reason: { type: String, maxlength: 500 },
    requestId: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

export type AuditLogAttrs = InferSchemaType<typeof auditLogSchema>;
export const AuditLogModel = mongoose.model("AuditLog", auditLogSchema);

/** System actor for automated actions (seeds, jobs). */
export const SYSTEM_ACTOR_ID = "000000000000000000000000";

export type AuditEntry = {
  actorId: string;
  actorRoles?: string[];
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  requestId?: string;
};

export async function recordAudit(entry: AuditEntry, session?: ClientSession) {
  await AuditLogModel.create([entry], session ? { session } : {});
}
