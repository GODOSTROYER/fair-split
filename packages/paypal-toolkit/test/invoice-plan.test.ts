import { describe, expect, it } from "vitest";
import {
  AUTO_CANCEL_AFTER_DAYS,
  AUTO_CANCEL_MAX_DAYS_AHEAD,
  allowedInvoiceNotes,
  approvalCovers,
  autoCancelDate,
  autoCancelWindowError,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  INVOICE_ITEM_KEYS,
  INVOICE_NOTE_CLOSINGS,
  InvoicePlanError,
  type InvoiceQuote,
  invoiceMemo,
  invoiceNumberFor,
  isInvoiceItemLabel,
  ppDate,
  rateCardReference,
  reconcileAgentDraft,
  runSlug,
  seasonIdCode,
} from "../src/index.js";
import {
  BUSINESS_EMAIL,
  HERO_QUOTE,
  heroQuote,
  heroRun,
  LOT_CODE,
  PAYER,
  RATE_CARD_SHA256,
} from "./support/fixtures.js";

const plan = () => buildInvoicePlan(heroRun(), { businessEmail: BUSINESS_EMAIL });
const planFor = (quote: InvoiceQuote) => () =>
  buildInvoicePlan(heroRun({ quote }), { businessEmail: BUSINESS_EMAIL });

describe("register §8 invoice fields", () => {
  it("derives the season ID code, run slug and invoice number", () => {
    expect(seasonIdCode("2026-A")).toBe("2026A");
    expect(runSlug("2026-A", 37)).toBe("2026A-r37");
    expect(invoiceNumberFor("2026-A", 37)).toBe("FS-2026A-r37");
  });

  it("keeps invoice_number within PayPal's 25 characters for every run block (k × 10,000 + 1, k ≤ 999)", () => {
    for (const runSeq of [1, 37, 999_999, 1_000_001, 9_990_001, 9_999_999]) {
      expect(invoiceNumberFor("2026-A", runSeq).length).toBeLessThanOrEqual(25);
    }
  });

  it("rejects malformed season codes and run numbers", () => {
    expect(() => seasonIdCode("2026A")).toThrow(InvoicePlanError);
    expect(() => runSlug("2026-A", 0)).toThrow(InvoicePlanError);
    expect(() => runSlug("2026-A", 3.5)).toThrow(InvoicePlanError);
  });

  it("references the rate card by its first 16 hex digits", () => {
    expect(rateCardReference(RATE_CARD_SHA256)).toBe(`rc:${RATE_CARD_SHA256.slice(0, 16)}`);
    expect(() => rateCardReference("7f3a91c2")).toThrow(InvoicePlanError);
    expect(() => rateCardReference(RATE_CARD_SHA256.toUpperCase())).toThrow(InvoicePlanError);
  });

  it("renders the memo with rc8 in two groups of four", () => {
    const rc = RATE_CARD_SHA256;
    expect(invoiceMemo("2026-A", rc, "LB-PH-2026-03")).toBe(
      `Season 2026-A, RC ${rc.slice(0, 4)} ${rc.slice(4, 8)}, lot LB-PH-2026-03`,
    );
  });

  it("auto-cancels on the invoice date + 25 days (C-27): an invoice dated 5 Nov cancels on 30 Nov", () => {
    expect(AUTO_CANCEL_AFTER_DAYS).toBe(25);
    expect(autoCancelDate("2026-11-05")).toBe("2026-11-30");
    expect(autoCancelDate("2026-12-20")).toBe("2027-01-14");
    expect(() => autoCancelDate("2026-02-30")).toThrow(RangeError);
  });

  it("builds exactly the create_invoice arguments, with amounts formatted from the code quote", () => {
    const p = plan();
    expect(p.createArgs).toEqual<CreateInvoiceArgs>({
      currency_code: "USD",
      invoice_number: "FS-2026A-r37",
      reference: `rc:${RATE_CARD_SHA256.slice(0, 16)}`,
      note: invoiceMemo("2026-A", RATE_CARD_SHA256, "LB-PH-2026-03"),
      invoicer_email_address: BUSINESS_EMAIL,
      primary_recipients: [
        { billing_info: { business_name: PAYER.businessName, email_address: PAYER.email } },
      ],
      items: [
        {
          name: "Premium",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "2887.50" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Quality bonus",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "1386.00" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Disbursement costs",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "60.00" },
          unit_of_measure: "AMOUNT",
        },
      ],
    });
    expect(p.totalCents).toBe(BigInt(HERO_QUOTE.totalCents));
  });

  it("never sends an invoice date or a payment term: PayPal dates the invoice, so a send cannot schedule it", () => {
    const p = plan();
    expect(p.createArgs).not.toHaveProperty("invoice_date");
    expect(JSON.stringify(p.createArgs)).not.toMatch(/date|due|payment_term/);
  });

  it("refuses a quote whose total is not the sum of its lines, a non-USD quote, or a negative line", () => {
    expect(planFor({ ...HERO_QUOTE, totalCents: HERO_QUOTE.totalCents + 1 })).toThrow(/not the sum/);
    expect(planFor({ ...HERO_QUOTE, currency: "PHP" as "USD" })).toThrow(/USD only/);
    expect(planFor(heroQuote({ bonus: -1 }))).toThrow(/non-negative/);
    expect(planFor(heroQuote({ premium: 2887.5 }))).toThrow(/integer cents/);
  });

  it("refuses a quote computed for another rate card or another lot (it would bill another season)", () => {
    expect(planFor({ ...HERO_QUOTE, rateCardSha256: "0".repeat(64) })).toThrow(/another rate card/);
    expect(planFor({ ...HERO_QUOTE, lotCode: "LB-PH-2026-04" })).toThrow(/another lot/);
    expect(LOT_CODE).toBe(HERO_QUOTE.lotCode);
  });

  it("refuses a quote whose pools disagree with its lines", () => {
    expect(planFor({ ...HERO_QUOTE, poolCents: HERO_QUOTE.poolCents + 1 })).toThrow(/pools disagree/);
    expect(planFor({ ...HERO_QUOTE, bonusPoolCents: 0 })).toThrow(/pools disagree/);
  });

  it("refuses a quote with lines missing, out of order or not in quantity 1", () => {
    const [premium, bonus, disbursement] = HERO_QUOTE.items as [
      InvoiceQuote["items"][number],
      InvoiceQuote["items"][number],
      InvoiceQuote["items"][number],
    ];
    expect(INVOICE_ITEM_KEYS).toEqual(["PREMIUM", "BONUS", "DISBURSEMENT"]);
    expect(planFor({ ...HERO_QUOTE, items: [premium, bonus] })).toThrow(/exactly three/);
    expect(planFor({ ...HERO_QUOTE, items: [bonus, premium, disbursement] })).toThrow(/must be PREMIUM/);
    expect(
      planFor({ ...HERO_QUOTE, items: [premium, bonus, { ...disbursement, quantity: "2" as "1" }] }),
    ).toThrow(/quantity/);
  });

  it.each([
    ["a digit", "Premium 2026"],
    ["an amount", "Premium $2,887.50"],
    ["over 40 characters", "Premium paid to the members of the co-op as ratified"],
    ["a leading space", " Premium"],
    ["a colon", "Premium: season"],
    ["an empty label", ""],
  ])("refuses an item label with %s (register §8 labels)", (_label, name) => {
    const items = HERO_QUOTE.items.map((i) => (i.key === "PREMIUM" ? { ...i, name } : i));
    expect(isInvoiceItemLabel(name)).toBe(false);
    expect(planFor({ ...HERO_QUOTE, items })).toThrow(/label/);
  });

  it("accepts register §8 labels: letters, spaces and ,'()-", () => {
    for (const name of [
      "Premium",
      "Quality bonus",
      "Disbursement costs",
      "Members' premium (Fairtrade)",
      "Co-op fee, audit",
    ])
      expect(isInvoiceItemLabel(name)).toBe(true);
  });

  it("keeps a zero line as a 0.00 line, so the invoice always has the quote's three lines", () => {
    const p = planFor(heroQuote({ disbursement: 0 }))();
    expect(p.createArgs.items.map((i) => [i.name, i.unit_amount.value])).toEqual([
      ["Premium", "2887.50"],
      ["Quality bonus", "1386.00"],
      ["Disbursement costs", "0.00"],
    ]);
  });

  it("refuses a quote that asks for nothing", () => {
    expect(planFor(heroQuote({ premium: 0, bonus: 0, disbursement: 0 }))).toThrow(/more than zero/);
  });

  it("requires a real invoicer and payer e-mail", () => {
    expect(() => buildInvoicePlan(heroRun(), { businessEmail: "coop" })).toThrow(InvoicePlanError);
    expect(() =>
      buildInvoicePlan(heroRun({ payer: { ...PAYER, email: "nobody" } }), { businessEmail: BUSINESS_EMAIL }),
    ).toThrow(InvoicePlanError);
  });
});

describe("the AUTO_CANCEL window (dueWithin30Days), and no due date", () => {
  it("inv.i8.labels: carries no due date, because PayPal never receives one (no payment_term)", () => {
    const p = plan();
    expect(p).not.toHaveProperty("dueDate");
    expect(p).not.toHaveProperty("autoCancelOn");
  });

  it("accepts a date after today and at most 30 days out", () => {
    expect(AUTO_CANCEL_MAX_DAYS_AHEAD).toBe(30);
    expect(autoCancelWindowError("2026-11-30", "2026-11-05")).toBeNull();
    expect(autoCancelWindowError("2026-11-06", "2026-11-05")).toBeNull();
    expect(autoCancelWindowError("2026-12-05", "2026-11-05")).toBeNull();
  });

  it("refuses today, the past and anything over 30 days out", () => {
    expect(autoCancelWindowError("2026-11-05", "2026-11-05")).toMatch(/not after today/);
    expect(autoCancelWindowError("2026-10-26", "2026-11-05")).toMatch(/not after today/);
    expect(autoCancelWindowError("2026-12-06", "2026-11-05")).toMatch(/more than 30 days/);
    expect(() => autoCancelWindowError("2026-11-31", "2026-11-05")).toThrow(RangeError);
  });

  it("measures today on PayPal's calendar (ppDate, America/Los_Angeles), not UTC", () => {
    // 00:30 UTC on 6 Nov is 16:30 on 5 Nov in Los Angeles (PST after 1 Nov), and 17:30 PDT before it.
    expect(ppDate(new Date("2026-11-06T00:30:00Z"))).toBe("2026-11-05");
    expect(ppDate(new Date("2026-10-23T00:30:00Z"))).toBe("2026-10-22");
    expect(ppDate(new Date("2026-11-05T20:00:00Z"))).toBe("2026-11-05");
  });
});

describe("sendNeedsTreasurer: an approval sends exactly one invoice", () => {
  const approval = { approverId: "persona:analyn", approvedAt: "2026-11-05T02:00:00.000Z" };
  const invoice = { invoiceNumber: "FS-2026A-r37", invoiceId: "INV2-Z56S-5LLA-Q52L-CPZ5" };

  it("covers the invoice it names, by number and, when given, by PayPal id", () => {
    expect(approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r37" }, invoice)).toBe(true);
    expect(
      approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r37", invoiceId: invoice.invoiceId }, invoice),
    ).toBe(true);
  });

  it("covers nothing else", () => {
    expect(approvalCovers(null, invoice)).toBe(false);
    expect(approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r36" }, invoice)).toBe(false);
    expect(
      approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r37", invoiceId: "INV2-OTHER" }, invoice),
    ).toBe(false);
    expect(approvalCovers({ ...approval, approverId: "", invoiceNumber: "FS-2026A-r37" }, invoice)).toBe(
      false,
    );
  });
});

describe("inv.i1.no-model-numbers: the agent's draft may choose words from a closed list, never numbers", () => {
  const agentDraft = (closing: string = INVOICE_NOTE_CLOSINGS[0]) => {
    const p = plan();
    return { ...structuredClone(p.createArgs), note: `${p.note}. ${closing}` };
  };

  it("offers the memo alone or the memo with one listed closing, none with a digit", () => {
    const memo = plan().note;
    expect(allowedInvoiceNotes(memo)).toEqual([memo, ...INVOICE_NOTE_CLOSINGS.map((c) => `${memo}. ${c}`)]);
    for (const closing of INVOICE_NOTE_CLOSINGS) expect(closing).not.toMatch(/\p{Nd}/u);
  });

  it.each(INVOICE_NOTE_CLOSINGS)("accepts the closing %j and keeps every code-owned field", (closing) => {
    const p = plan();
    const result = reconcileAgentDraft(agentDraft(closing), p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args).toEqual({ ...p.createArgs, note: `${p.note}. ${closing}` });
  });

  it("accepts the bare memo", () => {
    const p = plan();
    expect(reconcileAgentDraft(structuredClone(p.createArgs), p)).toEqual({ ok: true, args: p.createArgs });
  });

  const cases: [string, (d: ReturnType<typeof agentDraft>) => unknown][] = [
    [
      "a changed unit amount",
      (d) => ({
        ...d,
        items: d.items.map((i, n) =>
          n === 0 ? { ...i, unit_amount: { currency_code: "USD", value: "2888.50" } } : i,
        ),
      }),
    ],
    [
      "a changed quantity",
      (d) => ({ ...d, items: d.items.map((i, n) => (n === 1 ? { ...i, quantity: "2" } : i)) }),
    ],
    ["an extra line", (d) => ({ ...d, items: [...d.items, { ...(d.items[2] as object), name: "Tip" }] })],
    ["a dropped line", (d) => ({ ...d, items: d.items.slice(0, 2) })],
    ["a shipping cost", (d) => ({ ...d, shipping_cost: "25.00" })],
    [
      "a partial-payment minimum",
      (d) => ({ ...d, allow_partial_payment: true, minimum_partial_payment_amount: "100.00" }),
    ],
    ["a tip", (d) => ({ ...d, allow_tip: true })],
    [
      "a per-item discount",
      (d) => ({ ...d, items: d.items.map((i) => ({ ...i, discount: { percent: "10" } })) }),
    ],
    [
      "a per-item tax",
      (d) => ({ ...d, items: d.items.map((i) => ({ ...i, tax: { name: "VAT", percent: "12" } })) }),
    ],
    ["another invoice number", (d) => ({ ...d, invoice_number: "FS-2026A-r38" })],
    ["another reference", (d) => ({ ...d, reference: "rc:0000000000000000" })],
    ["another invoicer", (d) => ({ ...d, invoicer_email_address: "attacker@example.test" })],
    [
      "another payer",
      (d) => ({ ...d, primary_recipients: [{ billing_info: { email_address: "attacker@example.test" } }] }),
    ],
    ["an invoice date (the code never sends one)", (d) => ({ ...d, invoice_date: "2026-11-05" })],
    ["a due date the toolkit schema would strip", (d) => ({ ...d, due_date: "2026-11-20" })],
    [
      "a payment term the toolkit schema would strip",
      (d) => ({ ...d, payment_term: { term_type: "NET_10" } }),
    ],
    [
      "a recipient field the schema would strip",
      (d) => ({
        ...d,
        primary_recipients: [
          {
            billing_info: {
              business_name: PAYER.businessName,
              email_address: PAYER.email,
              pay_to: "attacker@example.test",
            },
          },
        ],
      }),
    ],
    [
      "an item field the schema would strip",
      (d) => ({ ...d, items: d.items.map((i, n) => (n === 0 ? { ...i, total: "9999.00" } : i)) }),
    ],
    ["a note without the memo", (d) => ({ ...d, note: "Season premium" })],
    ["a number in the note", (d) => ({ ...d, note: `${plan().note}. Please pay 5000 instead.` })],
    [
      "a number in an item name",
      (d) => ({ ...d, items: d.items.map((i, n) => (n === 0 ? { ...i, name: "Premium 2887.50" } : i)) }),
    ],
    [
      "a number in a description",
      (d) => ({ ...d, items: d.items.map((i) => ({ ...i, description: "9,625 kg" })) }),
    ],
    ["a missing currency", (d) => ({ ...d, currency_code: undefined })],
    ["not an invoice at all", () => ({ hello: "world" })],
    // No free text either: words can carry an amount ("five thousand") or an injected instruction.
    [
      "a renamed item, even without digits",
      (d) => ({ ...d, items: d.items.map((i, n) => (n === 0 ? { ...i, name: "Season premium" } : i)) }),
    ],
    [
      "an item description, even without digits",
      (d) => ({ ...d, items: d.items.map((i) => ({ ...i, description: "Paid to members as ratified" })) }),
    ],
    ["a free-text closing", (d) => ({ ...d, note: `${plan().note}. Thank you, Lantern Bay.` })],
    ["an amount in words", (d) => ({ ...d, note: `${plan().note}. Please pay five thousand dollars.` })],
    ["a link in the note", (d) => ({ ...d, note: `${plan().note}. Pay at https://pay.example.test` })],
    [
      "two listed closings",
      (d) => ({ ...d, note: `${plan().note}. ${INVOICE_NOTE_CLOSINGS[0]} ${INVOICE_NOTE_CLOSINGS[1]}` }),
    ],
    ["a closing before the memo", (d) => ({ ...d, note: `${INVOICE_NOTE_CLOSINGS[0]} ${plan().note}` })],
    ["a missing note", (d) => ({ ...d, note: undefined })],
    ["pay-by-bank", (d) => ({ ...d, enable_pay_by_bank: true })],
    ["a theme colour", (d) => ({ ...d, theme_color: "#000000" })],
    ["an invoicer business name", (d) => ({ ...d, invoicer_business_name: "Another Co-op" })],
  ];

  it.each(cases)("refuses %s", (_label, mutate) => {
    const result = reconcileAgentDraft(mutate(agentDraft()), plan());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches.length).toBeGreaterThan(0);
  });
});
