// IC-05: the only webhook body allowed to advance a payout without a fresh GET is a stored,
// signature-verified SUCCEEDED. The verifier authenticates the delivery before storage; this rule
// validates the persisted metadata and binds the body to the exact pre-written payout item.

import { PAYPAL_API_HOSTS } from "../env.js";
import { checkCertUrl, checkSimulatorCertUrl } from "./cert-url.js";
import { parseWebhookEnvelope } from "./event.js";
import { MAX_TRANSMISSION_SKEW_MS, parseTransmissionTime, TRANSMISSION_ID_PATTERN } from "./transmission.js";

const SUCCEEDED = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";
const SIGNATURE_B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const SIMULATOR_CERT_URL =
  /^https?:\/\/[^/?#]+\/paypal-sim\/sim\/certs\/SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}\.pem$/;
const DELIVERY_KEYS = [
  "transmissionId",
  "transmissionTime",
  "transmissionSig",
  "certUrl",
  "authAlgo",
  "rejectReason",
  "certWarning",
] as const;

export interface StoredWebhookApplyInput {
  eventType: unknown;
  verified: unknown;
  delivery: unknown;
  raw: unknown;
  paypalEventId: unknown;
  /** Original receipt instant, not the later outbox processing instant. */
  receivedAt: unknown;
  /** The item resolved within its batch; never resolve by sender_item_id alone. */
  item: unknown;
}

export type StoredWebhookApplyRule =
  | { action: "apply_now"; status: "SUCCESS"; corroboration: "settle_get" }
  | {
      action: "fresh_get_first";
      reason:
        | "NOT_A_PAYOUT_ITEM_SUCCESS"
        | "NOT_SIGNATURE_VERIFIED"
        | "CERT_EXPIRED"
        | "DELIVERY_NOT_RECORDED"
        | "INVALID_DELIVERY"
        | "STALE_DELIVERY"
        | "INVALID_STORED_EVENT"
        | "RESOURCE_MISMATCH";
    };

type GetReason = Extract<StoredWebhookApplyRule, { action: "fresh_get_first" }>["reason"];
const getFirst = (reason: GetReason): StoredWebhookApplyRule => ({ action: "fresh_get_first", reason });
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const identifier = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 128 &&
  !/\s/u.test(value) &&
  [...value].every((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127);

function receiptTime(value: unknown): number | null {
  const time =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? parseTransmissionTime(value)
          : null;
  return time !== null && Number.isFinite(time) ? time : null;
}

function validSignature(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 1_400) return false;
  const text = value.trim();
  if (!SIGNATURE_B64.test(text)) return false;
  const length = Buffer.from(text, "base64").length;
  return length >= 128 && length <= 1_024;
}

function validCertUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  // Issuer trust was established by the verifier, using its configured simulator CA only in
  // simulator mode. Re-reading a jsonb URL must never trigger a fetch or extend that trust.
  return (
    checkCertUrl(value, PAYPAL_API_HOSTS.sandbox).ok || checkSimulatorCertUrl(value, SIMULATOR_CERT_URL).ok
  );
}

/**
 * Fail closed on incomplete or inconsistent storage. Only IDs and status are consumed from the
 * body; amounts, receiver details, notes and links never participate in this decision. A delayed
 * task may still apply an originally fresh verified delivery: freshness is judged at receipt.
 * The caller must separately apply decideItemStatus under the item's lock to preserve I5.
 */
export function storedWebhookApplyRule(input: StoredWebhookApplyInput): StoredWebhookApplyRule {
  if (input.eventType !== SUCCEEDED) return getFirst("NOT_A_PAYOUT_ITEM_SUCCESS");
  if (input.verified !== "self" && input.verified !== "postback") return getFirst("NOT_SIGNATURE_VERIFIED");
  const delivery = input.delivery;
  if (!record(delivery) || !DELIVERY_KEYS.every((key) => Object.hasOwn(delivery, key))) {
    return getFirst("DELIVERY_NOT_RECORDED");
  }
  if (delivery.certWarning !== null) return getFirst("CERT_EXPIRED");
  if (
    delivery.rejectReason !== null ||
    typeof delivery.transmissionId !== "string" ||
    !TRANSMISSION_ID_PATTERN.test(delivery.transmissionId) ||
    typeof delivery.transmissionTime !== "string" ||
    typeof delivery.authAlgo !== "string" ||
    delivery.authAlgo.toUpperCase() !== "SHA256WITHRSA" ||
    !validSignature(delivery.transmissionSig) ||
    !validCertUrl(delivery.certUrl)
  ) {
    return getFirst("INVALID_DELIVERY");
  }
  const sentAt = parseTransmissionTime(delivery.transmissionTime);
  const receivedAt = receiptTime(input.receivedAt);
  if (sentAt === null || receivedAt === null) return getFirst("INVALID_DELIVERY");
  if (Math.abs(sentAt - receivedAt) > MAX_TRANSMISSION_SKEW_MS) return getFirst("STALE_DELIVERY");

  if (
    typeof input.raw !== "string" ||
    Buffer.byteLength(input.raw, "utf8") > 64 * 1_024 ||
    !identifier(input.paypalEventId)
  ) {
    return getFirst("INVALID_STORED_EVENT");
  }
  const parsed = parseWebhookEnvelope(input.raw);
  if (
    !parsed.ok ||
    parsed.event.id !== input.paypalEventId ||
    parsed.event.event_type !== input.eventType ||
    (parsed.event.resource_type !== undefined && parsed.event.resource_type !== "payouts_item")
  ) {
    return getFirst("INVALID_STORED_EVENT");
  }
  const resource = parsed.event.resource;
  const target = input.item;
  if (
    !record(resource) ||
    !record(resource.payout_item) ||
    resource.transaction_status !== "SUCCESS" ||
    !identifier(resource.payout_batch_id) ||
    !identifier(resource.payout_item_id) ||
    !identifier(resource.payout_item.sender_item_id) ||
    !record(target) ||
    !identifier(target.payoutBatchId) ||
    !identifier(target.senderItemId) ||
    (target.payoutItemId !== null && !identifier(target.payoutItemId)) ||
    resource.payout_batch_id !== target.payoutBatchId ||
    resource.payout_item.sender_item_id !== target.senderItemId ||
    (target.payoutItemId !== null && resource.payout_item_id !== target.payoutItemId)
  ) {
    return getFirst("RESOURCE_MISMATCH");
  }
  return { action: "apply_now", status: "SUCCESS", corroboration: "settle_get" };
}
