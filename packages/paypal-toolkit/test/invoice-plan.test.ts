import { createHash } from "node:crypto";
import {
  AUTO_CANCEL_AFTER_DAYS,
  AUTO_CANCEL_MAX_DAYS_AHEAD,
  autoCancelDate,
  canonicalInvoiceCall,
  canonicalSend,
  QUOTE_ITEM_KEYS,
} from "@fairsplit/domain";
import { describe, expect, it } from "vitest";
import {
  approvalCovers,
  autoCancelWindowError,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  draftDifferences,
  InvoicePlanError,
  type InvoiceQuote,
  invoiceMemo,
  invoiceNumberFor,
  invoiceSendApproval,
  ppDate,
  rateCardReference,
  readAgentCreate,
  runSlug,
  seasonIdCode,
  sendArgsSha256,
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
import { mutants } from "./support/mutations.js";

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

  it("auto-cancels on the invoice date + 25 days (C-27, core's autoCancelDate): 5 Nov cancels on 30 Nov", () => {
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

  it("is core's canonical body: canonicalInvoiceCall over the plan's expectation, nothing local", () => {
    const p = plan();
    expect(p.expected).toEqual({
      quote: HERO_QUOTE,
      invoiceNumber: "FS-2026A-r37",
      reference: `rc:${RATE_CARD_SHA256.slice(0, 16)}`,
      memo: invoiceMemo("2026-A", RATE_CARD_SHA256, LOT_CODE),
      businessEmail: BUSINESS_EMAIL,
      payer: { email: PAYER.email, businessName: PAYER.businessName },
    });
    const call = canonicalInvoiceCall("create_invoice", {
      ...p.expected,
      invoiceId: null,
      invoiceDate: null,
    });
    expect(call).toEqual({ ok: true, method: "create_invoice", args: p.createArgs });
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
    expect(QUOTE_ITEM_KEYS).toEqual(["PREMIUM", "BONUS", "DISBURSEMENT"]);
    expect(planFor({ ...HERO_QUOTE, items: [premium, bonus] })).toThrow(/exactly three/);
    expect(planFor({ ...HERO_QUOTE, items: [bonus, premium, disbursement] })).toThrow(/must be PREMIUM/);
    expect(
      planFor({ ...HERO_QUOTE, items: [premium, bonus, { ...disbursement, quantity: "2" as "1" }] }),
    ).toThrow(/quantity/);
  });

  it.each([
    ["a digit", "Premium 2026"],
    ["an amount", "Premium $2,887.50"],
    ["an amount in words", "Four thousand premium"],
    ["a Filipino number word", "Dalawang daang premium"],
    ["a Roman numeral", "Premium XIV"],
    ["over 40 characters", "Premium paid to the members of the co-op as ratified"],
    ["a leading space", " Premium"],
    ["a trailing space", "Premium "],
    ["a colon", "Premium: season"],
    ["a domain", "Premium at example.test"],
    ["a non-ASCII letter", "Prémium"],
    ["a word outside the premium line's vocabulary", "Premium for Bukidnon"],
    ["another line's word", "Premium bonus"],
    ["no word of its own line", "Fairtrade"],
    ["an empty label", ""],
  ])("refuses a quote whose own premium name has %s (core's label rules)", (_label, name) => {
    const items = HERO_QUOTE.items.map((i) => (i.key === "PREMIUM" ? { ...i, name } : i));
    expect(planFor({ ...HERO_QUOTE, items })).toThrow(/label/);
  });

  it("refuses a quote whose names are swapped between lines", () => {
    const swapped = HERO_QUOTE.items.map((i, n, all) => ({
      ...i,
      name: (all[(n + 1) % 3] as typeof i).name,
    }));
    expect(planFor({ ...HERO_QUOTE, items: swapped })).toThrow(/label/);
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

  it("requires a real invoicer and payer e-mail, in plain ASCII as the policy lattice compares them", () => {
    expect(() => buildInvoicePlan(heroRun(), { businessEmail: "coop" })).toThrow(InvoicePlanError);
    expect(() => buildInvoicePlan(heroRun(), { businessEmail: "coop@exampl\u212a.test" })).toThrow(
      InvoicePlanError,
    );
    expect(() =>
      buildInvoicePlan(heroRun({ payer: { ...PAYER, email: "nobody" } }), { businessEmail: BUSINESS_EMAIL }),
    ).toThrow(InvoicePlanError);
    expect(() =>
      buildInvoicePlan(heroRun({ payer: { ...PAYER, email: ` ${PAYER.email}` } }), {
        businessEmail: BUSINESS_EMAIL,
      }),
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

  const bound = invoiceSendApproval({
    ...approval,
    invoiceNumber: "FS-2026A-r37",
    invoiceId: invoice.invoiceId,
  });

  it("binds the exact send: sha256 of the JCS of core's canonicalSend, {invoice_id, send_to_recipient: false}", () => {
    expect(canonicalSend(invoice.invoiceId)).toEqual({
      invoice_id: invoice.invoiceId,
      send_to_recipient: false,
    });
    const jcs = `{"invoice_id":"${invoice.invoiceId}","send_to_recipient":false}`;
    expect(sendArgsSha256(invoice.invoiceId)).toBe(createHash("sha256").update(jcs).digest("hex"));
    expect(bound).toEqual({
      ...approval,
      invoiceNumber: "FS-2026A-r37",
      invoiceId: invoice.invoiceId,
      sendArgsSha256: sendArgsSha256(invoice.invoiceId),
    });
  });

  it("covers the invoice it is bound to, and by number alone only for the server chain", () => {
    expect(approvalCovers(bound, invoice)).toBe(true);
    expect(approvalCovers(bound, invoice, { bound: true })).toBe(true);
    // Given before the invoice existed (Judge Mode's first press): the server chain only.
    expect(approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r37" }, invoice)).toBe(true);
    expect(approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r37" }, invoice, { bound: true })).toBe(
      false,
    );
  });

  it("covers nothing else", () => {
    expect(approvalCovers(null, invoice)).toBe(false);
    expect(approvalCovers({ ...approval, invoiceNumber: "FS-2026A-r36" }, invoice)).toBe(false);
    expect(approvalCovers({ ...bound, invoiceId: "INV2-OTHER" }, invoice)).toBe(false);
    expect(approvalCovers({ ...bound, approverId: "" }, invoice)).toBe(false);
    // An id without the hash of its send, or the hash without the id, binds nothing.
    expect(approvalCovers({ ...bound, sendArgsSha256: null }, invoice)).toBe(false);
    expect(approvalCovers({ ...bound, invoiceId: null }, invoice)).toBe(false);
    expect(approvalCovers({ ...bound, sendArgsSha256: sendArgsSha256("INV2-OTHER") }, invoice)).toBe(false);
    // A bound approval never covers an invoice whose id is not known yet.
    expect(approvalCovers(bound, { ...invoice, invoiceId: null })).toBe(false);
  });
});

describe("inv.i1.no-model-numbers: what the model's create_invoice arguments may say (readAgentCreate)", () => {
  const RUN_ID = heroRun().runId;
  /** Claude's labels: each names its own line, in its line's closed vocabulary (core). */
  const LABELS = ["Fairtrade premium", "Bean quality bonus", "Payout disbursement costs"] as const;
  const [premium, bonus, disbursement] = LABELS;
  /** Core's canonical body for these labels, as plain JSON the model could have written. */
  const canonicalFor = (labels: readonly string[] = LABELS): Record<string, unknown> => {
    const p = plan();
    const call = canonicalInvoiceCall(
      "create_invoice",
      { ...p.expected, invoiceId: null, invoiceDate: null },
      labels,
    );
    if (!call.ok) throw new Error(call.reason);
    return structuredClone(call.args) as unknown as Record<string, unknown>;
  };

  it("accepts S4.4's keyed item_labels and builds core's body from them, in the quote's line order", () => {
    const keyed = { bonus, disbursement, premium };
    expect(readAgentCreate({ item_labels: keyed }, plan(), RUN_ID)).toEqual({
      ok: true,
      labels: keyed,
      args: canonicalFor(),
    });
    expect(readAgentCreate({ run_id: RUN_ID, item_labels: keyed }, plan(), RUN_ID).ok).toBe(true);
  });

  it("accepts a toolkit draft that is exactly core's canonical body for its own labels, in any key order", () => {
    const draft = canonicalFor();
    expect(readAgentCreate(draft, plan(), RUN_ID)).toEqual({ ok: true, labels: [...LABELS], args: draft });
    const reordered = Object.fromEntries(Object.entries(draft).reverse());
    expect(readAgentCreate(reordered, plan(), RUN_ID).ok).toBe(true);
    // The deterministic path's draft: the quote's own names.
    expect(readAgentCreate(structuredClone(plan().createArgs), plan(), RUN_ID).ok).toBe(true);
  });

  it.each([
    [
      "another run's run_id",
      { run_id: "0199f6a0-0000-7000-8000-000000000038", item_labels: { premium, bonus, disbursement } },
    ],
    ["a field beside item_labels", { item_labels: { premium, bonus, disbursement }, note: "Pay now" }],
    ["labels as a list under item_labels", { item_labels: [...LABELS] }],
    ["a fourth keyed label", { item_labels: { premium, bonus, disbursement, tip: "Tip" } }],
    ["a keyed label missing", { item_labels: { premium, bonus } }],
    ["a keyed label that is not text", { item_labels: { premium, bonus, disbursement: 60 } }],
    ["words instead of arguments", "Create the invoice"],
    ["nothing", null],
    ["an empty object", {}],
  ])("refuses %s", (_label, input) => {
    const read = readAgentCreate(input, plan(), RUN_ID);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.mismatches.length).toBeGreaterThan(0);
  });

  it.each([
    ["an amount in words", ["Four thousand premium", bonus, disbursement]],
    ["a digit", [premium, "Bonus 1386", disbursement]],
    ["a Cebuano number word", ["Upat ka libo premium", bonus, disbursement]],
    ["a Roman numeral", [premium, bonus, "Disbursement costs MMDCCC"]],
    // The old local check let these through; core's per-line vocabulary does not.
    [
      "a word outside the line's vocabulary ('audit')",
      [premium, bonus, "Payout and audit disbursement costs"],
    ],
    ["a place name", ["Premium for Bukidnon farmers", bonus, disbursement]],
    ["a payment rail", [premium, bonus, "Disbursement by Zelle"]],
    ["another line's word", [premium, "Quality bonus premium", disbursement]],
    ["a label that does not name its own line", ["Fairtrade", bonus, disbursement]],
    ["two lines swapped", [bonus, premium, disbursement]],
  ])("core's label rules: refuses labels with %s, keyed or in a draft", (_label, labels) => {
    const [p, b, d] = labels as [string, string, string];
    const keyed = readAgentCreate({ item_labels: { premium: p, bonus: b, disbursement: d } }, plan(), RUN_ID);
    expect(keyed.ok).toBe(false);
    const draft = canonicalFor();
    (draft.items as { name: string }[]).forEach((item, i) => {
      item.name = labels[i] as string;
    });
    const drafted = readAgentCreate(draft, plan(), RUN_ID);
    expect(drafted).toMatchObject({ ok: false });
    if (!drafted.ok) expect(drafted.mismatches[0]).toMatch(/^items: /);
  });

  it("inv.i1.canonical-body: refuses a draft that differs from the canonical body in any byte, and says where", () => {
    const all = mutants(canonicalFor());
    expect(all.length).toBeGreaterThan(150);
    for (const { label, draft } of all) {
      const read = readAgentCreate(draft, plan(), RUN_ID);
      expect(read.ok, label).toBe(false);
      if (!read.ok) expect(read.mismatches.length, label).toBeGreaterThan(0);
    }
  });

  it.each([
    [
      "a changed unit amount",
      (d: Draft) => ({
        ...d,
        items: d.items.map((i, n) =>
          n ? i : { ...i, unit_amount: { currency_code: "USD", value: "2888.50" } },
        ),
      }),
      "items[0].unit_amount.value: differs from the canonical body",
    ],
    [
      "a shipping cost",
      (d: Draft) => ({ ...d, shipping_cost: "25.00" }),
      "shipping_cost: not in the canonical body",
    ],
    ["a tip", (d: Draft) => ({ ...d, allow_tip: true }), "allow_tip: not in the canonical body"],
    [
      "an invoice date",
      (d: Draft) => ({ ...d, invoice_date: "2026-11-05" }),
      "invoice_date: not in the canonical body",
    ],
    [
      "a closing phrase after the memo",
      (d: Draft) => ({ ...d, note: `${d.note}. Thank you.` }),
      "note: differs from the canonical body",
    ],
    ["a missing note", (d: Draft) => ({ ...d, note: undefined }), "note: missing"],
    [
      "another payer",
      (d: Draft) => ({
        ...d,
        primary_recipients: [
          { billing_info: { business_name: PAYER.businessName, email_address: "attacker@example.test" } },
        ],
      }),
      "primary_recipients[0].billing_info.email_address: differs from the canonical body",
    ],
    ["an extra line", (d: Draft) => ({ ...d, items: [...d.items, d.items[2]] }), "items: "],
    [
      "a key every object inherits",
      (d: Draft) => ({ ...d, ...(JSON.parse('{"__proto__": {"allow_tip": true}}') as object) }),
      "__proto__: not in the canonical body",
    ],
  ])("names %s", (_label, mutate, mismatch) => {
    const read = readAgentCreate(
      JSON.parse(JSON.stringify(mutate(canonicalFor() as unknown as Draft))),
      plan(),
      RUN_ID,
    );
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.mismatches.some((m) => m.startsWith(mismatch))).toBe(true);
  });

  it("draftDifferences compares values code unit for code unit and ignores only key order", () => {
    expect(draftDifferences({ a: "x", b: [1, { c: true }] }, { b: [1, { c: true }], a: "x" })).toEqual([]);
    // "a" + U+0301 COMBINING ACUTE and U+00E1: the same text after NFC, two different bodies here.
    expect(draftDifferences({ a: "a\u0301" }, { a: "\u00e1" })).toEqual([
      "a: differs from the canonical body",
    ]);
    expect(draftDifferences({ a: "1.0" }, { a: "1.00" })).toEqual(["a: differs from the canonical body"]);
    expect(draftDifferences({ a: 1 }, { a: "1" })).toEqual(["a: differs from the canonical body"]);
    expect(draftDifferences([1, 2], [1])).toEqual(["(body): 2 entries, the canonical body has 1"]);
  });
});

type Draft = CreateInvoiceArgs & { note?: string | undefined };
