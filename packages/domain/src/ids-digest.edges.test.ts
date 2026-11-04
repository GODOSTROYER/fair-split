// Tests that kill mutation-testing survivors (handoff T3) in the identifiers PayPal echoes back (the
// Proof verifier parses them to anchor a run), in the bytes a ledger checkpoint signature covers, and in
// the quote's currency.
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { batchCanonical, checkpointBytes } from "./digest-input.js";
import { invoiceNumber, parseRunSlug, parseSenderItemId, senderBatchId, senderItemId } from "./ids.js";
import { jcs } from "./jcs.js";
import { quoteInvoice } from "./quote.js";

const SHA = "7f3a91c2".padEnd(64, "0");

describe("identifiers: exact edges", () => {
  it("parseRunSlug reads only a whole slug, with every digit of the run", () => {
    expect(parseRunSlug("2026A-r137")).toEqual({ seasonCode: "2026A", runSeq: 137 });
    expect(parseRunSlug("x2026A-r37")).toBeNull();
    expect(parseRunSlug("2026A-r37x")).toBeNull();
  });

  it("parseSenderItemId reads only a whole id, with every digit of the run and the re-route", () => {
    expect(parseSenderItemId("r137x12-M-031")).toEqual({ runSeq: 137, rerouteN: 12, memberNo: "M-031" });
    expect(parseSenderItemId("r37-M-031")).toEqual({ runSeq: 37, rerouteN: null, memberNo: "M-031" });
    for (const bad of ["xr37-M-031", "r37-M-0311", "r37xy-M-031", "r37x-M-031", "garbage"]) {
      expect(parseSenderItemId(bad)).toBeNull();
    }
  });

  it("invoice_number is at most 25 characters, exactly", () => {
    const slug = (n: number) => `2026A-r${"9".repeat(n)}`;
    expect(invoiceNumber(slug(15))).toHaveLength(25);
    expect(() => invoiceNumber(slug(16))).toThrow("invoice_number too long: FS-2026A-r9999999999999999");
  });

  it("sender_item_id is at most 63 characters, exactly", () => {
    const memberNo = "M".repeat(40);
    expect(senderItemId(123_456_789_012, memberNo, 12_345_678)).toHaveLength(63);
    expect(() => senderItemId(123_456_789_012, memberNo, 123_456_789)).toThrow("sender_item_id too long");
  });

  it("sender_batch_id is at most 256 characters, exactly", () => {
    const season = "S".repeat(256 - "-7f3a91c2-r1".length);
    expect(senderBatchId(season, SHA, 1)).toHaveLength(256);
    expect(() => senderBatchId(`${season}S`, SHA, 1)).toThrow("sender_batch_id too long");
  });
});

describe("checkpointBytes: what the ledger key signs", () => {
  const checkpoint = {
    v: 1 as const,
    keyId: "fs-ledger-k1",
    runId: "0199f6a0-0000-7000-8000-000000000037",
    seq: 42,
    entryHash: "a".repeat(64),
    at: "2026-11-05T02:10:00.000Z",
  };

  it("is the JCS of the purpose and exactly the six fields, and nothing else", () => {
    const text = new TextDecoder().decode(checkpointBytes(checkpoint as never));
    expect(text).toBe(jcs({ purpose: "fairsplit.ledger.checkpoint", ...checkpoint }));
    const withSignature = { ...checkpoint, signatureHex: "b".repeat(128) };
    expect(new TextDecoder().decode(checkpointBytes(withSignature as never))).toBe(text);
  });

  it.each(["v", "keyId", "runId", "seq", "entryHash", "at"] as const)("binds %s", (field) => {
    const base = new TextDecoder().decode(checkpointBytes(checkpoint as never));
    const changed = { ...checkpoint, [field]: typeof checkpoint[field] === "number" ? 2 : "other" };
    expect(new TextDecoder().decode(checkpointBytes(changed as never))).not.toBe(base);
  });
});

describe("batchCanonical and the quote: messages and currency", () => {
  it("names why a batch cannot be hashed", () => {
    const run = { runId: "r", senderBatchId: "s", rateCardSha256: SHA };
    expect(() => batchCanonical(run, [])).toThrow("a batch needs at least one item");
    expect(() =>
      batchCanonical(run, [
        { senderItemId: "r1-M-001", receiver: "a@x.test", amountCents: 0, currency: "USD" },
      ]),
    ).toThrow("item amounts must be positive cents");
  });

  it("the quote is in US dollars", () => {
    expect(quoteInvoice(testCard(), TEST_LOT).currency).toBe("USD");
  });
});
