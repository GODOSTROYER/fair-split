// `judgeReset` (S3.9), one task for both triggers:
//   button (a judge's Reset): every parked UNCLAIMED item of that workspace gets its cancel enqueued (the
//          cash path; at most 2 PayPal calls a reset). The workspace already ended; the hourly pass purges it.
//   cron   (hourly at :07, fs-cron): under a session advisory lock (one pass at a time across processes)
//          1. cancels judge items parked UNCLAIMED for over 15 minutes (at most 5 a pass),
//          2. purges expired judge workspaces that are safe to remove,
//          3. retires pooled workspaces of an older seed and refills the pool to 3,
//          4. writes a `reconciliation_reports{health}` summary for /ops.
// Cancels are never made here: they are `cancelUnclaimed` outbox rows (I7), run by the run slice's handler
// through `PayoutsService.cancelUnclaimed`, which re-checks the kill switch before any PayPal call.
// (S3.9 step 5, the webhook-registration and Claude-budget checks, belongs to WS-PPCORE and WS-READ.)
import { TASKS, TaskArgs } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { enqueue, type TaskContext } from "@fairsplit/outbox";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { AppDeps } from "../lib/context.js";
import { POOL_TARGET, poolSize, purgeExpiredJudgeWorkspaces, refillPool, retireStalePool } from "./pool.js";

/** Judge items parked UNCLAIMED longer than this are cancelled by the hourly pass. */
export const PARKED_AFTER_MS = 15 * 60_000;
export const MAX_CANCELS_PER_PASS = 5;
/** A Reset cancels at most this many items itself ("about 10 s, at most 2 calls"). */
export const MAX_CANCELS_PER_RESET = 2;
const CRON_LOCK = "fs:judge-reset";

export interface JudgeResetReport {
  trigger: "cron" | "button";
  cancelsEnqueued: number;
  purged: number;
  deferred: number;
  poolCreated: number;
  poolRetired: number;
  skipped?: "locked";
}

async function enqueueCancels(
  deps: AppDeps,
  where: { workspaceId?: string; parkedBefore?: Date },
  limit: number,
): Promise<number> {
  const pi = schema.payoutItems;
  const w = schema.workspaces;
  // Parked since: the item.updated event that moved it to UNCLAIMED (the line's events are indexed), else
  // when the item was written. Never updated_at: a webhook re-delivery or a settle GET touches the row and
  // would restart the 15 minutes.
  const parkedSince = sql`coalesce((
    select min(e.at) from run_events e
     where e.line_id = ${pi.lineId} and e.workspace_id = ${pi.workspaceId} and e.type = 'item.updated'
       and e.payload->>'payoutItemId' = ${pi.payoutItemId} and e.payload->>'to' = 'UNCLAIMED'
  ), ${pi.createdAt})`;
  const conditions = [
    eq(w.kind, "judge"),
    eq(pi.status, "UNCLAIMED"),
    isNull(pi.cancelRequestedAt),
    sql`${pi.payoutItemId} is not null`,
    ...(where.workspaceId ? [eq(pi.workspaceId, where.workspaceId)] : []),
    ...(where.parkedBefore ? [sql`${parkedSince} < ${where.parkedBefore.toISOString()}::timestamptz`] : []),
  ];
  const parked = await deps.db
    .select({ workspaceId: pi.workspaceId, payoutItemId: pi.payoutItemId })
    .from(pi)
    .innerJoin(w, eq(w.id, pi.workspaceId))
    .where(and(...conditions))
    .orderBy(asc(parkedSince))
    .limit(limit);
  if (parked.length === 0) return 0;
  let n = 0;
  await deps.db.transaction(async (tx) => {
    for (const item of parked) {
      const args = { payoutItemId: item.payoutItemId as string, afterCancel: "cash" as const };
      const r = await enqueue(tx, "cancelUnclaimed", args, TASKS.cancelUnclaimed.dedupeKey(args), {
        workspaceId: item.workspaceId,
      });
      if (r.inserted) n++;
    }
  });
  return n;
}

async function withCronLock<T>(deps: AppDeps, fn: () => Promise<T>): Promise<T | null> {
  const reserved = await deps.sql.reserve();
  try {
    const [row] = await reserved<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${CRON_LOCK}, 0)) as locked`;
    if (!row?.locked) return null;
    try {
      return await fn();
    } finally {
      await reserved`select pg_advisory_unlock(hashtextextended(${CRON_LOCK}, 0))`;
    }
  } finally {
    reserved.release();
  }
}

/** The task handler (registered by the judge route folder). */
export async function runJudgeReset(
  deps: AppDeps,
  rawArgs: unknown,
  task?: Pick<TaskContext, "outboxId">,
): Promise<JudgeResetReport> {
  const args = TaskArgs.judgeReset.parse(rawArgs);
  const now = deps.clock.now();
  if (args.trigger === "button") {
    if (!args.workspaceId) throw new TypeError("judgeReset{button} needs a workspaceId");
    const cancelsEnqueued = await enqueueCancels(
      deps,
      { workspaceId: args.workspaceId },
      MAX_CANCELS_PER_RESET,
    );
    const report: JudgeResetReport = {
      trigger: "button",
      cancelsEnqueued,
      purged: 0,
      deferred: 0,
      poolCreated: 0,
      poolRetired: 0,
    };
    deps.logger.info({ ...report, outboxId: task?.outboxId }, "judge reset (button)");
    return report;
  }
  const report = await withCronLock(deps, async () => {
    const cancelsEnqueued = await enqueueCancels(
      deps,
      { parkedBefore: new Date(now.getTime() - PARKED_AFTER_MS) },
      MAX_CANCELS_PER_PASS,
    );
    const purge = await purgeExpiredJudgeWorkspaces(deps.db);
    const poolRetired = await retireStalePool(deps.db);
    const poolCreated = await refillPool(deps.db, POOL_TARGET);
    const r: JudgeResetReport = {
      trigger: "cron",
      cancelsEnqueued,
      purged: purge.purged.length,
      deferred: purge.deferred.length,
      poolCreated,
      poolRetired,
    };
    await deps.db.insert(schema.reconciliationReports).values({
      kind: "health",
      windowEnd: now,
      summary: { source: "judgeReset", ...r, poolSize: await poolSize(deps.db), slot: args.slot },
    });
    return r;
  });
  const out: JudgeResetReport = report ?? {
    trigger: "cron",
    cancelsEnqueued: 0,
    purged: 0,
    deferred: 0,
    poolCreated: 0,
    poolRetired: 0,
    skipped: "locked",
  };
  deps.logger.info({ ...out, outboxId: task?.outboxId }, "judge reset (cron)");
  return out;
}
