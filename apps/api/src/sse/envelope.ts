// A stored `run_events` row → the IC-01 `RunEvent` envelope sent over SSE (S3.7):
// `{id, ws, runId, type, at, actor: {kind, id, impersonatedBy}, provenance, payload}` with the bigserial id
// as a decimal string, which is also the SSE `id:` field and so the client's `Last-Event-ID`.
import type { RunEvent } from "@fairsplit/contracts";
import type { StoredRunEvent } from "@fairsplit/db";

export function toRunEventEnvelope(e: StoredRunEvent): RunEvent {
  return {
    id: String(e.id),
    ws: e.workspaceId,
    runId: e.runId,
    at: e.at.toISOString(),
    actor: { kind: e.actorKind, id: e.actorId, impersonatedBy: e.impersonatedBy ?? null },
    provenance: e.provenance,
    type: e.type,
    payload: e.payload,
  } as RunEvent;
}

/** `Last-Event-ID` header (or `lastEventId` query for clients that cannot set headers) → a numeric id. */
export function parseLastEventId(
  header: string | undefined | null,
  query?: string | null,
): number | undefined {
  const raw = (header ?? query ?? "").trim();
  if (!/^\d{1,15}$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}
