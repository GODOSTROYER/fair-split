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
    const labelled = canonicalInvoice(EXPECTED, ["Season premium", "Grade one bonus", "PayPal fees (est)"]);
    expect(labelled.items.map((i) => i.name)).toEqual([
      "Season premium",
      "Grade one bonus",
      "PayPal fees (est)",
    ]);
    expect(labelled.items.map((i) => i.unit_amount)).toEqual(CANONICAL.items.map((i) => i.unit_amount));
    expect(() => canonicalInvoice(EXPECTED, ["Premium 2026", "Bonus", "Fees"])).toThrow(RangeError);
  });

  it("item labels are at most 40 letters, spaces and ,'()- with no digits, and distinct", () => {
    expect(itemLabelProblem(["Premium", "Quality bonus", "Disbursement costs"])).toBeNull();
    expect(itemLabelProblem(["Members' premium (lot)", "Bonus, grade one", "Pay-out costs"])).toBeNull();
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
    ]) {
      expect(itemLabelProblem([bad, "Bonus", "Costs"]), bad).not.toBeNull();
    }
    expect(itemLabelProblem(["Premium", "premium", "Costs"])).toMatch(/distinct/);
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
      it.name = ["Season premium", "Grade one bonus", "Disbursement and handling"][i];
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

  it("compares after normalisation: amounts as cents and e-mail case only", () => {
    const d = draft({ invoicer_email_address: BUSINESS.toUpperCase() });
    (d.items[1] as Draft["items"][number]).unit_amount.value = minorToDecimal(
      quote.items[1]?.unitAmountCents ?? 0,
    ).replace(/0$/, "");
    (d.primary_recipients[0] as { billing_info: { email_address: string } }).billing_info.email_address =
      PAYER.toUpperCase();
    expect(decide(call("create_invoice", d), ctx()).verdict).toBe("ALLOW");
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
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 }), fc.string({ maxLength: 45 }), (i, name) => {
        const d = draft();
        (d.items[i] as Draft["items"][number]).name = name;
        const labels = d.items.map((x) => x.name as string);
        const r = decide(call("create_invoice", d), ctx());
        expect(r.results.find((x) => x.policy === "invoiceEqualsQuote")?.verdict).toBe(
          itemLabelProblem(labels) === null ? "ALLOW" : "DENY",
        );
      }),
      { numRuns: 300 },
    );
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
