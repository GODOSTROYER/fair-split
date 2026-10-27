// The apply contract the webhook route exposes to processWebhook and settleBatch (plan, PayPal
// integration contract, "Webhooks"): a signature-verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED may apply at
// once (it drives MM-1) but is corroborated by the settle GETs at +25 s / +90 s; a GET that disagrees
// wins and raises an /ops alert; every other status needs a fresh GET before any state change.

import { ITEM_STATUSES, WEBHOOK_EVENT_TYPES } from "@fairsplit/paypal-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { WebhookVerifiedLabel } from "./_shims/contracts.js";
import {
  corroborateWithSettleGet,
  openForSettleGets,
  SETTLE_GET_DELAYS_MS,
  webhookApplyRule,
} from "./apply.js";

const LABELS: readonly WebhookVerifiedLabel[] = ["self", "postback", "dev_mock", "fetched"];

/** How a delivery reached us, as the route records it in `delivery`: here, under an in-date certificate. */
const IN_DATE = { certWarning: null } as const;
/** A delivery signed under an expired PayPal certificate (verify.ts labels it CERT_EXPIRED). */
const EXPIRED = { certWarning: "CERT_EXPIRED" } as const;
/** `delivery` stored with its null-valued keys stripped (jsonb_strip_nulls, an undefined-dropping mapper). */
const STRIPPED = { transmissionId: "8f3c1a40-91d2-11ef-b4c7-1b2c3d4e5f60", rejectReason: undefined } as const;

describe("webhookApplyRule: what processWebhook may do before asking PayPal", () => {
  it("a signature-verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED under an in-date certificate applies at once (MM-1), pending the settle GETs at +25 s (Judge) or +90 s", () => {
    for (const verified of ["self", "postback"] as const) {
      expect(
        webhookApplyRule({ eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified, delivery: IN_DATE }),
      ).toEqual({
        action: "apply_now",
        status: "SUCCESS",
        corroboration: "settle_get",
      });
    }
    expect(SETTLE_GET_DELAYS_MS).toEqual({ judge: 25_000, standard: 90_000 });
  });

  it("every other event, under every label, changes no state before a fresh GET", () => {
    const applyNow: string[] = [];
    const eventTypes = [
      ...WEBHOOK_EVENT_TYPES,
      "PAYMENT.SALE.COMPLETED",
      "payment.payouts-item.succeeded",
      "",
    ];
    for (const eventType of eventTypes) {
      for (const verified of [...LABELS, null]) {
        for (const delivery of [IN_DATE, EXPIRED, STRIPPED, {}, null]) {
          const rule = webhookApplyRule({ eventType, verified, delivery });
          if (rule.action === "apply_now") {
            applyNow.push(`${eventType} ${verified} ${JSON.stringify(delivery)}`);
          } else expect(rule.action).toBe("fresh_get_first");
        }
        // A row read back without its `delivery` field at all.
        const bare = JSON.parse(JSON.stringify({ eventType, verified }));
        expect(webhookApplyRule(bare).action).toBe("fresh_get_first");
      }
    }
    expect(applyNow).toEqual([
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED self {"certWarning":null}',
      'PAYMENT.PAYOUTS-ITEM.SUCCEEDED postback {"certWarning":null}',
    ]);
  });

  it("says why a GET comes first: any status other than an item success, or a success no signature vouches for", () => {
    for (const eventType of [
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
      "PAYMENT.PAYOUTS-ITEM.FAILED",
      "PAYMENT.PAYOUTS-ITEM.RETURNED",
      "PAYMENT.PAYOUTSBATCH.SUCCESS",
      "INVOICING.INVOICE.PAID",
    ]) {
      expect(webhookApplyRule({ eventType, verified: "self", delivery: IN_DATE })).toEqual({
        action: "fresh_get_first",
        reason: "NOT_A_PAYOUT_ITEM_SUCCESS",
      });
    }
    // Simulator events (dev only) and catch-up rows carry no PayPal signature over this delivery.
    for (const verified of ["dev_mock", "fetched", null] as const) {
      expect(
        webhookApplyRule({ eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified, delivery: IN_DATE }),
      ).toEqual({ action: "fresh_get_first", reason: "NOT_SIGNATURE_VERIFIED" });
    }
  });

  it("an expired-certificate SUCCEEDED never changes state from its body, not even one PayPal's postback confirmed", () => {
    for (const verified of LABELS) {
      for (const eventType of ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED"]) {
        expect(webhookApplyRule({ eventType, verified, delivery: EXPIRED })).toEqual({
          action: "fresh_get_first",
          reason: "CERT_EXPIRED",
        });
      }
    }
  });

  it("fails closed on any certificate warning, including ones it does not know yet", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string({ minLength: 0, maxLength: 40 }),
          fc.jsonValue().filter((v) => v !== null),
        ),
        fc.constantFrom(...LABELS),
        fc.constantFrom(...WEBHOOK_EVENT_TYPES),
        (certWarning, verified, eventType) => {
          // As read back from jsonb, where the value can be anything JSON can hold.
          const delivery = { certWarning } as { certWarning: string };
          const rule = webhookApplyRule({ eventType, verified, delivery });
          return rule.action === "fresh_get_first" && rule.reason === "CERT_EXPIRED";
        },
      ),
    );
  });

  it("a verified row whose delivery record is missing is not trusted to have had an in-date certificate", () => {
    for (const verified of ["self", "postback"] as const) {
      expect(
        webhookApplyRule({ eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified, delivery: null }),
      ).toEqual({ action: "fresh_get_first", reason: "DELIVERY_NOT_RECORDED" });
    }
  });

  it("only an explicit null certWarning is in date: a record that lost the key (null keys stripped) or a row read without the column is DELIVERY_NOT_RECORDED", () => {
    for (const verified of ["self", "postback"] as const) {
      const eventType = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED";
      for (const delivery of [STRIPPED, {}, { certWarning: undefined }]) {
        expect(webhookApplyRule({ eventType, verified, delivery }), JSON.stringify(delivery)).toEqual({
          action: "fresh_get_first",
          reason: "DELIVERY_NOT_RECORDED",
        });
      }
      for (const delivery of [undefined, "{}", 0, false]) {
        const row = { eventType, verified, delivery } as unknown as Parameters<typeof webhookApplyRule>[0];
        expect(webhookApplyRule(row), String(delivery)).toEqual({
          action: "fresh_get_first",
          reason: "DELIVERY_NOT_RECORDED",
        });
      }
    }
  });
});

describe("corroborateWithSettleGet: the settle GET checks a SUCCESS applied from a webhook", () => {
  const applied = { paypalEventId: "WH-58D3", payoutItemId: "5KX9", status: "SUCCESS" } as const;

  it("a GET that agrees corroborates it, with no alert", () => {
    expect(corroborateWithSettleGet(applied, "SUCCESS")).toEqual({
      verdict: "corroborated",
      status: "SUCCESS",
      alert: null,
    });
  });

  it.each(ITEM_STATUSES.filter((s) => s !== "SUCCESS"))(
    "a GET that says %s wins and raises an /ops alert",
    (getStatus) => {
      expect(corroborateWithSettleGet(applied, getStatus)).toMatchObject({
        verdict: "get_wins",
        status: getStatus,
        alert: {
          kind: "WEBHOOK_GET_MISMATCH",
          paypalEventId: "WH-58D3",
          payoutItemId: "5KX9",
          webhookStatus: "SUCCESS",
          getStatus,
        },
      });
    },
  );

  it("flags when the GET moves the item backwards, the one sanctioned exception to forward-only (I5)", () => {
    const backwards = ITEM_STATUSES.filter(
      (s) =>
        corroborateWithSettleGet(applied, s).verdict === "get_wins" &&
        corroborateWithSettleGet(applied, s).alert?.correction,
    );
    expect(backwards.sort()).toEqual(["BLOCKED", "FAILED", "ONHOLD", "PENDING", "RETURNED", "UNCLAIMED"]);
    expect(corroborateWithSettleGet(applied, "REVERSED").alert?.correction).toBe(false);
  });

  it("an unreadable GET status changes nothing and still raises the alert", () => {
    for (const raw of ["NEW", "", null]) {
      expect(corroborateWithSettleGet(applied, raw)).toMatchObject({
        verdict: "unreadable",
        status: null,
        alert: { kind: "WEBHOOK_GET_MISMATCH", webhookStatus: "SUCCESS", getStatus: raw },
      });
    }
  });
});

describe("openForSettleGets: the follow-up settle GETs keep running until a GET has agreed", () => {
  it("a SUCCESS applied from a webhook stays open until a GET corroborates it", () => {
    expect(openForSettleGets({ status: "SUCCESS", corroboratedByGet: false })).toBe(true);
    expect(openForSettleGets({ status: "SUCCESS", corroboratedByGet: true })).toBe(false);
  });

  it("non-terminal statuses stay open whatever confirmed them", () => {
    for (const status of ["PENDING", "ONHOLD", "UNCLAIMED"] as const) {
      expect(openForSettleGets({ status, corroboratedByGet: true })).toBe(true);
    }
    expect(openForSettleGets({ status: null, corroboratedByGet: false })).toBe(true);
    for (const status of ["FAILED", "BLOCKED", "RETURNED", "REFUNDED", "REVERSED"] as const) {
      expect(openForSettleGets({ status, corroboratedByGet: true })).toBe(false);
    }
  });
});
