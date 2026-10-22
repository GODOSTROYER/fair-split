// Webhook catch-up after downtime (architecture §6.5, S3.6.5 "Catch-up"): list PayPal's event
// notifications since the last applied event (minus a 10-minute overlap) and store any we missed as
// `verified = 'fetched'`, enqueuing processWebhook exactly as the webhook route does. Same row shape,
// same ON CONFLICT (paypal_event_id) DO NOTHING and the same `wh:<event id>` dedupe key, so a delivery
// and a catch-up of one event can race safely. WS-OPS calls this from the hourly reconcile{catchup}.
//
// A fetched event has no transmission signature: it is authentic because we read it from PayPal over
// TLS with our own token. Its `raw` is PayPal's JSON as listed, re-serialized, which the label says.

import {
  isSubscribedEventType,
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

export interface CatchUpOptions {
  /**
   * PayPal `create_time` of the newest applied event, or null when nothing has been applied yet. Re-running
   * a pass is always safe (inserts dedupe), so a `truncated` pass can simply be repeated.
   */
  lastAppliedAt: Date | null;
  /** Bounds the PayPal calls one pass may make (each page is one call). */
  maxPages?: number;
}

export interface CatchUpResult {
  window: { start: Date; end: Date };
  listed: number;
  inserted: number;
  alreadyStored: number;
  /** Event types we do not subscribe to. */
  skipped: number;
  /** More pages remained; the next pass picks them up. */
  truncated: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function catchUpWebhookEvents<Tx>(
  deps: CatchUpDeps<Tx>,
  options: CatchUpOptions,
): Promise<CatchUpResult> {
  const end = (deps.now ?? (() => new Date()))();
  const since = options.lastAppliedAt?.getTime() ?? end.getTime() - CATCH_UP_DEFAULT_LOOKBACK_MS;
  const start = new Date(Math.min(since - CATCH_UP_OVERLAP_MS, end.getTime()));
  const { events, truncated } = await listWebhookEvents(deps.http, {
    startTime: start,
    endTime: end,
    maxPages: options.maxPages ?? 5,
    priority: "background",
  });

  let inserted = 0;
  let alreadyStored = 0;
  let skipped = 0;
  for (const event of events) {
    if (!isSubscribedEventType(event.event_type)) {
      skipped += 1;
      continue;
    }
    const resource = isRecord(event.resource) ? event.resource : undefined;
    const row: WebhookEventInsert = {
      paypalEventId: event.id,
      eventType: event.event_type,
      resourceType: typeof event.resource_type === "string" ? event.resource_type : null,
      resourceKey: resourceKeyOf({ event_type: event.event_type, ...(resource ? { resource } : {}) }),
      verified: "fetched",
      status: "received",
      raw: JSON.stringify(event),
      transmissionId: null,
      rejectReason: null,
      receivedAt: end,
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

  const result = {
    window: { start, end },
    listed: events.length,
    inserted,
    alreadyStored,
    skipped,
    truncated,
  };
  deps.logger?.info?.(
    { ...result, window: { start: start.toISOString(), end: end.toISOString() } },
    "paypal webhook catch-up",
  );
  return result;
}
