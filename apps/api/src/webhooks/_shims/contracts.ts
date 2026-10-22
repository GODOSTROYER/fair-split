// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors IC-01 (register §11): the `processWebhook` entry of the TaskName registry (arguments are
// ids only), the webhook_events vocabulary from architecture §3 and S3.4 (including S3's `fetched`
// deviation), and the `webhook.received` run event (register IC-01 name, architecture §5 fields).
// Types and plain data only, so the swap is a change of import path.

/** The TaskName registry entry this route enqueues. */
export type TaskName = "processWebhook";

export interface ProcessWebhookArgs {
  webhookEventId: string;
}

/** Dedupe key for the outbox row (S3.6.5: `wh:${evt.id}`). */
export const processWebhookDedupeKey = (paypalEventId: string): string => `wh:${paypalEventId}`;

/** `webhook_events.verified`: how an event was authenticated (`fetched` = pulled by catch-up). */
export type WebhookVerifiedLabel = "self" | "postback" | "dev_mock" | "fetched";

/** `webhook_events.status`. */
export type WebhookEventStatus = "received" | "applied" | "orphan" | "rejected";

/**
 * Labels the frozen run event can carry: architecture §5 types `verified` as "self" | "postback".
 * CONTRACT GAP, raised for WS-CORE before the 24 Oct 18:00 freeze: widen it to WebhookVerifiedLabel
 * (add "dev_mock" and "fetched"), or a simulator or catch-up event cannot be reported with its label
 * intact (I8). Until then `webhookRunEvent()` refuses those labels instead of relabelling them.
 */
export type WebhookRunEventVerified = "self" | "postback";

/** IC-01 `webhook.received` (architecture §5: `{type, eventId, eventType, verified, duplicate}`). */
export interface WebhookReceivedRunEvent {
  type: "webhook.received";
  eventId: string;
  eventType: string;
  verified: WebhookRunEventVerified;
  duplicate: boolean;
}
