// I1 for the one thing the agent writes into an invoice: its three item labels (S4.4 checkLabels,
// register §8 "Claude's recorded labels"). A label must name its own quote line, from a closed
// vocabulary, so it can neither spell an amount nor contact details nor tell the brand it is paying
// for something else. The oracles here are built by construction, never by calling the checker.
import type { PolicyCtx, QuoteItemKey, ToolCall } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import {
  canonicalInvoice,
  canonicalInvoiceCall,
  ITEM_LABEL_HEAD_WORDS,
  ITEM_LABEL_WORDS,
  itemLabelProblem,
} from "./invoice.js";
import { decide } from "./policy.js";
import { QUOTE_ITEM_NAMES, quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const EXPECTED: PolicyCtx["expected"] = {
  quote,
  invoiceNumber: invoiceNumber("2026A-r37"),
  reference: invoiceReference(card.sha256),
  memo: invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode),
  businessEmail: "coop-business@sandbox.example",
  payer: { email: "lantern-bay@sandbox.example", businessName: "Lantern Bay Chocolate Co." },
  brandAllowlist: ["lantern-bay@sandbox.example"],
  invoiceId: null,
  invoiceDate: null,
};
const CTX: PolicyCtx = {
  flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
  ppEnv: "sandbox",
  toolkitSandbox: true,
  runState: "QUOTED",
  invoiceExists: false,
  holds: [],
  budget: { spentMicros: 0, capMicros: 750_000, iteration: 0, maxIterations: 10 },
  expected: EXPECTED,
  today: "2026-10-29",
};
const KEYS: readonly QuoteItemKey[] = ["PREMIUM", "BONUS", "DISBURSEMENT"];
const S3_NAMES = [QUOTE_ITEM_NAMES.PREMIUM, QUOTE_ITEM_NAMES.BONUS, QUOTE_ITEM_NAMES.DISBURSEMENT];

/** The draft the agent would send with these names: code's canonical body with the names swapped in. */
function draftWith(names: readonly unknown[]): ToolCall {
  const body = structuredClone(canonicalInvoice(EXPECTED)) as unknown as {
    items: { name: unknown }[];
  };
  body.items.forEach((it, i) => {
    it.name = names[i];
  });
  return { name: "create_invoice", args: body };
}
const verdictOf = (names: readonly unknown[]) => {
  const d = decide(draftWith(names), CTX);
  return { verdict: d.verdict, iq: d.results.find((r) => r.policy === "invoiceEqualsQuote") };
};

/** Every label set from the reviews that the old digit-only check allowed. */
const REVIEW_BYPASSES: readonly [label: string, names: readonly string[]][] = [
  ["number words", ["Four thousand dollars due", "Plus one thousand later", "Total five thousand"]],
  ["Roman numerals", ["Premium MMDCCCLXXXVII", "Bonus MCCCLXXXVI", "Fees LX"]],
  [
    "letters that look like digits",
    ["Premium, total due lO,OOO", "Quality bonus SOO", "Disbursement costs ZO"],
  ],
  ["swapped lines", ["Disbursement costs", "Quality bonus", "Premium"]],
  ["another line's name", ["Premium", "Quality bonus", "Premium costs"]],
  ["other parties", ["Billed to Northwind Cocoa", "On behalf of Acme Trading", "Refund owed to Lantern Bay"]],
  ["a charge as a credit", ["Credit to buyer (deducted)", "Discount (less)", "Shipping"]],
  ["pay elsewhere", ["Pay by wire, not PayPal", "Already paid (do not pay)", "Void (sample only)"]],
  [
    "contact details in words",
    ["Pay evil at evil dot example", "See pay dot evil dot example", "Call five five five one two"],
  ],
  ["another rail", ["Zelle to treasurer at evil dot com", "Bonus", "Fees"]],
  ["trailing spaces", ["Premium", "Premium ", "Premium  "]],
  ["doubled spaces", ["Quality bonus", "Quality  bonus", "Quality   bonus"]],
  ["an amount in words", ["Premium for one thousand kilos", "Quality bonus", "Disbursement costs"]],
  ["a leading space", [" Premium", "Quality bonus", "Disbursement costs"]],
  ["a digit", ["Premium", "Quality bonus", "Disbursement costs 2"]],
];

describe("inv.i1.labels: each item label names its own quote line, in a closed vocabulary", () => {
  it("allows the S3 names and natural labels for each line", () => {
    for (const names of [
      S3_NAMES,
      ["Season premium", "Top grade quality bonus", "PayPal payout disbursement fees"],
      ["Fairtrade premium for members", "Quality bonus, fermented beans", "Disbursement costs (payouts)"],
      ["Members' premium (lot)", "Bonus, top grade", "Pay-out disbursement costs"],
      ["PREMIUM", "QUALITY BONUS", "DISBURSEMENT COSTS"],
    ]) {
      expect(itemLabelProblem(names), names.join(" | ")).toBeNull();
      expect(verdictOf(names).iq?.verdict, names.join(" | ")).toBe("ALLOW");
      expect(verdictOf(names).verdict).toBe("ALLOW");
    }
  });

  it("denies every label set the reviews showed passing, and the executor refuses to build it", () => {
    for (const [label, names] of REVIEW_BYPASSES) {
      const v = verdictOf(names);
      expect(v.verdict, label).toBe("DENY");
      expect(v.iq?.verdict, label).toBe("DENY");
      expect(v.iq?.reason, label).toMatch(/label/);
      expect(canonicalInvoiceCall("create_invoice", EXPECTED, names), label).toMatchObject({ ok: false });
      expect(() => canonicalInvoice(EXPECTED, names), label).toThrow(RangeError);
    }
  });

  it("a hostile label is denied on any line, next to two valid labels", () => {
    // "Bonus" alone is a fine label for the bonus line (and only there), so it is not in this list.
    const hostile = REVIEW_BYPASSES.flatMap(([, names]) => names).filter(
      (n) => !S3_NAMES.includes(n as (typeof S3_NAMES)[number]) && n !== "Bonus",
    );
    for (const bad of hostile) {
      for (let i = 0; i < 3; i++) {
        const names = S3_NAMES.map((n, k) => (k === i ? bad : n));
        expect(itemLabelProblem(names), `${i}: ${bad}`).toMatch(new RegExp(`^Item ${i + 1}'s label`));
        expect(verdictOf(names).verdict, `${i}: ${bad}`).toBe("DENY");
      }
    }
  });

  it("names why: the shape, its own line, another line, or a word outside the line's vocabulary", () => {
    expect(itemLabelProblem(["Premium", "Bonus"])).toMatch(/three/);
    expect(itemLabelProblem(["Premium 2026", "Quality bonus", "Disbursement costs"])).toBe(
      "Item 1's label must be 1-40 letters, single spaces and ,'()- with no digits",
    );
    expect(itemLabelProblem(["Premium", "Bonus", "x".repeat(41)])).toMatch(/^Item 3's label must be 1-40/);
    expect(itemLabelProblem(["Fairtrade", "Quality bonus", "Disbursement costs"])).toBe(
      'Item 1\'s label must name its own line ("premium")',
    );
    expect(itemLabelProblem(["Premium", "Quality bonus", "Premium costs"])).toBe(
      "Item 3's label names the premium line, not its own",
    );
    expect(itemLabelProblem(["Premium", "Bonus, one", "Disbursement costs"])).toBe(
      'Item 2\'s label may not use "one"',
    );
    expect(itemLabelProblem([42, "Quality bonus", "Disbursement costs"])).toMatch(/^Item 1's label must be/);
    // Labels are checked against the quote's own line order.
    expect(
      itemLabelProblem(
        ["Quality bonus", "Premium", "Disbursement costs"],
        ["BONUS", "PREMIUM", "DISBURSEMENT"],
      ),
    ).toBeNull();
    expect(itemLabelProblem(S3_NAMES, ["PREMIUM", "PREMIUM", "DISBURSEMENT"])).toMatch(
      /one premium, one bonus/,
    );
  });

  it("takes S4.4's keyed item_labels {premium, bonus, disbursement} and puts each on its own line", () => {
    const keyed = {
      premium: "Season premium",
      bonus: "Top grade quality bonus",
      disbursement: "Disbursement costs",
    };
    expect(canonicalInvoice(EXPECTED, keyed).items.map((i) => i.name)).toEqual([
      "Season premium",
      "Top grade quality bonus",
      "Disbursement costs",
    ]);
    const built = canonicalInvoiceCall("create_invoice", EXPECTED, keyed);
    expect(built).toMatchObject({ ok: true });
    if (built.ok) expect(decide({ name: "create_invoice", args: built.args }, CTX).verdict).toBe("ALLOW");
    // A swap under the keys, a missing key and an extra key are all refused.
    for (const bad of [
      { premium: "Disbursement costs", bonus: "Quality bonus", disbursement: "Premium" },
      { premium: "Premium", bonus: "Quality bonus" },
      { ...keyed, tip: "Bonus" },
    ]) {
      expect(canonicalInvoiceCall("create_invoice", EXPECTED, bad as typeof keyed)).toMatchObject({
        ok: false,
      });
    }
  });

  it("the vocabularies are closed, letters only, and keep every line's own word out of the others", () => {
    for (const key of KEYS) {
      const words = ITEM_LABEL_WORDS[key];
      for (const w of words) expect(w, `${key} ${w}`).toMatch(/^[a-z][a-z'-]*$/);
      for (const head of ITEM_LABEL_HEAD_WORDS[key]) expect(words).toContain(head);
      for (const other of KEYS.filter((k) => k !== key)) {
        for (const head of ITEM_LABEL_HEAD_WORDS[other])
          expect(words, `${key} has ${head}`).not.toContain(head);
      }
      // No number word, Roman numeral or single letter can be spelled from a vocabulary word.
      for (const w of words) {
        expect(NUMBER_WORDS, `${key} ${w}`).not.toContain(w);
        expect(/^[ivxlcdm]+$/.test(w), `${key} ${w}`).toBe(false);
        expect(w.length, `${key} ${w}`).toBeGreaterThan(1);
      }
    }
  });

  it("property: labels built from a line's word and known-good qualifiers pass; one hostile word anywhere fails", () => {
    // The oracle is the construction: GOOD labels are made from words a person picked for each line,
    // and a HOSTILE word (an amount, a contact, another party, another line, a payment instruction)
    // inserted anywhere must make the draft DENY. Nothing here calls itemLabelProblem.
    const GOOD: Record<QuoteItemKey, { head: string[]; qualifiers: string[] }> = {
      PREMIUM: {
        head: ["Premium", "premium", "PREMIUM"],
        qualifiers: ["Season", "Fairtrade", "Members'", "Cacao", "for the co-op", "on shipped kilos"],
      },
      BONUS: {
        head: ["Bonus", "bonus"],
        qualifiers: ["Quality", "Top grade", "Season", "for fermented beans"],
      },
      DISBURSEMENT: {
        head: ["Disbursement", "disbursement"],
        qualifiers: ["costs", "PayPal", "Payout", "fees", "handling", "transfer"],
      },
    };
    const HOSTILE = [
      ...NUMBER_WORDS.map((w) => w[0]?.toUpperCase() + w.slice(1)),
      "II",
      "IV",
      "XL",
      "lx",
      "MMXXVI",
      "lO",
      "OO",
      "SOO",
      "ZO",
      "Il",
      "l",
      "at",
      "dot",
      "com",
      "www",
      "http",
      "email",
      "call",
      "phone",
      "Zelle",
      "Venmo",
      "wire",
      "bank",
      "cash",
      "refund",
      "credit",
      "discount",
      "shipping",
      "tax",
      "paid",
      "void",
      "owed",
      "billed",
      "less",
      "not",
      "Acme",
      "Northwind",
      "Lantern",
      "Bay",
      "Evil",
      "Analyn",
      "treasurer",
    ];
    const label = (key: QuoteItemKey) =>
      fc
        .record({
          head: fc.constantFrom(...GOOD[key].head),
          before: fc.subarray(GOOD[key].qualifiers, { maxLength: 2 }),
          after: fc.subarray(GOOD[key].qualifiers, { maxLength: 1 }),
        })
        .map(({ head, before, after }) => [...before, head, ...after].join(" "))
        .filter((s) => s.length <= 40);
    const otherHeads = (key: QuoteItemKey) =>
      KEYS.filter((k) => k !== key).flatMap((k) => GOOD[k].head.slice(0, 1));
    fc.assert(
      fc.property(
        label("PREMIUM"),
        label("BONUS"),
        label("DISBURSEMENT"),
        fc.nat({ max: 2 }),
        fc.nat(),
        fc.nat(),
        (premium, bonus, disbursement, line, pick, at) => {
          const names = [premium, bonus, disbursement];
          expect(verdictOf(names).iq?.verdict).toBe("ALLOW");
          const hostile = [...HOSTILE, ...otherHeads(KEYS[line] as QuoteItemKey)];
          const word = hostile[pick % hostile.length] as string;
          const words = (names[line] as string).split(" ");
          words.splice(at % (words.length + 1), 0, word);
          const bad = names.map((n, k) => (k === line ? words.join(" ") : n));
          expect(verdictOf(bad).iq?.verdict, bad.join(" | ")).toBe("DENY");
        },
      ),
      { numRuns: 1500 },
    );
  }, 60_000);
});

/** English number words a label could spell an amount with (the oracle's own list). */
const NUMBER_WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
  "hundred",
  "hundreds",
  "thousand",
  "thousands",
  "million",
  "billion",
  "dozen",
  "half",
];
