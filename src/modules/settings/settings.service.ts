import {
  AiSettingsSchema,
  EconomySettingsSchema,
  ProgressionSettingsSchema,
  type EconomySettings,
  type ProgressionSettings,
  type z,
} from "@ahq/api-contracts";
import type { ClientSession } from "mongoose";
import { AppError } from "../../lib/errors.js";
import { SYSTEM_ACTOR_ID, recordAudit } from "../audit/audit-log.model.js";
import { DEFAULT_AI } from "../ai/ai.defaults.js";
import { DEFAULT_ECONOMY, DEFAULT_PROGRESSION } from "./settings.defaults.js";
import { PlatformSettingModel, type SettingKey } from "./settings.model.js";

type Registry = {
  economy: { schema: typeof EconomySettingsSchema; value: EconomySettings };
  progression: { schema: typeof ProgressionSettingsSchema; value: ProgressionSettings };
  hospital: { schema: z.ZodTypeAny; value: unknown };
  ai: { schema: z.ZodTypeAny; value: unknown };
};
type Value<K extends SettingKey> = Registry[K]["value"];

const CACHE_MS = 30_000;

/** Versioned, validated platform settings with a short in-process cache. */
export class SettingsService {
  private readonly schemas = new Map<SettingKey, z.ZodTypeAny>([
    ["economy", EconomySettingsSchema],
    ["progression", ProgressionSettingsSchema],
    ["ai", AiSettingsSchema],
  ]);
  private readonly defaults = new Map<SettingKey, unknown>([
    ["economy", DEFAULT_ECONOMY],
    ["progression", DEFAULT_PROGRESSION],
    ["ai", DEFAULT_AI],
  ]);
  private readonly cache = new Map<SettingKey, { value: unknown; version: number; at: number }>();

  /** Lets other modules (e.g. hospital) register their setting schema and defaults. */
  register(key: SettingKey, schema: z.ZodTypeAny, defaults: unknown) {
    this.schemas.set(key, schema);
    this.defaults.set(key, defaults);
  }

  async get<K extends SettingKey>(key: K): Promise<{ value: Value<K>; version: number }> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS)
      return { value: hit.value as Value<K>, version: hit.version };
    let doc = await PlatformSettingModel.findOne({ key, status: "active" }).lean();
    if (!doc) {
      await this.ensureDefault(key);
      doc = await PlatformSettingModel.findOne({ key, status: "active" }).lean();
    }
    this.cache.set(key, { value: doc!.value, version: doc!.version, at: Date.now() });
    return { value: doc!.value as Value<K>, version: doc!.version };
  }

  /** Returns the value of a specific (possibly archived) version — e.g. the economy an attempt was started with. */
  async getVersion<K extends SettingKey>(key: K, version: number): Promise<Value<K>> {
    const doc = await PlatformSettingModel.findOne({ key, version }).lean();
    if (!doc) throw AppError.notFound(`Setting ${key} v${version} not found.`);
    return doc.value as Value<K>;
  }

  async ensureDefault(key: SettingKey) {
    try {
      await PlatformSettingModel.create({
        key,
        version: 1,
        status: "active",
        value: this.defaults.get(key),
        changeNote: "Initial defaults",
        createdBy: SYSTEM_ACTOR_ID,
      });
    } catch (e) {
      if ((e as { code?: number }).code !== 11000) throw e; // another instance created it
    }
  }

  async history(key: SettingKey, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      PlatformSettingModel.find({ key })
        .sort({ version: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
      PlatformSettingModel.countDocuments({ key }),
    ]);
    return { items, total };
  }

  /** Creates a new active version (optimistic concurrency on expectedVersion), archiving the previous one. */
  async update(
    key: SettingKey,
    input: { value: unknown; changeNote: string; expectedVersion: number },
    actor: { id: string; roles: string[] },
    requestId?: string,
  ) {
    const schema = this.schemas.get(key);
    if (!schema) throw AppError.notFound("Unknown setting.");
    const parsed = schema.safeParse(input.value);
    if (!parsed.success) {
      throw AppError.badRequest(
        "Invalid setting value.",
        parsed.error.issues.map((i) => ({
          path: ["value", ...i.path].join("."),
          message: i.message,
        })),
      );
    }
    const current = await this.get(key);
    if (current.version !== input.expectedVersion) {
      throw new AppError(
        412,
        "PRECONDITION_FAILED",
        `Settings changed meanwhile (now version ${current.version}).`,
      );
    }
    const session = await PlatformSettingModel.startSession();
    let version = 0;
    try {
      await session.withTransaction(async (s: ClientSession) => {
        const res = await PlatformSettingModel.updateOne(
          { key, status: "active", version: input.expectedVersion },
          { $set: { status: "archived" } },
          { session: s },
        );
        if (res.modifiedCount !== 1)
          throw new AppError(412, "PRECONDITION_FAILED", "Settings changed meanwhile.");
        version = input.expectedVersion + 1;
        await PlatformSettingModel.create(
          [
            {
              key,
              version,
              status: "active",
              value: parsed.data,
              changeNote: input.changeNote,
              createdBy: actor.id,
            },
          ],
          { session: s },
        );
        await recordAudit(
          {
            actorId: actor.id,
            actorRoles: actor.roles,
            action: "settings.updated",
            targetType: "PlatformSetting",
            targetId: `${key}@${version}`,
            before: current.value,
            after: parsed.data,
            reason: input.changeNote,
            ...(requestId ? { requestId } : {}),
          },
          s,
        );
      });
    } finally {
      await session.endSession();
    }
    this.cache.delete(key);
    return { key, version, value: parsed.data };
  }

  clearCache() {
    this.cache.clear();
  }
}
