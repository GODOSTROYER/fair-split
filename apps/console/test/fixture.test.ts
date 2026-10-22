// The prototype fixture copies the decision register §2; this checks every figure it shows to the cent.

import { describe, expect, it } from "vitest";
import {
  BATCH_ITEMS,
  BATCH_SHA256,
  HERO,
  INVOICE,
  lineAfter,
  lineWithDuplicate,
  MEMBERS,
  RATE_CARD_SHA256,
  SENDER_BATCH_ID,
  TOTALS,
} from "../src/prototype/fixture.js";
import { kg, phpEstimate, usd, usdSpoken } from "../src/prototype/format.js";
import { sha256Hex } from "../src/prototype/hash.js";

describe("prototype fixture vs register §2", () => {
  it("every derived line sums to the register's net", () => {
    for (const m of MEMBERS) expect(lineAfter(m).netCents, m.no).toBe(m.netCents);
  });

  it("the hero line is 43.69 + 21.85 − CBU 1.09 = 64.45, about ₱4,028", () => {
    const line = lineAfter(HERO);
    expect([line.premiumCents, line.bonusCents, line.cbuCents]).toEqual([4369, 2185, 109]);
    expect(phpEstimate(line.netCents)).toBe("₱4,028");
  });

  it("Merlyn's cash line is 88.57 + 41.34 − 2.07 = 127.84, about ₱7,990", () => {
    const merlyn = MEMBERS.find((m) => m.no === "M-053");
    if (!merlyn) throw new Error("M-053 missing");
    const line = lineAfter(merlyn);
    expect([line.premiumCents, line.bonusCents, line.cbuCents, line.netCents]).toEqual([
      8857, 4134, 207, 12784,
    ]);
    expect(phpEstimate(line.netCents)).toBe("₱7,990");
  });

  it("Nong Dioning is 80.65 with the duplicate and 62.71 without", () => {
    const dioning = MEMBERS.find((m) => m.no === "M-007");
    if (!dioning) throw new Error("M-007 missing");
    expect(lineWithDuplicate(dioning).netCents).toBe(8065);
    expect(lineAfter(dioning).netCents).toBe(6271);
  });

  it("Nong Pedring's loan is 5.90, at the 50% cap", () => {
    const pedring = MEMBERS.find((m) => m.no === "M-022");
    if (!pedring) throw new Error("M-022 missing");
    expect(lineAfter(pedring).loanCents).toBe(590);
  });

  it("the batch is 8 items, US$368.39; seven paid by PayPal is US$341.74, 8.1% of value", () => {
    const paypal = MEMBERS.filter((m) => m.rail === "paypal");
    expect(paypal).toHaveLength(TOTALS.paypalCount);
    expect(paypal.reduce((sum, m) => sum + m.netCents, 0)).toBe(TOTALS.paypalCents);
    expect(TOTALS.paypalCents - 2665).toBe(TOTALS.finalPaypalCents);
    expect(((TOTALS.finalPaypalCents / TOTALS.netCents) * 100).toFixed(1)).toBe("8.1");
    expect(BATCH_ITEMS.map((i) => i.senderItemId)).toEqual(
      [...BATCH_ITEMS.map((i) => i.senderItemId)].sort(),
    );
  });

  it("the invoice and the pool add up", () => {
    expect(INVOICE.premiumCents + INVOICE.bonusCents + INVOICE.disbursementCents).toBe(INVOICE.totalCents);
    expect(INVOICE.premiumCents + INVOICE.bonusCents).toBe(TOTALS.grossCents);
    expect(TOTALS.paypalCents + TOTALS.cashCents).toBe(TOTALS.netCents);
    expect(TOTALS.netCents + TOTALS.ruledDeductionsCents - TOTALS.creditsCents).toBe(TOTALS.grossCents);
    expect(TOTALS.duplicateMovedCents + TOTALS.creditsCents).toBe(TOTALS.redirectedCents);
    expect(TOTALS.finalPaypalCents + TOTALS.finalCashCents).toBe(TOTALS.netCents);
  });

  it("hashes are computed, never typed", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(RATE_CARD_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(BATCH_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(SENDER_BATCH_ID).toBe(`2026A-${RATE_CARD_SHA256.slice(0, 8)}-r37`);
  });

  it("formats money, kilos and spoken amounts like format.* will", () => {
    expect(usd(433_350)).toBe("US$4,333.50");
    expect(usd(-109)).toBe("−US$1.09");
    expect(usdSpoken(6445)).toBe("sixty-four dollars and forty-five cents");
    expect(usdSpoken(36_839)).toBe("three hundred sixty-eight dollars and thirty-nine cents");
    expect(kg(97_806)).toBe("9,780.6 kg");
  });
});
