// The vendored PR #107 schemas behave as the PR's own tests say, and Fair Split's strict schema
// adds EMAIL-only, USD-only, two decimals on top.

import { describe, expect, it } from "vitest";
import {
  cancelUnclaimedPayoutItemParameters,
  createPayoutBatchParameters,
  fairSplitPayoutBatch,
  getPayoutBatch,
  getPayoutBatchParameters,
  getPayoutItemParameters,
  PayoutParamsError,
} from "../src/index.js";
import { RealPayPalHttp } from "./support/http.js";
import { useMsw } from "./support/msw.js";

useMsw();

const batch = (value = "12.34") => ({
  sender_batch_header: {
    sender_batch_id: "Payouts_2026_10_04_001",
    recipient_type: "EMAIL" as const,
    email_subject: "You have a payout!",
  },
  items: [
    {
      receiver: "seller@example.com",
      amount: { currency: "USD", value },
      note: "Thanks for selling with us!",
      sender_item_id: "seller-42",
    },
  ],
});

describe("createPayoutBatchParameters (vendored from PR #107)", () => {
  it.each(["-10.00", "ten", "", "1e3", "0", "0.00", ".0", "10."])("rejects the amount %p", (value) => {
    expect(createPayoutBatchParameters({}).safeParse(batch(value)).success).toBe(false);
  });

  it.each(["10", "0.01", ".5", "10.123456"])("leaves the precision of %p to PayPal", (value) => {
    expect(createPayoutBatchParameters({}).safeParse(batch(value)).success).toBe(true);
  });

  it("requires at least one item and drops unknown fields", () => {
    expect(createPayoutBatchParameters({}).safeParse({ ...batch(), items: [] }).success).toBe(false);
    const parsed = createPayoutBatchParameters({}).parse({ ...batch(), paypal_request_id: "other-key" });
    expect(parsed).not.toHaveProperty("paypal_request_id");
  });

  it.each([
    [
      "get_payout_batch",
      () => getPayoutBatchParameters({}).safeParse({ payout_batch_id: "../../v1/oauth2/token" }),
    ],
    ["get_payout_batch", () => getPayoutBatchParameters({}).safeParse({ payout_batch_id: "A".repeat(31) })],
    ["get_payout_item", () => getPayoutItemParameters({}).safeParse({ payout_item_id: "" })],
    [
      "cancel_unclaimed_payout_item",
      () => cancelUnclaimedPayoutItemParameters({}).safeParse({ payout_item_id: "8AELMXH8UB2P8/../../x" }),
    ],
  ])("%s rejects an ID that would escape the URL path", (_tool, run) => {
    expect(run().success).toBe(false);
  });

  it("defaults paging to page 1, 100 per page, with totals", () => {
    expect(getPayoutBatchParameters({}).parse({ payout_batch_id: "5UXD2E8A7EBQJ" })).toEqual({
      payout_batch_id: "5UXD2E8A7EBQJ",
      page: 1,
      page_size: 100,
      total_required: true,
    });
  });

  it("throws before any request when the PR's validation fails", async () => {
    const http = new RealPayPalHttp();
    await expect(getPayoutBatch(http, {}, { payout_batch_id: "a/b" })).rejects.toBeInstanceOf(
      PayoutParamsError,
    );
    expect(http.calls).toHaveLength(0);
  });
});

describe("fairSplitPayoutBatch: EMAIL, USD, two decimals, nothing else", () => {
  const ok = {
    sender_batch_header: {
      sender_batch_id: "2026A-5f2c9e01-r37",
      recipient_type: "EMAIL",
      note: "Fair Split 2026-A, batch 0a1b2c3d",
    },
    items: [
      {
        receiver: "m014@example.test",
        amount: { currency: "USD", value: "64.45" },
        sender_item_id: "r37-M-014",
        purpose: "GOODS",
      },
    ],
  };

  it("accepts the register §8 shape, which also passes PR #107's schema", () => {
    expect(fairSplitPayoutBatch.safeParse(ok).success).toBe(true);
    expect(createPayoutBatchParameters({}).safeParse(ok).success).toBe(true);
  });

  const item = ok.items[0] as (typeof ok.items)[number];
  it.each([
    [
      "PHONE recipients",
      { ...ok, sender_batch_header: { ...ok.sender_batch_header, recipient_type: "PHONE" } },
    ],
    ["a non-USD amount", { ...ok, items: [{ ...item, amount: { currency: "PHP", value: "64.45" } }] }],
    ["three decimals", { ...ok, items: [{ ...item, amount: { currency: "USD", value: "64.450" } }] }],
    ["one decimal", { ...ok, items: [{ ...item, amount: { currency: "USD", value: "64.5" } }] }],
    ["a zero amount", { ...ok, items: [{ ...item, amount: { currency: "USD", value: "0.00" } }] }],
    ["a phone receiver", { ...ok, items: [{ ...item, receiver: "+15555550100" }] }],
    ["an item without sender_item_id", { ...ok, items: [{ ...item, sender_item_id: undefined }] }],
    ["an item-level recipient_type", { ...ok, items: [{ ...item, recipient_type: "PHONE" }] }],
    ["a Venmo wallet", { ...ok, items: [{ ...item, recipient_wallet: "VENMO" }] }],
    ["an e-mail message", { ...ok, sender_batch_header: { ...ok.sender_batch_header, email_message: "hi" } }],
    ["a duplicate sender_item_id", { ...ok, items: [item, { ...item, receiver: "m007@example.test" }] }],
    ["no items", { ...ok, items: [] }],
  ])("refuses %s", (_label, body) => {
    expect(fairSplitPayoutBatch.safeParse(body).success).toBe(false);
  });
});
