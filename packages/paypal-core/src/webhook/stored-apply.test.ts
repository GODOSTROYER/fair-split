import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decideItemStatus, ITEM_STATUSES, type ItemStatus, itemStatusRank } from "../item-status.js";
import { storedWebhookApplyRule } from "./stored-apply.js";

const SUCCEEDED = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";
const RECEIVED_AT = new Date("2026-11-01T08:00:00.000Z");
const delivery = {
  transmissionId: "delivery-001",
  transmissionTime: RECEIVED_AT.toISOString(),
  transmissionSig: Buffer.alloc(256, 1).toString("base64"),
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
  authAlgo: "SHA256withRSA",
  certWarning: null,
  rejectReason: null,
};
const event = {
  id: "WH-SUCCESS-001",
  event_type: SUCCEEDED,
  resource: {
    payout_batch_id: "BATCH-001",
    payout_item_id: "ITEM-001",
    transaction_status: "SUCCESS",
    payout_item: { sender_item_id: "r37-M014" },
  },
};
const row = () => ({
  paypalEventId: event.id,
  eventType: SUCCEEDED,
  verified: "self",
  delivery: { ...delivery },
  raw: JSON.stringify(event),
  receivedAt: RECEIVED_AT,
  item: {
    payoutBatchId: "BATCH-001",
    payoutItemId: "ITEM-001",
    senderItemId: "r37-M014",
    status: "PENDING",
    cancelRequestedAt: null,
  },
});

describe("storedWebhookApplyRule", () => {
  it("a complete, signature-verified stored SUCCESS applies with no GET", () => {
    for (const verified of ["self", "postback"]) {
      expect(storedWebhookApplyRule({ ...row(), verified })).toEqual({
        action: "apply_now",
        status: "SUCCESS",
        corroboration: "settle_get",
      });
    }
  });

  it("an early verified SUCCESS applies to a persisted SUBMITTED item before a POST response names it", () => {
    expect(
      storedWebhookApplyRule({ ...row(), item: { ...row().item, status: "SUBMITTED", payoutItemId: null } }),
    ).toEqual({ action: "apply_now", status: "SUCCESS", corroboration: "settle_get" });
  });

  it("every other event and verification label requires a fresh GET", () => {
    for (const status of ITEM_STATUSES.filter((status) => status !== "SUCCESS")) {
      const raw = JSON.stringify({ ...event, resource: { ...event.resource, transaction_status: status } });
      expect(storedWebhookApplyRule({ ...row(), raw }).action).toBe("fresh_get_first");
      expect(storedWebhookApplyRule({ ...row(), eventType: `PAYMENT.PAYOUTS-ITEM.${status}` }).action).toBe(
        "fresh_get_first",
      );
    }
    for (const verified of ["dev_mock", "fetched", null, "", {}, true]) {
      expect(storedWebhookApplyRule({ ...row(), verified }).action).toBe("fresh_get_first");
    }
  });

  it("inv.i5.decided-money: a stored SUCCESS requires a GET for RETURNED, FAILED or BLOCKED", () => {
    for (const status of ["RETURNED", "FAILED", "BLOCKED"]) {
      expect(storedWebhookApplyRule({ ...row(), item: { ...row().item, status } }).action).toBe(
        "fresh_get_first",
      );
    }
  });

  it("inv.i5.decided-money: any cancel request prevents applying a stored SUCCESS without a GET", () => {
    for (const cancelRequestedAt of [RECEIVED_AT, RECEIVED_AT.toISOString(), 0, false, {}, undefined]) {
      expect(storedWebhookApplyRule({ ...row(), item: { ...row().item, cancelRequestedAt } }).action).toBe(
        "fresh_get_first",
      );
    }
    const { cancelRequestedAt: _cancelRequestedAt, ...missingCancel } = row().item;
    expect(storedWebhookApplyRule({ ...row(), item: missingCancel }).action).toBe("fresh_get_first");
  });

  it("fails closed unless the held status is known and cancelRequestedAt is explicitly null", () => {
    for (const status of [null, undefined, "", "NOT_A_STATUS", "pending", 10, {}, []]) {
      expect(storedWebhookApplyRule({ ...row(), item: { ...row().item, status } }).action).toBe(
        "fresh_get_first",
      );
    }
    const { status: _status, ...missingStatus } = row().item;
    expect(storedWebhookApplyRule({ ...row(), item: missingStatus }).action).toBe("fresh_get_first");
    for (const status of ITEM_STATUSES.filter(
      (status) => !["RETURNED", "FAILED", "BLOCKED"].includes(status),
    )) {
      expect(storedWebhookApplyRule({ ...row(), item: { ...row().item, status } }).action).toBe("apply_now");
    }
  });

  it("validates every delivery field and requires both null-valued verdict keys", () => {
    const invalid: Record<string, readonly unknown[]> = {
      transmissionId: [null, "", "bad id", 1],
      transmissionTime: [null, "", "2026-02-30T00:00:00Z", 1],
      transmissionSig: [null, "", "not base64", Buffer.alloc(127).toString("base64"), 1],
      certUrl: [null, "", "http://evil.example/cert", "https://x:y@example.com/cert", 1],
      authAlgo: [null, "", "SHA1withRSA", 1],
      certWarning: [undefined, "CERT_EXPIRED", false, 0, {}],
      rejectReason: [undefined, "MALFORMED_EVENT", false, 0, {}],
    };
    for (const [key, values] of Object.entries(invalid)) {
      for (const value of values) {
        expect(storedWebhookApplyRule({ ...row(), delivery: { ...delivery, [key]: value } }).action).toBe(
          "fresh_get_first",
        );
      }
      const absent: Record<string, unknown> = { ...delivery };
      delete absent[key];
      expect(storedWebhookApplyRule({ ...row(), delivery: absent }).action).toBe("fresh_get_first");
    }
    for (const invalidDelivery of [undefined, null, [], {}, "{}", false]) {
      expect(storedWebhookApplyRule({ ...row(), delivery: invalidDelivery }).action).toBe("fresh_get_first");
    }
  });

  it("accepts structurally valid simulated certificate URLs and refuses URL ambiguities", () => {
    for (const origin of ["http://127.0.0.1:43891", "http://localhost:43891", "https://fair-split.example"]) {
      const certUrl = `${origin}/paypal-sim/sim/certs/SIMCERT-12345678-12345678-12345678.pem`;
      expect(storedWebhookApplyRule({ ...row(), delivery: { ...delivery, certUrl } }).action).toBe(
        "apply_now",
      );
    }
    for (const certUrl of [
      "http://fair-split.example/paypal-sim/sim/certs/SIMCERT-12345678-12345678-12345678.pem",
      `${delivery.certUrl}?cache=1`,
      `${delivery.certUrl}#ignored`,
      "https://api.sandbox.paypal.com:9443/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
      "https://evil.example/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
      "https://fair-split.example/paypal-sim/sim/certs/other.pem",
    ]) {
      expect(storedWebhookApplyRule({ ...row(), delivery: { ...delivery, certUrl } }).action).toBe(
        "fresh_get_first",
      );
    }
  });

  it("checks signed freshness against receipt, including exact boundaries, rather than processing time", () => {
    for (const offset of [-300_000, 300_000]) {
      const transmissionTime = new Date(RECEIVED_AT.getTime() + offset).toISOString();
      expect(storedWebhookApplyRule({ ...row(), delivery: { ...delivery, transmissionTime } }).action).toBe(
        "apply_now",
      );
    }
    for (const offset of [-300_001, 300_001]) {
      const transmissionTime = new Date(RECEIVED_AT.getTime() + offset).toISOString();
      expect(storedWebhookApplyRule({ ...row(), delivery: { ...delivery, transmissionTime } }).action).toBe(
        "fresh_get_first",
      );
    }
    for (const receivedAt of [null, undefined, "not a date", Number.NaN, new Date(Number.NaN)]) {
      expect(storedWebhookApplyRule({ ...row(), receivedAt }).action).toBe("fresh_get_first");
    }
  });

  it("does not confuse signed stale metadata, other event IDs, other batches, or conflicting item IDs", () => {
    const invalidRaw = [
      "broken",
      "null",
      "[]",
      JSON.stringify({ ...event, id: "WH-OTHER" }),
      JSON.stringify({ ...event, event_type: "PAYMENT.PAYOUTS-ITEM.FAILED" }),
      JSON.stringify({ ...event, resource: null }),
      ...Object.entries({
        payout_batch_id: "BATCH-OTHER",
        payout_item_id: "ITEM-OTHER",
        payout_item: { sender_item_id: "r38-M014" },
        transaction_status: "FAILED",
      }).map(([key, value]) => JSON.stringify({ ...event, resource: { ...event.resource, [key]: value } })),
    ];
    for (const raw of invalidRaw)
      expect(storedWebhookApplyRule({ ...row(), raw }).action).toBe("fresh_get_first");
    expect(storedWebhookApplyRule({ ...row(), item: null }).action).toBe("fresh_get_first");
  });

  it("can bind the first PayPal item ID to its pre-written sender ID within the matching batch", () => {
    expect(storedWebhookApplyRule({ ...row(), item: { ...row().item, payoutItemId: null } }).action).toBe(
      "apply_now",
    );
    const raw = JSON.stringify({ ...event, resource: { ...event.resource, payout_item: undefined } });
    expect(storedWebhookApplyRule({ ...row(), raw }).action).toBe("fresh_get_first");
  });

  it("inv.i5.stored-webhook: arbitrary json delivery or raw input never throws", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (delivery, raw) => {
        expect(() => storedWebhookApplyRule({ ...row(), delivery, raw })).not.toThrow();
      }),
      { numRuns: 500 },
    );
  });

  it("inv.i5.stored-webhook: forged or stale bodies cannot advance any item", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ITEM_STATUSES),
        fc.integer({ min: 300_001, max: 2_000_000 }),
        (start, skew) => {
          const transmissionTime = new Date(RECEIVED_AT.getTime() - skew).toISOString();
          const rule = storedWebhookApplyRule({
            ...row(),
            delivery: { ...delivery, transmissionTime },
            item: { ...row().item, status: start },
          });
          let current: ItemStatus = start;
          if (rule.action === "apply_now") {
            const decision = decideItemStatus(current, rule.status, { cancelRequested: false });
            if (decision.apply) current = decision.status;
          }
          expect(current).toBe(start);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("inv.i5.stored-webhook: a non-SUCCEEDED event or mismatched signed resource always needs a GET", () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (eventType, foreignId) => {
        if (eventType !== SUCCEEDED) {
          expect(storedWebhookApplyRule({ ...row(), eventType }).action).toBe("fresh_get_first");
        }
        if (foreignId !== event.id) {
          expect(storedWebhookApplyRule({ ...row(), paypalEventId: foreignId }).action).toBe(
            "fresh_get_first",
          );
        }
        if (foreignId !== event.resource.payout_batch_id) {
          const raw = JSON.stringify({
            ...event,
            resource: { ...event.resource, payout_batch_id: foreignId },
          });
          expect(storedWebhookApplyRule({ ...row(), raw }).action).toBe("fresh_get_first");
        }
      }),
      { numRuns: 500 },
    );
  });

  it("inv.i5.stored-webhook: duplicate and reordered deliveries leave the same monotonic rank", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ITEM_STATUSES),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
        (start, valid) => {
          const fold = (entries: readonly boolean[]) => {
            let current: ItemStatus = start;
            for (const accepted of entries) {
              const rule = storedWebhookApplyRule({
                ...row(),
                verified: accepted ? "self" : "fetched",
                item: { ...row().item, status: current },
              });
              if (rule.action !== "apply_now") continue;
              const before = itemStatusRank(current);
              const next = decideItemStatus(current, rule.status, { cancelRequested: false });
              if (next.apply) current = next.status;
              expect(itemStatusRank(current)).toBeGreaterThanOrEqual(before);
            }
            return current;
          };
          expect(fold([...valid, ...valid].reverse())).toBe(fold(valid));
        },
      ),
      { numRuns: 500 },
    );
  });
});
