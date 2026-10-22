// The code-owned invoice (register §8, S3 §S3.6.3). Every field PayPal sees is derived here from
// the run and the code-computed quote; the agent may contribute wording only (invariant I1).

import { isDeepStrictEqual } from "node:util";
import type { InvoiceQuote } from "./_shims/domain.js";
import type { TreasurerApproval } from "./agent.js";
import { addDays, parseIsoDate } from "./dates.js";
import { centsToValue } from "./money.js";
import { toolkitZodSchemas } from "./schemas.js";

/** Register C-27: auto-cancel on the invoice date + 25 days ("30 Nov" is showcase copy only). */
export const AUTO_CANCEL_AFTER_DAYS = 25;
/** PayPal Invoicing v2 limits (invoicing_v2.json): invoice_number ≤ 25, reference ≤ 120. */
export const INVOICE_NUMBER_MAX = 25;
export const REFERENCE_MAX = 120;

/** Item wording for the code-built invoice (S3 §S3.6.3). */
export const INVOICE_ITEM_NAMES = {
  premium: "Premium",
  bonus: "Quality bonus",
  disbursement: "Disbursement costs",
} as const;

export interface InvoicePayer {
  businessName: string;
  email: string;
}

/** IC-06 input: what `Invoices.ensureForRun` needs to know about a pay run. Plain data. */
export interface InvoiceRun {
  runId: string;
  /** From the global `fs_run_seq`, never reset. */
  runSeq: number;
  /** "2026-A"; its ID code ("2026A") is derived. */
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
  description?: string;
  quantity: string;
  unit_amount: { currency_code: "USD"; value: string };
  unit_of_measure: "AMOUNT";
}

/** Exactly the toolkit 1.11.0 `create_invoice` arguments we send. */
export interface CreateInvoiceArgs {
  currency_code: "USD";
  invoice_number: string;
  invoice_date: string;
  reference: string;
  note: string;
  invoicer_email_address: string;
  primary_recipients: { billing_info: { business_name: string; email_address: string } }[];
  items: CreateInvoiceItem[];
}

export interface InvoicePlan {
  runId: string;
  invoiceNumber: string;
  reference: string;
  /** The memo, e.g. "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03". */
  note: string;
  invoiceDate: string;
  autoCancelOn: string;
  /**
   * The last day the invoice can be paid. Toolkit 1.11.0's create_invoice has no payment_term,
   * so PayPal applies its default term; Fair Split's effective due date is the AUTO_CANCEL date.
   */
  dueDate: string;
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
const DIGIT = /\p{Nd}/u;

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

export function autoCancelDate(invoiceDate: string): string {
  return addDays(invoiceDate, AUTO_CANCEL_AFTER_DAYS);
}

function quoteItems(quote: InvoiceQuote): CreateInvoiceItem[] {
  check(quote.currency === "USD", `Invoices are USD only (sandbox accounts are US): ${quote.currency}`);
  const parts = [
    [INVOICE_ITEM_NAMES.premium, quote.premiumCents],
    [INVOICE_ITEM_NAMES.bonus, quote.bonusCents],
    [INVOICE_ITEM_NAMES.disbursement, quote.disbursementCents],
  ] as const;
  let sum = 0n;
  const items: CreateInvoiceItem[] = [];
  for (const [name, cents] of parts) {
    check(typeof cents === "bigint" && cents >= 0n, `${name} must be a non-negative bigint of cents`);
    sum += cents;
    // A zero component is left off the invoice rather than shown as a 0.00 line.
    if (cents > 0n) {
      items.push({
        name,
        quantity: "1",
        unit_amount: { currency_code: "USD", value: centsToValue(cents) },
        unit_of_measure: "AMOUNT",
      });
    }
  }
  check(sum === quote.totalCents, `Quote total ${quote.totalCents} is not the sum of its parts ${sum}`);
  check(sum > 0n, "An invoice must ask for more than zero");
  return items;
}

/** Builds every code-owned field of the invoice for one run (no IO, no clock). */
export function buildInvoicePlan(
  run: InvoiceRun,
  context: { invoiceDate: string; businessEmail: string },
): InvoicePlan {
  parseIsoDate(context.invoiceDate);
  check(EMAIL.test(context.businessEmail), "The invoicer must be the business account's e-mail");
  check(EMAIL.test(run.payer.email), "The payer e-mail is not an e-mail address");
  check(run.payer.businessName.trim().length > 0, "The payer needs a business name");
  const invoiceNumber = invoiceNumberFor(run.seasonCode, run.runSeq);
  const reference = rateCardReference(run.rateCardSha256);
  check(reference.length <= REFERENCE_MAX, "reference too long");
  const note = invoiceMemo(run.seasonCode, run.rateCardSha256, run.lotCode);
  const autoCancelOn = autoCancelDate(context.invoiceDate);
  const items = quoteItems(run.quote);
  return {
    runId: run.runId,
    invoiceNumber,
    reference,
    note,
    invoiceDate: context.invoiceDate,
    autoCancelOn,
    dueDate: autoCancelOn,
    totalCents: run.quote.totalCents,
    createArgs: {
      currency_code: "USD",
      invoice_number: invoiceNumber,
      invoice_date: context.invoiceDate,
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

/** Fields of the agent's draft that are free text; everything else must equal the code-built invoice. */
const FREE_TEXT_FIELDS = new Set(["note", "items"]);
const FREE_TEXT_ITEM_FIELDS = new Set(["name", "description"]);
const REQUIRED_ITEM_FIELDS = ["quantity", "unit_amount", "unit_of_measure"] as const;

/**
 * Invariant I1 at the money edge: the agent writes words, code writes numbers. Accepts the agent's
 * create_invoice draft only if every code-owned field (currency, number, dates, reference,
 * invoicer, recipients, quantities, amounts) equals the plan, the note contains the code-rendered
 * memo, and no agent-written text contains a digit. Returns the plan's arguments carrying the
 * agent's wording.
 */
export function reconcileAgentDraft(draft: unknown, plan: InvoicePlan): DraftReconciliation {
  const parsed = toolkitZodSchemas().get("create_invoice")?.safeParse(draft);
  if (!parsed?.success)
    return { ok: false, mismatches: ["draft does not match the toolkit create_invoice schema"] };
  const d = parsed.data as Record<string, unknown>;
  const expected = plan.createArgs as unknown as Record<string, unknown>;
  const mismatches: string[] = [];

  for (const [key, value] of Object.entries(d)) {
    if (FREE_TEXT_FIELDS.has(key) || value === undefined) continue;
    if (!(key in expected)) mismatches.push(`${key}: not a field the agent may set`);
    else if (!isDeepStrictEqual(value, expected[key]))
      mismatches.push(`${key}: differs from the code-built invoice`);
  }
  for (const key of Object.keys(expected)) {
    if (!FREE_TEXT_FIELDS.has(key) && d[key] === undefined) mismatches.push(`${key}: missing`);
  }

  const note = typeof d.note === "string" ? d.note : "";
  if (!note.includes(plan.note)) mismatches.push("note: must contain the code-rendered memo");
  else if (DIGIT.test(note.replace(plan.note, "")))
    mismatches.push("note: agent-written text may not contain digits");

  const items = Array.isArray(d.items) ? (d.items as Record<string, unknown>[]) : [];
  const wanted = plan.createArgs.items;
  if (items.length !== wanted.length) {
    mismatches.push(`items: ${items.length} lines, the quote has ${wanted.length}`);
  } else {
    items.forEach((got, i) => {
      const want = wanted[i] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(got)) {
        if (FREE_TEXT_ITEM_FIELDS.has(key) || value === undefined) continue;
        if (!(key in want)) mismatches.push(`items[${i}].${key}: not a field the agent may set`);
        else if (!isDeepStrictEqual(value, want[key]))
          mismatches.push(`items[${i}].${key}: differs from the quote`);
      }
      for (const key of REQUIRED_ITEM_FIELDS) {
        if (got[key] === undefined) mismatches.push(`items[${i}].${key}: missing`);
      }
      for (const key of FREE_TEXT_ITEM_FIELDS) {
        const text = got[key];
        if (typeof text === "string" && DIGIT.test(text)) {
          mismatches.push(`items[${i}].${key}: agent-written text may not contain digits`);
        }
      }
      if (typeof got.name !== "string" || got.name.trim().length === 0)
        mismatches.push(`items[${i}].name: missing`);
    });
  }

  if (mismatches.length > 0) return { ok: false, mismatches };
  return {
    ok: true,
    args: {
      ...plan.createArgs,
      note,
      items: wanted.map((want, i) => {
        const got = items[i] as Record<string, unknown>;
        const description = typeof got.description === "string" ? got.description : undefined;
        return { ...want, name: String(got.name), ...(description ? { description } : {}) };
      }),
    },
  };
}
