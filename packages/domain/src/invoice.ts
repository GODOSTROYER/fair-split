// The canonical invoice (I1, register §8, S3.6.3, S4.4). Code builds every field PayPal sees from
// the quote and the run; the agent contributes only the three item labels. `invoice_date` and
// `payment_term` are never sent: PayPal dates the invoice itself, and the only date we send is the
// AUTO_CANCEL rule's, at PayPal's invoice date + 25 days (C-27). Pure: no clock, no IO.
import type { InvoiceQuote, PolicyCtx, QuoteItemKey } from "@fairsplit/contracts";
import { foldAsciiCase } from "./ascii.js";
import { addDays } from "./format.js";
import { minorToDecimal } from "./money.js";

/** C-27: the AUTO_CANCEL rule fires on the invoice date + 25 days. */
export const AUTO_CANCEL_AFTER_DAYS = 25;
/** `dueWithin30Days`: the AUTO_CANCEL date is after today and at most this many days out. */
export const AUTO_CANCEL_MAX_DAYS_AHEAD = 30;
/** S4.4 `checkLabels`: the agent's item labels. */
export const ITEM_LABEL_MAX = 40;
/** Letters and `,'()-`, starting with a letter, words joined by single spaces: no edge or double spaces. */
const ITEM_LABEL = /^[A-Za-z][A-Za-z,'()-]*(?: [A-Za-z,'()-]+)*$/;

/** The quote's three lines in invoice order (`quoteInvoice`). */
export const QUOTE_ITEM_KEYS: readonly QuoteItemKey[] = ["PREMIUM", "BONUS", "DISBURSEMENT"];

/**
 * The word that names each quote line. A label must carry its own line's word and no other line's,
 * so it can neither swap two lines nor bill one line under another's name.
 */
export const ITEM_LABEL_HEAD_WORDS: Readonly<Record<QuoteItemKey, readonly string[]>> = {
  PREMIUM: ["premium", "premiums"],
  BONUS: ["bonus", "bonuses"],
  DISBURSEMENT: ["disbursement", "disbursements"],
};

/** Words any line's label may add. No number word, Roman numeral, single letter or contact word. */
const SHARED_LABEL_WORDS = [
  "for",
  "of",
  "the",
  "and",
  "to",
  "on",
  "per",
  "season",
  "seasonal",
  "cacao",
  "cocoa",
  "member",
  "members",
  "members'",
  "farmer",
  "farmers",
  "farmers'",
  "grower",
  "growers",
  "growers'",
  "co-op",
  "coop",
  "cooperative",
  "lot",
  "harvest",
  "shipped",
  "verified",
  "kilo",
  "kilos",
  "dried",
  "bean",
  "beans",
] as const;

/**
 * S4.4 `checkLabels` as a closed vocabulary (I1): every word a label for each line may use, its own
 * line's word included (ASCII case folded; words split on spaces, commas and parentheses). Anything
 * else is refused, so letters alone cannot spell an amount ("Four thousand", "MMDCCC", "lO,OOO"),
 * contact or payment details ("at", "dot", "wire", "Zelle"), another party, or a different charge
 * ("refund", "discount", "shipping", "paid"). The agent's prompt is given these lists.
 */
export const ITEM_LABEL_WORDS: Readonly<Record<QuoteItemKey, readonly string[]>> = {
  PREMIUM: [
    ...ITEM_LABEL_HEAD_WORDS.PREMIUM,
    ...SHARED_LABEL_WORDS,
    "fairtrade",
    "fair",
    "trade",
    "social",
    "community",
    "development",
    "producer",
    "producers",
  ],
  BONUS: [
    ...ITEM_LABEL_HEAD_WORDS.BONUS,
    ...SHARED_LABEL_WORDS,
    "quality",
    "grade",
    "top",
    "fine",
    "flavor",
    "flavour",
    "fermented",
    "fermentation",
  ],
  DISBURSEMENT: [
    ...ITEM_LABEL_HEAD_WORDS.DISBURSEMENT,
    ...SHARED_LABEL_WORDS,
    "costs",
    "cost",
    "fees",
    "fee",
    "payout",
    "payouts",
    "pay-out",
    "pay-outs",
    "transfer",
    "transfers",
    "processing",
    "handling",
    "paypal",
    "distribution",
  ],
};

/** S4.4's keyed labels (`create_run_invoice` `item_labels`): one label per quote line, by name. */
export interface ItemLabels {
  premium: string;
  bonus: string;
  disbursement: string;
}
const ITEM_LABEL_FIELD: Readonly<Record<QuoteItemKey, keyof ItemLabels>> = {
  PREMIUM: "premium",
  BONUS: "bonus",
  DISBURSEMENT: "disbursement",
};
const LINE_NOUN: Readonly<Record<QuoteItemKey, string>> = {
  PREMIUM: "premium",
  BONUS: "bonus",
  DISBURSEMENT: "disbursement",
};

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

/** A label's words for the vocabulary check: split on spaces, commas and parentheses, ASCII case folded. */
const labelWords = (label: string): string[] =>
  foldAsciiCase(label)
    .split(/[ ,()]+/)
    .filter(Boolean);

/** Why `keys` is not the quote's three lines (each key once), or null. */
function quoteKeysProblem(keys: readonly unknown[]): string | null {
  const ok =
    keys.length === QUOTE_ITEM_KEYS.length &&
    QUOTE_ITEM_KEYS.every((k) => keys.filter((x) => x === k).length === 1);
  return ok ? null : "The quote must have one premium, one bonus and one disbursement line";
}

/**
 * Why a set of item labels is refused, or null (S4.4 `checkLabels`, I1). One label per quote line,
 * in the quote's line order (`keys`, by default premium, bonus, disbursement). Each label is 1-40
 * characters of letters and `,'()-` starting with a letter, words joined by single spaces (no digit,
 * `@`, `.`, `/` or `:`, and no edge or doubled spaces); it names its own line (its
 * `ITEM_LABEL_HEAD_WORDS`) and no other; and every word is in its line's closed vocabulary
 * (`ITEM_LABEL_WORDS`). So the labels are distinct, and none can spell a number, contact details,
 * another party or another charge.
 */
export function itemLabelProblem(
  labels: readonly unknown[],
  keys: readonly unknown[] = QUOTE_ITEM_KEYS,
): string | null {
  const keysProblem = quoteKeysProblem(keys);
  if (keysProblem) return keysProblem;
  if (labels.length !== keys.length) return "There must be three item labels, one per quote line";
  for (const [i, label] of labels.entries()) {
    const key = keys[i] as QuoteItemKey;
    const item = `Item ${i + 1}'s label`;
    if (typeof label !== "string" || label.length > ITEM_LABEL_MAX || !ITEM_LABEL.test(label)) {
      return `${item} must be 1-${ITEM_LABEL_MAX} letters, single spaces and ,'()- with no digits`;
    }
    const words = labelWords(label);
    for (const other of QUOTE_ITEM_KEYS) {
      if (other !== key && words.some((w) => ITEM_LABEL_HEAD_WORDS[other].includes(w))) {
        return `${item} names the ${LINE_NOUN[other]} line, not its own`;
      }
    }
    const stray = words.find((w) => !ITEM_LABEL_WORDS[key].includes(w));
    if (stray !== undefined) return `${item} may not use "${stray}"`;
    if (!words.some((w) => ITEM_LABEL_HEAD_WORDS[key].includes(w))) {
      return `${item} must name its own line ("${LINE_NOUN[key]}")`;
    }
  }
  return null;
}

/** The labels in the quote's line order: a list as given, or S4.4's keyed form, or why not. */
function labelsInQuoteOrder(
  quote: InvoiceQuote,
  labels: readonly unknown[] | ItemLabels,
): { ok: true; labels: readonly unknown[] } | { ok: false; reason: string } {
  if (Array.isArray(labels)) return { ok: true, labels };
  const keyed = labels as unknown as Record<string, unknown>;
  const fields = Object.values(ITEM_LABEL_FIELD);
  const keys = Object.keys(keyed);
  if (keys.length !== fields.length || !fields.every((f) => Object.hasOwn(keyed, f))) {
    return { ok: false, reason: "The item labels are keyed premium, bonus and disbursement, once each" };
  }
  return { ok: true, labels: quote.items.map((it) => keyed[ITEM_LABEL_FIELD[it.key]]) };
}

/**
 * IC-02 `canonicalInvoice(quote, labels)`: S3.6.3's create arguments, built by code from the quote
 * and the run. `labels` (the agent's, checked: a list in the quote's line order, or S4.4's keyed
 * `{premium, bonus, disbursement}`) replace the quote's item names; amounts, quantities, currency,
 * number, reference, note, invoicer and the one recipient always come from code.
 */
export function canonicalInvoice(
  e: InvoiceExpectation,
  labels?: readonly string[] | ItemLabels,
): CanonicalInvoice {
  if (e.quote.currency !== "USD" || e.quote.items.length !== 3) {
    throw new RangeError("A quote is three USD lines");
  }
  const keys = e.quote.items.map((it) => it.key);
  const keysProblem = quoteKeysProblem(keys);
  if (keysProblem) throw new RangeError(keysProblem);
  let names: readonly unknown[] | undefined;
  if (labels !== undefined) {
    const ordered = labelsInQuoteOrder(e.quote, labels);
    if (!ordered.ok) throw new RangeError(ordered.reason);
    const problem = itemLabelProblem(ordered.labels, keys);
    if (problem) throw new RangeError(problem);
    names = ordered.labels;
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
      name: (names?.[i] as string | undefined) ?? item.name,
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
 * the only thing the agent contributes is `labels`, its three item labels for create_invoice (a list
 * in the quote's line order or S4.4's keyed `{premium, bonus, disbursement}`), which are checked
 * here. The executor sends `args` from this function, never the model's arguments, and the policy
 * lattice (`invoiceEqualsQuote`) is the second layer: it allows a call only when its arguments equal
 * this body exactly. Refuses, never guesses, when the run cannot yet build the body.
 */
export function canonicalInvoiceCall(
  method: string,
  e: InvoiceCallExpectation,
  labels?: readonly string[] | ItemLabels,
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
