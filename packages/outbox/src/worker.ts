/**
 * The background worker (EXECUTOR=worker, the S6 fallback): a Render background worker that runs the tasks
 * fs-api's dispatcher hands it. It hears ids on `NOTIFY fs_outbox_worker` and also scans for `dispatched` rows
 * addressed to it, so a missed notification only costs one scan interval. If it is down, fs-api's 20 s
 * watchdog runs the task inline instead.
 */
import { type Db, schema as s } from "@fairsplit/db";
import { and, eq, lt, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import type { TaskName } from "./_shims/contracts.js";
import { inlineExecutor, WORKER_CHANNEL } from "./executors.js";
import { type RunnerDeps, runTask } from "./runner.js";

export interface WorkerOptions extends RunnerDeps {
  listenUrl: string;
  concurrency?: number;
  scanMs?: number;
  onError?: (e: unknown) => void;
}

export interface Worker {
  start(): Promise<void>;
  stop(): Promise<void>;
  scan(): Promise<number>;
}

export function createWorker(o: WorkerOptions): Worker {
  const pool = inlineExecutor((id) => runTask(o, id, "worker"), {
    kind: "worker",
    concurrency: o.concurrency ?? 4,
    onError: (e) => o.onError?.(e),
  });
  let listenSql: Sql | null = null;
  let timer: NodeJS.Timeout | null = null;
  const db: Db = o.db;

  const take = (id: string, name: TaskName) => pool.run(name, [id]);
  // payload "<id>:<name>" (see workerExecutor)
  const onNotify = (payload: string) => {
    const [id, name] = payload.split(":");
    if (id && name) void take(id, name as TaskName);
  };

  async function scan(): Promise<number> {
    const free = pool.capacity();
    if (free <= 0) return 0;
    const rows = await db
      .select({ id: s.taskOutbox.id, name: s.taskOutbox.name })
      .from(s.taskOutbox)
      .where(
        and(
          eq(s.taskOutbox.state, "dispatched"),
          eq(s.taskOutbox.executor, "worker"),
          lt(s.taskOutbox.dispatchedAt, sql`now() - interval '1 second'`),
        ),
      )
      .limit(free);
    for (const r of rows) await take(r.id, r.name as TaskName);
    return rows.length;
  }

  return {
    async start() {
      listenSql = postgres(o.listenUrl, { max: 1, onnotice: () => {}, idle_timeout: 0 });
      await listenSql.listen(WORKER_CHANNEL, onNotify, () => void scan().catch(o.onError));
      timer = setInterval(() => void scan().catch(o.onError), o.scanMs ?? 2000);
    },
    async stop() {
      if (timer) clearInterval(timer);
      if (listenSql) await listenSql.end({ timeout: 5 });
      listenSql = null;
      await pool.idle();
    },
    scan,
  };
}
