// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors IC-01 (register §11): the `processWebhook` entry of the TaskName registry (arguments are
// ids only) and the webhook_events vocabulary from architecture §3 and S3.4 (including S3's
// `fetched` deviation). Types and plain data only, so the swap is a change of import path.

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
