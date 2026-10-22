/**
 * WorkspaceScope repositories (IC-04). `repos(scope)` binds every workspace table, the optimistic transitions,
 * the event log, the ledger and the flags to one scope, so handler code never names a workspace id itself:
 *
 *   const r = repos(scope);
 *   await db.transaction(async (tx) => {
 *     const res = await r.runs.transition(tx, { id, from: "APPROVED", to: "POSTING", cause: "post", provenance: "live" });
 *     if (!res.ok) return res; // ILLEGAL | STALE | NOT_FOUND
 *     await r.ledger.append(tx, { kind: "payout.submitting", payload: { runId: id } });
 *   });
 */
import type { Provenance, SystemFlag } from "../_shims/contracts.js";
import type { DbOrTx, Tx } from "../client.js";
import { appendEvent, type NewRunEvent, scopedEvent } from "../events.js";
import { isKilled, readFlags, setFlag } from "../flags.js";
import { appendLedger, type LedgerAppend } from "../ledger.js";
import * as s from "../schema/index.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";
import { type ScopedTable, scopedTable, type WsTable } from "./scoped.js";
import {
  applyItemStatus,
  DEFAULT_POLICY,
  type HoldTransition,
  type ItemStatusUpdate,
  type LineTransition,
  type RunTransition,
  requestItemCancel,
  type TransitionPolicy,
  transitionHold,
  transitionLine,
  transitionRun,
} from "./transitions.js";

export * from "./scoped.js";
export * from "./transitions.js";

export const tables = {
  coops: scopedTable(s.coops, "coops"),
  members: scopedTable(s.members, "members"),
  plots: scopedTable(s.plots, "plots"),
  seasons: scopedTable(s.seasons, "seasons"),
  lots: scopedTable(s.lots, "lots"),
  rateCards: scopedTable(s.rateCards, "rate_cards"),
  rateRules: scopedTable(s.rateRules, "rate_rules"),
  ratifications: scopedTable(s.ratifications, "ratifications"),
  memberships: scopedTable(s.memberships, "memberships"),
  frameTokens: scopedTable(s.frameTokens, "frame_tokens"),
  pairingTokens: scopedTable(s.pairingTokens, "pairing_tokens"),
  deviceKeys: scopedTable(s.deviceKeys, "device_keys"),
  pushTokens: scopedTable(s.pushTokens, "push_tokens"),
  documents: scopedTable(s.documents, "documents"),
  extractionReads: scopedTable(s.extractionReads, "extraction_reads"),
  slipRows: scopedTable(s.slipRows, "slip_rows"),
  slipFields: scopedTable(s.slipFields, "slip_fields"),
  deductionMarks: scopedTable(s.deductionMarks, "deduction_marks"),
  slipAnomalies: scopedTable(s.slipAnomalies, "slip_anomalies"),
  payRuns: scopedTable(s.payRuns, "pay_runs"),
  invoices: scopedTable(s.invoices, "invoices"),
  memberLines: scopedTable(s.memberLines, "member_lines"),
  holds: scopedTable(s.holds, "holds"),
  approvals: scopedTable(s.approvals, "approvals"),
  statements: scopedTable(s.statements, "statements"),
  cashReceipts: scopedTable(s.cashReceipts, "cash_receipts"),
  reviewRequests: scopedTable(s.reviewRequests, "review_requests"),
  payoutBatches: scopedTable(s.payoutBatches, "payout_batches"),
  payoutItems: scopedTable(s.payoutItems, "payout_items"),
  agentSessions: scopedTable(s.agentSessions, "agent_sessions"),
  llmCalls: scopedTable(s.llmCalls, "llm_calls"),
} as const;

type Method = "insert" | "insertMany" | "get" | "require" | "list" | "update";
type Bound<T extends WsTable> = {
  [K in Method]: ScopedTable<T>[K] extends (db: DbOrTx, scope: WorkspaceScope, ...rest: infer A) => infer R
    ? (db: DbOrTx, ...rest: A) => R
    : never;
};

function bind<T extends WsTable>(t: ScopedTable<T>, scope: WorkspaceScope): Bound<T> {
  return {
    insert: (db, values) => t.insert(db, scope, values),
    insertMany: (db, values) => t.insertMany(db, scope, values),
    get: (db, id) => t.get(db, scope, id),
    require: (db, id) => t.require(db, scope, id),
    list: (db, where, opts) => t.list(db, scope, where, opts),
    update: (db, id, patch) => t.update(db, scope, id, patch),
  };
}

type Tables = typeof tables;
type BoundTables = { [K in keyof Tables]: Tables[K] extends ScopedTable<infer T> ? Bound<T> : never };

export function repos(scope: WorkspaceScope, policy: TransitionPolicy = DEFAULT_POLICY) {
  const bound = Object.fromEntries(
    Object.entries(tables).map(([k, t]) => [k, bind(t as unknown as ScopedTable<WsTable>, scope)]),
  ) as unknown as BoundTables;
  return {
    scope,
    /** a transaction that holds this workspace's lock before anything else (tx.ts lock order) */
    tx: <R>(db: DbOrTx, fn: (tx: Tx) => Promise<R>) => withWorkspaceTx(db, scope, fn),
    ...bound,
    runs: {
      ...bound.payRuns,
      transition: (db: DbOrTx, t: RunTransition) => transitionRun(db, scope, t, policy),
    },
    lines: {
      ...bound.memberLines,
      transition: (db: DbOrTx, t: LineTransition) => transitionLine(db, scope, t, policy),
    },
    holdStates: {
      transition: (db: DbOrTx, t: HoldTransition) => transitionHold(db, scope, t, policy),
    },
    items: {
      ...bound.payoutItems,
      applyStatus: (db: DbOrTx, u: ItemStatusUpdate) => applyItemStatus(db, scope, u),
      requestCancel: (db: DbOrTx, r: { id: string; intent: "cash" | "reroute" }) =>
        requestItemCancel(db, scope, r),
    },
    events: {
      append: (db: DbOrTx, e: Omit<NewRunEvent, "workspaceId" | "actor">) =>
        appendEvent(db, scopedEvent(scope, e)),
    },
    ledger: {
      append: (db: DbOrTx, e: LedgerAppend) => appendLedger(db, scope, e),
    },
    flags: {
      read: (db: DbOrTx) => readFlags(db, scope.workspaceId),
      isKilled: (db: DbOrTx, flag: SystemFlag) => isKilled(db, scope.workspaceId, flag),
      set: (db: DbOrTx, flag: SystemFlag, on: boolean, o: { reason?: string; provenance: Provenance }) =>
        setFlag(db, scope, flag, on, o),
    },
  };
}

export type Repos = ReturnType<typeof repos>;
