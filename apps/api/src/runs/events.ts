// Typed event and ledger writers for the runs slice.
//
// Events: every payload is parsed with the IC-01 `RunEventPayloads` schema for its type BEFORE it is appended,
// so nothing this slice writes to `run_events` can fail the typed SSE client's validation (api-client/sse.ts
// reports a non-conforming event as an error, not as an event). `appendEvent` writes the row and the
// pg_notify in the caller's transaction (IC-04).
//
// Ledger: the kinds Proof reads (`PROOF_LEDGER_KINDS`) are parsed with the contract's `LedgerPayloads`; every
// other kind carries IDs, enums, hashes and cents only (S3.12). Free text never enters a payload: callers pass
// salted `commitText` commitments for officer text; `noteSha256` is reserved for static gate reasons.
import { createHash } from "node:crypto";
import {
  type LedgerPayload,
  LedgerPayloads,
  type ProofLedgerKind,
  type Provenance,
  type RunEventPayload,
  RunEventPayloads,
  type RunEventType,
} from "@fairsplit/contracts";
import {
  type Actor,
  appendEvent,
  appendLedger,
  type DbOrTx,
  type LedgerEntry,
  type StoredRunEvent,
  type WorkspaceScope,
} from "@fairsplit/db";

export interface EmitOptions {
  runId?: string | null;
  lineId?: string | null;
  provenance: Provenance;
  /** Defaults to the scope's actor (the credential's persona). */
  actor?: Actor;
}

export async function emit<T extends RunEventType>(
  tx: DbOrTx,
  scope: WorkspaceScope,
  type: T,
  payload: RunEventPayload<T>,
  o: EmitOptions,
): Promise<StoredRunEvent> {
  const parsed = RunEventPayloads[type].parse(payload) as Record<string, unknown>;
  return appendEvent(tx, {
    workspaceId: scope.workspaceId,
    runId: o.runId ?? null,
    lineId: o.lineId ?? null,
    type,
    actor: o.actor ?? scope.actor,
    provenance: o.provenance,
    payload: parsed,
  });
}

export interface LedgerOptions {
  runId?: string | null;
  at: Date;
  actor?: Actor;
}

/** A Proof-read ledger kind, checked against the contract's payload shape. */
export function proofLedger<K extends ProofLedgerKind>(
  tx: DbOrTx,
  scope: WorkspaceScope,
  kind: K,
  payload: LedgerPayload<K>,
  o: LedgerOptions,
): Promise<LedgerEntry> {
  const parsed = LedgerPayloads[kind].parse(payload) as Record<string, unknown>;
  return appendLedger(tx, scope, {
    kind,
    payload: parsed,
    runId: o.runId ?? null,
    at: o.at,
    ...(o.actor ? { actor: o.actor } : {}),
  });
}

/** Any other recorded act (hold.resolved, field.entered, flag.flipped, approval.declined, policy.verdict…). */
export function factLedger(
  tx: DbOrTx,
  scope: WorkspaceScope,
  kind: string,
  payload: Record<string, string | number | boolean | null | string[]>,
  o: LedgerOptions,
): Promise<LedgerEntry> {
  return appendLedger(tx, scope, {
    kind,
    payload,
    runId: o.runId ?? null,
    at: o.at,
    ...(o.actor ? { actor: o.actor } : {}),
  });
}

/** Static gate reasons only. Officer free text must use ledger/commitments.ts `commitText`. */
export function noteSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The PayPal side of the world acts as `paypal`; the engine as `engine`; queued work as `system`. */
export const ACTORS = {
  engine: { kind: "engine", id: "engine", impersonatedBy: null },
  paypalGet: { kind: "paypal", id: "paypal:get", impersonatedBy: null },
  paypalPost: { kind: "paypal", id: "paypal:post", impersonatedBy: null },
  paypalWebhook: { kind: "paypal", id: "paypal:webhook", impersonatedBy: null },
  outbox: { kind: "system", id: "system:outbox", impersonatedBy: null },
} as const satisfies Record<string, Actor>;
