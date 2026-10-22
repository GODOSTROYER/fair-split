/**
 * I5 · state only moves forward. Every state write is optimistic:
 *
 *   UPDATE … SET state = $next, version = version + 1 WHERE id = $id AND workspace_id = $ws AND state = $expected
 *
 * Zero rows means another writer moved first: the caller gets `{ok: false, reason: "STALE", current}` and reloads.
 * The edge itself is checked against a transition policy first (default: the register's tables in the domain
 * shim; inject WS-CORE's `fsm` once it lands). A successful transition appends its run_event in the same
 * transaction. Payout item statuses climb ranks only (`applyItemStatus`), mirrored by a SQL trigger.
 *
 * Every helper takes the workspace lock before its first row lock (tx.ts), so a transition can never deadlock
 * against another transaction that holds the lock and wants the same row (e.g. the kill-switch handler).
 */
import { and, eq, type SQL, sql } from "drizzle-orm";
import {
  type HoldState,
  ITEM_STATUS_RANK,
  type ItemStatus,
  type LineState,
  type Provenance,
  type RunState,
} from "../_shims/contracts.js";
import { canApplyItemStatus, canTransitionLine, canTransitionRun } from "../_shims/domain.js";
import type { DbOrTx, Tx } from "../client.js";
import { appendEvent, type StoredRunEvent } from "../events.js";
import { holds, memberLines, payoutItems, payRuns } from "../schema/index.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";

export interface TransitionPolicy {
  run(from: RunState, to: RunState): boolean;
  line(from: LineState, to: LineState): boolean;
  hold(from: HoldState, to: HoldState): boolean;
}

const HOLD_EDGES: Record<HoldState, readonly HoldState[]> = {
  OPEN: ["ASKED_CHAIR", "RESOLVED", "EXCLUDED"],
  ASKED_CHAIR: ["RESOLVED", "EXCLUDED"],
  RESOLVED: [],
  EXCLUDED: [],
};

export const DEFAULT_POLICY: TransitionPolicy = {
  run: canTransitionRun,
  line: canTransitionLine,
  hold: (from, to) => HOLD_EDGES[from].includes(to),
};

export type TransitionFailure = {
  ok: false;
  reason: "ILLEGAL" | "STALE" | "NOT_FOUND";
  current: string | null;
};
export type TransitionResult<R> = { ok: true; row: R; event: StoredRunEvent | null } | TransitionFailure;

export type Cause = string | Record<string, unknown>;

type PayRun = typeof payRuns.$inferSelect;
type MemberLine = typeof memberLines.$inferSelect;
type Hold = typeof holds.$inferSelect;
type PayoutItem = typeof payoutItems.$inferSelect;

async function currentState(
  tx: Tx,
  table: typeof payRuns | typeof memberLines | typeof holds,
  scope: WorkspaceScope,
  id: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ state: table.state })
    .from(table)
    .where(and(eq(table.workspaceId, scope.workspaceId), eq(table.id, id)));
  return row?.state ?? null;
}

export interface RunTransition {
  id: string;
  from: RunState;
  to: RunState;
  cause: Cause;
  provenance: Provenance;
  /** other columns written in the same UPDATE (e.g. batchSha256 + senderBatchId on → POSTING) */
  patch?: Partial<Omit<typeof payRuns.$inferInsert, "id" | "workspaceId" | "state" | "version">>;
}

export async function transitionRun(
  db: DbOrTx,
  scope: WorkspaceScope,
  t: RunTransition,
  policy: TransitionPolicy = DEFAULT_POLICY,
): Promise<TransitionResult<PayRun>> {
  if (!policy.run(t.from, t.to)) return { ok: false, reason: "ILLEGAL", current: t.from };
  return withWorkspaceTx(db, scope, async (tx) => {
    const [row] = await tx
      .update(payRuns)
      .set({ ...(t.patch ?? {}), state: t.to, version: sql`${payRuns.version} + 1` })
      .where(and(eq(payRuns.workspaceId, scope.workspaceId), eq(payRuns.id, t.id), eq(payRuns.state, t.from)))
      .returning();
    if (!row) return staleOrMissing(await currentState(tx, payRuns, scope, t.id));
    const event = await appendEvent(tx, {
      workspaceId: scope.workspaceId,
      runId: t.id,
      type: "run.state",
      actor: scope.actor,
      provenance: t.provenance,
      payload: { id: t.id, from: t.from, to: t.to, cause: t.cause, version: row.version },
    });
    return { ok: true, row, event };
  });
}

export interface LineTransition {
  id: string;
  from: LineState;
  to: LineState;
  cause: Cause;
  provenance: Provenance;
  patch?: Partial<
    Omit<typeof memberLines.$inferInsert, "id" | "workspaceId" | "state" | "version" | "runId">
  >;
}

export async function transitionLine(
  db: DbOrTx,
  scope: WorkspaceScope,
  t: LineTransition,
  policy: TransitionPolicy = DEFAULT_POLICY,
): Promise<TransitionResult<MemberLine>> {
  if (!policy.line(t.from, t.to)) return { ok: false, reason: "ILLEGAL", current: t.from };
  return withWorkspaceTx(db, scope, async (tx) => {
    const [row] = await tx
      .update(memberLines)
      .set({ ...(t.patch ?? {}), state: t.to, version: sql`${memberLines.version} + 1` })
      .where(
        and(
          eq(memberLines.workspaceId, scope.workspaceId),
          eq(memberLines.id, t.id),
          eq(memberLines.state, t.from),
        ),
      )
      .returning();
    if (!row) return staleOrMissing(await currentState(tx, memberLines, scope, t.id));
    const event = await appendEvent(tx, {
      workspaceId: scope.workspaceId,
      runId: row.runId,
      lineId: row.id,
      type: "line.state",
      actor: scope.actor,
      provenance: t.provenance,
      payload: { id: t.id, from: t.from, to: t.to, cause: t.cause, version: row.version },
    });
    return { ok: true, row, event };
  });
}

export interface HoldTransition {
  id: string;
  from: HoldState;
  to: HoldState;
  provenance: Provenance;
  resolution?: Record<string, unknown>;
}

/** OPEN → (ASKED_CHAIR) → RESOLVED | EXCLUDED; reaching RESOLVED or EXCLUDED emits hold.resolved. */
export async function transitionHold(
  db: DbOrTx,
  scope: WorkspaceScope,
  t: HoldTransition,
  policy: TransitionPolicy = DEFAULT_POLICY,
): Promise<TransitionResult<Hold>> {
  if (!policy.hold(t.from, t.to)) return { ok: false, reason: "ILLEGAL", current: t.from };
  const terminal = t.to === "RESOLVED" || t.to === "EXCLUDED";
  return withWorkspaceTx(db, scope, async (tx) => {
    const [row] = await tx
      .update(holds)
      .set({
        state: t.to,
        version: sql`${holds.version} + 1`,
        ...(terminal
          ? { resolvedBy: scope.actor.id, resolvedAt: sql`now()`, resolution: t.resolution ?? null }
          : {}),
      })
      .where(and(eq(holds.workspaceId, scope.workspaceId), eq(holds.id, t.id), eq(holds.state, t.from)))
      .returning();
    if (!row) return staleOrMissing(await currentState(tx, holds, scope, t.id));
    const event = terminal
      ? await appendEvent(tx, {
          workspaceId: scope.workspaceId,
          runId: row.runId,
          lineId: row.lineId,
          type: "hold.resolved",
          actor: scope.actor,
          provenance: t.provenance,
          payload: { id: row.id, kind: row.kind, code: row.code, from: t.from, to: t.to },
        })
      : null;
    return { ok: true, row, event };
  });
}

function staleOrMissing(current: string | null): TransitionFailure {
  return current === null
    ? { ok: false, reason: "NOT_FOUND", current }
    : { ok: false, reason: "STALE", current };
}

export interface ItemStatusUpdate {
  /** our row id; or identify by senderItemId */
  id?: string;
  senderItemId?: string;
  status: ItemStatus;
  provenance: Provenance;
  payoutItemId?: string;
  transactionStatus?: string;
  feeCents?: bigint | null;
  feeCurrency?: string | null;
  errors?: unknown;
  /** what caused it, e.g. {webhookEventId} or {get: "payouts-item"} */
  cause?: Cause;
}

export type ItemStatusResult =
  | { applied: true; row: PayoutItem; from: string; event: StoredRunEvent }
  | { applied: false; reason: "NOT_FOUND" | "NOT_HIGHER" | "RETURN_WITHOUT_CANCEL"; current: string | null };

/**
 * Applies a PayPal item status if, and only if, it outranks the current one (register §7). Arrival order is
 * therefore irrelevant: a late PENDING after SUCCESS is a no-op. RETURNED needs our own cancel first.
 */
export async function applyItemStatus(
  db: DbOrTx,
  scope: WorkspaceScope,
  u: ItemStatusUpdate,
): Promise<ItemStatusResult> {
  if (!u.id && !u.senderItemId) throw new TypeError("applyItemStatus: id or senderItemId is required");
  const key: SQL = u.id ? eq(payoutItems.id, u.id) : eq(payoutItems.senderItemId, u.senderItemId as string);
  return withWorkspaceTx(db, scope, async (tx) => {
    const [cur] = await tx
      .select()
      .from(payoutItems)
      .where(and(eq(payoutItems.workspaceId, scope.workspaceId), key))
      .for("update");
    if (!cur) return { applied: false, reason: "NOT_FOUND", current: null };
    const from = cur.status as ItemStatus | "SUBMITTED";
    if (!canApplyItemStatus(from, u.status, { cancelRequested: cur.cancelRequestedAt !== null })) {
      const reason =
        u.status === "RETURNED" &&
        cur.cancelRequestedAt === null &&
        ITEM_STATUS_RANK[u.status] > cur.statusRank
          ? "RETURN_WITHOUT_CANCEL"
          : "NOT_HIGHER";
      return { applied: false, reason, current: cur.status };
    }
    const [row] = await tx
      .update(payoutItems)
      .set({
        status: u.status,
        statusRank: ITEM_STATUS_RANK[u.status],
        version: sql`${payoutItems.version} + 1`,
        ...(u.payoutItemId !== undefined ? { payoutItemId: u.payoutItemId } : {}),
        ...(u.transactionStatus !== undefined ? { transactionStatus: u.transactionStatus } : {}),
        ...(u.feeCents !== undefined ? { feeCents: u.feeCents } : {}),
        ...(u.feeCurrency !== undefined ? { feeCurrency: u.feeCurrency } : {}),
        ...(u.errors !== undefined ? { errors: u.errors } : {}),
      })
      .where(eq(payoutItems.id, cur.id))
      .returning();
    if (!row) throw new Error("applyItemStatus: locked row vanished");
    const event = await appendEvent(tx, {
      workspaceId: scope.workspaceId,
      lineId: row.lineId,
      runId: await runIdOfLine(tx, scope, row.lineId),
      type: "item.updated",
      actor: scope.actor,
      provenance: u.provenance,
      payload: {
        itemId: row.id,
        senderItemId: row.senderItemId,
        lineId: row.lineId,
        from,
        to: row.status,
        rank: row.statusRank,
        cause: u.cause ?? null,
      },
    });
    return { applied: true, row, from, event };
  });
}

async function runIdOfLine(tx: Tx, scope: WorkspaceScope, lineId: string): Promise<string | null> {
  const [l] = await tx
    .select({ runId: memberLines.runId })
    .from(memberLines)
    .where(and(eq(memberLines.workspaceId, scope.workspaceId), eq(memberLines.id, lineId)));
  return l?.runId ?? null;
}

/** Marks our own cancel of an UNCLAIMED item (S3.6.4 step 1); only then may RETURNED apply. Idempotent. */
export async function requestItemCancel(
  db: DbOrTx,
  scope: WorkspaceScope,
  r: { id: string; intent: "cash" | "reroute" },
): Promise<{ ok: true; row: PayoutItem } | { ok: false; current: string | null }> {
  return withWorkspaceTx(db, scope, (tx) => requestItemCancelLocked(tx, scope, r));
}

async function requestItemCancelLocked(
  db: Tx,
  scope: WorkspaceScope,
  r: { id: string; intent: "cash" | "reroute" },
): Promise<{ ok: true; row: PayoutItem } | { ok: false; current: string | null }> {
  const [row] = await db
    .update(payoutItems)
    .set({
      cancelRequestedAt: sql`coalesce(${payoutItems.cancelRequestedAt}, now())`,
      cancelIntent: r.intent,
    })
    .where(
      and(
        eq(payoutItems.workspaceId, scope.workspaceId),
        eq(payoutItems.id, r.id),
        eq(payoutItems.status, "UNCLAIMED"),
      ),
    )
    .returning();
  if (row) return { ok: true, row };
  const [cur] = await db
    .select({ status: payoutItems.status })
    .from(payoutItems)
    .where(and(eq(payoutItems.workspaceId, scope.workspaceId), eq(payoutItems.id, r.id)));
  return { ok: false, current: cur?.status ?? null };
}
