// The hourly schedule: which scheduled tasks are due at a given instant, with their outbox dedupe
// keys (approved S3.3 step 6). fs-cron is a thin trigger: at :07 it runs tools/cron-tick.mjs, which
// POSTs fs-api's /internal/cron/tick over the private network, and the tick enqueues this plan through
// the transactional outbox (I7). This module is the tested reference for that tick (HANDOFF to
// WS-API / WS-DATA: lift `planCronRun` and `runCron` with the outbox adapter; apps cannot import
// apps). Its CLI prints any hour's plan.
//   every pass                 judgeReset                 keyed by UTC hour
//   any pass 02:00-05:59 UTC   reconcile{nightly}         keyed by UTC date
//   every pass                 warmCaches                 keyed by 23-hour window
// reconcile{catchup} is not here: webhook catch-up runs once per fs-api boot (S3.6.5), not hourly.
// Dedupe keys come from the contracts shim (IC-01) and `enqueue` is ON CONFLICT DO NOTHING, so the
// first successful pass in a slot creates the row and later passes are no-ops. A skipped or failed
// pass is therefore made up by the next one, instead of waiting a whole day or window.
import { type ScheduledArgValue, TASK_KEYS, type TaskName } from "./_shims/contracts.js";
import { loadDotEnv } from "./env.js";
import { createLogger, type Logger } from "./log.js";
import { isMain } from "./main.js";
import { loadCronSink } from "./wiring.js";

/** Render cron expression for fs-cron: minute 7 of every hour (register §6). */
export const CRON_SCHEDULE = "7 * * * *";
/** First UTC hour of the nightly reconcile window (S3.3: 02:07 UTC). */
export const NIGHTLY_UTC_HOUR = 2;
/** Passes from 02:00 to 05:59 UTC may enqueue the nightly reconcile, so three missed passes are tolerated. */
export const NIGHTLY_WINDOW_HOURS = 4;
/** warmCaches window in hours; strictly under the 24 h grammar-cache expiry (S4). */
export const WARM_EVERY_HOURS = 23;

const HOUR_MS = 3_600_000;

export type CronArgValue = ScheduledArgValue;

export interface CronJob {
  readonly name: Extract<TaskName, "judgeReset" | "reconcile" | "warmCaches">;
  readonly args: Readonly<Record<string, CronArgValue>>;
  /** `task_outbox.dedupe_key`: one row per job per slot, ever. */
  readonly dedupeKey: string;
}

/** The outbox port the plan is written to. WS-DATA's adapter wraps `enqueue(tx, name, args, dedupeKey)`. */
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

/** The 23-hour warmCaches window containing `now`. */
export function warmWindow(now: Date): number {
  return Math.floor(hourIndex(now) / WARM_EVERY_HOURS);
}

/** Pure: the jobs this pass offers to the outbox. Order is enqueue order. */
export function planCronRun(now: Date): CronJob[] {
  if (Number.isNaN(now.getTime())) throw new Error("planCronRun needs a valid date");
  const slot = hourSlot(now);
  const jobs: CronJob[] = [{ name: "judgeReset", ...TASK_KEYS.judgeResetCron(slot) }];
  const h = now.getUTCHours();
  if (h >= NIGHTLY_UTC_HOUR && h < NIGHTLY_UTC_HOUR + NIGHTLY_WINDOW_HOURS) {
    jobs.push({ name: "reconcile", ...TASK_KEYS.reconcileNightly(slot.slice(0, 10)) });
  }
  jobs.push({ name: "warmCaches", ...TASK_KEYS.warmCachesWindow(warmWindow(now)) });
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

/**
 * CLI. `--plan [--at=<iso>]` prints a pass's plan. Without `--plan` it enqueues the plan directly,
 * which needs an outbox sink (local runs once WS-DATA wires one; on Render the tick does this).
 * Exit code: 0 all enqueued (or plan only), 1 any enqueue failed or no outbox is wired.
 */
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
