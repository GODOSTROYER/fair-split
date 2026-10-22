import { describe, expect, it } from "vitest";
import {
  AUTO_CANCEL_AFTER_DAYS,
  autoCancelDate,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  InvoicePlanError,
  invoiceMemo,
  invoiceNumberFor,
  rateCardReference,
  reconcileAgentDraft,
  runSlug,
  seasonIdCode,
} from "../src/index.js";
import { BUSINESS_EMAIL, HERO_QUOTE, heroRun, PAYER, RATE_CARD_SHA256 } from "./support/fixtures.js";

const plan = () => buildInvoicePlan(heroRun(), { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL });

describe("register §8 invoice fields", () => {
  it("derives the season ID code, run slug and invoice number", () => {
    expect(seasonIdCode("2026-A")).toBe("2026A");
    expect(runSlug("2026-A", 37)).toBe("2026A-r37");
    expect(invoiceNumberFor("2026-A", 37)).toBe("FS-2026A-r37");
  });

  it("keeps invoice_number within PayPal's 25 characters for every environment offset (S3.4)", () => {
    // judge/prod from 1, dev from 100000, nightly smoke from 900000 + 10 × run number
    for (const runSeq of [1, 100_000, 900_000 + 10 * 99_999]) {
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
      invoice_date: "2026-11-05",
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
    expect(p.totalCents).toBe(HERO_QUOTE.totalCents);
    expect(p.autoCancelOn).toBe("2026-11-30");
    expect(p.dueDate).toBe(p.autoCancelOn);
  });

  it("refuses a quote whose total is not the sum of its parts, a non-USD quote, or a negative part", () => {
    const bad = (quote: object) => () =>
      buildInvoicePlan(heroRun({ quote: { ...HERO_QUOTE, ...quote } }), {
        invoiceDate: "2026-11-05",
        businessEmail: BUSINESS_EMAIL,
      });
    expect(bad({ totalCents: HERO_QUOTE.totalCents + 1n })).toThrow(/not the sum/);
    expect(bad({ currency: "PHP" })).toThrow(/USD only/);
    expect(bad({ bonusCents: -1n, totalCents: HERO_QUOTE.totalCents - HERO_QUOTE.bonusCents - 1n })).toThrow(
      /non-negative/,
    );
  });

  it("leaves a zero component off the invoice", () => {
    const p = buildInvoicePlan(
      heroRun({
        quote: { ...HERO_QUOTE, disbursementCents: 0n, totalCents: HERO_QUOTE.totalCents - 6_000n },
      }),
      { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL },
    );
    expect(p.createArgs.items.map((i) => i.name)).toEqual(["Premium", "Quality bonus"]);
  });

  it("requires a real invoicer and payer e-mail", () => {
    expect(() => buildInvoicePlan(heroRun(), { invoiceDate: "2026-11-05", businessEmail: "coop" })).toThrow(
      InvoicePlanError,
    );
    expect(() =>
      buildInvoicePlan(heroRun({ payer: { ...PAYER, email: "nobody" } }), {
        invoiceDate: "2026-11-05",
        businessEmail: BUSINESS_EMAIL,
      }),
    ).toThrow(InvoicePlanError);
  });
});

describe("inv.i1.no-model-numbers: the agent's draft may carry words, never numbers", () => {
  const agentDraft = () => {
    const p = plan();
    return {
      ...structuredClone(p.createArgs),
      note: `${p.note}. Thank you for funding the season premium.`,
      items: p.createArgs.items.map((item, i) => ({
        ...item,
        name: ["Season premium", "Quality bonus, grade one", "Disbursement"][i] as string,
        description: "Paid to members as ratified",
      })),
    };
  };

  it("accepts wording and keeps every code-owned field", () => {
    const p = plan();
    const result = reconcileAgentDraft(agentDraft(), p);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.args.items.map((i) => i.name)).toEqual([
      "Season premium",
      "Quality bonus, grade one",
      "Disbursement",
    ]);
    expect(result.args.items.map((i) => i.unit_amount)).toEqual(p.createArgs.items.map((i) => i.unit_amount));
    expect(result.args.note.startsWith(p.note)).toBe(true);
    const { note: _n, items: _i, ...codeOwned } = result.args;
    const { note: _pn, items: _pi, ...planOwned } = p.createArgs;
    expect(codeOwned).toEqual(planOwned);
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
    ["another date", (d) => ({ ...d, invoice_date: "2026-11-06" })],
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
  ];

  it.each(cases)("refuses %s", (_label, mutate) => {
    const result = reconcileAgentDraft(mutate(agentDraft()), plan());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.mismatches.length).toBeGreaterThan(0);
  });
});
