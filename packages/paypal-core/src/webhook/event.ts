// Webhook event envelope, the subscribed event list (register §8) and resource keys (S3.6.5).

import { z } from "zod";

/** Exactly the 15 event types in register §8, in the register's order. */
export const WEBHOOK_EVENT_TYPES = Object.freeze([
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
] as const);

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

const SUBSCRIBED: ReadonlySet<string> = new Set(WEBHOOK_EVENT_TYPES);

export function isSubscribedEventType(value: string): value is WebhookEventType {
  return SUBSCRIBED.has(value);
}

/** Lenient envelope: PayPal adds fields over time, so unknown keys pass through. */
export const WebhookEnvelopeSchema = z
  .object({
    id: z.string().min(1).max(128),
    event_type: z.string().min(1).max(128),
    resource_type: z.string().max(128).optional(),
    event_version: z.string().optional(),
    resource_version: z.string().optional(),
    create_time: z.string().optional(),
    summary: z.string().optional(),
    resource: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type WebhookEnvelope = z.infer<typeof WebhookEnvelopeSchema>;

export type EnvelopeParse =
  | { ok: true; event: WebhookEnvelope }
  | { ok: false; error: "INVALID_JSON" | "INVALID_ENVELOPE"; eventType: string | null };

/** Parse a raw webhook body. Never throws. On failure, still reports `event_type` when readable. */
export function parseWebhookEnvelope(raw: string | Uint8Array): EnvelopeParse {
  const text = typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "INVALID_JSON", eventType: null };
  }
  const parsed = WebhookEnvelopeSchema.safeParse(json);
  if (parsed.success) return { ok: true, event: parsed.data };
  const rawType =
    typeof json === "object" && json !== null ? (json as { event_type?: unknown }).event_type : null;
  const eventType = typeof rawType === "string" ? rawType.slice(0, 128) : null;
  return { ok: false, error: "INVALID_ENVELOPE", eventType };
}

export type ResourceRef =
  | { kind: "invoice"; invoiceId: string | null }
  | {
      kind: "payout_item";
      senderItemId: string | null;
      payoutItemId: string | null;
      payoutBatchId: string | null;
      transactionStatus: string | null;
    }
  | {
      kind: "payout_batch";
      payoutBatchId: string | null;
      senderBatchId: string | null;
      batchStatus: string | null;
    }
  | { kind: "other" };

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const obj = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Where a webhook points. Invoices: `resource.invoice?.id ?? resource.id` (S3.6.5). Items:
 * `payout_item.sender_item_id` (our key, written before the POST), then `payout_item_id`. Batches:
 * `batch_header.payout_batch_id`.
 */
export function resourceRefOf(event: Pick<WebhookEnvelope, "event_type" | "resource">): ResourceRef {
  const resource = obj(event.resource);
  if (event.event_type.startsWith("INVOICING.INVOICE.")) {
    return { kind: "invoice", invoiceId: str(obj(resource.invoice).id) ?? str(resource.id) };
  }
  if (event.event_type.startsWith("PAYMENT.PAYOUTS-ITEM.")) {
    return {
      kind: "payout_item",
      senderItemId: str(obj(resource.payout_item).sender_item_id) ?? str(resource.sender_item_id),
      payoutItemId: str(resource.payout_item_id),
      payoutBatchId: str(resource.payout_batch_id),
      transactionStatus: str(resource.transaction_status),
    };
  }
  if (event.event_type.startsWith("PAYMENT.PAYOUTSBATCH.")) {
    const header = obj(resource.batch_header);
    return {
      kind: "payout_batch",
      payoutBatchId: str(header.payout_batch_id),
      senderBatchId: str(obj(header.sender_batch_header).sender_batch_id),
      batchStatus: str(header.batch_status),
    };
  }
  return { kind: "other" };
}

/** Compact `webhook_events.resource_key`: `invoice:<id>`, `item:<sender_item_id|payout_item_id>`, `batch:<id>`. */
export function resourceKeyOf(event: Pick<WebhookEnvelope, "event_type" | "resource">): string | null {
  const ref = resourceRefOf(event);
  switch (ref.kind) {
    case "invoice":
      return ref.invoiceId ? `invoice:${ref.invoiceId}` : null;
    case "payout_item": {
      const id = ref.senderItemId ?? ref.payoutItemId;
      return id ? `item:${id}` : null;
    }
    case "payout_batch":
      return ref.payoutBatchId ? `batch:${ref.payoutBatchId}` : null;
    default:
      return null;
  }
}
