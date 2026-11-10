// Tests that kill mutation-testing survivors (handoff T3) in storedWebhookApplyRule, the gate that lets a
// stored PAYMENT.PAYOUTS-ITEM.SUCCEEDED mark an item paid without a fresh GET: each field of the recorded
// delivery and of the stored event, at its exact edge.
import { describe, expect, it } from "vitest";
import { storedWebhookApplyRule } from "./stored-apply.js";

const SUCCEEDED = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";
const RECEIVED_AT = new Date("2026-11-01T08:00:00.000Z");
const APPLY = { action: "apply_now", status: "SUCCESS", corroboration: "settle_get" };
const get = (reason: string) => ({ action: "fresh_get_first", reason });
const sig = (bytes: number) => Buffer.alloc(bytes, 1).toString("base64");

const event = (over: Record<string, unknown> = {}, resource: Record<string, unknown> = {}) => ({
  id: "WH-SUCCESS-001",
  event_type: SUCCEEDED,
  resource: {
    payout_batch_id: "BATCH-001",
    payout_item_id: "ITEM-001",
    transaction_status: "SUCCESS",
    payout_item: { sender_item_id: "r37-M014" },
    ...resource,
  },
  ...over,
});
const row = (over: Record<string, unknown> = {}, delivery: Record<string, unknown> = {}) => ({
  paypalEventId: "WH-SUCCESS-001",
  eventType: SUCCEEDED,
  verified: "self",
  delivery: {
    transmissionId: "delivery-001",
    transmissionTime: RECEIVED_AT.toISOString(),
    transmissionSig: sig(256),
    certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
    authAlgo: "SHA256withRSA",
    certWarning: null,
    rejectReason: null,
    ...delivery,
  },
  raw: JSON.stringify(event()),
  receivedAt: RECEIVED_AT,
  item: {
    payoutBatchId: "BATCH-001",
    payoutItemId: "ITEM-001",
    senderItemId: "r37-M014",
    status: "PENDING",
    cancelRequestedAt: null,
  },
  ...over,
});

describe("the recorded delivery", () => {
  it("the signature must decode to 128 to 1,024 bytes, at most 1,400 characters, base64 only", () => {
    expect(storedWebhookApplyRule(row({}, { transmissionSig: sig(128) }))).toEqual(APPLY);
    expect(storedWebhookApplyRule(row({}, { transmissionSig: sig(1_024) }))).toEqual(APPLY);
    expect(storedWebhookApplyRule(row({}, { transmissionSig: sig(127) }))).toEqual(get("INVALID_DELIVERY"));
    expect(storedWebhookApplyRule(row({}, { transmissionSig: sig(1_025) }))).toEqual(get("INVALID_DELIVERY"));
    expect(storedWebhookApplyRule(row({}, { transmissionSig: `${sig(256)}!` }))).toEqual(
      get("INVALID_DELIVERY"),
    );
    expect(storedWebhookApplyRule(row({}, { transmissionSig: ` ${sig(256)} ` }))).toEqual(APPLY);
    expect(storedWebhookApplyRule(row({}, { transmissionSig: `${sig(256)}${" ".repeat(1_400)}` }))).toEqual(
      get("INVALID_DELIVERY"),
    );
    expect(storedWebhookApplyRule(row({}, { transmissionSig: 7 }))).toEqual(get("INVALID_DELIVERY"));
  });

  it("a delivery missing any recorded key, or with a non-string time, is not one", () => {
    const { authAlgo: _a, ...noAlgo } = row().delivery;
    expect(storedWebhookApplyRule(row({ delivery: noAlgo }))).toEqual(get("DELIVERY_NOT_RECORDED"));
    expect(storedWebhookApplyRule(row({}, { transmissionTime: 1_730_000_000_000 }))).toEqual(
      get("INVALID_DELIVERY"),
    );
  });

  it("the receipt time may be a Date, epoch milliseconds or an ISO string; anything else is invalid", () => {
    expect(storedWebhookApplyRule(row({ receivedAt: RECEIVED_AT.getTime() }))).toEqual(APPLY);
    expect(storedWebhookApplyRule(row({ receivedAt: RECEIVED_AT.toISOString() }))).toEqual(APPLY);
    expect(storedWebhookApplyRule(row({ receivedAt: Number.NaN }))).toEqual(get("INVALID_DELIVERY"));
    expect(storedWebhookApplyRule(row({ receivedAt: true }))).toEqual(get("INVALID_DELIVERY"));
  });

  it("only a SUCCEEDED event applies", () => {
    expect(storedWebhookApplyRule(row({ eventType: "PAYMENT.PAYOUTS-ITEM.FAILED" }))).toEqual(
      get("NOT_A_PAYOUT_ITEM_SUCCESS"),
    );
  });
});

describe("the stored event", () => {
  const withEvent = (e: unknown, over: Record<string, unknown> = {}) =>
    storedWebhookApplyRule(row({ raw: JSON.stringify(e), ...over }));

  it("event ids are 1 to 128 printable characters with no space", () => {
    const id128 = "W".repeat(128);
    expect(withEvent(event({ id: id128 }), { paypalEventId: id128 })).toEqual(APPLY);
    const id129 = "W".repeat(129);
    expect(withEvent(event({ id: id129 }), { paypalEventId: id129 })).toEqual(get("INVALID_STORED_EVENT"));
    expect(withEvent(event({ id: "" }), { paypalEventId: "" })).toEqual(get("INVALID_STORED_EVENT"));
    expect(withEvent(event({ id: "WH\u0007X" }), { paypalEventId: "WH\u0007X" })).toEqual(
      get("INVALID_STORED_EVENT"),
    );
    expect(withEvent(event({ id: "WH\u007fX" }), { paypalEventId: "WH\u007fX" })).toEqual(
      get("INVALID_STORED_EVENT"),
    );
    expect(withEvent(event({ id: " " }), { paypalEventId: " " })).toEqual(get("INVALID_STORED_EVENT"));
    expect(withEvent(event({ id: 7 }), { paypalEventId: 7 })).toEqual(get("INVALID_STORED_EVENT"));
  });

  it("a resource type other than payouts_item is not this event; none at all is fine", () => {
    expect(withEvent(event({ resource_type: "payouts" }))).toEqual(get("INVALID_STORED_EVENT"));
    expect(withEvent(event({ resource_type: "payouts_item" }))).toEqual(APPLY);
  });

  it("each resource identifier is checked, the item's too", () => {
    expect(withEvent(event({}, { payout_item_id: "I T" }))).toEqual(get("RESOURCE_MISMATCH"));
    expect(withEvent(event({}, { payout_batch_id: "" }))).toEqual(get("RESOURCE_MISMATCH"));
    expect(storedWebhookApplyRule(row({ item: { ...row().item, senderItemId: "r 37" } }))).toEqual(
      get("RESOURCE_MISMATCH"),
    );
  });
});
