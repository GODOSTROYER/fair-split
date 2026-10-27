/**
 * The Judge pool (S3.9 "Lifecycle", architecture §10). `judgeReset` keeps a few judge workspaces cloned from the
 * showcase and unclaimed (`expires_at` NULL); a judge's first press claims one for the session's 24 hours.
 *
 * The database holds the claim to that lifetime (migrations/0009 and 0013, `fs_workspaces_guard`, every role):
 *   - a first expiry (NULL → value) must be at least now() + 24 h, by the database's clock;
 *   - after that, an expiry only moves later, never back to NULL, and always more than a minute ahead of the wall
 *     clock;
 *   - `fs_purge_workspace` takes only a judge workspace whose expiry is strictly past.
 * So nothing the app writes can end a session's history early: a Reset ends the session (the cookie), and the hourly
 * `judgeReset` purges the workspace once its expiry has passed.
 *
 * Claim through `claimJudgeWorkspace`: it stamps `claimed_at = now()` and `expires_at = now() + 24 h` (to the
 * millisecond) with the database clock, which is exactly what the guard asks for. An expiry the app computes from its
 * own clock (`Date.now() + 24 h`) lands a little short whenever that clock lags the database's, and is refused.
 */
import { sql } from "drizzle-orm";
import type { Db, DbOrTx } from "./client.js";
import { rethrowDbError } from "./errors.js";
import { isTransaction } from "./tx.js";

/** A judge session (and so its workspace's first expiry) lasts 24 hours: the judge cookie's lifetime (S3.9). */
export const JUDGE_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface ClaimedWorkspace {
  workspaceId: string;
  /** the database's now() when the claim was written */
  claimedAt: Date;
  /** claimedAt + 24 h */
  expiresAt: Date;
}

interface ClaimRow {
  id: string;
  claimed_at: Date | string;
  expires_at: Date | string;
}

const toDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));

/**
 * Claims a pooled judge workspace for one session: the oldest unclaimed one (`FOR NO KEY UPDATE SKIP LOCKED`, so
 * concurrent first presses never get the same workspace and never wait on each other), or `workspaceId` when the
 * caller has just cloned one on demand. Returns null when the pool is empty, or when `workspaceId` is not an
 * unclaimed judge workspace. Takes only the workspace row's lock, so it may run before or inside the transaction
 * that writes the session.
 */
export async function claimJudgeWorkspace(
  db: DbOrTx,
  opts: { workspaceId?: string } = {},
): Promise<ClaimedWorkspace | null> {
  const which =
    opts.workspaceId === undefined
      ? sql`(select id from workspaces
               where kind = 'judge' and expires_at is null
               order by created_at, id
               limit 1
               for no key update skip locked)`
      : sql`(select id from workspaces
               where id = ${opts.workspaceId} and kind = 'judge' and expires_at is null
               for no key update)`;
  // milliseconds: what a client reads back, so writing the returned expiry again is not a change
  const rows = (await db.execute(sql`
    update workspaces
       set claimed_at = date_trunc('milliseconds', now()),
           expires_at = date_trunc('milliseconds', now()) + make_interval(secs => ${JUDGE_SESSION_TTL_MS / 1000})
     where id = ${which} and expires_at is null
    returning id, claimed_at, expires_at`)) as unknown as ClaimRow[];
  const row = rows[0];
  if (!row) return null;
  return { workspaceId: row.id, claimedAt: toDate(row.claimed_at), expiresAt: toDate(row.expires_at) };
}

/**
 * Purges an expired judge workspace with all its rows (the hourly `judgeReset`, S3.9 step 2): true when purged,
 * false when it no longer exists; `FS409 PURGE_REFUSED` (as FairSplitDbError) when it is not a judge workspace, has
 * not expired, or has money in flight (a POSTING run, a payout item not yet terminal).
 *
 * `fs_purge_workspace()` takes the workspace lock before the workspace row (migrations/0014, the src/tx.ts lock
 * order), so it waits for a transition of that workspace to commit instead of deadlocking with it. It runs in a
 * transaction of its own: inside a caller's transaction it would come after whatever row locks the caller holds,
 * which is the order the lock rule forbids, so a transaction is refused here.
 */
export async function purgeJudgeWorkspace(db: Db, workspaceId: string): Promise<boolean> {
  if (isTransaction(db)) {
    throw new TypeError("purgeJudgeWorkspace runs in its own transaction: pass the pool, not a transaction");
  }
  try {
    const rows = (await db.execute(sql`select fs_purge_workspace(${workspaceId}) as ok`)) as unknown as {
      ok: boolean;
    }[];
    return rows[0]?.ok === true;
  } catch (e) {
    rethrowDbError(e);
  }
}
