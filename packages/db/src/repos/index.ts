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
import { getTableColumns } from "drizzle-orm";
import type { Provenance, SystemFlag } from "../_shims/contracts.js";
import type { DbOrTx, Tx } from "../client.js";
import { appendEvent, type NewRunEvent, scopedEvent } from "../events.js";
import { isKilled, readFlags, setFlag } from "../flags.js";
import { appendLedger, type LedgerAppend } from "../ledger.js";
import * as s from "../schema/index.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";
import {
  beginPosting,
  type CheckedApprovalVoid,
  type PostingStart,
  voidCheckedApprovals,
} from "./posting.js";
import { type ScopedTable, scopedTable, type WsTable } from "./scoped.js";
import { type SeasonRules, setSeasonRules } from "./seasons.js";
import {
  type ApprovalVoid,
  applyItemStatus,
  DEFAULT_POLICY,
  followItem,
  type HoldTransition,
  type ItemStatusUpdate,
  type LineFollow,
  type LineTransition,
  type RunTransition,
  requestItemCancel,
  type TransitionPolicy,
  transitionHold,
  transitionLine,
  transitionRun,
  voidApprovals,
} from "./transitions.js";

export * from "./posting.js";
export * from "./scoped.js";
export * from "./seasons.js";
export * from "./transitions.js";

/** A signed approval never changes (I4, I6): every column is guarded; `approvals.void()` is the one write. */
const APPROVAL_COLUMNS = Object.keys(getTableColumns(s.approvals)) as (keyof typeof s.approvals.$inferInsert &
  string)[];

export const tables = {
  coops: scopedTable(s.coops, "coops"),
  members: scopedTable(s.members, "members"),
  plots: scopedTable(s.plots, "plots"),
  /** A ratified card freezes its season's terms (I2): only `seasons.setRules()` writes them, while it is a draft. */
  seasons: scopedTable(s.seasons, "seasons", {
    guarded: s.SEASON_RULE_COLUMNS,
    use: "seasons.setRules(), and only before the season's rate card is ratified (I2)",
  }),
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
  payRuns: scopedTable(s.payRuns, "pay_runs", { guarded: ["state", "version"], use: "runs.transition()" }),
  invoices: scopedTable(s.invoices, "invoices"),
  memberLines: scopedTable(s.memberLines, "member_lines", {
    guarded: ["state", "version"],
    use: "lines.transition() or lines.followItem()",
  }),
  holds: scopedTable(s.holds, "holds", {
    guarded: ["state", "version", "resolvedBy", "resolvedAt", "resolution"],
    use: "holdStates.transition()",
  }),
  approvals: scopedTable(s.approvals, "approvals", {
    guarded: APPROVAL_COLUMNS,
    use: "approvals.void(); a signed approval never changes",
  }),
  statements: scopedTable(s.statements, "statements"),
  cashReceipts: scopedTable(s.cashReceipts, "cash_receipts"),
  reviewRequests: scopedTable(s.reviewRequests, "review_requests"),
  payoutBatches: scopedTable(s.payoutBatches, "payout_batches"),
  payoutItems: scopedTable(s.payoutItems, "payout_items", {
    guarded: ["status", "statusRank", "version", "cancelRequestedAt", "cancelIntent"],
    use: "items.applyStatus() or items.requestCancel()",
  }),
  agentSessions: scopedTable(s.agentSessions, "agent_sessions"),
  llmCalls: scopedTable(s.llmCalls, "llm_calls"),
} as const;

type Method = "insert" | "insertMany" | "get" | "require" | "list" | "update";
type Bound<T extends WsTable, G extends string> = {
  [K in Method]: ScopedTable<T, G>[K] extends (db: DbOrTx, scope: WorkspaceScope, ...rest: infer A) => infer R
    ? (db: DbOrTx, ...rest: A) => R
    : never;
};

function bind<T extends WsTable, G extends string>(t: ScopedTable<T, G>, scope: WorkspaceScope): Bound<T, G> {
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
type BoundTables = {
  [K in keyof Tables]: Tables[K] extends ScopedTable<infer T, infer G> ? Bound<T, G> : never;
};

export function repos(scope: WorkspaceScope, policy: TransitionPolicy = DEFAULT_POLICY) {
  const bound = Object.fromEntries(
    Object.entries(tables).map(([k, t]) => [k, bind(t as unknown as ScopedTable<WsTable, string>, scope)]),
  ) as unknown as BoundTables;
  return {
    scope,
    /** a transaction that holds this workspace's lock before anything else (tx.ts lock order) */
    tx: <R>(db: DbOrTx, fn: (tx: Tx) => Promise<R>) => withWorkspaceTx(db, scope, fn),
    ...bound,
    seasons: {
      ...bound.seasons,
      /** writes the season's terms while its rate card is a draft; FS409 RATE_CARD_RATIFIED once it is ratified */
      setRules: (db: DbOrTx, id: string, rules: SeasonRules) => setSeasonRules(db, scope, id, rules),
    },
    runs: {
      ...bound.payRuns,
      transition: (db: DbOrTx, t: RunTransition) => transitionRun(db, scope, t, policy),
      /** APPROVED → POSTING only under the approvals the post was checked under (payouts writeSubmitted, primary) */
      beginPosting: (db: DbOrTx, p: PostingStart) => beginPosting(db, scope, p, policy),
    },
    lines: {
      ...bound.memberLines,
      transition: (db: DbOrTx, t: LineTransition) => transitionLine(db, scope, t, policy),
      /** walk the line to the state its payout item's status maps to (early webhooks, S3.5) */
      followItem: (db: DbOrTx, f: LineFollow) => followItem(db, scope, f, policy),
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
    approvals: {
      ...bound.approvals,
      /** voids the run's live signatures (line edit, kill switch, digest mismatch) and records it in the ledger */
      void: (db: DbOrTx, v: ApprovalVoid) => voidApprovals(db, scope, v),
      /** voids the approvals a failed check named, only while they are the run's live set; APPROVED → IN_REVIEW */
      voidChecked: (db: DbOrTx, v: CheckedApprovalVoid) => voidCheckedApprovals(db, scope, v, policy),
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
