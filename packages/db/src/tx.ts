/**
 * Transactions and the per-workspace lock order.
 *
 * Every write that appends to the event log or the ledger serialises on one advisory lock per workspace (the
 * "workspace lock"), so event ids and ledger seqs are assigned in commit order. To make deadlocks impossible, a
 * transaction takes that lock BEFORE its first row lock:
 *
 *   lock order: workspace lock → row locks (pay_runs, member_lines, holds, payout_items, system_flags, …)
 *
 * The repositories follow it: every scoped insert or update, every transition, `lines.followItem`,
 * `items.applyStatus`, `items.requestCancel`, `approvals.void`, `ledger.append`, `flags.set`, `appendEvent` and
 * `openSeedWindow` takes the lock first in its transaction, and so does `fs_purge_workspace()` (`purgeJudgeWorkspace`,
 * migrations/0014) before it locks the workspace row. Code that writes rows with raw Drizzle in the same transaction opens it with `withWorkspaceTx`
 * (or `repos(scope).tx`), which takes the lock before anything else. The lock is held until commit, so never keep
 * such a transaction open across a PayPal or Claude call: commit, call out, then open a new transaction (the
 * outbox task shape).
 */
import { is, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import type { DbOrTx, Tx } from "./client.js";
import type { WorkspaceScope } from "./scope.js";

/**
 * True for an open Drizzle transaction. Uses drizzle's `is()`, which compares entity kinds along the class chain,
 * so it also recognises a transaction created by another installed copy of drizzle-orm (a different peer-dependency
 * variant), where `instanceof` fails and a caller would silently open a nested transaction instead.
 */
export function isTransaction(db: unknown): db is Tx {
  return is(db, PgTransaction);
}

/** Runs fn in db's transaction when db is one, otherwise in a new transaction. */
export function inTransaction<R>(db: DbOrTx, fn: (tx: Tx) => Promise<R>): Promise<R> {
  return isTransaction(db) ? fn(db) : db.transaction(fn);
}

/** Takes the workspace lock until the transaction ends (re-entrant within one transaction). */
export async function lockWorkspaceLog(tx: DbOrTx, workspaceId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${workspaceId}`}, 0))`);
}

/**
 * Opens (or joins) a transaction and takes the workspace lock before anything else, so the caller's row locks
 * always come after it.
 */
export function withWorkspaceTx<R>(
  db: DbOrTx,
  scope: WorkspaceScope | string,
  fn: (tx: Tx) => Promise<R>,
): Promise<R> {
  const workspaceId = typeof scope === "string" ? scope : scope.workspaceId;
  return inTransaction(db, async (tx) => {
    await lockWorkspaceLog(tx, workspaceId);
    return fn(tx);
  });
}
