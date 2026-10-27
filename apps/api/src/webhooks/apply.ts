// The apply contract between the webhook route and processWebhook / settleBatch (plan, "PayPal
// integration contract", Webhooks; S3.6.5 "Item events"; register §8 "Any non-success status is checked
// with a fresh GET before it changes state").
//
//   1. The route never changes state: it verifies, stores the event and enqueues processWebhook.
//   2. A signature-verified ('self' or 'postback') PAYMENT.PAYOUTS-ITEM.SUCCEEDED delivered under an
//      in-date PayPal certificate may apply at once (it drives MM-1), as SUCCESS with source "webhook",
//      pending corroboration.
//   3. Every other event changes no state until a fresh GET says what to change (the settleBatch GET if
//      one is due within 10 s, otherwise the item, batch or invoice GET). That includes a SUCCEEDED no
//      signature vouches for ('dev_mock', 'fetched'), one signed under an expired certificate
//      (`delivery.certWarning` set, even when PayPal's postback confirmed that delivery: the state
//      must come from PayPal's GET, never from an expired-certificate body), and one whose `delivery`
//      record is missing or lost its `certWarning` key (nothing says its certificate was in date). Only
//      an explicit `certWarning: null`, as the route writes it, says so: MM-1 therefore needs the
//      repository to store `delivery` as written, null-valued keys included (persistence shim).
//   4. The settle GETs at +25 s (Judge Mode) or +90 s, again at +90 s and +10 min, corroborate a
//      webhook-applied SUCCESS. An item applied from a webhook counts as open until a GET has agreed,
//      so those follow-up GETs keep running for it.
//   5. If a GET disagrees, the GET wins and an /ops alert is raised (`WEBHOOK_GET_MISMATCH`). When the
//      GET's status ranks lower, this is the one sanctioned exception to forward-only (I5): it is
//      written as a correction (item.updated, source "status_check", alert.correction true), never
//      silently.
//
// Pure functions and plain data: processWebhook (WS-PPCORE) and settleBatch call them.

import { type ItemStatus, itemStatusRank, parseItemStatus } from "@fairsplit/paypal-core";
import type { WebhookVerifiedLabel } from "./_shims/contracts.js";
import type { WebhookDelivery } from "./_shims/persistence.js";

/** First settle GET after the POST: +25 s in Judge Mode, +90 s otherwise (S3.6.6). */
export const SETTLE_GET_DELAYS_MS = Object.freeze({ judge: 25_000, standard: 90_000 });

const ITEM_SUCCEEDED = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";

export type WebhookApplyRule =
  | { action: "apply_now"; status: "SUCCESS"; corroboration: "settle_get" }
  | {
      action: "fresh_get_first";
      reason:
        | "NOT_A_PAYOUT_ITEM_SUCCESS"
        | "NOT_SIGNATURE_VERIFIED"
        /** Signed under an expired PayPal certificate (verify.ts certWarning CERT_EXPIRED, or any other warning). */
        | "CERT_EXPIRED"
        /**
         * A verified row whose `delivery` is null, absent, or has no `certWarning` key: nothing says its
         * certificate was in date. On a row the route stored, it means the repository dropped `delivery`
         * or its null-valued keys, and MM-1 is off until it keeps them.
         */
        | "DELIVERY_NOT_RECORDED";
    };

/** The stored `certWarning`: undefined when it was not recorded (no `delivery`, or no such key). */
function recordedCertWarning(delivery: unknown): unknown {
  if (typeof delivery !== "object" || delivery === null) return undefined;
  return (delivery as { certWarning?: unknown }).certWarning;
}

/**
 * What processWebhook may do with a stored event before asking PayPal. Pass the stored row with its
 * `delivery` as read back: an explicit `certWarning: null` is in date, any other value is a certificate
 * warning, and a missing record or key fails closed (a GET first).
 */
export function webhookApplyRule(event: {
  eventType: string | null;
  verified: WebhookVerifiedLabel | null;
  delivery: Partial<WebhookDelivery> | null;
}): WebhookApplyRule {
  const certWarning = recordedCertWarning(event.delivery);
  // Any certificate warning, known or not, means the body is not to be believed.
  if (certWarning !== undefined && certWarning !== null)
    return { action: "fresh_get_first", reason: "CERT_EXPIRED" };
  if (event.eventType !== ITEM_SUCCEEDED)
    return { action: "fresh_get_first", reason: "NOT_A_PAYOUT_ITEM_SUCCESS" };
  if (event.verified !== "self" && event.verified !== "postback") {
    return { action: "fresh_get_first", reason: "NOT_SIGNATURE_VERIFIED" };
  }
  if (certWarning === undefined) return { action: "fresh_get_first", reason: "DELIVERY_NOT_RECORDED" };
  return { action: "apply_now", status: "SUCCESS", corroboration: "settle_get" };
}

/** For /ops: a settle GET contradicted (or could not confirm) a status applied from a webhook. */
export interface WebhookGetMismatchAlert {
  kind: "WEBHOOK_GET_MISMATCH";
  paypalEventId: string;
  payoutItemId: string;
  webhookStatus: ItemStatus;
  /** As PayPal returned it (unreadable values included). */
  getStatus: unknown;
  /** True when the GET moves the item to a lower rank: a correction against forward-only (I5). */
  correction: boolean;
}

export type SettleCorroboration =
  | { verdict: "corroborated"; status: ItemStatus; alert: null }
  | { verdict: "get_wins"; status: ItemStatus; alert: WebhookGetMismatchAlert }
  /** The GET's status is not one we know: change nothing, alert, and let the next settle GET decide. */
  | { verdict: "unreadable"; status: null; alert: WebhookGetMismatchAlert };

/** The settle GET's answer for an item whose status was applied from a webhook. */
export function corroborateWithSettleGet(
  applied: { paypalEventId: string; payoutItemId: string; status: ItemStatus },
  getStatus: unknown,
): SettleCorroboration {
  const parsed = parseItemStatus(getStatus);
  const alert = (correction: boolean): WebhookGetMismatchAlert => ({
    kind: "WEBHOOK_GET_MISMATCH",
    paypalEventId: applied.paypalEventId,
    payoutItemId: applied.payoutItemId,
    webhookStatus: applied.status,
    getStatus,
    correction,
  });
  if (parsed === null) return { verdict: "unreadable", status: null, alert: alert(false) };
  if (parsed === applied.status) return { verdict: "corroborated", status: parsed, alert: null };
  return {
    verdict: "get_wins",
    status: parsed,
    alert: alert(itemStatusRank(parsed) < itemStatusRank(applied.status)),
  };
}

const TERMINAL: ReadonlySet<ItemStatus> = new Set([
  "SUCCESS",
  "FAILED",
  "BLOCKED",
  "RETURNED",
  "REFUNDED",
  "REVERSED",
]);

/**
 * Whether the follow-up settle GETs (+90 s, +10 min) still run for an item: while its status is not
 * terminal, and while a status applied from a webhook has not yet been corroborated by a GET.
 */
export function openForSettleGets(item: { status: ItemStatus | null; corroboratedByGet: boolean }): boolean {
  if (item.status === null || !TERMINAL.has(item.status)) return true;
  return !item.corroboratedByGet;
}
