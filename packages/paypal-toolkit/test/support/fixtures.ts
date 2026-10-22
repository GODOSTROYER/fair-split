// Fixtures shaped after PayPal's Invoicing v2 API reference (paypal-rest-api-specifications,
// openapi/invoicing_v2.json): link_description, invoice, invoices (search), payment_reference
// and the common error body. E-mails are sandbox aliases; no token or secret appears here.
//
// TEMPORARY: the hero figures below mirror register §2 (and WS-CORE's seed snapshot on ws/core)
// until the IC-03 seed snapshot (packages/seed/snapshot/season-2026A.json) lands; then read them
// from there.

import { createHash } from "node:crypto";
import { vi } from "vitest";
import { type InvoiceQuote, type InvoiceRun, invoiceMemo, type PayPalLimiter } from "../../src/index.js";
import { TOOLKIT_BASE } from "./msw.js";

/** Hashes are computed, never typed (register §2). */
export const RATE_CARD_SHA256 = createHash("sha256").update("BR 2026-04 fixture card").digest("hex");
export const LOT_CODE = "LB-PH-2026-03";

/** IC-02 quoteInvoice for the hero lot: US$4,333.50 = 2,887.50 + 1,386.00 + 60.00. */
export function heroQuote(
  cents: { premium?: number; bonus?: number; disbursement?: number } = {},
): InvoiceQuote {
  const premium = cents.premium ?? 288_750;
  const bonus = cents.bonus ?? 138_600;
  const disbursement = cents.disbursement ?? 6_000;
  return {
    currency: "USD",
    items: [
      { key: "PREMIUM", name: "Premium", quantity: "1", unitAmountCents: premium },
      { key: "BONUS", name: "Quality bonus", quantity: "1", unitAmountCents: bonus },
      { key: "DISBURSEMENT", name: "Disbursement costs", quantity: "1", unitAmountCents: disbursement },
    ],
    totalCents: premium + bonus + disbursement,
    premiumPoolCents: premium,
    bonusPoolCents: bonus,
    poolCents: premium + bonus,
    disbursementCents: disbursement,
    lotCode: LOT_CODE,
    rateCardSha256: RATE_CARD_SHA256,
  };
}

export const HERO_QUOTE: InvoiceQuote = heroQuote();
export const HERO_MEMO = invoiceMemo("2026-A", RATE_CARD_SHA256, LOT_CODE);

export const BUSINESS_EMAIL = "coop-business@example.test";
export const PAYER = { businessName: "Lantern Bay Chocolate Co.", email: "lantern-bay@example.test" };

export function heroRun(overrides: Partial<InvoiceRun> = {}): InvoiceRun {
  return {
    runId: "0199f6a0-0000-7000-8000-000000000037",
    runSeq: 37,
    seasonCode: "2026-A",
    rateCardSha256: RATE_CARD_SHA256,
    lotCode: LOT_CODE,
    quote: HERO_QUOTE,
    payer: PAYER,
    sendApproval: {
      approverId: "persona:analyn",
      approvedAt: "2026-11-05T02:00:00.000Z",
      invoiceNumber: "FS-2026A-r37",
    },
    ...overrides,
  };
}

export const INVOICE_ID = "INV2-Z56S-5LLA-Q52L-CPZ5";

/** 201 with the default Prefer: return=minimal. */
export const createdLink = (id = INVOICE_ID) => ({
  rel: "self",
  href: `${TOOLKIT_BASE}/v2/invoicing/invoices/${id}`,
  method: "GET",
});

/** 200 from send: a link_description to the payer view. */
export const payerViewLink = (id = INVOICE_ID) => ({
  rel: "payer-view",
  href: `https://www.sandbox.paypal.com/invoice/p/#${id.replaceAll("-", "").slice(4)}`,
  method: "GET",
});

const HERO_ITEMS = [
  ["Premium", "2887.50"],
  ["Quality bonus", "1386.00"],
  ["Disbursement costs", "60.00"],
] as const;

type ItemBody = {
  name: string;
  quantity: string;
  unit_amount: { currency_code: string; value: string };
  [key: string]: unknown;
};

/** 200 GET (`invoice`), as PayPal returns it for the hero invoice. A field set to null is left out. */
export function invoiceBody(
  overrides: {
    id?: string;
    status?: string;
    reference?: string | null;
    note?: string | null;
    total?: string | null;
    due?: string;
    number?: string;
    /** null leaves the date out. */
    invoiceDate?: string | null;
    invoicer?: string;
    recipient?: string;
    items?: ItemBody[];
    /** detail.terms_and_conditions: payer-visible free text the code never sends. */
    terms?: string;
    configuration?: Record<string, unknown>;
    breakdown?: Record<string, unknown>;
  } = {},
) {
  const id = overrides.id ?? INVOICE_ID;
  const reference =
    overrides.reference === undefined ? `rc:${RATE_CARD_SHA256.slice(0, 16)}` : overrides.reference;
  const note = overrides.note === undefined ? HERO_MEMO : overrides.note;
  const total = overrides.total === undefined ? "4333.50" : overrides.total;
  const invoiceDate = overrides.invoiceDate === undefined ? "2026-11-05" : overrides.invoiceDate;
  return {
    id,
    status: overrides.status ?? "SENT",
    detail: {
      ...(reference === null ? {} : { reference }),
      currency_code: "USD",
      invoice_number: overrides.number ?? "FS-2026A-r37",
      ...(invoiceDate === null ? {} : { invoice_date: invoiceDate }),
      ...(note === null ? {} : { note }),
      ...(overrides.terms === undefined ? {} : { terms_and_conditions: overrides.terms }),
      payment_term: { term_type: "DUE_ON_RECEIPT", due_date: invoiceDate ?? "2026-11-05" },
      metadata: {
        create_time: "2026-11-05T02:00:01Z",
        recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}`,
        invoicer_view_url: `https://www.sandbox.paypal.com/invoice/details/${id}`,
      },
    },
    invoicer: { email_address: overrides.invoicer ?? BUSINESS_EMAIL },
    primary_recipients: [
      {
        billing_info: {
          business_name: PAYER.businessName,
          email_address: overrides.recipient ?? PAYER.email,
        },
      },
    ],
    items:
      overrides.items ??
      HERO_ITEMS.map(([name, value]) => ({
        name,
        quantity: "1",
        unit_amount: { currency_code: "USD", value },
        unit_of_measure: "AMOUNT",
      })),
    configuration: {
      tax_calculated_after_discount: true,
      tax_inclusive: false,
      allow_tip: false,
      ...overrides.configuration,
    },
    amount:
      total === null
        ? { currency_code: "USD" }
        : {
            currency_code: "USD",
            value: total,
            breakdown: {
              item_total: { currency_code: "USD", value: total },
              discount: { invoice_discount: { amount: { currency_code: "USD", value: "0.00" } } },
              tax_total: { currency_code: "USD", value: "0.00" },
              ...overrides.breakdown,
            },
          },
    due_amount: { currency_code: "USD", value: overrides.due ?? "4333.50" },
    links: [{ href: `${TOOLKIT_BASE}/v2/invoicing/invoices/${id}`, rel: "self", method: "GET" }],
  };
}

export const searchResult = (...items: ReturnType<typeof invoiceBody>[]) => ({
  total_items: items.length,
  total_pages: 1,
  items,
  links: [],
});

/** The common PayPal error body (name, message, debug_id, details[], links[]). */
export const paypalError = (
  name: string,
  message: string,
  debugId = "b56535a4ac3a2",
  issue = "INVALID_PARAMETER",
) => ({
  name,
  message,
  debug_id: debugId,
  details: [{ issue, description: message }],
  links: [
    {
      href: "https://developer.paypal.com/docs/api/invoicing/v2/#error-INVALID_PARAMETER",
      rel: "information_link",
    },
  ],
});

/** IC-05 PayPalAuth double: hands out test tokens, rotating on invalidate(). */
export function fakeAuth(tokens: string[] = ["test-token-1", "test-token-2"]) {
  let i = 0;
  return {
    token: vi.fn(async () => ({
      v: tokens[Math.min(i, tokens.length - 1)] as string,
      exp: Date.now() + 3_600_000,
      scopes: [],
    })),
    invalidate: vi.fn((_stale?: string) => {
      i += 1;
    }),
  };
}

/** An IC-04 limiter double that admits every call and records what it was asked. */
export function openLimiter() {
  const take = vi.fn(
    async (_request: Parameters<PayPalLimiter["take"]>[0]): ReturnType<PayPalLimiter["take"]> => ({
      ok: true,
    }),
  );
  return { take };
}
