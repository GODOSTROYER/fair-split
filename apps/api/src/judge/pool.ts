// The judge workspace pool (S3.9). A first press claims a pooled workspace (`FOR UPDATE SKIP LOCKED`, so
// two judges never share one) or, when the pool is empty, clones one on the spot. Pooled workspaces are
// unclaimed (`claimed_at` and `expires_at` null) and carry the seed fingerprint in their name, so a deploy
// with a new seed retires the old ones instead of handing them out. A claimed workspace lives 24 h.
//
// Purge (hourly `judgeReset`): `fs_purge_workspace()` deletes an expired judge workspace and everything in
// it. It already refuses while money is in flight (a POSTING run, a non-terminal item). We also wait while
// the workspace's PayPal calls are inside the limiter's window or circuit (7 minutes: the purge cascade
// would delete the `paypal_calls` rows the limiter counts) and while its batches still count toward the
// rolling 24 h live-post quota (the cascade would hand that quota back early).
import { asDbError, type Db, schema, type Tx, uuidv7 } from "@fairsplit/db";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { JUDGE_COOKIE_TTL_MS } from "../credentials/verify/index.js";
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

/** Inserts a judge workspace row and its world, in the caller's transaction. */
export async function cloneWorkspace(
  tx: Tx,
  o: { claimedAt?: Date; expiresAt?: Date } = {},
): Promise<string> {
  const id = uuidv7();
  await tx.insert(schema.workspaces).values({
    id,
    kind: "judge",
    name: poolName(),
    seededFrom: await showcaseId(tx),
    claimedAt: o.claimedAt ?? null,
    expiresAt: o.expiresAt ?? null,
  });
  // lock order (db/tx.ts): the workspace lock before the world's rows and ledger entries
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${id}`}, 0))`);
  await materializeWorld(tx, id);
  return id;
}

/**
 * Claims one pooled workspace of the current seed for 24 h, or returns null when none is free. Two
 * concurrent claims never get the same row (SKIP LOCKED) and never wait on each other.
 */
export async function claimPooledWorkspace(tx: Tx, now: Date, expiresAt: Date): Promise<string | null> {
  const w = schema.workspaces;
  const [free] = await tx
    .select({ id: w.id })
    .from(w)
    .where(and(eq(w.kind, "judge"), isNull(w.claimedAt), isNull(w.expiresAt), eq(w.name, poolName())))
    .orderBy(w.createdAt)
    .limit(1)
    .for("update", { skipLocked: true });
  if (!free) return null;
  const [claimed] = await tx
    .update(w)
    .set({ claimedAt: now, expiresAt })
    .where(and(eq(w.id, free.id), isNull(w.claimedAt)))
    .returning({ id: w.id });
  return claimed?.id ?? null;
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

/** Expires unclaimed judge workspaces cloned from another seed, so the next purge removes them. */
export async function retireStalePool(db: Db, now: Date): Promise<number> {
  const w = schema.workspaces;
  const rows = await db
    .update(w)
    .set({ expiresAt: now })
    .where(and(eq(w.kind, "judge"), isNull(w.claimedAt), isNull(w.expiresAt), ne(w.name, poolName())))
    .returning({ id: w.id });
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
  /** Still holding money in flight, recent PayPal calls, or live posts inside the 24 h quota window. */
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
    const busy = (await db.execute(sql`
      select exists (select 1 from paypal_calls pc
                      where pc.workspace_id = ${id}
                        and pc.at > now() - make_interval(secs => ${quietSec})) as calls,
             exists (select 1 from payout_batches pb
                      where pb.workspace_id = ${id}
                        and pb.submitted_at > now() - interval '24 hours') as posts`)) as unknown as {
      calls: boolean;
      posts: boolean;
    }[];
    if (busy[0]?.calls || busy[0]?.posts) {
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
