// The apply contract the webhook route exposes to processWebhook and settleBatch (plan, PayPal
// integration contract, "Webhooks"): a signature-verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED may apply at
// once (it drives MM-1) but is corroborated by the settle GETs at +25 s / +90 s; a GET that disagrees
// wins and raises an /ops alert; every other status needs a fresh GET before any state change.

import { ITEM_STATUSES, WEBHOOK_EVENT_TYPES } from "@fairsplit/paypal-core";
import { describe, expect, it } from "vitest";
import type { WebhookVerifiedLabel } from "./_shims/contracts.js";
import {
  corroborateWithSettleGet,
  openForSettleGets,
  SETTLE_GET_DELAYS_MS,
  webhookApplyRule,
} from "./apply.js";

const LABELS: readonly WebhookVerifiedLabel[] = ["self", "postback", "dev_mock", "fetched"];

describe("webhookApplyRule: what processWebhook may do before asking PayPal", () => {
  it("a signature-verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED applies at once, pending the settle GETs at +25 s (Judge) or +90 s", () => {
    for (const verified of ["self", "postback"] as const) {
      expect(webhookApplyRule({ eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified })).toEqual({
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
      for (const verified of LABELS) {
        const rule = webhookApplyRule({ eventType, verified });
        if (rule.action === "apply_now") applyNow.push(`${eventType} ${verified}`);
        else expect(rule.action).toBe("fresh_get_first");
      }
    }
    expect(applyNow).toEqual([
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED self",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED postback",
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
      expect(webhookApplyRule({ eventType, verified: "self" })).toEqual({
        action: "fresh_get_first",
        reason: "NOT_A_PAYOUT_ITEM_SUCCESS",
      });
    }
    // Simulator events (dev only) and catch-up rows carry no PayPal signature over this delivery.
    for (const verified of ["dev_mock", "fetched"] as const) {
      expect(webhookApplyRule({ eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", verified })).toEqual({
        action: "fresh_get_first",
        reason: "NOT_SIGNATURE_VERIFIED",
      });
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
