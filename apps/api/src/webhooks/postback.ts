// The postback step processWebhook runs after the 200 (S3.6.5 "Postback"): once per live run, on the
// first verified INVOICING.INVOICE.PAID, ask PayPal's verify-webhook-signature about the stored
// delivery and, on SUCCESS, upgrade the row's `verified` from 'self' to 'postback' (the on-screen
// "PayPal: SUCCESS" badge).
//
// Bounded: one PayPal call (createPostbackVerifier never retries) under a 6 s deadline, and never
// inside the webhook request, so a slow or failing PayPal cannot delay the 200 or trigger redelivery.
// Choosing *when* to run it (the first INVOICE.PAID of a live run: register §8's "one postback
// verify") is processWebhook's decision; the step itself is idempotent per row.

import {
  type LoggerLike,
  POSTBACK_DEADLINE_MS,
  type PostbackFn,
  type PostbackInput,
  postbackWithDeadline,
} from "@fairsplit/paypal-core";
import type { WebhookVerifiedLabel } from "./_shims/contracts.js";
import type { RunInTransaction, WebhookDelivery } from "./_shims/persistence.js";

/** The parts of a stored `webhook_events` row this step reads. */
export interface StoredWebhookEvent {
  id: string;
  raw: string;
  verified: WebhookVerifiedLabel | null;
  delivery: WebhookDelivery | null;
}

export interface PostbackStepDeps<Tx> {
  /** `core.postback`: one verify-webhook-signature call, no retries, 5 s per attempt. */
  postback: PostbackFn;
  /** PP_WEBHOOK_ID, the id the delivery was signed for. */
  webhookId: string;
  transaction: RunInTransaction<Tx>;
  /** `UPDATE webhook_events SET verified = 'postback' WHERE id = $1 AND verified = 'self'`; true when a row changed. */
  markPostbackVerified(tx: Tx, webhookEventId: string): Promise<boolean>;
  /** Overall deadline (default 6 s). */
  deadlineMs?: number;
  logger?: LoggerLike;
}

export type PostbackStepResult =
  | { status: "confirmed" }
  | { status: "already_confirmed" }
  | { status: "not_eligible"; reason: "NOT_SELF_VERIFIED" | "NO_TRANSMISSION_HEADERS" }
  | { status: "unconfirmed"; postback: "FAILURE" | "ERROR" | "TIMEOUT" };

export async function confirmWebhookByPostback<Tx>(
  deps: PostbackStepDeps<Tx>,
  event: StoredWebhookEvent,
): Promise<PostbackStepResult> {
  if (event.verified === "postback") return { status: "already_confirmed" };
  // PayPal answers FAILURE for simulator events; fetched and rejected rows have no delivery to replay.
  if (event.verified !== "self") return { status: "not_eligible", reason: "NOT_SELF_VERIFIED" };
  const d = event.delivery;
  if (!d?.transmissionId || !d.transmissionTime || !d.transmissionSig || !d.certUrl || !d.authAlgo) {
    return { status: "not_eligible", reason: "NO_TRANSMISSION_HEADERS" };
  }
  const input: PostbackInput = {
    authAlgo: d.authAlgo,
    certUrl: d.certUrl,
    transmissionId: d.transmissionId,
    transmissionSig: d.transmissionSig,
    transmissionTime: d.transmissionTime,
    webhookId: deps.webhookId,
    rawEvent: event.raw,
  };
  const answer = await postbackWithDeadline(deps.postback, input, {
    deadlineMs: deps.deadlineMs ?? POSTBACK_DEADLINE_MS,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });
  if (answer !== "SUCCESS") {
    deps.logger?.warn?.(
      { webhookEventId: event.id, postback: answer },
      "paypal webhook postback did not confirm; the row stays 'self'",
    );
    return { status: "unconfirmed", postback: answer };
  }
  const changed = await deps.transaction((tx) => deps.markPostbackVerified(tx, event.id));
  return changed ? { status: "confirmed" } : { status: "already_confirmed" };
}
