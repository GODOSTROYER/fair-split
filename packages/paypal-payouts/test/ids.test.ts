import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  batchNote,
  centsToValue,
  PayoutIdError,
  payPalRequestId,
  rc8,
  readValueCents,
  SENDER_ITEM_ID_MAX,
  seasonIdCode,
  senderBatchId,
  senderItemId,
} from "../src/index.js";
import { RATE_CARD_SHA256 } from "./support/fixtures.js";

describe("register §8 payout identifiers", () => {
  const base = { seasonCode: "2026-A", rateCardSha256: RATE_CARD_SHA256, runSeq: 37 };

  it("builds sender_batch_id as {season}-{rc8}-r{runSeq}, and -x{n} for a re-route", () => {
    expect(seasonIdCode("2026-A")).toBe("2026A");
    expect(rc8(RATE_CARD_SHA256)).toBe(RATE_CARD_SHA256.slice(0, 8));
    expect(senderBatchId(base)).toBe(`2026A-${RATE_CARD_SHA256.slice(0, 8)}-r37`);
    expect(senderBatchId({ ...base, rerouteNo: 2 })).toBe(`2026A-${RATE_CARD_SHA256.slice(0, 8)}-r37-x2`);
  });

  it("builds sender_item_id as r{runSeq}-{memberNo}, and r{runSeq}x{n}-{memberNo} for a re-route", () => {
    expect(senderItemId({ runSeq: 37, memberNo: "M-014" })).toBe("r37-M-014");
    expect(senderItemId({ runSeq: 37, memberNo: "M-031", rerouteNo: 1 })).toBe("r37x1-M-031");
  });

  it("stays within PayPal's 63 characters for every environment offset (S3.4)", () => {
    for (const runSeq of [1, 100_000, 900_000 + 10 * 99_999]) {
      expect(senderItemId({ runSeq, memberNo: "M-014", rerouteNo: 9 }).length).toBeLessThanOrEqual(
        SENDER_ITEM_ID_MAX,
      );
    }
  });

  it("derives PayPal-Request-Id as sha256(sender_batch_id)", () => {
    const sbid = senderBatchId(base);
    expect(payPalRequestId(sbid)).toBe(createHash("sha256").update(sbid).digest("hex"));
    expect(payPalRequestId(sbid)).toMatch(/^[0-9a-f]{64}$/);
    expect(payPalRequestId(`${sbid}-x1`)).not.toBe(payPalRequestId(sbid));
  });

  it("writes the batch note with the digest's first 8 hex digits", () => {
    const digest = createHash("sha256").update("batch").digest("hex");
    expect(batchNote("2026-A", digest)).toBe(`Fair Split 2026-A, batch ${digest.slice(0, 8)}`);
  });

  it.each([
    ["a season without the dash", () => senderBatchId({ ...base, seasonCode: "2026A" })],
    ["a short rate-card hash", () => senderBatchId({ ...base, rateCardSha256: "7f3a91c2" })],
    ["an uppercase hash", () => senderBatchId({ ...base, rateCardSha256: RATE_CARD_SHA256.toUpperCase() })],
    ["runSeq 0", () => senderBatchId({ ...base, runSeq: 0 })],
    ["a fractional runSeq", () => senderItemId({ runSeq: 1.5, memberNo: "M-014" })],
    ["re-route 0", () => senderBatchId({ ...base, rerouteNo: 0 })],
    ["a member number with a space", () => senderItemId({ runSeq: 37, memberNo: "M 014" })],
    ["a note over a non-hash", () => batchNote("2026-A", "abc")],
  ])("rejects %s", (_label, run) => {
    expect(run).toThrow(PayoutIdError);
  });

  it("formats and reads PayPal amounts in cents", () => {
    expect(centsToValue(6_445n)).toBe("64.45");
    expect(centsToValue(3_440n)).toBe("34.40");
    expect(centsToValue(5n)).toBe("0.05");
    expect(() => centsToValue(0n)).toThrow(RangeError);
    expect(readValueCents("64.45")).toBe(6_445n);
    expect(readValueCents("64.5")).toBe(6_450n);
    expect(readValueCents("64")).toBe(6_400n);
    expect(readValueCents("-1.00")).toBeNull();
    expect(readValueCents(64.45)).toBeNull();
  });
});
