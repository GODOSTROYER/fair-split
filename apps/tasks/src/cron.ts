// fs-cron: Render runs `node apps/tasks/dist/cron.js` hourly at :07 (render.yaml `schedule`).
// Each pass enqueues, through the transactional outbox (I7), the scheduled tasks due in this hour:
//   every hour        judgeReset, reconcile{catchup}
//   02:07 UTC         reconcile{nightly}            (S3.3: nightly Transaction Search pass)
//   every 23 hours    warmCaches                    (S4: grammars expire 24 h after last use)
// Dedupe keys are derived from the UTC hour, so a re-run of the same pass is a no-op.
import type { TaskName } from "./_shims/contracts.js";
import { loadDotEnv } from "./env.js";
import { createLogger, type Logger } from "./log.js";
import { isMain } from "./main.js";
import { loadCronSink } from "./wiring.js";

/** Render cron expression for fs-cron: minute 7 of every hour (register §6). */
export const CRON_SCHEDULE = "7 * * * *";
/** Hour (UTC) of the nightly reconcile pass. */
export const NIGHTLY_UTC_HOUR = 2;
/** warmCaches cadence in hours; strictly under the 24 h grammar-cache expiry. */
export const WARM_EVERY_HOURS = 23;

const HOUR_MS = 3_600_000;

export type CronArgValue = string | number;

export interface CronJob {
  readonly name: Extract<TaskName, "judgeReset" | "reconcile" | "warmCaches">;
  readonly args: Readonly<Record<string, CronArgValue>>;
  /** `task_outbox.dedupe_key`: one row per job per slot, ever. */
  readonly dedupeKey: string;
}

/** The outbox port the cron writes to. WS-DATA's adapter wraps `enqueue(tx, name, args, dedupeKey)`. */
export interface CronSink {
  enqueue(job: CronJob): Promise<{ readonly id: string; readonly created: boolean }>;
}

export interface CronResult {
  readonly job: CronJob;
  readonly ok: boolean;
  readonly id?: string;
  readonly created?: boolean;
  readonly error?: string;
}

/** `2026-10-23T05` for any instant within that UTC hour. */
export function hourSlot(now: Date): string {
  return now.toISOString().slice(0, 13);
}

export function hourIndex(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS);
}

/** Pure: the jobs due for the pass that runs at `now`. Order is enqueue order. */
export function planCronRun(now: Date): CronJob[] {
  if (Number.isNaN(now.getTime())) throw new Error("planCronRun needs a valid date");
  const slot = hourSlot(now);
  const jobs: CronJob[] = [
    { name: "judgeReset", args: { trigger: "cron", slot }, dedupeKey: `judgeReset:cron:${slot}` },
    { name: "reconcile", args: { mode: "catchup", slot }, dedupeKey: `reconcile:catchup:${slot}` },
  ];
  if (now.getUTCHours() === NIGHTLY_UTC_HOUR) {
    const date = slot.slice(0, 10);
    jobs.push({ name: "reconcile", args: { mode: "nightly", date }, dedupeKey: `reconcile:nightly:${date}` });
  }
  const h = hourIndex(now);
  if (h % WARM_EVERY_HOURS === 0) {
    const window = h / WARM_EVERY_HOURS;
    jobs.push({ name: "warmCaches", args: { window, slot }, dedupeKey: `warmCaches:w${window}` });
  }
  return jobs;
}

/** Enqueue every planned job; one failure does not stop the others. */
export async function runCron(now: Date, sink: CronSink, logger: Logger): Promise<CronResult[]> {
  const results: CronResult[] = [];
  for (const job of planCronRun(now)) {
    try {
      const { id, created } = await sink.enqueue(job);
      logger.info({ task: job.name, dedupeKey: job.dedupeKey, id, created }, "cron.enqueue");
      results.push({ job, ok: true, id, created });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ task: job.name, dedupeKey: job.dedupeKey, error }, "cron.enqueue failed");
      results.push({ job, ok: false, error });
    }
  }
  return results;
}

export interface CronCliOptions {
  readonly plan: boolean;
  readonly at?: Date;
}

export function parseCronArgs(argv: readonly string[]): CronCliOptions {
  let plan = false;
  let at: Date | undefined;
  for (const arg of argv) {
    if (arg === "--plan" || arg === "--dry-run") plan = true;
    else if (arg.startsWith("--at=")) {
      at = new Date(arg.slice(5));
      if (Number.isNaN(at.getTime())) throw new Error(`--at is not a date: ${arg.slice(5)}`);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return at ? { plan, at } : { plan };
}

/** Exit code: 0 all enqueued (or plan only), 1 any enqueue failed or no outbox is wired. */
export async function main(
  argv: readonly string[],
  deps: { sink?: CronSink | undefined; logger?: Logger; now?: () => Date } = {},
): Promise<number> {
  const logger = deps.logger ?? createLogger({ entry: "cron" });
  const opts = parseCronArgs(argv);
  const now = opts.at ?? deps.now?.() ?? new Date();
  if (opts.plan) {
    for (const job of planCronRun(now))
      logger.info({ task: job.name, args: job.args, dedupeKey: job.dedupeKey }, "cron.plan");
    return 0;
  }
  const sink = "sink" in deps ? deps.sink : await loadCronSink();
  if (!sink) {
    logger.error(
      { jobs: planCronRun(now).map((j) => j.dedupeKey) },
      "cron: no outbox sink wired (WS-DATA); nothing enqueued",
    );
    return 1;
  }
  const results = await runCron(now, sink, logger);
  return results.every((r) => r.ok) ? 0 : 1;
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
