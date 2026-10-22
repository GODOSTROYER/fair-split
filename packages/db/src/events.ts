/**
 * `run_events` — the append-only realtime feed, audit timeline and replay source (IC-04 `appendEvent`).
 *
 * - The insert fires `pg_notify('run_events', '<ws>:<id>')` (trigger), which Postgres delivers on commit only.
 * - Appends take the per-workspace lock (tx.ts), so within a workspace event ids are assigned in commit order. An
 *   SSE client resuming from Last-Event-ID can therefore never miss an event that committed late with a smaller id.
 * - Lock order: the workspace lock comes before any row lock. A transaction that writes rows with raw Drizzle and
 *   then appends opens with `withWorkspaceTx` (repository writes and transitions already take the lock first).
 */
import { type Provenance, RUN_EVENT_TYPES, type RunEventType } from "./_shims/contracts.js";
import type { DbOrTx } from "./client.js";
import { type JsonValue, toJsonObject } from "./json.js";
import { runEvents } from "./schema/index.js";
import type { Actor, WorkspaceScope } from "./scope.js";
import { isTransaction, lockWorkspaceLog } from "./tx.js";

export interface NewRunEvent {
  workspaceId: string;
  runId?: string | null;
  lineId?: string | null;
  type: RunEventType;
  actor: Actor;
  provenance: Provenance;
  payload: Record<string, unknown>;
}

export interface StoredRunEvent {
  id: number;
  workspaceId: string;
  runId: string | null;
  lineId: string | null;
  type: string;
  at: Date;
  actorKind: string;
  actorId: string;
  impersonatedBy: string | null;
  provenance: string;
  payload: { [key: string]: JsonValue };
}

/** The S3.7 SSE envelope. */
export interface RunEventEnvelope {
  id: number;
  ws: string;
  runId: string | null;
  lineId: string | null;
  type: string;
  at: string;
  actor: { kind: string; id: string; impersonatedBy?: string };
  provenance: string;
  payload: { [key: string]: JsonValue };
}

const EVENT_TYPES = new Set<string>(RUN_EVENT_TYPES);

export async function appendEvents(tx: DbOrTx, events: readonly NewRunEvent[]): Promise<StoredRunEvent[]> {
  if (events.length === 0) return [];
  if (!isTransaction(tx)) return tx.transaction((inner) => appendEvents(inner, events));
  const values = events.map((e) => {
    if (!EVENT_TYPES.has(e.type)) throw new TypeError(`appendEvent: unknown RunEvent type ${e.type}`);
    return {
      workspaceId: e.workspaceId,
      runId: e.runId ?? null,
      lineId: e.lineId ?? null,
      type: e.type,
      actorKind: e.actor.kind,
      actorId: e.actor.id,
      impersonatedBy: e.actor.impersonatedBy ?? null,
      provenance: e.provenance,
      payload: toJsonObject(e.payload, `${e.type}.payload`),
    };
  });
  const workspaces = [...new Set(values.map((v) => v.workspaceId))].sort();
  for (const ws of workspaces) await lockWorkspaceLog(tx, ws);
  const rows = await tx.insert(runEvents).values(values).returning();
  return rows as StoredRunEvent[];
}

/** IC-04: insert one event in the caller's transaction; listeners hear about it when that transaction commits. */
export async function appendEvent(tx: DbOrTx, event: NewRunEvent): Promise<StoredRunEvent> {
  const [row] = await appendEvents(tx, [event]);
  if (!row) throw new Error("appendEvent: insert returned no row");
  return row;
}

/** Scope-bound variant: workspace and actor come from the credential, never from the caller's body. */
export function scopedEvent(
  scope: WorkspaceScope,
  e: Omit<NewRunEvent, "workspaceId" | "actor"> & { actor?: Actor },
): NewRunEvent {
  return { ...e, workspaceId: scope.workspaceId, actor: e.actor ?? scope.actor };
}

export function toEnvelope(e: StoredRunEvent): RunEventEnvelope {
  return {
    id: e.id,
    ws: e.workspaceId,
    runId: e.runId,
    lineId: e.lineId,
    type: e.type,
    at: e.at.toISOString(),
    actor: {
      kind: e.actorKind,
      id: e.actorId,
      ...(e.impersonatedBy ? { impersonatedBy: e.impersonatedBy } : {}),
    },
    provenance: e.provenance,
    payload: e.payload,
  };
}
