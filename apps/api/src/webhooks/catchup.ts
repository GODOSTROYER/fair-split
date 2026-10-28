// Webhook catch-up after downtime (architecture §6.5, S3.6.5 "Catch-up"): list PayPal's event
// notifications since the end of the last finished pass (minus a 10-minute overlap) and store any we
// missed as `verified = 'fetched'`, enqueuing processWebhook exactly as the webhook route does. Same row
// shape, same ON CONFLICT (paypal_event_id) DO NOTHING and the same `wh:<event id>` dedupe key, so a
// delivery and a catch-up of one event can race safely. WS-OPS calls this from reconcile{catchup}.
//
// Where a pass starts. Not at the newest applied event: a delivery we refused for good (PayPal's retries
// reusing the first headers, past the 5-minute window) is older than events applied after it, and a pass
// starting at "newest applied − 10 min" would never list it (verifier probe: refused at 09:00:05, a newer
// one applied at 09:20, the 10:07 pass started at 09:10). A pass that finishes its window returns
// `completedThrough` (that window's end: everything created up to then has been listed); WS-OPS persists
// it and passes it back, and the next pass starts there minus the overlap. Only the very first pass, with
// nothing completed yet, starts from the newest applied event (or a day back).
//
// A fetched event has no transmission signature: it is authentic because we read it from PayPal over
// TLS with our own token. Its `raw` is PayPal's JSON as listed, re-serialized, which the label says.
//
// Convergence. PayPal documents no sort order for the listing, but its `next` links carry a keyset
// cursor (`move_to=next&index_time=…&index_id=…`) that walks back from end_time: newest first. Simply
// repeating a pass that stopped at maxPages would re-read the same newest pages and never reach the
// older events it exists to recover. So a truncated pass returns `resume`, the part of the window it
// has not read, worked out from the create_time of what it did read: newest first → [start, oldest
// seen]; oldest first → [newest seen, end]. Bounds are inclusive (as PayPal's are) and rounded outward
// to whole seconds, so events on the boundary are re-read and deduped, never skipped. When the order
// cannot be read off the events, `resume` carries PayPal's `next` link instead. WS-OPS stores
// `resume` and passes it back until a pass returns null; each pass costs at most maxPages calls. The
// cursor carries `through`, the window's own end, so the pass that finishes it reports that as
// `completedThrough`.

import {
  isSubscribedEventType,
  type ListedWebhookEvent,
  type LoggerLike,
  listWebhookEvents,
  type PayPalHttp,
  resourceKeyOf,
} from "@fairsplit/paypal-core";
import { type ProcessWebhookArgs, processWebhookDedupeKey } from "./_shims/contracts.js";
import type { Enqueue, RunInTransaction } from "./_shims/persistence.js";
import type { WebhookEventInsert } from "./paypal.js";

export const CATCH_UP_OVERLAP_MS = 10 * 60_000;
/** With no applied event yet, look back one day. */
export const CATCH_UP_DEFAULT_LOOKBACK_MS = 24 * 60 * 60_000;

export interface CatchUpDeps<Tx> {
  http: PayPalHttp;
  transaction: RunInTransaction<Tx>;
  insertWebhookEvent(tx: Tx, row: WebhookEventInsert): Promise<{ id: string } | null>;
  enqueue: Enqueue<Tx>;
  now?: () => Date;
  logger?: LoggerLike;
}

/** Where the next pass continues. Plain JSON, so WS-OPS can persist it as is. */
export interface CatchUpCursor {
  /** The part of the window not read yet (ISO 8601; both bounds inclusive, as PayPal's are). */
  start: string;
  end: string;
  /** PayPal's `next` link, used when the listing order could not be read off the events. */
  next: string | null;
  /**
   * The end of the whole window this cursor belongs to (ISO 8601): what the pass that finishes it
   * reports as `completedThrough`. A cursor written before this field existed uses `end`.
   */
  through?: string;
}

export interface CatchUpOptions {
  /**
   * The previous finished pass's `completedThrough`, as WS-OPS persisted it: this pass starts there
   * minus the overlap. Null or unset when no pass has finished yet; then `lastAppliedAt` decides.
   */
  completedThrough?: Date | null;
  /**
   * PayPal `create_time` of the newest applied event, or null when nothing has been applied yet. Only
   * used when there is no `completedThrough`: an event refused for good can be older than it.
   */
  lastAppliedAt: Date | null;
  /** The previous pass's `resume`. While set, the pass continues that window instead of starting over. */
  resume?: CatchUpCursor | null;
  /** Bounds the PayPal calls one pass may make (each page is one call). */
  maxPages?: number;
  pageSize?: number;
}

export interface CatchUpResult {
  window: { start: Date; end: Date };
  listed: number;
  inserted: number;
  alreadyStored: number;
  /** Event types we do not subscribe to. */
  skipped: number;
  /** More pages remained after maxPages. */
  truncated: boolean;
  /** Non-null exactly when truncated: pass it back as `options.resume` to finish the window. */
  resume: CatchUpCursor | null;
  /**
   * Set when this pass finished its window (nothing left to resume): every event created up to this
   * time has been listed. Persist it and pass it back as `options.completedThrough`. Null while a
   * window is unfinished: keep the value persisted before.
   */
  completedThrough: Date | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const iso = (ms: number) => new Date(ms).toISOString();

function createTimeOf(event: ListedWebhookEvent): number {
  const value = (event as { create_time?: unknown }).create_time;
  return typeof value === "string" ? Date.parse(value) : Number.NaN;
}

/** The listing order, as far as the events show it. */
function listingOrder(times: readonly number[]): "newest_first" | "oldest_first" | "unknown" {
  let up = false;
  let down = false;
  for (let i = 1; i < times.length; i++) {
    const previous = times[i - 1] ?? 0;
    const current = times[i] ?? 0;
    if (current > previous) up = true;
    else if (current < previous) down = true;
  }
  if (down && !up) return "newest_first";
  if (up && !down) return "oldest_first";
  return "unknown";
}

/** The unread part of a truncated pass's window (see the header comment). */
export function resumeAfter(
  window: { start: Date; end: Date },
  events: readonly ListedWebhookEvent[],
  next: string | null,
): CatchUpCursor | null {
  const start = window.start.getTime();
  const end = window.end.getTime();
  const times = events.map(createTimeOf).filter(Number.isFinite);
  const order = listingOrder(times);
  if (order === "newest_first") {
    const narrowedEnd = Math.ceil(Math.min(...times) / 1000) * 1000;
    if (narrowedEnd >= start && narrowedEnd < end)
      return { start: iso(start), end: iso(narrowedEnd), next: null };
  } else if (order === "oldest_first") {
    const narrowedStart = Math.floor(Math.max(...times) / 1000) * 1000;
    if (narrowedStart > start && narrowedStart <= end)
      return { start: iso(narrowedStart), end: iso(end), next: null };
  }
  return next === null ? null : { start: iso(start), end: iso(end), next };
}

function readCursor(
  cursor: CatchUpCursor,
): { start: Date; end: Date; next: string | null; through: Date } | null {
  const start = Date.parse(cursor.start);
  const end = Date.parse(cursor.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null;
  const next = typeof cursor.next === "string" && cursor.next.length > 0 ? cursor.next : null;
  const through = typeof cursor.through === "string" ? Date.parse(cursor.through) : Number.NaN;
  return {
    start: new Date(start),
    end: new Date(end),
    next,
    through: new Date(Number.isFinite(through) && through >= end ? through : end),
  };
}

const isValidDate = (value: Date | null | undefined): value is Date =>
  value instanceof Date && Number.isFinite(value.getTime());

export async function catchUpWebhookEvents<Tx>(
  deps: CatchUpDeps<Tx>,
  options: CatchUpOptions,
): Promise<CatchUpResult> {
  const now = (deps.now ?? (() => new Date()))();
  const resumed = options.resume ? readCursor(options.resume) : null;
  if (options.resume && !resumed) {
    deps.logger?.warn?.({}, "paypal webhook catch-up: unreadable resume cursor ignored; starting over");
  }
  let start: Date;
  let end: Date;
  /** The end of the whole window this pass works on: completedThrough once it is finished. */
  let through: Date;
  if (resumed) {
    ({ start, end, through } = resumed);
  } else {
    end = now;
    through = end;
    let completed = options.completedThrough ?? null;
    if (completed !== null && !isValidDate(completed)) {
      deps.logger?.warn?.({}, "paypal webhook catch-up: unreadable completedThrough ignored");
      completed = null;
    }
    const since =
      completed?.getTime() ??
      (isValidDate(options.lastAppliedAt) ? options.lastAppliedAt.getTime() : null) ??
      end.getTime() - CATCH_UP_DEFAULT_LOOKBACK_MS;
    start = new Date(Math.min(since - CATCH_UP_OVERLAP_MS, end.getTime()));
  }
  const listing = await listWebhookEvents(deps.http, {
    startTime: start,
    endTime: end,
    maxPages: options.maxPages ?? 5,
    pageSize: options.pageSize ?? 50,
    priority: "background",
    from: resumed?.next ?? null,
  });

  let inserted = 0;
  let alreadyStored = 0;
  let skipped = 0;
  for (const event of listing.events) {
    if (!isSubscribedEventType(event.event_type)) {
      skipped += 1;
      continue;
    }
    const resource = isRecord(event.resource) ? event.resource : undefined;
    const row: WebhookEventInsert = {
      paypalEventId: event.id,
      eventType: event.event_type,
      resourceKey: resourceKeyOf({ event_type: event.event_type, ...(resource ? { resource } : {}) }),
      verified: "fetched",
      status: "received",
      raw: JSON.stringify(event),
      delivery: null,
    };
    const stored = await deps.transaction(async (tx) => {
      const created = await deps.insertWebhookEvent(tx, row);
      if (!created) return false;
      const args: ProcessWebhookArgs = { webhookEventId: created.id };
      await deps.enqueue(tx, "processWebhook", args, processWebhookDedupeKey(event.id));
      return true;
    });
    if (stored) inserted += 1;
    else alreadyStored += 1;
  }

  const rest = listing.truncated ? resumeAfter({ start, end }, listing.events, listing.next) : null;
  const result: CatchUpResult = {
    window: { start, end },
    listed: listing.events.length,
    inserted,
    alreadyStored,
    skipped,
    truncated: listing.truncated,
    resume: rest === null ? null : { ...rest, through: through.toISOString() },
    // Only a pass that read its window to the end moves the high-water mark.
    completedThrough: listing.truncated ? null : through,
  };
  deps.logger?.info?.(
    {
      ...result,
      window: { start: start.toISOString(), end: end.toISOString() },
      resumed: resumed !== null,
      resume: result.resume ? { start: result.resume.start, end: result.resume.end } : null,
      completedThrough: result.completedThrough?.toISOString() ?? null,
    },
    "paypal webhook catch-up",
  );
  return result;
}
