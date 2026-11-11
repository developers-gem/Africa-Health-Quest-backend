import { API_PREFIX } from "@ahq/shared-types";
import {
  CatalogSchema,
  MergeGuestResultSchema,
  MergeGuestSchema,
  SyncBatchResultSchema,
  SyncBatchSchema,
  SyncStateQuerySchema,
  SyncStateSchema,
} from "../schemas/sync.js";
import type { Api } from "./helpers.js";

export function registerSyncRoutes({ route }: Api) {
  const S = `${API_PREFIX}/sync`;
  const tag = "Synchronization";
  route({
    method: "post",
    path: `${S}/events`,
    tag,
    auth: "bearer",
    idempotent: true,
    summary: "Upload queued offline events (applied in order, each at most once)",
    description: [
      "Each event carries a device-generated `eventId` (UUID); re-sending an event returns its stored result with status `duplicate`.",
      "Events in one batch can refer to an attempt started earlier in the queue as `client:<clientRef>`.",
      "Conflicts: the server is authoritative. The first answer to a step wins (same choice → `duplicate`, different choice → `rejected` with the current attempt). Profile edits are last-writer-wins by device time (`stale` when superseded). Funding is checked when the event is processed (`rejected` with `INSUFFICIENT_FUNDS`).",
      "Device timestamps more than 5 minutes in the future are clamped to server time. Clients can never send HP, funding, completion or unlocks.",
    ].join("\n\n"),
    body: SyncBatchSchema,
    ok: [200, SyncBatchResultSchema, "Per-event results and current progress"],
  });
  route({
    method: "get",
    path: `${S}/state`,
    tag,
    auth: "bearer",
    summary: "Pull server state changed since the last sync",
    description:
      "Pass the previous `serverTime` as `since` and the progress `version` you hold as `progressVersion`; unchanged sections are returned as `null`/empty.",
    query: SyncStateQuerySchema,
    ok: [200, SyncStateSchema, "Changes"],
  });
  route({
    method: "post",
    path: `${S}/merge-guest`,
    tag,
    auth: "bearer",
    summary: "Merge a guest's progress into the signed-in registered account",
    description:
      "Completed guest missions are replayed under first-completion rules (rewards are never double-counted); hospital shifts are not transferred. The guest account is then deleted.",
    body: MergeGuestSchema,
    ok: [200, MergeGuestResultSchema, "Merged"],
    errors: [[403, "FORBIDDEN (invalid guest session or target is a guest)"]],
  });
  route({
    method: "get",
    path: `${API_PREFIX}/catalog`,
    tag,
    auth: "public",
    summary:
      "Catalogue for app start and offline caches (tiers, countries, missions, hospital rules)",
    description:
      "Optional bearer token personalises lock states. Supports `If-None-Match` with the returned `ETag` (304 when unchanged). Never contains mission steps or answer keys.",
    ok: [200, CatalogSchema, "Catalogue"],
  });
}
