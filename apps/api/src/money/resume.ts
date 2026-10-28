// A written batch is never abandoned (S3.6.4 step 7). Once a batch's rows are written (SUBMITTED, no PayPal id
// yet; a primary batch's run POSTING), the only way to finish it is to POST the very same ids again until PayPal
// answers: the service re-reads the rows, re-checks the digest the officers signed (I4) and either posts, adopts
// PayPal's batch, or refuses. Two things keep that POST coming:
//   - each attempt that has to wait (PayPal's pacing, an unanswered POST, a kill switch) re-queues the post as
//     the press's next attempt row, due when the step said (runs/now.ts `deferTask`); turning a kill switch off
//     brings those waiting attempts forward (`wakeWaitingPosts`, from setFlag);
//   - `resumeStalledPosts`, the catch-up for a post that stopped anyway (an outage that outlasted every attempt,
//     a crash, rows written by an older build): at boot (the runs folder's onBoot), on every hourly cron pass
//     (judgeReset) and when a kill switch is turned off, every stalled batch with no post waiting gets one.
import { type DbOrTx, inTransaction, schema, type Tx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { parseSenderItemId } from "@fairsplit/paypal-payouts";
import { and, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { pressKeyOf } from "../runs/now.js";

const LIVE = ["queued", "dispatched", "running"] as const;

/** The PayPal tasks that wait out a kill switch as queued attempt rows. */
const WAITING_ON_SWITCH = ["postPayoutBatch", "reroute", "cancelUnclaimed"] as const;

interface StalledBatch {
  workspace_id: string;
  run_id: string;
  sender_batch_id: string;
  kind: "primary" | "reroute";
  line_id: string | null;
  sender_item_id: string | null;
}

/** The next attempt key of a press: the press itself when it has no row yet, else `{press}:r{n}`. */
async function nextAttemptKey(tx: Tx, press: string): Promise<string> {
  const t = schema.taskOutbox;
  const rows = await tx
    .select({ id: t.id })
    .from(t)
    .where(or(eq(t.dedupeKey, press), like(t.dedupeKey, `${press}:r%`)));
  return rows.length === 0 ? press : `${press}:r${rows.length}`;
}

async function resumePrimary(tx: Tx, b: StalledBatch): Promise<boolean> {
  const t = schema.taskOutbox;
  const byRun = and(eq(t.name, "postPayoutBatch"), sql`${t.args}->>'runId' = ${b.run_id}`);
  const [waiting] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(byRun, inArray(t.state, [...LIVE])))
    .limit(1);
  if (waiting) return false;
  const [last] = await tx
    .select({ key: t.dedupeKey })
    .from(t)
    .where(byRun)
    .orderBy(desc(t.createdAt))
    .limit(1);
  const press = last ? pressKeyOf(last.key) : `post:${b.sender_batch_id}:resume`;
  const args = { runId: b.run_id, senderBatchId: b.sender_batch_id };
  const r = await enqueue(tx, "postPayoutBatch", args, await nextAttemptKey(tx, press), {
    workspaceId: b.workspace_id,
  });
  return r.inserted;
}

async function resumeReroute(tx: Tx, b: StalledBatch): Promise<boolean> {
  const n = b.sender_item_id ? parseSenderItemId(b.sender_item_id)?.rerouteNo : null;
  if (!b.line_id || !n) return false;
  const t = schema.taskOutbox;
  const byLine = and(eq(t.name, "reroute"), sql`${t.args}->>'lineId' = ${b.line_id}`);
  const [waiting] = await tx
    .select({ id: t.id })
    .from(t)
    .where(and(byLine, inArray(t.state, [...LIVE])))
    .limit(1);
  if (waiting) return false;
  // a re-route resumes under its own press (its key names the approval it was signed with)
  const [last] = await tx
    .select({ key: t.dedupeKey })
    .from(t)
    .where(and(byLine, sql`(${t.args}->>'n')::int = ${n}`))
    .orderBy(desc(t.createdAt))
    .limit(1);
  if (!last) return false;
  const press = pressKeyOf(last.key);
  const r = await enqueue(tx, "reroute", { lineId: b.line_id, n }, await nextAttemptKey(tx, press), {
    workspaceId: b.workspace_id,
  });
  return r.inserted;
}

/**
 * The catch-up: every written batch PayPal has not named yet (a primary one of a POSTING run, or a re-route), with
 * no post queued, dispatched or running for it, gets one as its press's next attempt row. Idempotent; returns how
 * many were enqueued. `db` may be the caller's transaction (setFlag), where the rows commit with the switch.
 */
export async function resumeStalledPosts(
  deps: { db: DbOrTx; logger: Pick<AppDeps["logger"], "warn"> },
  o: { workspaceId?: string } = {},
): Promise<number> {
  const stalled = (await deps.db.execute(sql`
    select pb.workspace_id::text as workspace_id, pb.run_id::text as run_id, pb.sender_batch_id, pb.kind,
           (select pi.line_id::text from payout_items pi where pi.batch_id = pb.id order by pi.id limit 1) as line_id,
           (select pi.sender_item_id from payout_items pi where pi.batch_id = pb.id order by pi.id limit 1)
             as sender_item_id
      from payout_batches pb
      join pay_runs r on r.id = pb.run_id and r.workspace_id = pb.workspace_id
     where pb.status = 'SUBMITTED' and pb.paypal_batch_id is null
       and (pb.kind = 'reroute' or r.state = 'POSTING')
       ${o.workspaceId ? sql`and pb.workspace_id = ${o.workspaceId}` : sql``}
     order by pb.submitted_at`)) as unknown as StalledBatch[];
  let resumed = 0;
  for (const b of stalled) {
    const done = await inTransaction(deps.db, (tx) =>
      b.kind === "primary" ? resumePrimary(tx, b) : resumeReroute(tx, b),
    );
    if (done) resumed++;
  }
  if (resumed > 0) deps.logger.warn({ resumed }, "stalled payout posts resumed with their written ids");
  return resumed;
}

/**
 * A kill switch was turned off: the PayPal steps of this workspace waiting it out (queued attempt rows of a post, a
 * re-route or a cancel) are due now instead of at their next scheduled try. Call inside setFlag's transaction.
 */
export async function wakeWaitingPosts(tx: DbOrTx, workspaceId: string): Promise<number> {
  const t = schema.taskOutbox;
  const woken = await tx
    .update(t)
    .set({ runAfter: sql`now()` })
    .where(
      and(
        eq(t.workspaceId, workspaceId),
        eq(t.state, "queued"),
        inArray(t.name, [...WAITING_ON_SWITCH]),
        sql`${t.runAfter} > now()`,
      ),
    )
    .returning({ id: t.id });
  return woken.length;
}
