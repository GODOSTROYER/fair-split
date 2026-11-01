// The hourly cron tick (S3.3 step 6, S3.14): fs-cron runs tools/cron-tick.mjs at :07 UTC, which POSTs
// /internal/cron/tick over Render's private network with `Authorization: Bearer <CRON_SECRET>`. The tick
// enqueues the hour's scheduled tasks through the transactional outbox (I7), in one transaction:
//   every pass                 judgeReset{cron}     keyed by the UTC hour (reset:pool:2026-11-01T10)
//   passes 02:00-05:59 UTC     reconcile{nightly}   keyed by the UTC date (its 48 h window's start)
//   every pass                 warmCaches           keyed by the 23-hour window
// The judgeReset pass is the judge folder's handler (src/judge/reset-task.ts): it cancels judge items parked
// UNCLAIMED for over 15 minutes, purges expired judge workspaces, retires and refills the pool, resumes stalled
// POSTs and drops expired webhook transmission ids. reconcile and warmCaches are handled elsewhere (labelled no-ops
// in this build). This is the only hourly plan, using the real IC-01 `TASKS` keys
// (apps cannot import apps).
//
// Only a job this process has a handler for is enqueued. A row without one would be claimed, fail `no handler
// registered` on every attempt and go dead, so the tick skips that job and labels it `no handler` in its answer, its
// tick record and the log (until J1's labelled no-ops land, warmCaches and the nightly reconcile are skipped so).
//
// At most one tick is taken per 30 minutes, decided in Postgres: the tick holds a transaction advisory lock while
// it reads the last tick's time and writes its own record (`reconciliation_reports{health}`, source `cronTick`), so
// of two fs-api processes ticking at once exactly one is taken; the other answers 429 with Retry-After and enqueues
// nothing. The dedupe keys cover whole slots, so a tick taken twice in one hour queues nothing new, and a missed
// hour is made up by the next tick.
import { createHash, timingSafeEqual } from "node:crypto";
import { TASKS, type TaskArgsOf } from "@fairsplit/contracts";
import { type Db, schema } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { and, eq, isNull, max, sql } from "drizzle-orm";

export const CRON_TICK_PATH = "/internal/cron/tick";
/** At most one tick in this long (S3.14). */
export const TICK_MIN_INTERVAL_MS = 30 * 60_000;
/** A CRON_SECRET shorter than this counts as unset (tools/cron-tick.mjs refuses one too). */
export const MIN_CRON_SECRET_LENGTH = 16;
/** First UTC hour of the nightly reconcile window (S3.6: 02:07 UTC). */
export const NIGHTLY_UTC_HOUR = 2;
/** Passes from 02:00 to 05:59 UTC may enqueue the nightly reconcile, so three missed passes are tolerated. */
export const NIGHTLY_WINDOW_HOURS = 4;
/** The nightly reconcile looks back this far from its date's midnight (S3.6: one search over 48 h). */
export const NIGHTLY_LOOKBACK_MS = 48 * 3_600_000;
/** warmCaches window in hours; strictly under the 24 h grammar-cache expiry (S4). */
export const WARM_EVERY_HOURS = 23;
/** The tick record: a system `reconciliation_reports` row of this kind and `summary.source`. */
export const TICK_REPORT = { kind: "health", source: "cronTick" } as const;
const TICK_LOCK = "fs:cron-tick";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type CronTaskName = "judgeReset" | "reconcile" | "warmCaches";
/** Every task a tick may enqueue. */
export const CRON_TASK_NAMES: readonly CronTaskName[] = ["judgeReset", "reconcile", "warmCaches"];

export type CronJob = {
  [T in CronTaskName]: {
    readonly name: T;
    readonly args: TaskArgsOf<T>;
    /** `task_outbox.dedupe_key`: one row per job per slot, ever. */
    readonly dedupeKey: string;
  };
}[CronTaskName];

/** `2026-11-01T10` for any instant within that UTC hour. */
export function hourSlot(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** The 23-hour warmCaches window containing `now` (hours since the epoch / 23, floored). */
export function warmWindow(now: Date): number {
  return Math.floor(Math.floor(now.getTime() / HOUR_MS) / WARM_EVERY_HOURS);
}

function job<T extends CronTaskName>(name: T, args: TaskArgsOf<T>): CronJob {
  return { name, args, dedupeKey: TASKS[name].dedupeKey(args) } as CronJob;
}

/** Pure: the jobs a tick at `now` offers to the outbox, in enqueue order. */
export function planCronTick(now: Date): CronJob[] {
  if (Number.isNaN(now.getTime())) throw new RangeError("planCronTick needs a valid date");
  const jobs: CronJob[] = [job("judgeReset", { trigger: "cron", workspaceId: null, slot: hourSlot(now) })];
  const h = now.getUTCHours();
  if (h >= NIGHTLY_UTC_HOUR && h < NIGHTLY_UTC_HOUR + NIGHTLY_WINDOW_HOURS) {
    const midnight = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
    jobs.push(
      job("reconcile", {
        mode: "nightly",
        windowStart: new Date(midnight - NIGHTLY_LOOKBACK_MS).toISOString(),
      }),
    );
  }
  jobs.push(job("warmCaches", { slot: `w${warmWindow(now)}` }));
  return jobs;
}

/** CRON_SECRET as the tick accepts it, or null: unset, blank or too short means the route is not there. */
export function configuredCronSecret(value: string | undefined): string | null {
  return value !== undefined && value.length >= MIN_CRON_SECRET_LENGTH ? value : null;
}

const BEARER = /^Bearer ([^\s]+)$/i;

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/**
 * True when `authorization` is exactly `Bearer <expected>`. Constant time: both sides are hashed to 32 bytes and
 * compared with timingSafeEqual, so neither the secret's length nor a matching prefix shows in the timing.
 */
export function cronSecretMatches(expected: string, authorization: string | undefined): boolean {
  const presented = BEARER.exec(authorization ?? "")?.[1] ?? "";
  const same = timingSafeEqual(digest(presented), digest(expected));
  return same && presented.length > 0;
}

export interface TickTask {
  readonly task: CronTaskName;
  readonly dedupeKey: string;
  /** false when this slot's row already existed (the enqueue was a no-op). */
  readonly created: boolean;
}

/** Why a job of the plan was not enqueued: no handler for its task is registered in this process. */
export const SKIPPED_NO_HANDLER = "no handler";

export interface SkippedTask {
  readonly task: CronTaskName;
  readonly dedupeKey: string;
  readonly reason: typeof SKIPPED_NO_HANDLER;
}

export type TickOutcome =
  | {
      readonly kind: "accepted";
      readonly at: Date;
      readonly tasks: readonly TickTask[];
      readonly skipped: readonly SkippedTask[];
    }
  | { readonly kind: "refused"; readonly lastAt: Date; readonly retryAfterMs: number };

/**
 * Takes the tick at `now` (the app clock) or refuses it. One transaction: the advisory lock serialises ticks from
 * every process, the last tick's time is read after the lock (READ COMMITTED: a fresh snapshot per statement, so a
 * tick that committed while this one waited is seen), and the plan's rows and the tick record commit together.
 * `handles` says whether this process runs a task: a job whose task it does not run is skipped and labelled.
 */
export async function takeCronTick(
  db: Db,
  now: Date,
  handles: (task: CronTaskName) => boolean,
): Promise<TickOutcome> {
  const plan = planCronTick(now);
  const rr = schema.reconciliationReports;
  return db.transaction(
    async (tx) => {
      await tx.execute(sql`set local lock_timeout = '10s'`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${TICK_LOCK}, 0))`);
      const [last] = await tx
        .select({ at: max(rr.windowEnd) })
        .from(rr)
        .where(
          and(
            eq(rr.kind, TICK_REPORT.kind),
            isNull(rr.workspaceId),
            sql`${rr.summary}->>'source' = ${TICK_REPORT.source}`,
          ),
        );
      const lastAt = last?.at ?? null;
      if (lastAt && now.getTime() - lastAt.getTime() < TICK_MIN_INTERVAL_MS) {
        const wait = lastAt.getTime() + TICK_MIN_INTERVAL_MS - now.getTime();
        return {
          kind: "refused",
          lastAt,
          retryAfterMs: Math.min(Math.max(wait, 1000), TICK_MIN_INTERVAL_MS),
        };
      }
      const tasks: TickTask[] = [];
      const skipped: SkippedTask[] = [];
      for (const j of plan) {
        if (!handles(j.name)) {
          skipped.push({ task: j.name, dedupeKey: j.dedupeKey, reason: SKIPPED_NO_HANDLER });
          continue;
        }
        const r = await enqueue(tx, j.name, j.args, j.dedupeKey);
        tasks.push({ task: j.name, dedupeKey: j.dedupeKey, created: r.inserted });
      }
      await tx.insert(rr).values({
        kind: TICK_REPORT.kind,
        windowEnd: now,
        summary: { source: TICK_REPORT.source, at: now.toISOString(), tasks, skipped },
      });
      return { kind: "accepted", at: now, tasks, skipped };
    },
    { isolationLevel: "read committed" },
  );
}
