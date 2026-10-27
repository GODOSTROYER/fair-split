/**
 * Retention for the rows a Judge purge keeps (migrations/0005, 0016). `paypal_calls`, `webhook_events` and
 * `llm_calls` outlive their workspace and fs_app cannot delete them, so they leave only through the owner-side
 * `fs_prune_kept_rows()`, which the cron calls (`judgeReset` or the nightly pass):
 *
 *   const pruned = await pruneKeptRows(db); // { paypalCalls, webhookEvents, rejectedEvents }
 *
 * Each table keeps at least what it is for, whatever the caller asks: paypal_calls a day (the limiter reads 60 s,
 * the 429 circuit 6 minutes, /ops a day), resolved webhook events 30 days (the event-id dedupe outlasts PayPal's
 * 3 days of retries, resends and catch-up), rejected events a day (7 by default, S3.9). Received (unprocessed) events
 * and llm_calls (the Judge replay store and spend meter) are never pruned.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";

export interface KeptRowsRetention {
  paypalCallsHours: number;
  webhookEventsHours: number;
  rejectedEventsHours: number;
}

/** What fs_prune_kept_rows keeps however little the caller asks for (hours). */
export const KEPT_ROWS_FLOORS: Readonly<KeptRowsRetention> = Object.freeze({
  paypalCallsHours: 24,
  webhookEventsHours: 30 * 24,
  rejectedEventsHours: 24,
});

/** The defaults: 30 days of PayPal calls and resolved events, 7 days of rejects. */
export const KEPT_ROWS_DEFAULTS: Readonly<KeptRowsRetention> = Object.freeze({
  paypalCallsHours: 30 * 24,
  webhookEventsHours: 30 * 24,
  rejectedEventsHours: 7 * 24,
});

export interface PrunedKeptRows {
  paypalCalls: number;
  webhookEvents: number;
  rejectedEvents: number;
}

function seconds(hours: number, what: string): number {
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) {
    throw new RangeError(`${what} must be a finite number of hours, 0 or more`);
  }
  return Math.round(hours * 3600);
}

/** Runs fs_prune_kept_rows (floors applied in SQL) and returns how many rows each step removed. */
export async function pruneKeptRows(
  db: DbOrTx,
  retention: Partial<KeptRowsRetention> = {},
): Promise<PrunedKeptRows> {
  const r = { ...KEPT_ROWS_DEFAULTS, ...retention };
  const rows = (await db.execute(sql`
    select pruned_calls::int as calls, pruned_events::int as events, pruned_rejected::int as rejected
      from fs_prune_kept_rows(
             make_interval(secs => ${seconds(r.paypalCallsHours, "paypalCallsHours")}),
             make_interval(secs => ${seconds(r.webhookEventsHours, "webhookEventsHours")}),
             make_interval(secs => ${seconds(r.rejectedEventsHours, "rejectedEventsHours")}))`)) as unknown as {
    calls: number;
    events: number;
    rejected: number;
  }[];
  const row = rows[0];
  return {
    paypalCalls: row?.calls ?? 0,
    webhookEvents: row?.events ?? 0,
    rejectedEvents: row?.rejected ?? 0,
  };
}
