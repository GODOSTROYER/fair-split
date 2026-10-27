import {
  AGENT_TOOL_NAMES,
  POLICY_NAMES,
  type PolicyCtx,
  type PolicyName,
  type ToolCall,
} from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { TEST_LOT, testCard } from "./__fixtures__/world.js";
import { invoiceMemo, invoiceNumber, invoiceReference } from "./batch.js";
import {
  AUTO_CANCEL_AFTER_DAYS,
  autoCancelDate,
  autoCancelRuleArgs,
  canonicalInvoice,
  canonicalInvoiceCall,
  canonicalSend,
  itemLabelProblem,
  parseStrictIsoDate,
} from "./invoice.js";
import { minorToDecimal } from "./money.js";
import { decide, decideWith, POLICIES, readInvoiceFields } from "./policy.js";
import { quoteInvoice } from "./quote.js";

const card = testCard();
const quote = quoteInvoice(card, TEST_LOT);
const BUSINESS = "coop-business@sandbox.example";
const PAYER = "lantern-bay@sandbox.example";
const PAYER_NAME = "Lantern Bay Chocolate Co.";
const INVOICE_ID = "INV2-AB12-CD34-EF56-GH78";
const INVOICE_DATE = "2026-10-29";
const MEMO = invoiceMemo("2026-A", card.sha256, TEST_LOT.lotCode);

type Expected = PolicyCtx["expected"];
const EXPECTED: Expected = {
  quote,
  invoiceNumber: invoiceNumber("2026A-r37"),
  reference: invoiceReference(card.sha256),
  memo: MEMO,
  businessEmail: BUSINESS,
  payer: { email: PAYER, businessName: PAYER_NAME },
  brandAllowlist: [PAYER],
  invoiceId: null,
  invoiceDate: null,
};

function ctx(over: Partial<PolicyCtx> = {}, expected: Partial<Expected> = {}): PolicyCtx {
  return {
    flags: { killPayouts: false, killPaypalLive: false, killAiLive: false },
    ppEnv: "sandbox",
    toolkitSandbox: true,
    runState: "QUOTED",
    invoiceExists: false,
    holds: [],
    budget: { spentMicros: 100_000, capMicros: 750_000, iteration: 2, maxIterations: 10 },
    expected: { ...EXPECTED, ...expected },
    today: "2026-10-29",
    ...over,
  };
}

/** The context once PayPal has created the invoice and dated it (read back with a GET). */
const ruleCtx = (expected: Partial<Expected> = {}, over: Partial<PolicyCtx> = {}) =>
  ctx({ invoiceExists: true, ...over }, { invoiceId: INVOICE_ID, invoiceDate: INVOICE_DATE, ...expected });

/** S3.6.3's create arguments in toolkit 1.11.0's create_invoice shape, written out by hand. */
const CANONICAL = {
  currency_code: "USD",
  invoice_number: "FS-2026A-r37",
  reference: invoiceReference(card.sha256),
  note: MEMO,
  invoicer_email_address: BUSINESS,
  primary_recipients: [{ billing_info: { business_name: PAYER_NAME, email_address: PAYER } }],
  items: quote.items.map((i) => ({
    name: i.name,
    quantity: "1",
    unit_amount: { currency_code: "USD", value: minorToDecimal(i.unitAmountCents) },
    unit_of_measure: "AMOUNT",
  })),
};

type Draft = Record<string, unknown> & {
  primary_recipients: Record<string, unknown>[];
  items: (Record<string, unknown> & { unit_amount: Record<string, unknown> })[];
};
const draft = (over: Record<string, unknown> = {}): Draft =>
  ({ ...structuredClone(CANONICAL), ...over }) as Draft;

const RULE = (date: string, invoiceId = INVOICE_ID) => ({
  invoice_id: invoiceId,
  rules: [
    {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date },
    },
  ],
});

const call = (name: string, args: unknown = {}): ToolCall => ({ name, args });
const reasonOf = (d: ReturnType<typeof decide>, p: PolicyName) =>
  d.results.find((r) => r.policy === p)?.reason;

/** Each quote line's own word, written out here, independently of the checker's vocabulary. */
const LINE_WORD = [/\bpremiums?\b/, /\bbonus(?:es)?\b/, /\bdisbursements?\b/] as const;
const NUMBERISH =
  /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand|million|[ivxlcdm]{2,}|[olisz]+)\b/;
const CONTACT_OR_CHARGE =
  /\b(?:at|dot|com|www|https?|e?mail|call|wire|zelle|venmo|refund|credit|discount|shipping|tax|paid)\b/;

/** What any allowed label must be, whatever the checker says: a safe name for line `i`, nothing else. */
function expectSafeLabel(name: string, i: number) {
  const folded = name.replace(/[A-Z]/g, (c) => c.toLowerCase());
  expect(name.length, name).toBeLessThanOrEqual(40);
  expect(name, name).toMatch(/^[A-Za-z][A-Za-z ,'()-]*$/);
  expect(name.trim(), name).toBe(name);
  expect(name, name).not.toMatch(/ {2}/);
  expect(folded, name).toMatch(LINE_WORD[i] as RegExp);
  for (const [k, re] of LINE_WORD.entries()) if (k !== i) expect(folded, name).not.toMatch(re);
  expect(folded, name).not.toMatch(NUMBERISH);
  expect(folded, name).not.toMatch(CONTACT_OR_CHARGE);
}

/** Label-like strings: words from a small pool, including ones the vocabulary refuses. */
const labelLike = fc
  .array(
    fc.constantFrom(
      "Premium",
      "premium",
      "Bonus",
      "Quality",
      "Disbursement",
      "costs",
      "Season",
      "one",
      "at",
      "dot",
      "LX",
      "lO",
      "Refund",
      "Acme",
      "fees",
      "PayPal",
      "(lot)",
      "members'",
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((ws) => ws.join(" "));

describe("the canonical invoice (I1: code builds every field PayPal sees)", () => {
  it("canonicalInvoice builds exactly S3.6.3's create arguments: no dates, no payment term, nothing extra", () => {
    expect(canonicalInvoice(EXPECTED)).toEqual(CANONICAL);
    expect(Object.keys(canonicalInvoice(EXPECTED)).sort()).toEqual(
      [
        "currency_code",
        "invoice_number",
        "invoicer_email_address",
        "items",
        "note",
        "primary_recipients",
        "reference",
      ].sort(),
    );
    expect(JSON.stringify(canonicalInvoice(EXPECTED))).not.toMatch(/date|payment_term/);
    const labelled = canonicalInvoice(EXPECTED, [
      "Season premium",
      "Top grade quality bonus",
      "PayPal payout disbursement fees",
    ]);
    expect(labelled.items.map((i) => i.name)).toEqual([
      "Season premium",
      "Top grade quality bonus",
      "PayPal payout disbursement fees",
    ]);
    expect(labelled.items.map((i) => i.unit_amount)).toEqual(CANONICAL.items.map((i) => i.unit_amount));
    expect(() => canonicalInvoice(EXPECTED, ["Premium 2026", "Bonus", "Fees"])).toThrow(RangeError);
  });

  it("item labels are at most 40 letters, single spaces and ,'()- with no digits, each naming its own line", () => {
    expect(itemLabelProblem(["Premium", "Quality bonus", "Disbursement costs"])).toBeNull();
    expect(
      itemLabelProblem(["Members' premium (lot)", "Bonus, top grade", "Pay-out disbursement costs"]),
    ).toBeNull();
    for (const bad of [
      "Premium 2026",
      "Premium US$4",
      "Premium @ coop",
      "http premium.example",
      "Premium: one",
      "Premium. Pay",
      "",
      " Premium",
      "x".repeat(41),
      "Prémium",
      "Premium / bonus",
      "Premium  costs",
      "Premium ",
    ]) {
      // The other two labels are valid, so the refusal is item 1's own.
      expect(itemLabelProblem([bad, "Quality bonus", "Disbursement costs"]), bad).toMatch(/^Item 1's label/);
    }
    // Labels are distinct by construction: each must name its own line and no other.
    expect(itemLabelProblem(["Premium", "premium", "Disbursement costs"])).toBe(
      "Item 2's label names the premium line, not its own",
    );
    expect(itemLabelProblem(["Premium", "Bonus"])).toMatch(/three/);
  });

  it("the AUTO_CANCEL rule is SPECIFIC_DATE at invoice date + 25 days (C-27)", () => {
    expect(AUTO_CANCEL_AFTER_DAYS).toBe(25);
    expect(autoCancelDate("2026-10-29")).toBe("2026-11-23");
    expect(autoCancelDate("2026-12-20")).toBe("2027-01-14");
    expect(autoCancelRuleArgs(INVOICE_ID, "2026-11-23")).toEqual(RULE("2026-11-23"));
    expect(() => autoCancelDate("2026-02-30")).toThrow(RangeError);
  });

  it("dates parse strictly: YYYY-MM-DD and a real calendar day, nothing else", () => {
    expect(parseStrictIsoDate("2026-11-23")).toBe("2026-11-23");
    expect(parseStrictIsoDate("2028-02-29")).toBe("2028-02-29");
    for (const bad of [
      "2026-02-29",
      "2026-11-31",
      "2026-13-01",
      "2026-11-23T00:00:00Z",
      "2026-11-23 ",
      "23/11/2026",
      "2026-1-23",
      "",
      20261123,
      null,
    ]) {
      expect(parseStrictIsoDate(bad), String(bad)).toBeNull();
    }
  });
});

describe("inv.i1.whole-body: invoiceEqualsQuote compares the whole body with the canonical form", () => {
  it("allows the canonical draft, and the canonical draft with the agent's own valid labels", () => {
    expect(decide(call("create_invoice", draft()), ctx())).toMatchObject({
      verdict: "ALLOW",
      rank: 0,
      decidedBy: [],
    });
    const labelled = draft();
    labelled.items.forEach((it, i) => {
      it.name = ["Season premium", "Top grade quality bonus", "Disbursement and handling"][i];
    });
    expect(decide(call("create_invoice", labelled), ctx()).verdict).toBe("ALLOW");
  });

  it("DENY when an item amount differs from the quote (the on-camera beat)", () => {
    const bad = draft();
    (bad.items[1] as Draft["items"][number]).unit_amount.value = "1386.01";
    const d = decide(call("create_invoice", bad), ctx());
    expect(d.verdict).toBe("DENY");
    expect(d.decidedBy).toEqual(["invoiceEqualsQuote"]);
    expect(reasonOf(d, "invoiceEqualsQuote")).toBe(
      "items[1].unit_amount.value differs from the code's invoice",
    );
  });

  it("names every key the canonical body does not carry (tax, discount, shipping, tip, partial payment, …)", () => {
    const withItem = (i: number, extra: Record<string, unknown>) => {
      const d = draft();
      Object.assign(d.items[i] as object, extra);
      return d;
    };
    const cases: [string, unknown, string[]][] = [
      ["item tax", withItem(1, { tax: { name: "VAT", percent: "12" } }), ["items[1].tax"]],
      ["item discount", withItem(0, { discount: { percent: "10" } }), ["items[0].discount"]],
      [
        "item description",
        withItem(0, { description: "Premium for one thousand kilos" }),
        ["items[0].description"],
      ],
      ["item date", withItem(2, { item_date: "2026-10-29" }), ["items[2].item_date"]],
      ["shipping", draft({ shipping_cost: "10.00" }), ["shipping_cost"]],
      ["tip, even switched off", draft({ allow_tip: false }), ["allow_tip"]],
      ["tip", draft({ allow_tip: true }), ["allow_tip"]],
      [
        "partial payment",
        draft({ allow_partial_payment: true, minimum_partial_payment_amount: "1.00" }),
        ["allow_partial_payment", "minimum_partial_payment_amount"],
      ],
      ["pay by bank", draft({ enable_pay_by_bank: true }), ["enable_pay_by_bank"]],
      ["theme", draft({ theme_color: "#000000" }), ["theme_color"]],
      ["custom amount", draft({ amount: { breakdown: { custom: { label: "Fee" } } } }), ["amount"]],
      ["configuration", draft({ configuration: { allow_tip: true } }), ["configuration"]],
      ["extra recipients", draft({ additional_recipients: ["x@evil.example"] }), ["additional_recipients"]],
      ["invoicer tax id", draft({ invoicer_tax_id: "123" }), ["invoicer_tax_id"]],
      ["template", draft({ template_id: "TEMP-1" }), ["template_id"]],
      ["unknown item field", withItem(0, { surcharge: "1.00" }), ["items[0].surcharge"]],
    ];
    for (const [label, args, keys] of cases) {
      const d = decide(call("create_invoice", args), ctx());
      expect(d.verdict, label).toBe("DENY");
      expect(d.decidedBy, label).toContain("invoiceEqualsQuote");
      expect(reasonOf(d, "invoiceEqualsQuote"), label).toBe(
        `Not in the canonical invoice: ${keys.join(", ")}`,
      );
    }
    // Several at once are all named, so the verdict says exactly what the draft tried.
    const offsetting = withItem(0, { discount: { amount: { currency_code: "USD", value: "50.00" } } });
    offsetting.shipping_cost = "50.00";
    offsetting.allow_tip = true;
    expect(reasonOf(decide(call("create_invoice", offsetting), ctx()), "invoiceEqualsQuote")).toBe(
      "Not in the canonical invoice: allow_tip, items[0].discount, shipping_cost",
    );
  });

  it("refuses a changed number, currency, quantity, item count, extra recipient, note or label", () => {
    const cases: [string, Draft, RegExp][] = [
      ["invoice number", draft({ invoice_number: "FS-2026A-r38" }), /invoice_number/],
      ["currency", draft({ currency_code: "PHP" }), /currency_code/],
      ["reference", draft({ reference: "rc:0000000000000000" }), /reference/],
      ["note with a closing", draft({ note: `${MEMO}. Thank you.` }), /note/],
      ["note with an amount", draft({ note: `${MEMO}, total 4333.50` }), /note/],
      ["invoicer", draft({ invoicer_email_address: "x@evil.example" }), /invoicer_email_address/],
    ];
    const q = draft();
    (q.items[0] as Draft["items"][number]).quantity = "1.5";
    cases.push(["fractional quantity", q, /items\[0\]\.quantity/]);
    const unit = draft();
    (unit.items[0] as Draft["items"][number]).unit_of_measure = "HOURS";
    cases.push(["unit of measure", unit, /items\[0\]\.unit_of_measure/]);
    const cur = draft();
    delete (cur.items[2] as Draft["items"][number]).unit_amount.currency_code;
    cases.push(["missing item currency", cur, /items\[2\]\.unit_amount\.currency_code/]);
    const dropped = draft();
    dropped.items.splice(1, 1);
    cases.push(["dropped item", dropped, /items/]);
    const added = draft();
    added.items.push(structuredClone(added.items[0] as Draft["items"][number]));
    cases.push(["extra item", added, /items/]);
    const two = draft();
    two.primary_recipients.push({ billing_info: { email_address: PAYER } });
    cases.push(["second recipient", two, /primary_recipients/]);
    const digitLabel = draft();
    (digitLabel.items[0] as Draft["items"][number]).name = "Premium for 9625 kg";
    cases.push(["label with digits", digitLabel, /label/]);
    const dupLabel = draft();
    (dupLabel.items[1] as Draft["items"][number]).name = "Premium";
    cases.push(["duplicate label", dupLabel, /label/]);
    for (const [label, args, reason] of cases) {
      const d = decide(call("create_invoice", args), ctx());
      expect(d.verdict, label).toBe("DENY");
      expect(d.decidedBy, label).toContain("invoiceEqualsQuote");
      expect(reasonOf(d, "invoiceEqualsQuote"), label).toMatch(reason);
    }
    for (const notAnInvoice of [null, "invoice", [CANONICAL], 42]) {
      expect(decide(call("create_invoice", notAnInvoice), ctx()).decidedBy).toContain("invoiceEqualsQuote");
    }
  });

  it("compares exactly, with no normalisation: another amount spelling or e-mail case is denied", () => {
    const d = draft({ invoicer_email_address: BUSINESS.toUpperCase() });
    (d.items[1] as Draft["items"][number]).unit_amount.value = minorToDecimal(
      quote.items[1]?.unitAmountCents ?? 0,
    ).replace(/0$/, "");
    (d.primary_recipients[0] as { billing_info: { email_address: string } }).billing_info.email_address =
      PAYER.toUpperCase();
    const v = decide(call("create_invoice", d), ctx());
    expect(v.verdict).toBe("DENY");
    expect(v.decidedBy).toEqual(["invoiceEqualsQuote"]);
    expect(reasonOf(v, "invoiceEqualsQuote")).toBe(
      "invoicer_email_address, items[1].unit_amount.value, primary_recipients[0].billing_info.email_address differ from the code's invoice",
    );
  });

  it("inv.i1.no-model-numbers: property, a draft that moves money is denied; a relabel passes only if the label is valid", () => {
    const edit = fc.oneof(
      fc.record({
        kind: fc.constant("amount"),
        item: fc.integer({ min: 0, max: 2 }),
        delta: fc.integer({ min: -500_000, max: 500_000 }).filter((x) => x !== 0),
      }),
      fc.record({
        kind: fc.constant("itemKey"),
        item: fc.integer({ min: 0, max: 2 }),
        key: fc.constantFrom("tax", "discount", "description", "item_date"),
      }),
      fc.record({
        kind: fc.constant("topKey"),
        key: fc.constantFrom(
          "shipping_cost",
          "allow_tip",
          "allow_partial_payment",
          "minimum_partial_payment_amount",
          "enable_pay_by_bank",
          "amount",
          "configuration",
          "invoice_date",
          "additional_recipients",
        ),
      }),
      fc.record({ kind: fc.constant("drop"), item: fc.integer({ min: 0, max: 2 }) }),
      fc.record({
        kind: fc.constant("quantity"),
        item: fc.integer({ min: 0, max: 2 }),
        q: fc.constantFrom("2", "0", "1.5", "-1"),
      }),
    );
    fc.assert(
      fc.property(edit, (e) => {
        const d = draft();
        const item = "item" in e ? (d.items[e.item] as Draft["items"][number]) : undefined;
        if (e.kind === "amount" && item) {
          const cents = (quote.items[e.item]?.unitAmountCents ?? 0) + e.delta;
          fc.pre(cents >= 0);
          item.unit_amount = { currency_code: "USD", value: minorToDecimal(cents) };
        } else if (e.kind === "itemKey" && item) item[e.key] = { percent: "1" };
        else if (e.kind === "topKey") d[e.key] = "1.00";
        else if (e.kind === "drop") d.items.splice(e.item, 1);
        else if (e.kind === "quantity" && item) item.quantity = e.q;
        const verdict = decide(call("create_invoice", d), ctx());
        expect(verdict.verdict).toBe("DENY");
        expect(verdict.decidedBy).toContain("invoiceEqualsQuote");
      }),
      { numRuns: 300 },
    );
    let allowed = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.oneof(fc.string({ maxLength: 45 }), labelLike),
        (i, name) => {
          const d = draft();
          (d.items[i] as Draft["items"][number]).name = name;
          const r = decide(call("create_invoice", d), ctx());
          // Independent of the checker: an allowed label is a safe name for its own line.
          if (r.results.find((x) => x.policy === "invoiceEqualsQuote")?.verdict === "ALLOW") {
            allowed++;
            expectSafeLabel(name, i);
          }
        },
      ),
      { numRuns: 600 },
    );
    // Not vacuous: label-like strings do reach ALLOW.
    expect(allowed).toBeGreaterThan(0);
  });
});

// A run whose e-mails carry every letter a homoglyph attack folds into (k, i, a, e, o) and whose
// first line is US$300.00, so each lookalike below differs from code's bytes by one character.
const EXACT_BUSINESS = "kalinaw-treasurer@kakao-coop.example";
const EXACT_PAYER = "buyer@kalinaw-kakao.example";
const EXACT_EXPECTED: Expected = {
  ...EXPECTED,
  quote: {
    ...quote,
    items: quote.items.map((it, i) => (i === 0 ? { ...it, unitAmountCents: 30_000 } : it)),
  },
  businessEmail: EXACT_BUSINESS,
  payer: { email: EXACT_PAYER, businessName: PAYER_NAME },
  brandAllowlist: [EXACT_PAYER],
};
const exactCtx = (expected: Partial<Expected> = {}) => ctx({}, { ...EXACT_EXPECTED, ...expected });
const exactDraft = (): Draft => structuredClone(canonicalInvoice(EXACT_EXPECTED)) as unknown as Draft;
const recipientOf = (d: Draft) =>
  (d.primary_recipients[0] as { billing_info: { email_address: string } }).billing_info;

/** One-character lookalikes: each looks like (or case-folds into) the ASCII letter it replaces. */
const LOOKALIKES: readonly [label: string, swap: (s: string) => string][] = [
  ["U+212A KELVIN SIGN for k", (s) => s.replace("k", "K")],
  ["U+0130 LATIN CAPITAL I WITH DOT ABOVE for i", (s) => s.replace("i", "İ")],
  ["U+FF20 FULLWIDTH COMMERCIAL AT for @", (s) => s.replace("@", "＠")],
  ["U+0430 CYRILLIC SMALL A for a", (s) => s.replace("a", "а")],
  ["U+0435 CYRILLIC SMALL IE for e", (s) => s.replace("e", "е")],
  ["U+043E CYRILLIC SMALL O for o", (s) => s.replace("o", "о")],
];

describe("inv.i1.exact: invoiceEqualsQuote allows only the exact bytes code built", () => {
  it("allows the exact canonical body, and its JSON round trip (regression)", () => {
    for (const [body, c] of [
      [canonicalInvoice(EXPECTED), ctx()],
      [canonicalInvoice(EXACT_EXPECTED), exactCtx()],
      [JSON.parse(JSON.stringify(canonicalInvoice(EXACT_EXPECTED))), exactCtx()],
    ] as const) {
      expect(decide(call("create_invoice", body), c)).toMatchObject({ verdict: "ALLOW", decidedBy: [] });
    }
  });

  it("String.prototype.toLowerCase folds U+212A into ASCII k: the hole an e-mail check must not use", () => {
    expect("K".toLowerCase()).toBe("k");
    expect(EXACT_BUSINESS.replace("k", "K").toLowerCase()).toBe(EXACT_BUSINESS);
    expect(EXACT_PAYER.replace("k", "K").toLowerCase()).toBe(EXACT_PAYER);
  });

  it("an invoicer e-mail with a lookalike character is denied, naming the field", () => {
    for (const [label, swap] of LOOKALIKES) {
      const d = exactDraft();
      d.invoicer_email_address = swap(EXACT_BUSINESS);
      expect(d.invoicer_email_address, label).not.toBe(EXACT_BUSINESS);
      const v = decide(call("create_invoice", d), exactCtx());
      expect(v.verdict, label).toBe("DENY");
      expect(reasonOf(v, "invoiceEqualsQuote"), label).toBe(
        "invoicer_email_address differs from the code's invoice",
      );
      expect(reasonOf(v, "invoicerIsBusinessEmail"), label).toBe(
        "invoicer_email_address is not a plain ASCII e-mail address",
      );
    }
  });

  it("a recipient e-mail with a lookalike character is denied, naming the field", () => {
    const at = "primary_recipients[0].billing_info.email_address";
    for (const [label, swap] of LOOKALIKES) {
      const d = exactDraft();
      recipientOf(d).email_address = swap(EXACT_PAYER);
      const v = decide(call("create_invoice", d), exactCtx());
      expect(v.verdict, label).toBe("DENY");
      expect(reasonOf(v, "invoiceEqualsQuote"), label).toBe(`${at} differs from the code's invoice`);
      expect(reasonOf(v, "recipientInBrandAllowlist"), label).toBe(
        `${at} is not a plain ASCII e-mail address`,
      );
    }
  });

  it("a CC e-mail, lookalike or not, is denied by name", () => {
    for (const [label, swap] of LOOKALIKES) {
      const d = exactDraft();
      d.cc = [swap(EXACT_PAYER)];
      const v = decide(call("create_invoice", d), exactCtx());
      expect(v.verdict, label).toBe("DENY");
      expect(reasonOf(v, "invoiceEqualsQuote"), label).toBe("Not in the canonical invoice: cc");
      expect(reasonOf(v, "recipientInBrandAllowlist"), label).toBe(
        "Not a recipient field the draft may set: cc",
      );
    }
  });

  it("an allowlist entry that is not plain ASCII matches nothing", () => {
    const v = decide(
      call("create_invoice", exactDraft()),
      exactCtx({ brandAllowlist: [EXACT_PAYER.replace("k", "K")] }),
    );
    expect(reasonOf(v, "recipientInBrandAllowlist")).toBe("A recipient is not on the brand allowlist");
    const business = decide(
      call("create_invoice", exactDraft()),
      exactCtx({ businessEmail: EXACT_BUSINESS.replace("k", "K") }),
    );
    expect(business.verdict).toBe("DENY");
    expect(business.decidedBy).toContain("invoicerIsBusinessEmail");
  });

  it("an amount is the canonical two-decimal string exactly: no trim, no zero padding, no other digits", () => {
    expect(exactDraft().items[0]?.unit_amount.value).toBe("300.00");
    const spellings: unknown[] = [
      " 0300.0\n",
      "300.0",
      "0300.00",
      "300.00 ",
      " 300.00",
      "300.00\n",
      "３００.00",
      "300.000",
      "+300.00",
      "3e2",
      "300",
      "300.00​",
      "300,00",
      300,
      30_000,
    ];
    for (const value of spellings) {
      const d = exactDraft();
      (d.items[0] as Draft["items"][number]).unit_amount.value = value;
      const v = decide(call("create_invoice", d), exactCtx());
      expect(v.verdict, JSON.stringify(value)).toBe("DENY");
      expect(v.decidedBy, JSON.stringify(value)).toEqual(["invoiceEqualsQuote"]);
      expect(reasonOf(v, "invoiceEqualsQuote"), JSON.stringify(value)).toBe(
        "items[0].unit_amount.value differs from the code's invoice",
      );
    }
  });

  it("an ASCII-case variant of code's e-mail is denied by invoiceEqualsQuote; the allowlists fold ASCII case only", () => {
    const invoicer = exactDraft();
    invoicer.invoicer_email_address = "Kalinaw-Treasurer@kakao-coop.example";
    const vi = decide(call("create_invoice", invoicer), exactCtx());
    expect(vi.verdict).toBe("DENY");
    expect(vi.decidedBy).toEqual(["invoiceEqualsQuote"]);
    expect(reasonOf(vi, "invoicerIsBusinessEmail")).toBeNull();

    const recipient = exactDraft();
    recipientOf(recipient).email_address = "Buyer@Kalinaw-Kakao.EXAMPLE";
    const vr = decide(call("create_invoice", recipient), exactCtx());
    expect(vr.verdict).toBe("DENY");
    expect(vr.decidedBy).toEqual(["invoiceEqualsQuote"]);
    expect(reasonOf(vr, "invoiceEqualsQuote")).toBe(
      "primary_recipients[0].billing_info.email_address differs from the code's invoice",
    );
    expect(reasonOf(vr, "recipientInBrandAllowlist")).toBeNull();

    // The allowlist side folds too, ASCII only.
    const upperList = exactCtx({ brandAllowlist: [EXACT_PAYER.toUpperCase()] });
    expect(POLICIES.recipientInBrandAllowlist(call("create_invoice", exactDraft()), upperList).verdict).toBe(
      0,
    );
  });

  it("property: one changed character in any leaf code owns never yields ALLOW; a label passes only if valid", () => {
    type Leaf = { path: (string | number)[]; value: string };
    const leavesOf = (v: unknown, path: (string | number)[] = []): Leaf[] => {
      if (typeof v === "string") return [{ path, value: v }];
      if (Array.isArray(v)) return v.flatMap((x, i) => leavesOf(x, [...path, i]));
      if (v !== null && typeof v === "object") {
        return Object.entries(v).flatMap(([k, x]) => leavesOf(x, [...path, k]));
      }
      return [];
    };
    const setAt = (root: unknown, path: (string | number)[], value: string) => {
      let o = root as Record<string | number, unknown>;
      for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
      o[path.at(-1) as string | number] = value;
    };
    const runs = { base: [EXPECTED, ctx()], exact: [EXACT_EXPECTED, exactCtx()] } as const;
    const tricky = fc.constantFrom(
      " ",
      "\n",
      "\t",
      " ",
      "​",
      "́",
      "K",
      "İ",
      "ı",
      "＠",
      "０",
      "а",
      "е",
      "о",
      "0",
      "+",
      "e",
      "K",
      "k",
      ".",
      ",",
      "@",
    );
    const ch = fc.oneof(tricky, fc.string({ unit: "binary", minLength: 1, maxLength: 1 }));
    fc.assert(
      fc.property(
        fc.constantFrom("base" as const, "exact" as const),
        fc.nat(),
        fc.constantFrom("insert", "delete", "replace", "flipCase"),
        fc.nat(),
        ch,
        (run, leafIx, op, posIx, c) => {
          const [expected, context] = runs[run];
          const body = structuredClone(canonicalInvoice(expected));
          const leaves = leavesOf(body);
          const leaf = leaves[leafIx % leaves.length] as Leaf;
          const s = leaf.value;
          const i = posIx % (s.length + (op === "insert" ? 1 : 0) || 1);
          const flipped = (x: string) => (x === x.toUpperCase() ? x.toLowerCase() : x.toUpperCase());
          const mutated =
            op === "insert"
              ? s.slice(0, i) + c + s.slice(i)
              : op === "delete"
                ? s.slice(0, i) + s.slice(i + 1)
                : op === "replace"
                  ? s.slice(0, i) + c + s.slice(i + 1)
                  : s.slice(0, i) + flipped(s.charAt(i)) + s.slice(i + 1);
          fc.pre(mutated !== s);
          setAt(body, leaf.path, mutated);
          const v = decide(call("create_invoice", body), context);
          const isLabel = leaf.path[0] === "items" && leaf.path[2] === "name";
          if (isLabel) {
            // Independent of the checker: if the edited label is allowed, it still safely names its line.
            if (v.results.find((r) => r.policy === "invoiceEqualsQuote")?.verdict === "ALLOW") {
              expectSafeLabel(mutated, leaf.path[1] as number);
            }
          } else {
            expect(v.verdict).toBe("DENY");
            expect(v.decidedBy).toContain("invoiceEqualsQuote");
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});

describe("inv.i1.executor-body: the money executor sends the body code built, never the model's args", () => {
  const RULE_EXPECTED = { ...EXPECTED, invoiceId: INVOICE_ID, invoiceDate: INVOICE_DATE };
  const LABELS = ["Season premium", "Top grade quality bonus", "Disbursement and handling"] as const;

  it("canonicalInvoiceCall builds each invoice call's body from the run alone (plus the checked labels)", () => {
    expect(canonicalInvoiceCall("create_invoice", EXPECTED)).toEqual({
      ok: true,
      method: "create_invoice",
      args: canonicalInvoice(EXPECTED),
    });
    expect(canonicalInvoiceCall("create_invoice", EXPECTED, LABELS)).toEqual({
      ok: true,
      method: "create_invoice",
      args: canonicalInvoice(EXPECTED, LABELS),
    });
    expect(canonicalInvoiceCall("create_conditional_rules_for_invoice", RULE_EXPECTED)).toEqual({
      ok: true,
      method: "create_conditional_rules_for_invoice",
      args: autoCancelRuleArgs(INVOICE_ID, autoCancelDate(INVOICE_DATE)),
    });
    expect(canonicalInvoiceCall("send_invoice", RULE_EXPECTED)).toEqual({
      ok: true,
      method: "send_invoice",
      args: canonicalSend(INVOICE_ID),
    });
  });

  it("refuses rather than guesses: bad labels, no invoice yet, an unreadable date, another tool", () => {
    for (const [method, e, labels] of [
      ["create_invoice", EXPECTED, ["Premium 2026", "Bonus", "Costs"]],
      ["create_conditional_rules_for_invoice", EXPECTED, undefined],
      ["create_conditional_rules_for_invoice", { ...RULE_EXPECTED, invoiceDate: "29 Oct 2026" }, undefined],
      ["send_invoice", EXPECTED, undefined],
      ["create_payout_batch", RULE_EXPECTED, undefined],
    ] as const) {
      expect(canonicalInvoiceCall(method, e, labels), method).toMatchObject({ ok: false });
    }
  });

  it("invoiceEqualsQuote allows each call exactly when its args equal the executor's body", () => {
    const c = ruleCtx();
    for (const method of ["create_conditional_rules_for_invoice", "send_invoice"] as const) {
      const built = canonicalInvoiceCall(method, c.expected);
      if (!built.ok) throw new Error(built.reason);
      expect(POLICIES.invoiceEqualsQuote(call(method, built.args), c), method).toEqual({
        verdict: 0,
        reason: null,
      });
    }
    const created = canonicalInvoiceCall("create_invoice", EXPECTED, LABELS);
    if (!created.ok) throw new Error(created.reason);
    expect(POLICIES.invoiceEqualsQuote(call("create_invoice", created.args), ctx())).toEqual({
      verdict: 0,
      reason: null,
    });
  });
});

describe("inv.i1.one-shape: fields are read from the canonical shape only", () => {
  it("both the flat and the nested form of a field is ambiguous, and every reader denies it", () => {
    const both = draft({ detail: { invoice_number: "FS-2026A-r38", reference: "rc:0000000000000000" } });
    const d = decide(call("create_invoice", both), ctx());
    expect(d.verdict).toBe("DENY");
    for (const p of [
      "invoiceEqualsQuote",
      "invoicerIsBusinessEmail",
      "recipientInBrandAllowlist",
      "referenceCarriesHash",
    ] as const) {
      expect(reasonOf(d, p), p).toBe(
        "Ambiguous draft: invoice_number is given both as invoice_number and as detail.invoice_number",
      );
    }
    const invoicer = draft({ invoicer: { email_address: BUSINESS } });
    expect(reasonOf(decide(call("create_invoice", invoicer), ctx()), "invoicerIsBusinessEmail")).toMatch(
      /^Ambiguous draft: invoicer_email_address is given both/,
    );
    expect(readInvoiceFields(both)).toMatchObject({ ok: false });
    expect(readInvoiceFields(draft())).toMatchObject({
      ok: true,
      fields: {
        values: { invoice_number: "FS-2026A-r37", invoicer_email_address: BUSINESS },
        nestedOnly: {},
        recipientEmails: [PAYER],
      },
    });
  });

  it("the nested REST shape alone is not read: the flat field is missing", () => {
    const nested = {
      detail: {
        currency_code: "USD",
        invoice_number: "FS-2026A-r37",
        reference: CANONICAL.reference,
        note: MEMO,
      },
      invoicer: { email_address: BUSINESS },
      primary_recipients: CANONICAL.primary_recipients,
      items: CANONICAL.items,
    };
    const d = decide(call("create_invoice", nested), ctx());
    expect(d.verdict).toBe("DENY");
    expect(reasonOf(d, "invoicerIsBusinessEmail")).toBe(
      "Non-canonical draft: invoicer_email_address must be the flat field, not invoicer.email_address",
    );
    expect(reasonOf(d, "referenceCarriesHash")).toBe(
      "Non-canonical draft: reference must be the flat field, not detail.reference",
    );
    expect(reasonOf(d, "invoiceEqualsQuote")).toBe(
      "Non-canonical draft: currency_code must be the flat field, not detail.currency_code",
    );
  });

  it("a recipient must carry a readable e-mail at primary_recipients[].billing_info.email_address", () => {
    const flattened = draft({ primary_recipients: [{ email_address: PAYER }] });
    expect(reasonOf(decide(call("create_invoice", flattened), ctx()), "recipientInBrandAllowlist")).toBe(
      "Not a recipient field the draft may set: primary_recipients[0].email_address",
    );
    const doubled = draft({
      primary_recipients: [{ email_address: "x@evil.example", billing_info: { email_address: PAYER } }],
    });
    expect(reasonOf(decide(call("create_invoice", doubled), ctx()), "recipientInBrandAllowlist")).toBe(
      "Not a recipient field the draft may set: primary_recipients[0].email_address",
    );
    for (const [label, recipients] of [
      ["no billing info", [{}]],
      ["empty billing info", [{ billing_info: {} }]],
      ["a number", [{ billing_info: { email_address: 42 } }]],
      ["not an e-mail", [{ billing_info: { email_address: "lantern bay" } }]],
      ["not a list", { billing_info: { email_address: PAYER } }],
    ] as const) {
      const d = decide(call("create_invoice", draft({ primary_recipients: recipients })), ctx());
      expect(d.decidedBy, label).toContain("recipientInBrandAllowlist");
      expect(reasonOf(d, "recipientInBrandAllowlist"), label).toMatch(/readable e-mail|primary_recipients/);
    }
    const none = draft({ primary_recipients: [] });
    expect(reasonOf(decide(call("create_invoice", none), ctx()), "recipientInBrandAllowlist")).toBe(
      "Exactly one recipient is allowed",
    );
    const two = draft({
      primary_recipients: [
        { billing_info: { email_address: PAYER } },
        { billing_info: { email_address: PAYER } },
      ],
    });
    expect(reasonOf(decide(call("create_invoice", two), ctx()), "recipientInBrandAllowlist")).toBe(
      "Exactly one recipient is allowed",
    );
  });

  it("denies every recipient-bearing field other than primary_recipients[].billing_info.email_address", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ additional_recipients: ["x@evil.example"] }, "additional_recipients"],
      [{ cc: ["x@evil.example"] }, "cc"],
      [
        {
          primary_recipients: [
            { billing_info: { email_address: PAYER }, shipping_info: { business_name: "Evil Co" } },
          ],
        },
        "primary_recipients[0].shipping_info",
      ],
      [
        {
          primary_recipients: [
            {
              billing_info: {
                email_address: PAYER,
                phones: [{ country_code: "1", national_number: "5551234", phone_type: "MOBILE" }],
              },
            },
          ],
        },
        "primary_recipients[0].billing_info.phones",
      ],
      [
        { items: CANONICAL.items.map((i, k) => (k === 0 ? { ...i, email_address: "x@evil.example" } : i)) },
        "items[0].email_address",
      ],
    ];
    for (const [over, path] of cases) {
      const d = decide(call("create_invoice", draft(over)), ctx());
      expect(d.decidedBy, path).toContain("recipientInBrandAllowlist");
      expect(reasonOf(d, "recipientInBrandAllowlist"), path).toBe(
        `Not a recipient field the draft may set: ${path}`,
      );
    }
  });
});

describe("inv.i1.dates: no due or invoice date is ever sent; AUTO_CANCEL is invoice date + 25 days", () => {
  it("create_invoice carries no date at all", () => {
    expect(reasonOf(decide(call("create_invoice", draft()), ctx()), "dueWithin30Days")).toBeNull();
    const cases: [Record<string, unknown>, string][] = [
      [{ invoice_date: "2026-10-29" }, "invoice_date"],
      [{ payment_term: { term_type: "DUE_ON_DATE_SPECIFIED", due_date: "2026-11-13" } }, "payment_term"],
      [{ due_date: "2026-11-13" }, "due_date"],
      [{ invoice_date: "29 Oct 2026" }, "invoice_date"],
      [{ detail: { invoice_date: "2026-10-29" } }, "detail.invoice_date"],
      [
        { items: CANONICAL.items.map((i, k) => (k === 1 ? { ...i, item_date: "2026-10-29" } : i)) },
        "items[1].item_date",
      ],
    ];
    for (const [over, path] of cases) {
      const d = decide(call("create_invoice", draft(over)), ctx());
      expect(d.decidedBy, path).toContain("dueWithin30Days");
      expect(reasonOf(d, "dueWithin30Days"), path).toBe(`The draft may not set dates: ${path}`);
    }
  });

  it("the rule date must be exactly the invoice date + 25 days, read strictly", () => {
    expect(decide(call("create_conditional_rules_for_invoice", RULE("2026-11-23")), ruleCtx())).toMatchObject(
      {
        verdict: "ALLOW",
      },
    );
    for (const date of ["2026-11-22", "2026-11-24", "2026-11-28", "2026-10-30"]) {
      const d = decide(call("create_conditional_rules_for_invoice", RULE(date)), ruleCtx());
      expect(d.decidedBy, date).toContain("dueWithin30Days");
      expect(reasonOf(d, "dueWithin30Days"), date).toBe(
        "The AUTO_CANCEL date must be the invoice date + 25 days (2026-11-23)",
      );
    }
    for (const date of ["2026-11-31", "2026-11-23T00:00:00Z", "23/11/2026", "", 20261123]) {
      const d = decide(call("create_conditional_rules_for_invoice", RULE(date as string)), ruleCtx());
      expect(d.decidedBy, String(date)).toContain("dueWithin30Days");
      expect(reasonOf(d, "dueWithin30Days"), String(date)).toBe(
        "The AUTO_CANCEL date is not a YYYY-MM-DD date",
      );
    }
  });

  it("fails closed when the invoice date or today is unknown or unreadable", () => {
    const at = (c: PolicyCtx) =>
      reasonOf(
        decide(call("create_conditional_rules_for_invoice", RULE("2026-11-23")), c),
        "dueWithin30Days",
      );
    expect(at(ruleCtx({ invoiceDate: null }))).toBe("The invoice's date is not known yet");
    expect(at(ruleCtx({ invoiceDate: "2026-10-29T00:00:00Z" }))).toBe(
      "The invoice's date is not a YYYY-MM-DD date",
    );
    expect(at(ruleCtx({}, { today: "29 Oct" }))).toBe("Today is not a YYYY-MM-DD date");
    // An invoice dated long ago: +25 days is already past, so the rule would cancel at once.
    expect(at(ruleCtx({ invoiceDate: "2026-09-20" }))).toBe(
      "The AUTO_CANCEL date must be the invoice date + 25 days (2026-10-15)",
    );
    expect(
      reasonOf(
        decide(
          call("create_conditional_rules_for_invoice", RULE("2026-10-15")),
          ruleCtx({ invoiceDate: "2026-09-20" }),
        ),
        "dueWithin30Days",
      ),
    ).toBe("The AUTO_CANCEL date must be after today and within 30 days");
  });

  it("the rule must be one AUTO_CANCEL on SPECIFIC_DATE, on this run's invoice, with nothing else", () => {
    const rule = (r: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      invoice_id: INVOICE_ID,
      rules: [{ ...RULE("2026-11-23").rules[0], ...r }],
      ...extra,
    });
    const cases: [string, unknown, PolicyName, RegExp][] = [
      [
        "discount rule",
        rule({
          conditional_rule_type: "EARLY_PAYMENT_DISCOUNT",
          conditional_rule_value_type: "PERCENT",
          conditional_rule_value: "5",
        }),
        "invoiceEqualsQuote",
        /conditional_rule_value/,
      ],
      [
        "discount type alone",
        rule({ conditional_rule_type: "EARLY_PAYMENT_DISCOUNT" }),
        "dueWithin30Days",
        /one AUTO_CANCEL rule on SPECIFIC_DATE/,
      ],
      [
        "relative expiry",
        rule({
          rule_expiry_terms: {
            rule_expiry_condition: "SEVEN_DAYS_AFTER_ISSUE_DATE",
            condition_rule_end_date: "2026-11-23",
          },
        }),
        "dueWithin30Days",
        /one AUTO_CANCEL rule on SPECIFIC_DATE/,
      ],
      [
        "two rules",
        { invoice_id: INVOICE_ID, rules: [RULE("2026-11-23").rules[0], RULE("2026-11-23").rules[0]] },
        "dueWithin30Days",
        /one AUTO_CANCEL rule/,
      ],
      ["no rules", { invoice_id: INVOICE_ID, rules: [] }, "dueWithin30Days", /one AUTO_CANCEL rule/],
      ["another invoice", RULE("2026-11-23", "INV2-ZZZZ-ZZZZ-ZZZZ-ZZZZ"), "invoiceEqualsQuote", /invoice_id/],
      [
        "extra date field",
        rule({}, { due_date: "2026-11-23" }),
        "dueWithin30Days",
        /may not set dates: due_date/,
      ],
      [
        "extra key",
        rule({}, { send_to_recipient: true }),
        "invoiceEqualsQuote",
        /Not in the canonical rule: send_to_recipient/,
      ],
    ];
    for (const [label, args, policy, reason] of cases) {
      const d = decide(call("create_conditional_rules_for_invoice", args), ruleCtx());
      expect(d.verdict, label).toBe("DENY");
      expect(d.decidedBy, label).toContain(policy);
      expect(reasonOf(d, policy), label).toMatch(reason);
    }
    expect(
      reasonOf(
        decide(
          call("create_conditional_rules_for_invoice", RULE("2026-11-23")),
          ruleCtx({ invoiceId: null }),
        ),
        "invoiceEqualsQuote",
      ),
    ).toBe("There is no invoice to attach the rule to");
  });

  it("property: across invoice dates and offsets, only invoice date + 25 days passes", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: 0 }), fc.integer({ min: -40, max: 60 }), (age, offset) => {
        const today = "2026-10-29";
        const invoiceDate = new Date(Date.UTC(2026, 9, 29 + age)).toISOString().slice(0, 10);
        const date = new Date(Date.UTC(2026, 9, 29 + age + offset)).toISOString().slice(0, 10);
        const d = decide(
          call("create_conditional_rules_for_invoice", RULE(date)),
          ruleCtx({ invoiceDate }, { today }),
        );
        expect(d.verdict === "ALLOW").toBe(offset === 25);
      }),
      { numRuns: 300 },
    );
  });
});

describe("inv.i6.send-bound: send_invoice sends only this run's invoice, privately", () => {
  const SEND = { invoice_id: INVOICE_ID, send_to_recipient: false };

  it("the canonical send waits for the treasurer and nothing else", () => {
    const d = decide(call("send_invoice", SEND), ruleCtx());
    expect(d).toMatchObject({ verdict: "REQUIRE_APPROVAL", decidedBy: ["sendNeedsTreasurer"] });
  });

  it("a send for a different invoice id is denied", () => {
    const d = decide(call("send_invoice", { ...SEND, invoice_id: "INV2-ZZZZ-ZZZZ-ZZZZ-ZZZZ" }), ruleCtx());
    expect(d.verdict).toBe("DENY");
    expect(d.decidedBy).toEqual(["invoiceEqualsQuote"]);
    expect(reasonOf(d, "invoiceEqualsQuote")).toBe("invoice_id differs from the code's send");
    expect(
      reasonOf(decide(call("send_invoice", SEND), ruleCtx({ invoiceId: null })), "invoiceEqualsQuote"),
    ).toBe("There is no invoice to send");
  });

  it("any key but invoice_id and send_to_recipient: false is denied, and both are required", () => {
    const cases: [unknown, string][] = [
      [{ ...SEND, send_to_invoicer: true }, "Not in the canonical send: send_to_invoicer"],
      [{ ...SEND, note: "Pay 5000 now", subject: "Invoice" }, "Not in the canonical send: note, subject"],
      [
        { ...SEND, additional_recipients: ["x@evil.example"] },
        "Not in the canonical send: additional_recipients",
      ],
      [{ ...SEND, send_to_recipient: true }, "send_to_recipient differs from the code's send"],
      [{ invoice_id: INVOICE_ID }, "send_to_recipient differs from the code's send"],
      [{ send_to_recipient: false }, "invoice_id differs from the code's send"],
      [[SEND], "The send arguments are not an object"],
    ];
    for (const [args, reason] of cases) {
      const d = decide(call("send_invoice", args), ruleCtx());
      expect(d.verdict, reason).toBe("DENY");
      expect(reasonOf(d, "invoiceEqualsQuote"), reason).toBe(reason);
    }
  });
});

describe("policy lattice: decide(call, ctx) = max verdict (register §9)", () => {
  it("checks invoicer, recipients, reference and memo", () => {
    expect(
      decide(call("create_invoice", draft({ invoicer_email_address: "x@evil.example" })), ctx()).decidedBy,
    ).toEqual(["invoiceEqualsQuote", "invoicerIsBusinessEmail"]);
    const evil = draft({ primary_recipients: [{ billing_info: { email_address: "x@evil.example" } }] });
    expect(decide(call("create_invoice", evil), ctx()).decidedBy).toContain("recipientInBrandAllowlist");
    expect(reasonOf(decide(call("create_invoice", evil), ctx()), "recipientInBrandAllowlist")).toBe(
      "A recipient is not on the brand allowlist",
    );
    expect(
      decide(call("create_invoice", draft({ reference: "rc:0000000000000000" })), ctx()).decidedBy,
    ).toContain("referenceCarriesHash");
    expect(
      reasonOf(decide(call("create_invoice", draft({ note: `${MEMO}.` })), ctx()), "referenceCarriesHash"),
    ).toBe("The note must be exactly the code-rendered memo");
  });

  it("send_invoice waits for the treasurer (REQUIRE_APPROVAL)", () => {
    const d = decide(call("send_invoice", { invoice_id: INVOICE_ID, send_to_recipient: false }), ruleCtx());
    expect(d).toMatchObject({ verdict: "REQUIRE_APPROVAL", rank: 1, decidedBy: ["sendNeedsTreasurer"] });
  });

  it("phase gate: reads anywhere; writes only in their phase", () => {
    expect(decide(call("get_hold", { hold_id: "H1" }), ctx({ runState: "DRAFT" })).verdict).toBe("ALLOW");
    expect(decide(call("get_invoice"), ctx({ runState: "DRAFT" })).verdict).toBe("DENY");
    expect(decide(call("get_invoice"), ctx({ runState: "FUNDED" })).verdict).toBe("ALLOW");
    expect(decide(call("create_invoice", draft()), ctx({ runState: "INVOICED" })).decidedBy).toContain(
      "phaseGate",
    );
    expect(decide(call("create_invoice", draft()), ctx({ invoiceExists: true })).decidedBy).toContain(
      "phaseGate",
    );
    const holds = [
      { holdId: "H1", state: "OPEN" as const, gate: "BLOCKS_APPROVAL" as const },
      { holdId: "H3", state: "RESOLVED" as const, gate: "RESERVES_LINE" as const },
    ];
    expect(
      decide(call("propose_resolution", { hold_id: "H1" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("ALLOW");
    expect(
      decide(call("propose_resolution", { hold_id: "H3" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("DENY");
    expect(
      decide(call("request_payout_batch", { run_id: "r" }), ctx({ runState: "IN_REVIEW", holds })).verdict,
    ).toBe("DENY");
    expect(
      decide(call("request_payout_batch", { run_id: "r" }), ctx({ runState: "IN_REVIEW", holds: [] }))
        .verdict,
    ).toBe("ALLOW");
    expect(decide(call("get_payout_item", { id: "x" }), ctx({ runState: "APPROVED" })).verdict).toBe("DENY");
    expect(decide(call("get_payout_item", { id: "x" }), ctx({ runState: "SETTLING" })).verdict).toBe("ALLOW");
  });

  it("kill switches, sandbox-only, allowlist and budget", () => {
    expect(
      decide(
        call("get_hold"),
        ctx({ flags: { killPayouts: false, killPaypalLive: false, killAiLive: true } }),
      ).decidedBy,
    ).toContain("killSwitch");
    expect(
      decide(
        call("create_invoice", draft()),
        ctx({ flags: { killPayouts: false, killPaypalLive: true, killAiLive: false } }),
      ).verdict,
    ).toBe("DENY");
    expect(
      decide(
        call("request_payout_batch"),
        ctx({
          runState: "IN_REVIEW",
          flags: { killPayouts: true, killPaypalLive: false, killAiLive: false },
        }),
      ).decidedBy,
    ).toContain("killSwitch");
    expect(decide(call("create_invoice", draft()), ctx({ ppEnv: "live" })).decidedBy).toContain(
      "sandboxOnly",
    );
    expect(decide(call("create_payout_batch", {}), ctx()).decidedBy).toContain("allowlist");
    expect(decide(call("cancel_unclaimed_payout_item", {}), ctx()).verdict).toBe("DENY");
    expect(
      decide(
        call("get_hold"),
        ctx({ budget: { spentMicros: 750_000, capMicros: 750_000, iteration: 1, maxIterations: 10 } }),
      ).decidedBy,
    ).toContain("budgetCap");
    expect(
      decide(
        call("get_hold"),
        ctx({ budget: { spentMicros: 0, capMicros: 750_000, iteration: 10, maxIterations: 10 } }),
      ).verdict,
    ).toBe("DENY");
  });

  it("no tool reaches a money-moving endpoint", () => {
    const moneyMoving = [
      "create_payout_batch",
      "cancel_unclaimed_payout_item",
      "record_payment_for_invoice",
      "search_invoicing",
    ];
    for (const name of moneyMoving) {
      for (const runState of ["IN_REVIEW", "APPROVED", "POSTED"] as const) {
        expect(decide(call(name, {}), ctx({ runState })).verdict).toBe("DENY");
      }
    }
    expect(AGENT_TOOL_NAMES).toHaveLength(17);
    expect(AGENT_TOOL_NAMES).not.toContain("create_payout_batch");
  });

  it("30 hostile argument sets all end in DENY", () => {
    const hostile: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      const wrongAmount = draft();
      (wrongAmount.items[i % 3] as Draft["items"][number]).unit_amount.value = `${1 + i}.00`;
      hostile.push(wrongAmount);
      hostile.push(
        draft({ primary_recipients: [{ billing_info: { email_address: `attacker${i}@evil.example` } }] }),
      );
      const offsetting = draft({ shipping_cost: `${50 + i}.00` });
      (offsetting.items[0] as Draft["items"][number]).discount = {
        amount: { currency_code: "USD", value: `${50 + i}.00` },
      };
      hostile.push(i % 2 === 0 ? offsetting : draft({ reference: `rc:${String(i).repeat(16)}` }));
    }
    expect(hostile).toHaveLength(30);
    for (const args of hostile) expect(decide(call("create_invoice", args), ctx()).verdict).toBe("DENY");
  });

  it("property: adding a policy can only make the verdict stricter", () => {
    const names = [...AGENT_TOOL_NAMES, "create_payout_batch", "unknown_tool"];
    const states = ["DRAFT", "QUOTED", "INVOICED", "IN_REVIEW", "APPROVED", "POSTED", "SETTLED"] as const;
    fc.assert(
      fc.property(
        fc.constantFrom(...names),
        fc.constantFrom(...states),
        fc.boolean(),
        fc.boolean(),
        fc.shuffledSubarray([...POLICY_NAMES]),
        fc.constantFrom(...POLICY_NAMES),
        (name, runState, killAi, invoiceExists, subset, extra) => {
          const c = ctx({
            runState,
            invoiceExists,
            flags: { killPayouts: false, killPaypalLive: false, killAiLive: killAi },
          });
          const pick = (ns: PolicyName[]) => Object.fromEntries(ns.map((n) => [n, POLICIES[n]]));
          const smaller = decideWith(call(name, draft()), c, pick(subset));
          const larger = decideWith(call(name, draft()), c, pick([...new Set([...subset, extra])]));
          expect(larger.rank).toBeGreaterThanOrEqual(smaller.rank);
          expect(decide(call(name, draft()), c).rank).toBeGreaterThanOrEqual(larger.rank);
        },
      ),
      { numRuns: 400 },
    );
  });

  it("no policy throws, whatever the arguments", () => {
    const junk = fc.anything();
    fc.assert(
      fc.property(fc.constantFrom(...AGENT_TOOL_NAMES), junk, (name, args) => {
        expect(() => decide(call(name, args), ruleCtx())).not.toThrow();
      }),
      { numRuns: 300 },
    );
  });
});
