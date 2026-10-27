/**
 * The dispatcher in fs-api (architecture §2 execution model, S3.3):
 *
 * 1. Wake on `NOTIFY fs_outbox` (sent on commit by the enqueue trigger) and poll every second for delayed rows.
 * 2. Claim due rows with `FOR UPDATE SKIP LOCKED` (queued → dispatched), so any number of dispatchers share the
 *    queue without double-claiming. Each row is routed on its own (routing.ts: money and webhook tasks inline, the
 *    live AI reads on Workflows when EXECUTOR=workflow, replays inline), and its executor and hand-off count are
 *    recorded with the claim. Routing happens first, without locks: the candidates are read, the replay predicate
 *    (default `replayFromDatabase`: a judge workspace or kill_ai_live replays) answers for each one that could leave,
 *    and only then does a short transaction lock the candidates still queued and mark them. Inline rows are claimed
 *    only while the in-process executor has a free slot; rows that could go remote are looked up on their own, so
 *    they never wait behind inline ones.
 * 3. If a remote hand-off throws, or the task has not reached `running` within 20 s, run the same task inline (the
 *    runner's claim makes the race with a late remote start harmless).
 * 4. The sweep (every minute) makes that durable and bounded: a remote hand-off older than the start timeout runs
 *    inline even if the watchdog that should have caught it died with its process; a row still `dispatched` after
 *    5 minutes goes back to the queue, or dead once it has been dispatched max_attempts times; a `running` row whose
 *    heartbeat went silent for 5 minutes (the process died) is re-queued, or dead once its attempts are spent.
 *
 * A crash between the committing transaction and the dispatch loses nothing: the row is committed, and the next
 * tick of any dispatcher picks it up.
 */
import { type Db, schema as s } from "@fairsplit/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import { TASK_NAMES, type TaskName } from "./_shims/contracts.js";
import type { TaskArgs } from "./enqueue.js";
import type { Executor } from "./executors.js";
import { defaultRoute, type ExecutorRoute, replayFromDatabase } from "./routing.js";
import type { ExecutorKind } from "./runner.js";

/** A claimed row on its way to an executor. */
export interface TaskRef {
  id: string;
  name: TaskName;
  workspaceId: string | null;
  /** the row's arguments (ids only), for the replay predicate */
  args: TaskArgs;
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
  /** the executor EXECUTOR names: inline, or a remote one (workflow | worker) for the tasks routed to it */
  executor: Executor;
  /** the in-process executor; required with a remote executor (inline rows, and the fallback for remote ones) */
  fallback?: Executor;
  /** picks each claimed row's executor (default: S3.3's table, see routing.ts) */
  route?: ExecutorRoute;
  /**
   * true when a task will replay recorded output, so it stays inline. Asked before the claim locks anything, and only
   * for a task the route would send away. Default with a remote executor: `replayFromDatabase(db)` (a judge
   * workspace replays, C-06; so does kill_ai_live, per workspace or FS_KILL).
   */
  replay?: (task: TaskRef) => boolean | Promise<boolean>;
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
  /** remote hand-offs past the start timeout, handed to the in-process executor */
  rescued: number;
  /** rows stuck in `dispatched` past stuckAfter, back in the queue */
  redispatched: number;
  /** `running` rows with a silent heartbeat, back in the queue */
  recovered: number;
  /** rows given up: dispatched max_attempts times without finishing, or attempts spent */
  dead: number;
}

export interface Dispatcher {
  start(): Promise<void>;
  /** stops claiming; with drain, also waits for the in-process executor's tasks */
  stop(opts?: { drain?: boolean }): Promise<void>;
  /** claims and dispatches one batch; returns how many rows it claimed */
  tick(): Promise<number>;
  sweep(): Promise<SweepResult>;
  /** for /readyz: the last completed tick */
  readonly lastTickAt: Date | null;
  /** the configured EXECUTOR */
  readonly executorKind: string;
}

type Routed = TaskRef & { kind: ExecutorKind };

export function createDispatcher(o: DispatcherOptions): Dispatcher {
  if (o.executor.remote && !o.fallback) throw new Error("a remote executor needs an inline fallback (G2)");
  const local = (o.executor.remote ? o.fallback : o.executor) as Executor;
  const remote = o.executor.remote ? o.executor : null;
  const route = o.route ?? defaultRoute;
  const replay = o.replay ?? (remote ? replayFromDatabase(o.db) : undefined);
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

  /** The executor kind for one task: the route's answer, inline when it names an executor this process lacks. */
  async function kindOf(task: TaskRef): Promise<ExecutorKind> {
    const ctx = { configured: o.executor.kind, workspaceId: task.workspaceId, replay: false };
    // ask about replay only when it could matter (a task the route would send away)
    if (replay && route(task.name, ctx) !== "inline") {
      try {
        ctx.replay = await replay(task);
      } catch (e) {
        emit({ type: "dispatch_failed", id: task.id, name: task.name, error: `replay check: ${String(e)}` });
        return "inline";
      }
    }
    const kind = route(task.name, ctx);
    return kind === "inline" || kind !== remote?.kind ? "inline" : kind;
  }

  /** Names the route may send to the remote executor (asked with no workspace and no replay). */
  const remoteNames: string[] = remote
    ? TASK_NAMES.filter((n: TaskName) => {
        const kind = route(n, { configured: o.executor.kind, workspaceId: null, replay: false });
        return kind !== "inline" && kind === remote.kind;
      })
    : [];

  type Row = { id: string; name: string; workspace_id: string | null; args: TaskArgs };
  const toTask = (r: Row): TaskRef => ({
    id: r.id,
    name: r.name as TaskName,
    workspaceId: r.workspace_id,
    args: r.args,
  });

  /**
   * Due rows worth routing, read without locks: the oldest of any name while the in-process executor has room, and
   * separately the oldest the route may send away, so those never wait behind inline work.
   */
  async function candidates(inlineFree: number): Promise<TaskRef[]> {
    const byId = new Map<string, Row>();
    if (inlineFree > 0) {
      const rows = (await o.db.execute(sql`
        select id, name, workspace_id, args from ${s.taskOutbox}
         where state = 'queued' and run_after <= now()
         order by run_after, id
         limit ${batchSize}`)) as unknown as Row[];
      for (const r of rows) byId.set(r.id, r);
    }
    if (remoteNames.length > 0) {
      const rows = (await o.db.execute(sql`
        select id, name, workspace_id, args from ${s.taskOutbox}
         where state = 'queued' and run_after <= now() and name in ${remoteNames}
         order by run_after, id
         limit ${batchSize}`)) as unknown as Row[];
      for (const r of rows) byId.set(r.id, r);
    }
    return [...byId.values()].map(toTask);
  }

  async function claim(): Promise<Routed[]> {
    let inlineFree = local.capacity?.() ?? batchSize;
    if (inlineFree <= 0 && !remote) return [];
    // 1. route every candidate first, outside any transaction: the replay check may read the database or call out
    const routed: Routed[] = [];
    for (const task of await candidates(inlineFree)) routed.push({ ...task, kind: await kindOf(task) });
    if (routed.length === 0) return [];
    // 2. a short transaction locks the candidates still queued (another dispatcher may have taken some) and marks them
    return o.db.transaction(async (tx) => {
      const locked = (await tx.execute(sql`
        select id from ${s.taskOutbox}
         where id in ${routed.map((r) => r.id)} and state = 'queued' and run_after <= now()
         for update skip locked`)) as unknown as { id: string }[];
      const free = new Set(locked.map((r) => r.id));
      const picked: Routed[] = [];
      for (const task of routed) {
        if (picked.length >= batchSize) break;
        if (!free.has(task.id)) continue;
        if (task.kind === "inline") {
          if (inlineFree <= 0) continue; // stays queued (and unlocked at commit) for a later tick
          inlineFree--;
        }
        picked.push(task);
      }
      for (const kind of new Set(picked.map((p) => p.kind))) {
        const ids = picked.filter((p) => p.kind === kind).map((p) => p.id);
        await tx
          .update(s.taskOutbox)
          .set({
            state: "dispatched",
            dispatchedAt: sql`now()`,
            dispatches: sql`${s.taskOutbox.dispatches} + 1`,
            executor: kind,
            claimedBy: o.workerId,
          })
          .where(inArray(s.taskOutbox.id, ids));
      }
      return picked;
    });
  }

  /** Runs a task that a remote executor failed to start here, in the in-process executor. */
  async function runFallback(task: TaskRef, why: "dispatch_failed" | "fallback_inline", error?: string) {
    emit({ type: why, id: task.id, name: task.name, executor: o.executor.kind, ...(error ? { error } : {}) });
    await local.run(task.name, [task.id]);
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

  async function dispatchOne(task: Routed) {
    const executor = task.kind === "inline" ? local : (remote as Executor);
    try {
      const receipt = await executor.run(task.name, [task.id]);
      if (receipt?.workflowRunId) {
        await o.db
          .update(s.taskOutbox)
          .set({ workflowRunId: receipt.workflowRunId })
          .where(eq(s.taskOutbox.id, task.id));
      }
      emit({ type: "dispatched", id: task.id, name: task.name, executor: task.kind });
      if (executor.remote) watch(task);
    } catch (e) {
      if (executor.remote)
        await runFallback(task, "dispatch_failed", e instanceof Error ? e.message : String(e));
      else {
        await o.db
          .update(s.taskOutbox)
          .set({ state: "queued", claimedBy: null, executor: null })
          .where(and(eq(s.taskOutbox.id, task.id), eq(s.taskOutbox.state, "dispatched")));
        emit({ type: "requeued", id: task.id, name: task.name, error: String(e) });
      }
    }
  }

  async function tickOnce(): Promise<number> {
    const tasks = await claim();
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
    // remote hand-offs that missed their start: their watchdog may have died with the process that set it
    const late = (await o.db.execute(sql`
      select id, name, workspace_id, args from ${s.taskOutbox}
       where state = 'dispatched' and executor in ('workflow', 'worker')
         and dispatched_at < now() - make_interval(secs => ${startTimeoutMs / 1000})
       order by dispatched_at
       limit ${batchSize * 4}`)) as unknown as {
      id: string;
      name: string;
      workspace_id: string | null;
      args: TaskArgs;
    }[];
    // the runner's claim (dispatched → running) keeps a late remote start and this rescue from both running it
    for (const r of late) {
      await runFallback(
        { id: r.id, name: r.name as TaskName, workspaceId: r.workspace_id, args: r.args },
        "fallback_inline",
      );
    }
    const rescued = late.length;
    const res = await o.db.execute(sql`
      with stale as (
        update ${s.taskOutbox}
           set state = case when dispatches >= max_attempts then 'dead' else 'queued' end,
               run_after = now(), claimed_by = null, executor = null,
               finished_at = case when dispatches >= max_attempts then now() else finished_at end,
               last_error = case when dispatches >= max_attempts
                                 then left(coalesce(last_error || '; ', '') ||
                                           format('dispatched %s times, never finished', dispatches), 2000)
                                 else last_error end
         where state = 'dispatched' and dispatched_at < now() - make_interval(secs => ${stuckSec})
        returning state),
      silent as (
        update ${s.taskOutbox}
           set state = case when attempts >= max_attempts then 'dead' else 'queued' end,
               run_after = now(), claimed_by = null, executor = null,
               finished_at = case when attempts >= max_attempts then now() else finished_at end,
               last_error = left(coalesce(last_error || '; ', '') || 'heartbeat lost', 2000)
         where state = 'running'
           and coalesce(heartbeat_at, started_at, updated_at) < now() - make_interval(secs => ${stuckSec})
        returning state)
      select (select count(*) from stale where state = 'queued')::int as redispatched,
             (select count(*) from silent where state = 'queued')::int as recovered,
             ((select count(*) from stale where state = 'dead') +
              (select count(*) from silent where state = 'dead'))::int as dead`);
    const row = (res as unknown as Omit<SweepResult, "rescued">[])[0] ?? {
      redispatched: 0,
      recovered: 0,
      dead: 0,
    };
    const counts: SweepResult = { rescued, ...row };
    if (counts.rescued + counts.redispatched + counts.recovered + counts.dead > 0)
      emit({ type: "swept", counts });
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
      for (const ex of new Set([o.executor, o.fallback])) {
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
