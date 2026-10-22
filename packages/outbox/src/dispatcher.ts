/**
 * The dispatcher in fs-api (architecture §2 execution model, S3.3):
 *
 * 1. Wake on `NOTIFY fs_outbox` (sent on commit by the enqueue trigger) and poll every second for delayed rows.
 * 2. Claim due rows with `FOR UPDATE SKIP LOCKED` (queued → dispatched), so any number of dispatchers share the
 *    queue without double-claiming, and hand each to the executor.
 * 3. If the hand-off throws, or a remote executor has not moved the row to `running` within 20 s, run the same
 *    task inline (the runner's claim makes the race with a late remote start harmless).
 * 4. A sweeper re-queues rows stuck in `dispatched` for more than 5 minutes, and rows whose `running` heartbeat
 *    went silent for 5 minutes (the process died) — or marks them dead once their attempts are spent.
 *
 * A crash between the committing transaction and the dispatch loses nothing: the row is committed, and the next
 * tick of any dispatcher picks it up.
 */
import { type Db, schema as s } from "@fairsplit/db";
import { eq, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import type { TaskName } from "./_shims/contracts.js";
import type { Executor } from "./executors.js";

/** A claimed row on its way to an executor. */
export interface TaskRef {
  id: string;
  name: TaskName;
  workspaceId: string | null;
}

export const OUTBOX_CHANNEL = "fs_outbox";

export interface DispatcherEvent {
  type: "dispatched" | "dispatch_failed" | "fallback_inline" | "requeued" | "swept" | "tick_failed";
  id?: string;
  name?: string;
  executor?: string;
  error?: string;
  counts?: SweepResult;
}

export interface DispatcherOptions {
  db: Db;
  /** connection string for the LISTEN wake-up; without it the dispatcher relies on polling */
  listenUrl?: string;
  executor: Executor;
  /** where tasks run when the primary executor fails or is slow; required for remote executors */
  fallback?: Executor;
  workerId: string;
  batchSize?: number;
  pollMs?: number;
  /** a remote executor must have the task running within this (default 20 s) */
  startTimeoutMs?: number;
  /** dispatched or silent-running rows older than this are swept (default 5 min) */
  stuckAfterMs?: number;
  sweepEveryMs?: number;
  onEvent?: (e: DispatcherEvent) => void;
}

export interface SweepResult {
  redispatched: number;
  recovered: number;
  dead: number;
}

export interface Dispatcher {
  start(): Promise<void>;
  /** stops claiming; with drain, also waits for the fallback's in-flight inline tasks */
  stop(opts?: { drain?: boolean }): Promise<void>;
  /** claims and dispatches one batch; returns how many rows it claimed */
  tick(): Promise<number>;
  sweep(): Promise<SweepResult>;
  /** for /readyz: the last completed tick */
  readonly lastTickAt: Date | null;
  readonly executorKind: string;
}

export function createDispatcher(o: DispatcherOptions): Dispatcher {
  if (o.executor.remote && !o.fallback) throw new Error("a remote executor needs an inline fallback (G2)");
  const batchSize = o.batchSize ?? 10;
  const pollMs = o.pollMs ?? 1000;
  const startTimeoutMs = o.startTimeoutMs ?? 20_000;
  const stuckSec = (o.stuckAfterMs ?? 300_000) / 1000;
  const emit = o.onEvent ?? (() => {});
  const watchdogs = new Set<NodeJS.Timeout>();
  let pollTimer: NodeJS.Timeout | null = null;
  let sweepTimer: NodeJS.Timeout | null = null;
  let listenSql: Sql | null = null;
  let running = false;
  let ticking: Promise<number> | null = null;
  let again = false;
  let lastTickAt: Date | null = null;

  async function claim(limit: number): Promise<TaskRef[]> {
    const rows = await o.db.execute(sql`
      update ${s.taskOutbox}
         set state = 'dispatched', dispatched_at = now(), executor = ${o.executor.kind}, claimed_by = ${o.workerId}
       where id in (select id from ${s.taskOutbox}
                     where state = 'queued' and run_after <= now()
                     order by run_after, id
                     for update skip locked
                     limit ${limit})
      returning id, name, workspace_id`);
    return (rows as unknown as { id: string; name: string; workspace_id: string | null }[]).map((r) => ({
      id: r.id,
      name: r.name as TaskName,
      workspaceId: r.workspace_id,
    }));
  }

  async function runFallback(task: TaskRef, why: "dispatch_failed" | "fallback_inline", error?: string) {
    emit({ type: why, id: task.id, name: task.name, executor: o.executor.kind, ...(error ? { error } : {}) });
    if (o.fallback) {
      await o.fallback.run(task.name, [task.id]);
      return;
    }
    // no fallback (inline primary failed to accept): put it back for the next tick
    await o.db
      .update(s.taskOutbox)
      .set({ state: "queued", claimedBy: null, executor: null })
      .where(sql`${s.taskOutbox.id} = ${task.id} and ${s.taskOutbox.state} = 'dispatched'`);
    emit({ type: "requeued", id: task.id, name: task.name });
  }

  function watch(task: TaskRef) {
    const timer = setTimeout(() => {
      watchdogs.delete(timer);
      void (async () => {
        const [row] = await o.db
          .select({ state: s.taskOutbox.state })
          .from(s.taskOutbox)
          .where(eq(s.taskOutbox.id, task.id));
        if (row?.state === "dispatched") await runFallback(task, "fallback_inline");
      })().catch((e) => emit({ type: "dispatch_failed", id: task.id, error: String(e) }));
    }, startTimeoutMs);
    timer.unref?.();
    watchdogs.add(timer);
  }

  async function dispatchOne(task: TaskRef) {
    try {
      const receipt = await o.executor.run(task.name, [task.id]);
      if (receipt?.workflowRunId) {
        await o.db
          .update(s.taskOutbox)
          .set({ workflowRunId: receipt.workflowRunId })
          .where(eq(s.taskOutbox.id, task.id));
      }
      emit({ type: "dispatched", id: task.id, name: task.name, executor: o.executor.kind });
      if (o.executor.remote) watch(task);
    } catch (e) {
      await runFallback(task, "dispatch_failed", e instanceof Error ? e.message : String(e));
    }
  }

  async function tickOnce(): Promise<number> {
    const limit = Math.min(batchSize, o.executor.capacity?.() ?? batchSize);
    if (limit <= 0) return 0;
    const tasks = await claim(limit);
    // hand-offs run side by side: one slow startTask must not hold up the rest of the batch
    await Promise.all(tasks.map((task) => dispatchOne(task)));
    lastTickAt = new Date();
    return tasks.length;
  }

  function tick(): Promise<number> {
    if (ticking) {
      again = true;
      return ticking;
    }
    ticking = (async () => {
      let total = 0;
      try {
        do {
          again = false;
          total += await tickOnce();
        } while (again);
      } finally {
        ticking = null;
      }
      return total;
    })();
    return ticking;
  }

  async function sweep(): Promise<SweepResult> {
    const res = await o.db.execute(sql`
      with redispatch as (
        update ${s.taskOutbox}
           set state = 'queued', run_after = now(), claimed_by = null, executor = null
         where state = 'dispatched' and dispatched_at < now() - make_interval(secs => ${stuckSec})
        returning id),
      silent as (
        update ${s.taskOutbox}
           set state = case when attempts >= max_attempts then 'dead' else 'queued' end,
               run_after = now(), claimed_by = null, executor = null,
               finished_at = case when attempts >= max_attempts then now() else finished_at end,
               last_error = left(coalesce(last_error || '; ', '') || 'heartbeat lost', 2000)
         where state = 'running'
           and coalesce(heartbeat_at, started_at, updated_at) < now() - make_interval(secs => ${stuckSec})
        returning state)
      select (select count(*) from redispatch)::int as redispatched,
             (select count(*) from silent where state = 'queued')::int as recovered,
             (select count(*) from silent where state = 'dead')::int as dead`);
    const counts = (res as unknown as SweepResult[])[0] ?? { redispatched: 0, recovered: 0, dead: 0 };
    if (counts.redispatched + counts.recovered + counts.dead > 0) emit({ type: "swept", counts });
    return counts;
  }

  const safeTick = () => {
    if (!running) return;
    tick().catch((e) => emit({ type: "tick_failed", error: e instanceof Error ? e.message : String(e) }));
  };

  async function start() {
    if (running) return;
    running = true;
    if (o.listenUrl) {
      listenSql = postgres(o.listenUrl, { max: 1, onnotice: () => {}, idle_timeout: 0 });
      // on (re)listen, tick: rows committed while the connection was down are picked up at once
      await listenSql.listen(OUTBOX_CHANNEL, safeTick, safeTick);
    }
    pollTimer = setInterval(safeTick, pollMs);
    sweepTimer = setInterval(() => {
      if (running) sweep().catch((e) => emit({ type: "tick_failed", error: String(e) }));
    }, o.sweepEveryMs ?? 60_000);
    safeTick();
  }

  async function stop(opts: { drain?: boolean } = {}) {
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    if (sweepTimer) clearInterval(sweepTimer);
    for (const t of watchdogs) clearTimeout(t);
    watchdogs.clear();
    if (listenSql) await listenSql.end({ timeout: 5 });
    listenSql = null;
    if (ticking) await ticking.catch(() => 0);
    if (opts.drain) {
      for (const ex of [o.executor, o.fallback]) {
        const idle = (ex as { idle?: () => Promise<void> } | undefined)?.idle;
        if (idle) await idle.call(ex);
      }
    }
  }

  return {
    start,
    stop,
    tick,
    sweep,
    get lastTickAt() {
      return lastTickAt;
    },
    executorKind: o.executor.kind,
  };
}
