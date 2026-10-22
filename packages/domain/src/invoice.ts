// The canonical invoice (I1, register §8, S3.6.3, S4.4). Code builds every field PayPal sees from
// the quote and the run; the agent contributes only the three item labels. `invoice_date` and
// `payment_term` are never sent: PayPal dates the invoice itself, and the only date we send is the
// AUTO_CANCEL rule's, at PayPal's invoice date + 25 days (C-27). Pure: no clock, no IO.
import type { PolicyCtx } from "@fairsplit/contracts";
import { foldAsciiCase } from "./ascii.js";
import { addDays } from "./format.js";
import { minorToDecimal } from "./money.js";

/** C-27: the AUTO_CANCEL rule fires on the invoice date + 25 days. */
export const AUTO_CANCEL_AFTER_DAYS = 25;
/** `dueWithin30Days`: the AUTO_CANCEL date is after today and at most this many days out. */
export const AUTO_CANCEL_MAX_DAYS_AHEAD = 30;
/** S4.4 `checkLabels`: the agent's item labels. */
export const ITEM_LABEL_MAX = 40;
const ITEM_LABEL = /^[A-Za-z][A-Za-z ,'()-]*$/;

export type InvoiceExpectation = Pick<
  PolicyCtx["expected"],
  "quote" | "invoiceNumber" | "reference" | "memo" | "businessEmail" | "payer"
>;

export interface CanonicalInvoiceItem {
  name: string;
  quantity: "1";
  unit_amount: { currency_code: "USD"; value: string };
  unit_of_measure: "AMOUNT";
}

/** Exactly the toolkit 1.11.0 `create_invoice` arguments for a run, and nothing else. */
export interface CanonicalInvoice {
  currency_code: "USD";
  invoice_number: string;
  reference: string;
  note: string;
  invoicer_email_address: string;
  primary_recipients: [{ billing_info: { business_name: string; email_address: string } }];
  items: CanonicalInvoiceItem[];
}

/**
 * Why a set of item labels is refused, or null. One label per quote line (three), each 1–40
 * characters of letters, spaces and `,'()-` starting with a letter (no digit, `@`, `.`, `/` or `:`,
 * so no amount, URL, e-mail or phone), and all distinct.
 */
export function itemLabelProblem(labels: readonly unknown[]): string | null {
  if (labels.length !== 3) return "There must be three item labels, one per quote line";
  for (const [i, label] of labels.entries()) {
    if (typeof label !== "string" || label.length > ITEM_LABEL_MAX || !ITEM_LABEL.test(label)) {
      return `Item ${i + 1}'s label must be 1-${ITEM_LABEL_MAX} letters, spaces and ,'()- with no digits`;
    }
  }
  const folded = labels.map((l) => foldAsciiCase(l as string));
  return new Set(folded).size === folded.length ? null : "The item labels must be distinct";
}

/**
 * IC-02 `canonicalInvoice(quote, labels)`: S3.6.3's create arguments, built by code from the quote
 * and the run. `labels` (the agent's, checked) replace the quote's item names; amounts, quantities,
 * currency, number, reference, note, invoicer and the one recipient always come from code.
 */
export function canonicalInvoice(e: InvoiceExpectation, labels?: readonly string[]): CanonicalInvoice {
  if (labels !== undefined) {
    const problem = itemLabelProblem(labels);
    if (problem) throw new RangeError(problem);
  }
  if (e.quote.currency !== "USD" || e.quote.items.length !== 3) {
    throw new RangeError("A quote is three USD lines");
  }
  return {
    currency_code: "USD",
    invoice_number: e.invoiceNumber,
    reference: e.reference,
    note: e.memo,
    invoicer_email_address: e.businessEmail,
    primary_recipients: [
      { billing_info: { business_name: e.payer.businessName, email_address: e.payer.email } },
    ],
    items: e.quote.items.map((item, i) => ({
      name: labels?.[i] ?? item.name,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: minorToDecimal(item.unitAmountCents) },
      unit_of_measure: "AMOUNT",
    })),
  };
}

/** A calendar date in exactly `YYYY-MM-DD` form that exists, or null. Nothing else is read as a date. */
export function parseStrictIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? value : null;
}

/** C-27: PayPal's invoice date + 25 days. Throws on anything but a strict date. */
export function autoCancelDate(invoiceDate: string): string {
  if (parseStrictIsoDate(invoiceDate) === null) throw new RangeError(`not a YYYY-MM-DD date: ${invoiceDate}`);
  return addDays(invoiceDate, AUTO_CANCEL_AFTER_DAYS);
}

/** The canonical `create_conditional_rules_for_invoice` arguments: one AUTO_CANCEL on SPECIFIC_DATE. */
export function autoCancelRuleArgs(invoiceId: string, autoCancelOn: string): AutoCancelRuleArgs {
  if (parseStrictIsoDate(autoCancelOn) === null)
    throw new RangeError(`not a YYYY-MM-DD date: ${autoCancelOn}`);
  return {
    invoice_id: invoiceId,
    rules: [
      {
        conditional_rule_type: "AUTO_CANCEL" as const,
        rule_expiry_terms: {
          rule_expiry_condition: "SPECIFIC_DATE" as const,
          condition_rule_end_date: autoCancelOn,
        },
      },
    ],
  };
}

export interface AutoCancelRuleArgs {
  invoice_id: string;
  rules: [
    {
      conditional_rule_type: "AUTO_CANCEL";
      rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE"; condition_rule_end_date: string };
    },
  ];
}

/** The canonical `send_invoice` arguments: this run's invoice, never e-mailed by PayPal (register §8). */
export interface CanonicalSend {
  invoice_id: string;
  send_to_recipient: false;
}
export const canonicalSend = (invoiceId: string): CanonicalSend => ({
  invoice_id: invoiceId,
  send_to_recipient: false,
});

/** What code needs to build every invoice call: the quote and run, and PayPal's invoice ID and date once known. */
export type InvoiceCallExpectation = InvoiceExpectation &
  Pick<PolicyCtx["expected"], "invoiceId" | "invoiceDate">;

export type CanonicalInvoiceCall =
  | { ok: true; method: "create_invoice"; args: CanonicalInvoice }
  | { ok: true; method: "create_conditional_rules_for_invoice"; args: AutoCancelRuleArgs }
  | { ok: true; method: "send_invoice"; args: CanonicalSend }
  | { ok: false; reason: string };

/**
 * The body the money executor sends for an invoice call (I1). Code builds it from the run alone;
 * the only thing the agent contributes is `labels`, its three item labels for create_invoice, which
 * are checked here. The executor sends `args` from this function, never the model's arguments, and
 * the policy lattice (`invoiceEqualsQuote`) is the second layer: it allows a call only when its
 * arguments equal this body exactly. Refuses, never guesses, when the run cannot yet build the body.
 */
export function canonicalInvoiceCall(
  method: string,
  e: InvoiceCallExpectation,
  labels?: readonly string[],
): CanonicalInvoiceCall {
  try {
    if (method === "create_invoice") return { ok: true, method, args: canonicalInvoice(e, labels) };
    if (method === "create_conditional_rules_for_invoice") {
      if (e.invoiceId === null) return { ok: false, reason: "There is no invoice to attach the rule to" };
      if (e.invoiceDate === null) return { ok: false, reason: "The invoice's date is not known yet" };
      return { ok: true, method, args: autoCancelRuleArgs(e.invoiceId, autoCancelDate(e.invoiceDate)) };
    }
    if (method === "send_invoice") {
      if (e.invoiceId === null) return { ok: false, reason: "There is no invoice to send" };
      return { ok: true, method, args: canonicalSend(e.invoiceId) };
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "The run cannot build this call" };
  }
  return { ok: false, reason: `${method} is not an invoice call` };
}
