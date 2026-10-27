import { describe, expect, it } from "vitest";
import { payoutItemResource, syntheticEvent } from "../testing/index.js";
import {
  isSubscribedEventType,
  parseWebhookEnvelope,
  resourceKeyOf,
  resourceRefOf,
  WEBHOOK_EVENT_TYPES,
} from "./event.js";

describe("subscribed webhook events (register §8)", () => {
  it("is exactly the register's 15 event types", () => {
    const expected = [
      ...["PAID", "CANCELLED", "UPDATED", "REFUNDED"].map((e) => `INVOICING.INVOICE.${e}`),
      ...["PROCESSING", "SUCCESS", "DENIED"].map((e) => `PAYMENT.PAYOUTSBATCH.${e}`),
      ...["SUCCEEDED", "UNCLAIMED", "FAILED", "RETURNED", "CANCELED", "BLOCKED", "HELD", "REFUNDED"].map(
        (e) => `PAYMENT.PAYOUTS-ITEM.${e}`,
      ),
    ];
    expect([...WEBHOOK_EVENT_TYPES]).toEqual(expected);
    expect(new Set(WEBHOOK_EVENT_TYPES).size).toBe(15);
    expect(isSubscribedEventType("PAYMENT.PAYOUTS-ITEM.HELD")).toBe(true);
    expect(isSubscribedEventType("PAYMENT.CAPTURE.COMPLETED")).toBe(false);
  });
});

describe("parseWebhookEnvelope", () => {
  it("parses PayPal's envelope and keeps unknown fields", () => {
    const raw = JSON.stringify({
      ...syntheticEvent("INVOICING.INVOICE.PAID", { id: "INV2-AAAA" }),
      extra: 1,
    });
    const parsed = parseWebhookEnvelope(Buffer.from(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.event.event_type).toBe("INVOICING.INVOICE.PAID");
    expect((parsed.event as Record<string, unknown>).extra).toBe(1);
  });

  it("reports invalid JSON and invalid envelopes without throwing", () => {
    expect(parseWebhookEnvelope("{")).toEqual({ ok: false, error: "INVALID_JSON", eventType: null });
    expect(parseWebhookEnvelope('{"event_type":"X"}')).toEqual({
      ok: false,
      error: "INVALID_ENVELOPE",
      eventType: "X",
    });
    expect(parseWebhookEnvelope("[]")).toMatchObject({ ok: false, error: "INVALID_ENVELOPE" });
  });
});

describe("resourceRefOf / resourceKeyOf", () => {
  it("reads invoice ids from resource.invoice.id, falling back to resource.id", () => {
    expect(
      resourceKeyOf({ event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: "INV2-A" } } }),
    ).toBe("invoice:INV2-A");
    expect(resourceKeyOf({ event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-B" } })).toBe(
      "invoice:INV2-B",
    );
  });

  it("prefers our sender_item_id for items, then payout_item_id", () => {
    const resource = payoutItemResource({
      senderItemId: "r37-M-014",
      payoutItemId: "5KX9",
      payoutBatchId: "CR9VS",
      transactionStatus: "UNCLAIMED",
    });
    const event = { event_type: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", resource };
    expect(resourceRefOf(event)).toEqual({
      kind: "payout_item",
      senderItemId: "r37-M-014",
      payoutItemId: "5KX9",
      payoutBatchId: "CR9VS",
      transactionStatus: "UNCLAIMED",
    });
    expect(resourceKeyOf(event)).toBe("item:r37-M-014");
    expect(
      resourceKeyOf({ event_type: "PAYMENT.PAYOUTS-ITEM.FAILED", resource: { payout_item_id: "5KX9" } }),
    ).toBe("item:5KX9");
  });

  it("reads batch ids from batch_header", () => {
    const event = {
      event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      resource: {
        batch_header: {
          payout_batch_id: "CR9VS",
          batch_status: "SUCCESS",
          sender_batch_header: { sender_batch_id: "2026A-7f3a91c2-r37" },
        },
      },
    };
    expect(resourceRefOf(event)).toEqual({
      kind: "payout_batch",
      payoutBatchId: "CR9VS",
      senderBatchId: "2026A-7f3a91c2-r37",
      batchStatus: "SUCCESS",
    });
    expect(resourceKeyOf(event)).toBe("batch:CR9VS");
  });

  it("returns null keys for other or empty resources", () => {
    expect(resourceKeyOf({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "X" } })).toBeNull();
    expect(resourceKeyOf({ event_type: "PAYMENT.PAYOUTSBATCH.DENIED", resource: {} })).toBeNull();
    expect(resourceKeyOf({ event_type: "INVOICING.INVOICE.PAID" })).toBeNull();
  });
});
