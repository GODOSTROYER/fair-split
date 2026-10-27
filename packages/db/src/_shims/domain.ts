/**
 * TEMPORARY SHIM: replace with @fairsplit/domain after WS-CORE merges.
 *
 * Only what persistence needs from the pure domain:
 * - JCS (RFC 8785) canonicalisation and sha256 (architecture §12, IC-02 `verifyChain`);
 * - the ledger entry hash: sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))
 *   (S3.12). `‖` is read as concatenating the 64-char lowercase hex of prev_hash with the JCS text, UTF-8 encoded;
 * - the transition tables for runs and lines (register §7, architecture §4, S3.5), used as the default
 *   policy by the optimistic `transition()` helpers. They are edge-for-edge WS-CORE's `fsm.run|line|item`
 *   (packages/domain/src/fsm.ts on ws/core), which replaces them; migrations/0006 holds the same edges in SQL and
 *   test/state-guards.test.ts fails if the two ever differ.
 */
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import { ITEM_STATUS_RANK, type ItemStatus, type LineState, type RunState } from "./contracts.js";

export function jcs(value: unknown): string {
  const out = canonicalize(value);
  if (out === undefined) throw new TypeError("JCS: value has no JSON representation");
  return out;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export const GENESIS_HASH = "0".repeat(64);

export interface LedgerHashInput {
  seq: number;
  kind: string;
  actorKind: string;
  actorId: string;
  impersonatedBy: string | null;
  payload: unknown;
  /** ISO-8601 UTC with milliseconds, e.g. 2026-10-23T09:30:00.000Z */
  at: string;
}

export function ledgerEntryHash(prevHash: string, e: LedgerHashInput): string {
  const body = jcs({
    seq: e.seq,
    kind: e.kind,
    actorKind: e.actorKind,
    actorId: e.actorId,
    impersonatedBy: e.impersonatedBy,
    payload: e.payload,
    at: e.at,
  });
  return sha256Hex(prevHash + body);
}

type Edges<S extends string> = Partial<Record<S, readonly S[]>>;

const PRE_POSTING: readonly RunState[] = [
  "DRAFT",
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "EXTRACTING",
  "COMPUTED",
  "IN_REVIEW",
  "TREASURER_APPROVED",
  "AWAITING_BOARD",
  "APPROVED",
];

const RUN_EDGES: Edges<RunState> = {
  DRAFT: ["QUOTED"],
  QUOTED: ["INVOICED"],
  INVOICED: ["FUNDED", "CANCELLED"],
  FUNDED: ["EXTRACTING"],
  EXTRACTING: ["COMPUTED"],
  COMPUTED: ["IN_REVIEW"],
  IN_REVIEW: ["TREASURER_APPROVED"],
  // a line edit (or a digest mismatch at APPROVED) voids approvals and returns the run to IN_REVIEW
  TREASURER_APPROVED: ["APPROVED", "AWAITING_BOARD", "IN_REVIEW"],
  AWAITING_BOARD: ["APPROVED", "IN_REVIEW"],
  APPROVED: ["POSTING", "IN_REVIEW"],
  POSTING: ["POSTED", "DENIED"],
  POSTED: ["SETTLING", "DENIED"],
  SETTLING: ["SETTLED", "NEEDS_FOLLOW_UP", "DENIED"],
  NEEDS_FOLLOW_UP: ["SETTLED"],
  SETTLED: ["CLOSED"],
};

/**
 * Member lines (register §7, S3.5). Every edge but two moves forward: LOCKED → READY unlocks a line whose approvals
 * were voided before posting, and REROUTED → SUBMITTED starts the next attempt. A line never skips SUBMITTED →
 * PAYPAL_PENDING: an item webhook that beats our 201 walks the line through PAYPAL_PENDING in one transaction
 * (`lines.followItem`). RETURNED follows only UNCLAIMED (our own cancel) and leads only to cash or a re-route.
 */
const LINE_EDGES: Record<LineState, readonly LineState[]> = {
  COMPUTED: ["READY", "HELD"],
  HELD: ["READY", "EXCLUDED"],
  READY: ["OFF_RAIL_DUE", "LOCKED"],
  LOCKED: ["SUBMITTED", "READY"],
  SUBMITTED: ["PAYPAL_PENDING", "NEEDS_ACTION"],
  PAYPAL_PENDING: ["PAYPAL_HELD", "UNCLAIMED", "NEEDS_ACTION", "PAID", "REVERSED"],
  PAYPAL_HELD: ["UNCLAIMED", "NEEDS_ACTION", "PAID", "REVERSED"],
  UNCLAIMED: ["RETURNED", "NEEDS_ACTION", "PAID", "REVERSED"],
  RETURNED: ["OFF_RAIL_DUE", "REROUTED"],
  REROUTED: ["SUBMITTED"],
  NEEDS_ACTION: ["PAID", "REVERSED"],
  PAID: ["REVERSED"],
  REVERSED: [],
  OFF_RAIL_DUE: ["OFF_RAIL_PAID"],
  OFF_RAIL_PAID: [],
  EXCLUDED: [],
};

export function canTransitionRun(from: RunState, to: RunState): boolean {
  if (to === "HALTED") return PRE_POSTING.includes(from);
  return RUN_EDGES[from]?.includes(to) ?? false;
}

export function canTransitionLine(from: LineState, to: LineState): boolean {
  return LINE_EDGES[from].includes(to);
}

/** A status applies only if it outranks the current one; RETURNED only follows our own cancel of an UNCLAIMED item. */
export function canApplyItemStatus(
  from: ItemStatus | "SUBMITTED",
  to: ItemStatus,
  opts: { cancelRequested: boolean },
): boolean {
  const a = from === "SUBMITTED" ? 0 : ITEM_STATUS_RANK[from];
  if (ITEM_STATUS_RANK[to] <= a) return false;
  if (to === "RETURNED") return opts.cancelRequested && from === "UNCLAIMED";
  return true;
}
