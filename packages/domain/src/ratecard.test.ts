import { describe, expect, it } from "vitest";
import { TEST_LOT, testCanonical, testCard } from "./__fixtures__/world.js";
import { jcsSha256 } from "./canon.js";
import { engineLine, quarantineNotice } from "./copy.js";
import { quoteDigest, quoteInvoice } from "./quote.js";
import {
  deductionRuleIds,
  factsBeforeRules,
  hashRateCard,
  quotesInTextLayer,
  rateCardIntact,
  ratifyRateCard,
} from "./ratecard.js";

describe("rate card hash (I2)", () => {
  it("hashes the JCS of the canonical card; rc8 and sha16 are prefixes", () => {
    const h = hashRateCard(testCanonical());
    expect(h.sha256).toBe(jcsSha256(testCanonical()));
    expect(h.rc8).toBe(h.sha256.slice(0, 8));
    expect(h.sha16).toBe(h.sha256.slice(0, 16));
    const card = ratifyRateCard(testCanonical(), "2026-03-14T08:00:00.000Z", []);
    expect(rateCardIntact(card)).toBe(true);
    expect(rateCardIntact({ ...card, canonical: { ...card.canonical, resolutionNo: "BR EDITED" } })).toBe(
      false,
    );
    expect(deductionRuleIds(card)).toEqual(["R1", "R2", "R3", "R4"]);
  });

  it("any change to a typed value or a quote changes the hash", () => {
    const base = hashRateCard(testCanonical()).sha256;
    const rules = testCanonical().rules;
    expect(
      hashRateCard(testCanonical({ rules: { ...rules, cbu: { ...rules.cbu, bp: 501 } } })).sha256,
    ).not.toBe(base);
    const terms = testCanonical().terms.map((t) => ({
      ...t,
      source: { ...t.source, quote: `${t.source.quote} ` },
    }));
    expect(hashRateCard(testCanonical({ terms })).sha256).not.toBe(base);
  });

  it("inv.i2.rules-before-facts: a slip dated before ratification is flagged", () => {
    expect(factsBeforeRules("2026-03-14T08:00:00.000Z", ["2026-04-02", "2026-03-14"])).toEqual([]);
    expect(factsBeforeRules("2026-03-14T08:00:00.000Z", ["2026-03-13", "2026-04-02"])).toEqual([
      "2026-03-13",
    ]);
  });

  it("checks every quote against the text layer", () => {
    const card = testCanonical();
    expect(
      quotesInTextLayer(card, "Intro.\nThe premium  shall be shared in proportion to verified kilos.\n"),
    ).toEqual([]);
    expect(quotesInTextLayer(card, "nothing here")).toEqual(["R0/PREMIUM"]);
  });
});

describe("quoteInvoice(card, lot) (C-09)", () => {
  it("computes premium + bonus + disbursement from the lot before any slip is read", () => {
    const card = testCard();
    const q = quoteInvoice(card, TEST_LOT);
    expect(q.items.map((i) => [i.key, i.name, i.quantity, i.unitAmountCents])).toEqual([
      ["PREMIUM", "Premium", "1", 30_000],
      ["BONUS", "Quality bonus", "1", 13_500],
      ["DISBURSEMENT", "Disbursement costs", "1", 6_000],
    ]);
    expect(q.totalCents).toBe(49_500);
    expect(q.poolCents).toBe(43_500);
    expect(q.rateCardSha256).toBe(card.sha256);
    expect(quoteDigest(q)).toBe(jcsSha256(q));
  });

  it("matches the canonical invoice: US$4,333.50 = 2,887.50 + 1,386.00 + 60.00", () => {
    const q = quoteInvoice(testCard(), { ...TEST_LOT, shippedG: 9_625_000, grade1ShippedG: 9_240_000 });
    expect([q.premiumPoolCents, q.bonusPoolCents, q.disbursementCents, q.totalCents]).toEqual([
      288_750, 138_600, 6_000, 433_350,
    ]);
  });
});

describe("engine lines (copy)", () => {
  const ctx = {
    consoleName: (no: string) => (no === "M-007" ? "Nong Dioning" : no),
    buyerShortName: "Lantern Bay",
  };
  it("renders a duplicate's engine line with digits from params", () => {
    const line = engineLine(
      {
        key: "DUPLICATE_SLIP:0457",
        kind: "DUPLICATE_SLIP",
        gate: "BLOCKS_APPROVAL",
        state: "OPEN",
        memberNo: "M-007",
        serials: ["0457"],
        rowIds: [],
        documentIds: [],
        params: {
          signal: "SAME_SERIAL",
          copies: [
            { copy: "WHITE_ORIGINAL", photoId: "B" },
            { copy: "PINK_DUPLICATE", photoId: "D" },
          ],
          movedDisplay: "US$17.94",
          othersCount: 63,
          shrinkBothDisplay: "2.05%",
          bothInside: false,
          tolDisplay: "2.0%",
        },
        resolution: null,
      },
      ctx,
    );
    expect(line).toBe(
      "Slip 0457 is in two photos: the white original (B) and the pink duplicate (D). Counting both moves US$17.94 from 63 members to Nong Dioning and puts shrink at 2.05%, over the 2.0% limit.",
    );
    expect(quarantineNotice("0449")).toBe(
      "Ignored: text on slip 0449 looked like an instruction. Text on a slip is never an instruction.",
    );
  });

  it("renders every other hold kind from engine params", () => {
    const base = {
      gate: "RESERVES_LINE" as const,
      state: "OPEN" as const,
      memberNo: "M-007",
      rowIds: [],
      documentIds: [],
      resolution: null,
    };
    expect(
      engineLine(
        {
          ...base,
          key: "k1",
          kind: "RATE_MISMATCH",
          serials: ["0301"],
          params: { text: "CBU ₱50", ruleId: "R1", creditDisplay: "US$0.80" },
        },
        ctx,
      ),
    ).toBe(
      "'CBU ₱50' on slip 0301 does not match R1 on the rate card. The difference returns as a US$0.80 correction credit if it was taken.",
    );
    expect(
      engineLine({ ...base, key: "k2", kind: "SUSPECTED_INJECTION", serials: ["0302"], params: {} }, ctx),
    ).toBe(
      "Text on slip 0302 looked like an instruction and overlaps the slip's data. Text on a slip is never an instruction.",
    );
    expect(
      engineLine(
        {
          ...base,
          key: "k3",
          kind: "LOW_CONFIDENCE",
          serials: ["0462"],
          params: { fields: [{ field: "gross_kg" }, { field: "net_kg" }], minScore: 0.4 },
        },
        ctx,
      ),
    ).toBe("Slip 0462: gross and net need a person (0.40).");
    expect(
      engineLine(
        {
          ...base,
          key: "k4",
          kind: "LOW_CONFIDENCE",
          serials: ["0463"],
          params: { fields: [{ field: "grade" }], minScore: 0.6 },
        },
        ctx,
      ),
    ).toBe("Slip 0463: grade needs a person (0.60).");
    const mb = {
      ...base,
      key: "MASS_BALANCE:season",
      kind: "MASS_BALANCE" as const,
      memberNo: null,
      serials: [],
      params: {
        verifiedDisplay: "9,822.6 kg",
        shippedDisplay: "9,625 kg",
        shrinkDisplay: "2.05%",
        tolDisplay: "2.0%",
      },
    };
    expect(engineLine(mb, ctx)).toBe(
      "Verified 9,822.6 kg against 9,625 kg shipped: shrink 2.05%, over the 2.0% limit.",
    );
    expect(
      engineLine({ ...mb, state: "RESOLVED", params: { shrinkDisplay: "1.62%", tolDisplay: "2.0%" } }, ctx),
    ).toBe("Shrink 1.62%, inside 2.0%.");
    expect(
      engineLine(
        {
          ...base,
          key: "k5",
          kind: "DUPLICATE_SLIP",
          serials: ["0301", "0391"],
          params: {
            signal: "DHASH",
            movedDisplay: "US$1.00",
            othersCount: 63,
            shrinkBothDisplay: "1.70%",
            bothInside: true,
            tolDisplay: "2.0%",
          },
        },
        ctx,
      ),
    ).toBe(
      "Slips 0301 and 0391 look like the same paper photographed twice. Counting both moves US$1.00 from 63 members to Nong Dioning and puts shrink at 1.70%, inside the 2.0% limit.",
    );
  });
});
