// The judge workspace pool (S3.9). A first press claims a pooled workspace (a non-blocking workspace lock,
// then WS-DATA's `claimJudgeWorkspace`, a compare-and-set on its row, so two judges never share one) or, when
// the pool is empty, clones one on the spot and claims it. Pooled workspaces are unclaimed (`claimed_at` and
// `expires_at` null) and carry the seed fingerprint in their name, so a deploy with a new seed retires the old
// ones instead of handing them out.
//
// A claim lives 24 h by the DATABASE's clock: the database admits a first expiry only as now() + 24 h (0013), and
// never moves one earlier. So a workspace ends in two ways: its expiry passes, or its session is ended (a Reset,
// a retired pool workspace), which clears `claimed_at` and leaves the expiry to run out (`workspaceInUse`).
//
// Purge (hourly `judgeReset`): `fs_purge_workspace()` deletes an expired judge workspace and everything in
// it. It already refuses while money is in flight (a POSTING run, a non-terminal item). We also wait while
// the workspace's PayPal calls are inside the limiter's window or circuit (7 minutes: the purge cascade
// would delete the `paypal_calls` rows the limiter counts) and while a count still reads one of its batch rows
// (quota.ts `batchesStillCounted`): C-21 counts a batch for 24 h and a lane lease after its write or after a POST
// sent later (its run's fresh slot, a `batch_sent` mark), and the spend from the latest balance reading on its rail,
// whatever its age (its write, or PayPal naming it, at or after that reading; the service's floor guard reads it
// however old). A replayed batch is in no count. A batch POSTed late is counted from that POST, though its rows were
// written a day or more before, so the write alone would let the purge drop a POST C-21 still counts. The judge
// quotas (slots) live in the judge quota ledger, system rows the cascade never touches. Expiry here, and the time the
// counts are read at, is the database clock's, exactly as `fs_purge_workspace()` decides it.
import {
  asDbError,
  type ClaimedWorkspace,
  claimJudgeWorkspace,
  type Db,
  schema,
  type Tx,
  uuidv7,
} from "@fairsplit/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { JUDGE_COOKIE_TTL_MS } from "../credentials/verify/index.js";
import { batchesStillCounted } from "./quota.js";
import { materializeWorld, seedTag } from "./world.js";

/** Unclaimed workspaces kept ready (S3.9: "refills the pool to 3 workspaces"). */
export const POOL_TARGET = 3;
/** A claimed judge workspace lives as long as the judge cookie: 24 h. */
export const JUDGE_WORKSPACE_TTL_MS = JUDGE_COOKIE_TTL_MS;
/** Longest the limiter reads `paypal_calls` back (6-minute circuit), plus a margin. */
export const PURGE_PAYPAL_QUIET_MS = 7 * 60_000;

const POOL_LOCK = "fs:judge-pool";

/** The name every pooled workspace of the current seed carries. */
export function poolName(): string {
  return `judge-pool seed:${seedTag()}`;
}

async function showcaseId(tx: Tx): Promise<string | null> {
  const [row] = await tx
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.kind, "showcase"))
    .orderBy(schema.workspaces.createdAt)
    .limit(1);
  return row?.id ?? null;
}

/**
 * A workspace in use: one that never expires (showcase, real, an unclaimed pool workspace) or a claimed judge
 * workspace before its expiry. A judge workspace whose session ended (claim cleared) is not, whatever its expiry.
 */
export function workspaceInUse(
  row: { claimedAt: Date | null; expiresAt: Date | null } | null,
  now: Date,
): boolean {
  if (!row) return false;
  if (row.expiresAt === null) return true;
  return row.claimedAt !== null && row.expiresAt.getTime() > now.getTime();
}

/** Inserts an unclaimed judge workspace row and its world, in the caller's transaction. */
export async function cloneWorkspace(tx: Tx): Promise<string> {
  const id = uuidv7();
  await tx.insert(schema.workspaces).values({
    id,
    kind: "judge",
    name: poolName(),
    seededFrom: await showcaseId(tx),
    claimedAt: null,
    expiresAt: null,
  });
  // lock order (db/tx.ts): the workspace lock before the world's rows and ledger entries
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${id}`}, 0))`);
  await materializeWorld(tx, id);
  return id;
}

/** How many free pooled workspaces one claim looks at before it clones instead. */
const CLAIM_CANDIDATES = 8;

/**
 * Claims one pooled workspace of the current seed for 24 h by the database's clock, or returns null when none is
 * free. Lock order (db/tx.ts): the workspace lock before its row. Candidates are read without a lock; each is
 * tried with a NON-blocking workspace lock (held to commit, as the session start needs it next), then claimed
 * with WS-DATA's `claimJudgeWorkspace` (a compare-and-set on the row that stamps `claimed_at = now()`,
 * `expires_at = now() + 24 h`). So two concurrent claims never get the same workspace and never wait on each
 * other, and a workspace whose lock someone holds is skipped, not waited on.
 */
export async function claimPooledWorkspace(tx: Tx): Promise<ClaimedWorkspace | null> {
  const w = schema.workspaces;
  const free = and(eq(w.kind, "judge"), isNull(w.claimedAt), isNull(w.expiresAt), eq(w.name, poolName()));
  const candidates = await tx
    .select({ id: w.id })
    .from(w)
    .where(free)
    .orderBy(w.createdAt)
    .limit(CLAIM_CANDIDATES);
  for (const { id } of candidates) {
    const [lock] = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`fs:ws-log:${id}`}, 0)) as locked`,
    )) as unknown as { locked: boolean }[];
    if (!lock?.locked) continue;
    const claimed = await claimJudgeWorkspace(tx, { workspaceId: id });
    if (claimed) return claimed;
  }
  return null;
}

/** Claims a judge workspace this transaction just cloned (database clock, as `claimPooledWorkspace`). */
export async function claimCloned(tx: Tx, workspaceId: string): Promise<ClaimedWorkspace> {
  const claimed = await claimJudgeWorkspace(tx, { workspaceId });
  if (!claimed) throw new Error("a freshly cloned judge workspace could not be claimed");
  return claimed;
}

/** Unclaimed workspaces of the current seed. */
export async function poolSize(db: Db | Tx): Promise<number> {
  const w = schema.workspaces;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(w)
    .where(and(eq(w.kind, "judge"), isNull(w.claimedAt), isNull(w.expiresAt), eq(w.name, poolName())));
  return row?.n ?? 0;
}

/**
 * Retires unclaimed judge workspaces cloned from another seed: never handed out again (an expiry and no claim),
 * and purged once that expiry passes. The database admits no first expiry sooner than now() + 24 h (0013), so the
 * retirement stamps exactly that, by its own clock.
 */
export async function retireStalePool(db: Db): Promise<number> {
  const rows = (await db.execute(sql`
    update workspaces
       set expires_at = date_trunc('milliseconds', now()) + interval '24 hours'
     where kind = 'judge' and claimed_at is null and expires_at is null and name <> ${poolName()}
    returning id`)) as unknown as { id: string }[];
  return rows.length;
}

/**
 * Tops the pool up to `target`, one clone per transaction, serialised across processes by an advisory lock
 * (so two refills never overfill). Returns how many workspaces it created.
 */
export async function refillPool(db: Db, target = POOL_TARGET): Promise<number> {
  let created = 0;
  for (let i = 0; i < target; i++) {
    const made = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${POOL_LOCK}, 0))`);
      if ((await poolSize(tx)) >= target) return false;
      await cloneWorkspace(tx);
      return true;
    });
    if (!made) break;
    created++;
  }
  return created;
}

export interface PurgeOutcome {
  purged: string[];
  /** Still holding money in flight, recent PayPal calls, or a batch C-21 or the spend still counts. */
  deferred: string[];
}

/**
 * Purges expired judge workspaces that are safe to remove (at most `limit` per pass; `only` narrows the pass
 * to the given workspaces).
 */
export async function purgeExpiredJudgeWorkspaces(
  db: Db,
  limit = 20,
  only?: readonly string[],
): Promise<PurgeOutcome> {
  const quietSec = Math.ceil(PURGE_PAYPAL_QUIET_MS / 1000);
  const narrow =
    only && only.length > 0
      ? sql`and w.id in (${sql.join(
          only.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  // The database clock decides expiry here, exactly as fs_purge_workspace() does.
  const candidates = (await db.execute(sql`
    select w.id
      from workspaces w
     where w.kind = 'judge' and w.expires_at is not null and w.expires_at <= now() ${narrow}
     order by w.expires_at
     limit ${limit}`)) as unknown as { id: string }[];
  const out: PurgeOutcome = { purged: [], deferred: [] };
  for (const { id } of candidates) {
    const [busy] = (await db.execute(sql`
      select exists (select 1 from paypal_calls pc
                      where pc.workspace_id = ${id}
                        and pc.at > now() - make_interval(secs => ${quietSec})) as calls,
             now() as now`)) as unknown as { calls: boolean; now: Date | string }[];
    // C-21 and the spend count a batch from its row, which the cascade deletes: wait while either still counts one
    // (a batch POSTed late counts from that POST, its write a day or more before it)
    if (busy?.calls || (await batchesStillCounted(db, id, new Date(busy?.now ?? Date.now())))) {
      out.deferred.push(id);
      continue;
    }
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select fs_purge_workspace(${id}::uuid)`);
      });
      out.purged.push(id);
    } catch (err) {
      if (asDbError(err)?.code === "PURGE_REFUSED") out.deferred.push(id);
      else throw err;
    }
  }
  return out;
}
