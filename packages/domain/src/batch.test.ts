import type { BatchItem } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  batchDigest,
  batchNote,
  digestMatches,
  invoiceMemo,
  invoiceNumber,
  invoiceReference,
  paypalRequestId,
  publishedFees,
  runSlug,
  senderBatchId,
  senderItemId,
} from "./batch.js";
import { sha256Hex } from "./canon.js";
import { batchCanonical } from "./digest-input.js";

const RC = `7f3a91c2${"0".repeat(56)}`;
const RUN = {
  runId: "019f0000-0000-7000-8000-000000000000",
  senderBatchId: "2026A-7f3a91c2-r37",
  rateCardSha256: RC,
};
const ITEMS: BatchItem[] = [
  {
    senderItemId: "r37-M-014",
    receiver: "m014@members.fairsplit.example",
    amountCents: 6_445,
    currency: "USD",
  },
  {
    senderItemId: "r37-M-002",
    receiver: "m002@members.fairsplit.example",
    amountCents: 3_027,
    currency: "USD",
  },
];

describe("identifiers (register §8 field table)", () => {
  it("builds runSlug, invoice number, reference and memo", () => {
    expect(runSlug("2026A", 37)).toBe("2026A-r37");
    expect(invoiceNumber("2026A-r37")).toBe("FS-2026A-r37");
    expect(() => invoiceNumber("2026A-r37-way-too-long-for-paypal")).toThrow(RangeError);
    expect(invoiceReference(RC)).toBe("rc:7f3a91c200000000");
    expect(invoiceMemo("2026-A", RC, "LB-PH-2026-03")).toBe("Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03");
  });

  it("builds sender_batch_id and sender_item_id, with re-route suffixes", () => {
    expect(senderBatchId("2026A", RC, 37)).toBe("2026A-7f3a91c2-r37");
    expect(senderBatchId("2026A", RC, 37, 1)).toBe("2026A-7f3a91c2-r37-x1");
    expect(senderItemId(37, "M-014")).toBe("r37-M-014");
    expect(senderItemId(37, "M-031", 1)).toBe("r37x1-M-031");
    expect(senderItemId(900_123, "M-064").length).toBeLessThanOrEqual(63);
    expect(paypalRequestId("2026A-7f3a91c2-r37")).toBe(sha256Hex("2026A-7f3a91c2-r37"));
  });

  it("states published fees only: 8 × US$0.25 = US$2.00; 2% of US$368.39 = US$7.37", () => {
    expect(publishedFees(8, 36_839)).toEqual({ sandboxCents: 200, productionCents: 737 });
  });
});

describe("batchDigest", () => {
  it("hashes JCS{runId, senderBatchId, rateCardSha256, items sorted by senderItemId}", () => {
    const d = batchDigest(RUN, ITEMS);
    expect(d.items.map((i) => i.senderItemId)).toEqual(["r37-M-002", "r37-M-014"]);
    expect(d.itemCount).toBe(2);
    expect(d.totalCents).toBe(9_472);
    expect(d.batchSha256).toBe(sha256Hex(d.jcs));
    expect(d.jcs.startsWith('{"items":[{"amountCents":3027,"currency":"USD","receiver"')).toBe(true);
    expect(batchNote("2026-A", d.batchSha256)).toBe(`Fair Split 2026-A, batch ${d.batchSha256.slice(0, 8)}`);
    expect(batchCanonical(RUN, ITEMS).jcs).toBe(d.jcs);
  });

  it("refuses empty batches, duplicate item IDs and non-positive amounts", () => {
    expect(() => batchDigest(RUN, [])).toThrow(RangeError);
    expect(() => batchDigest(RUN, [ITEMS[0] as BatchItem, ITEMS[0] as BatchItem])).toThrow(/duplicate/);
    expect(() => batchDigest(RUN, [{ ...(ITEMS[0] as BatchItem), amountCents: 0 }])).toThrow(RangeError);
  });

  it("inv.i4.digest-is-payout: order never matters, any change to an item changes the digest", () => {
    const arbItem = fc.record({
      senderItemId: fc.integer({ min: 1, max: 64 }).map((n) => `r37-M-${String(n).padStart(3, "0")}`),
      receiver: fc.constantFrom("a@x.example", "b@x.example", "c@x.example"),
      amountCents: fc.integer({ min: 1, max: 40_000 }),
      currency: fc.constant("USD" as const),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(arbItem, { minLength: 1, maxLength: 12, selector: (i) => i.senderItemId }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 500 }),
        (items, pick, delta) => {
          const base = batchDigest(RUN, items).batchSha256;
          expect(batchDigest(RUN, [...items].reverse()).batchSha256).toBe(base);
          expect(digestMatches(base, RUN, items)).toBe(true);
          const k = pick % items.length;
          const tampered = items.map((it, i) =>
            i === k ? { ...it, amountCents: it.amountCents + delta } : it,
          );
          expect(digestMatches(base, RUN, tampered)).toBe(false);
          const redirected = items.map((it, i) =>
            i === k ? { ...it, receiver: `${it.receiver}.evil` } : it,
          );
          expect(digestMatches(base, RUN, redirected)).toBe(false);
          expect(digestMatches(base, { ...RUN, senderBatchId: `${RUN.senderBatchId}-x1` }, items)).toBe(
            false,
          );
          if (items.length > 1) expect(digestMatches(base, RUN, items.slice(1))).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
