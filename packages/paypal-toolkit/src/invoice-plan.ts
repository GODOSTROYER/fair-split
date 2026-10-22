// The code-owned invoice (register §8; the approved plan's "PayPal integration contract"; S3
// §S3.6.3). Every field PayPal sees is derived here from the run and the code-computed quote.
// invoice_date and payment_term are never sent: PayPal dates the invoice itself, so sending can
// never schedule it, and the AUTO_CANCEL date follows the date PayPal holds (C-27). The agent's
// draft may differ only by choosing one closing phrase for the note from a fixed list (invariant
// I1: free text could carry an amount in words).

import { isDeepStrictEqual } from "node:util";
import type { InvoiceQuote, QuoteItemKey } from "./_shims/domain.js";
import { addDays, parseIsoDate } from "./dates.js";
import { centsToValue } from "./money.js";
import { toolkitZodSchemas } from "./schemas.js";

/** Register C-27: auto-cancel on the invoice date + 25 days ("30 Nov" is showcase copy only). */
export const AUTO_CANCEL_AFTER_DAYS = 25;
/** dueWithin30Days (S4 policy lattice): the AUTO_CANCEL date is after today and at most 30 days out. */
export const AUTO_CANCEL_MAX_DAYS_AHEAD = 30;
/** PayPal Invoicing v2 limits (invoicing_v2.json): invoice_number ≤ 25, reference ≤ 120. */
export const INVOICE_NUMBER_MAX = 25;
export const REFERENCE_MAX = 120;

/** The quote's three lines, in invoice order (register §2): premium, quality bonus, disbursement costs. */
export const INVOICE_ITEM_KEYS: readonly QuoteItemKey[] = ["PREMIUM", "BONUS", "DISBURSEMENT"];

/** Register §8 item labels: at most 40 characters, letters, spaces and `,'()-`, no digits. */
export const INVOICE_ITEM_LABEL = /^[\p{L} ,'()-]{1,40}$/u;

/**
 * The only words the agent adds to an invoice: at most one of these closings after the code-rendered
 * memo, as `${memo}. ${closing}`. A closed list, because any free text could carry an amount in words.
 */
export const INVOICE_NOTE_CLOSINGS = [
  "Thank you.",
  "Thank you for funding the season.",
  "Paid out to members under the ratified rate card.",
] as const;

/** Every note the agent may choose for an invoice whose memo is `memo`. */
export function allowedInvoiceNotes(memo: string): string[] {
  return [memo, ...INVOICE_NOTE_CLOSINGS.map((closing) => `${memo}. ${closing}`)];
}

/**
 * sendNeedsTreasurer: Analyn's approval (or Judge-as-Treasurer, labelled) to send ONE invoice. It
 * names the run's invoice number, known before the invoice exists, and PayPal's invoice id when it
 * was given for an invoice that already exists. It never sends any other invoice.
 */
export interface TreasurerApproval {
  approverId: string;
  approvedAt: string;
  /** `FS-{runSlug}` of the invoice this approval sends. */
  invoiceNumber: string;
  /** PayPal's id of that invoice, when known at approval time; then it must match too. */
  invoiceId?: string | null;
}

/** True only when the approval names exactly this invoice. */
export function approvalCovers(
  approval: TreasurerApproval | null | undefined,
  invoice: { invoiceNumber: string; invoiceId: string | null },
): boolean {
  if (!approval || typeof approval.approverId !== "string" || approval.approverId.length === 0) return false;
  if (approval.invoiceNumber !== invoice.invoiceNumber) return false;
  return approval.invoiceId == null || approval.invoiceId === invoice.invoiceId;
}

export interface InvoicePayer {
  businessName: string;
  email: string;
}

/** IC-06 input: what `Invoices.ensureForRun` needs to know about a pay run. Plain data. */
export interface InvoiceRun {
  runId: string;
  /** From the global `fs_run_seq`, never reset. */
  runSeq: number;
  /** The season label "2026-A"; its ID code ("2026A") is derived. */
  seasonCode: string;
  /** sha256 (lowercase hex) of the ratified rate card's JCS. */
  rateCardSha256: string;
  lotCode: string;
  /** IC-02 `quoteInvoice(card, lot)`: computed by code before any slip is read. */
  quote: InvoiceQuote;
  /** The brand (Lantern Bay in the showcase). */
  payer: InvoicePayer;
  /** sendNeedsTreasurer: without it the chain stops after create, at PENDING_APPROVAL. */
  sendApproval?: TreasurerApproval | null;
}

export interface CreateInvoiceItem {
  name: string;
  quantity: string;
  unit_amount: { currency_code: "USD"; value: string };
  unit_of_measure: "AMOUNT";
}

/** Exactly the toolkit 1.11.0 `create_invoice` arguments we send: no invoice_date, no payment term. */
export interface CreateInvoiceArgs {
  currency_code: "USD";
  invoice_number: string;
  reference: string;
  note: string;
  invoicer_email_address: string;
  primary_recipients: { billing_info: { business_name: string; email_address: string } }[];
  items: CreateInvoiceItem[];
}

/**
 * The code-built invoice for one run. It carries no date: the AUTO_CANCEL date is the date PayPal
 * gives the invoice + 25 days (`autoCancelDate`), and there is no due date at all, because toolkit
 * 1.11.0 cannot send a payment_term and nothing PayPal does not hold may look like one (I8).
 */
export interface InvoicePlan {
  runId: string;
  invoiceNumber: string;
  reference: string;
  /** The memo, e.g. "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03". */
  note: string;
  totalCents: bigint;
  createArgs: CreateInvoiceArgs;
}

export class InvoicePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoicePlanError";
  }
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const SEASON_CODE = /^(\d{4})-([A-Z])$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new InvoicePlanError(message);
}

/** "2026-A" → "2026A" (register §2: Season 2026-A, ID code 2026A). */
export function seasonIdCode(seasonCode: string): string {
  const m = SEASON_CODE.exec(seasonCode);
  check(m !== null, `Season code must look like 2026-A: ${JSON.stringify(seasonCode)}`);
  return `${m[1]}${m[2]}`;
}

/** Register §4: runSlug = `2026A-r{runSeq}`. */
export function runSlug(seasonCode: string, runSeq: number): string {
  check(Number.isSafeInteger(runSeq) && runSeq > 0, `runSeq must be a positive integer: ${runSeq}`);
  return `${seasonIdCode(seasonCode)}-r${runSeq}`;
}

/** Register §8: invoice_number = `FS-{runSlug}`, the create idempotency key. */
export function invoiceNumberFor(seasonCode: string, runSeq: number): string {
  const n = `FS-${runSlug(seasonCode, runSeq)}`;
  check(n.length <= INVOICE_NUMBER_MAX, `invoice_number over ${INVOICE_NUMBER_MAX} characters: ${n}`);
  return n;
}

function assertSha256(sha: string): void {
  check(SHA256_HEX.test(sha), "rateCardSha256 must be 64 lowercase hex characters");
}

/** Register §8: reference = `rc:{rateCardSha16}`. */
export function rateCardReference(rateCardSha256: string): string {
  assertSha256(rateCardSha256);
  return `rc:${rateCardSha256.slice(0, 16)}`;
}

/** Register §8: "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03" (RC is rc8, grouped in fours). */
export function invoiceMemo(seasonCode: string, rateCardSha256: string, lotCode: string): string {
  seasonIdCode(seasonCode);
  assertSha256(rateCardSha256);
  check(lotCode.trim().length > 0 && !/[\r\n]/.test(lotCode), "lotCode must be a single non-empty line");
  return `Season ${seasonCode}, RC ${rateCardSha256.slice(0, 4)} ${rateCardSha256.slice(4, 8)}, lot ${lotCode}`;
}

/** C-27: the AUTO_CANCEL date is the invoice date PayPal holds + 25 days. */
export function autoCancelDate(invoiceDate: string): string {
  return addDays(invoiceDate, AUTO_CANCEL_AFTER_DAYS);
}

/**
 * dueWithin30Days: null when `autoCancelOn` is after `today` and at most 30 days out, else why not.
 * `today` is PayPal's date (`ppDate`), the calendar the invoice date comes from.
 */
export function autoCancelWindowError(autoCancelOn: string, today: string): string | null {
  parseIsoDate(autoCancelOn);
  const latest = addDays(today, AUTO_CANCEL_MAX_DAYS_AHEAD);
  if (autoCancelOn <= today) return `the AUTO_CANCEL date ${autoCancelOn} is not after today (${today})`;
  if (autoCancelOn > latest) return `the AUTO_CANCEL date ${autoCancelOn} is more than 30 days out`;
  return null;
}

/** True when `name` is a register §8 item label. */
export function isInvoiceItemLabel(name: unknown): name is string {
  return typeof name === "string" && name.trim() === name && INVOICE_ITEM_LABEL.test(name);
}

function quoteCents(value: unknown, what: string): bigint {
  check(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${what} must be non-negative integer cents`,
  );
  return BigInt(value);
}

/**
 * The quote's three lines, always three, in quote order (architecture §6.2: the items deep-equal the
 * quote). A zero line stays a 0.00 line rather than changing the invoice's shape, as WS-CORE's
 * `invoiceEqualsQuote` expects. The quote must belong to this run's card and lot, its lines must sum
 * to its total and agree with its pools; nothing here adjusts a figure.
 */
function quoteItems(run: InvoiceRun): { items: CreateInvoiceItem[]; totalCents: bigint } {
  const { quote } = run;
  check(quote.currency === "USD", `Invoices are USD only (sandbox accounts are US): ${quote.currency}`);
  check(quote.rateCardSha256 === run.rateCardSha256, "The quote was computed from another rate card");
  check(quote.lotCode === run.lotCode, "The quote was computed for another lot");
  check(
    Array.isArray(quote.items) && quote.items.length === INVOICE_ITEM_KEYS.length,
    "A quote has exactly three lines",
  );
  const byKey = new Map<QuoteItemKey, bigint>();
  const items = INVOICE_ITEM_KEYS.map((key, i): CreateInvoiceItem => {
    const item = quote.items[i];
    check(item?.key === key, `Quote line ${i + 1} must be ${key}`);
    check(item.quantity === "1", `${key}: the quantity is always 1`);
    check(
      isInvoiceItemLabel(item.name),
      `${key}: a label is at most 40 letters, spaces or ,'()- (no digits)`,
    );
    const cents = quoteCents(item.unitAmountCents, `${key} amount`);
    byKey.set(key, cents);
    return {
      name: item.name,
      quantity: "1",
      unit_amount: { currency_code: "USD", value: centsToValue(cents) },
      unit_of_measure: "AMOUNT",
    };
  });
  const premium = byKey.get("PREMIUM") ?? 0n;
  const bonus = byKey.get("BONUS") ?? 0n;
  const disbursement = byKey.get("DISBURSEMENT") ?? 0n;
  const total = quoteCents(quote.totalCents, "totalCents");
  check(
    premium + bonus + disbursement === total,
    `Quote total ${total} is not the sum of its lines ${premium + bonus + disbursement}`,
  );
  check(total > 0n, "An invoice must ask for more than zero");
  check(
    quoteCents(quote.premiumPoolCents, "premiumPoolCents") === premium &&
      quoteCents(quote.bonusPoolCents, "bonusPoolCents") === bonus &&
      quoteCents(quote.disbursementCents, "disbursementCents") === disbursement &&
      quoteCents(quote.poolCents, "poolCents") === premium + bonus,
    "The quote's pools disagree with its lines",
  );
  return { items, totalCents: total };
}

/** Builds every code-owned field of the invoice for one run (no IO, no clock, no date). */
export function buildInvoicePlan(run: InvoiceRun, context: { businessEmail: string }): InvoicePlan {
  check(EMAIL.test(context.businessEmail), "The invoicer must be the business account's e-mail");
  check(EMAIL.test(run.payer.email), "The payer e-mail is not an e-mail address");
  check(run.payer.businessName.trim().length > 0, "The payer needs a business name");
  const invoiceNumber = invoiceNumberFor(run.seasonCode, run.runSeq);
  const reference = rateCardReference(run.rateCardSha256);
  check(reference.length <= REFERENCE_MAX, "reference too long");
  const note = invoiceMemo(run.seasonCode, run.rateCardSha256, run.lotCode);
  const { items, totalCents } = quoteItems(run);
  return {
    runId: run.runId,
    invoiceNumber,
    reference,
    note,
    totalCents,
    createArgs: {
      currency_code: "USD",
      invoice_number: invoiceNumber,
      reference,
      note,
      invoicer_email_address: context.businessEmail,
      primary_recipients: [
        { billing_info: { business_name: run.payer.businessName, email_address: run.payer.email } },
      ],
      items,
    },
  };
}

/** Builds the PayPal-Request-Id for a conditional rule (register §8). */
export const conditionalRuleRequestId = (invoiceId: string): string => `cr-${invoiceId}`;

/** The AUTO_CANCEL rule (register §8): SPECIFIC_DATE, sent under request id `cr-{invoiceId}`. */
export function autoCancelRuleArgs(invoiceId: string, autoCancelOn: string) {
  parseIsoDate(autoCancelOn);
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

export type DraftReconciliation = { ok: true; args: CreateInvoiceArgs } | { ok: false; mismatches: string[] };

/** Item fields a draft may carry; each must equal the code-built line exactly (names included). */
const ITEM_FIELDS = ["name", "quantity", "unit_amount", "unit_of_measure"] as const;
const ITEM_FIELD_SET: ReadonlySet<string> = new Set(ITEM_FIELDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Invariant I1 at the money edge: the agent writes no number and no free text. Accepts the agent's
 * create_invoice draft only if it passes the toolkit's own schema, every field equals the code-built
 * invoice (currency, number, reference, invoicer, recipients, and all three items with their names,
 * quantities and amounts), no other field is set (no date, shipping, tip, partial payment,
 * pay-by-bank, discount, tax or description, at any depth: the draft is compared as written, so a
 * key the schema would strip still counts), and the note is the code-rendered memo, optionally closed
 * by one phrase from INVOICE_NOTE_CLOSINGS. Returns the plan's arguments carrying the chosen note.
 */
export function reconcileAgentDraft(draft: unknown, plan: InvoicePlan): DraftReconciliation {
  const parsed = toolkitZodSchemas().get("create_invoice")?.safeParse(draft);
  if (!parsed?.success || !isRecord(draft))
    return { ok: false, mismatches: ["draft does not match the toolkit create_invoice schema"] };
  const expected = plan.createArgs as unknown as Record<string, unknown>;
  const mismatches: string[] = [];

  for (const [key, value] of Object.entries(draft)) {
    if (key === "note" || key === "items" || value === undefined) continue;
    if (!(key in expected)) mismatches.push(`${key}: not a field the agent may set`);
    else if (!isDeepStrictEqual(value, expected[key]))
      mismatches.push(`${key}: differs from the code-built invoice`);
  }
  for (const key of Object.keys(expected)) {
    if (key !== "note" && key !== "items" && draft[key] === undefined) mismatches.push(`${key}: missing`);
  }

  const note = typeof draft.note === "string" ? draft.note : null;
  if (note === null || !allowedInvoiceNotes(plan.note).includes(note)) {
    mismatches.push("note: must be the code-rendered memo, optionally closed by one listed phrase");
  }

  const items = Array.isArray(draft.items) ? (draft.items as unknown[]) : [];
  const wanted = plan.createArgs.items;
  if (items.length !== wanted.length) {
    mismatches.push(`items: ${items.length} lines, the quote has ${wanted.length}`);
  } else {
    items.forEach((raw, i) => {
      const got = isRecord(raw) ? raw : {};
      const want = wanted[i] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(got)) {
        if (value === undefined) continue;
        if (!ITEM_FIELD_SET.has(key)) mismatches.push(`items[${i}].${key}: not a field the agent may set`);
        else if (!isDeepStrictEqual(value, want[key]))
          mismatches.push(`items[${i}].${key}: differs from the quote`);
      }
      for (const key of ITEM_FIELDS) {
        if (got[key] === undefined) mismatches.push(`items[${i}].${key}: missing`);
      }
    });
  }

  if (mismatches.length > 0 || note === null) return { ok: false, mismatches };
  return { ok: true, args: { ...plan.createArgs, note } };
}
