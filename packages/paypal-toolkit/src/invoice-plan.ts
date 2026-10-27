// The code-owned invoice (register §8; the approved plan's "PayPal integration contract"; S3
// §S3.6.3). Every field PayPal sees comes from WS-CORE's `canonicalInvoiceCall(method, expected,
// labels)`, built from the run and the code-computed quote alone. invoice_date and payment_term are
// never sent: PayPal dates the invoice itself, so sending can never schedule it, and the AUTO_CANCEL
// date follows the date PayPal holds (C-27). The agent contributes one thing only: the three item
// labels (the plan: "Item names: Claude's recorded labels"; S4.4 `canonicalInvoice(quote, labels)`),
// which core checks against each line's closed vocabulary, so they can spell no number, link or
// address (I1). The note is the memo, exactly.

import type { InvoiceQuote } from "@fairsplit/contracts";
import {
  AUTO_CANCEL_MAX_DAYS_AHEAD,
  type CanonicalInvoice,
  type CanonicalInvoiceCall,
  type CanonicalInvoiceItem,
  canonicalInvoiceCall,
  canonicalSend,
  type InvoiceExpectation,
  type ItemLabels,
  isAsciiEmail,
  itemLabelProblem,
  jcsSha256,
  QUOTE_ITEM_KEYS,
} from "@fairsplit/domain";
import { addDays, parseIsoDate } from "./dates.js";

/** PayPal Invoicing v2 limits (invoicing_v2.json): invoice_number ≤ 25, reference ≤ 120. */
export const INVOICE_NUMBER_MAX = 25;
export const REFERENCE_MAX = 120;

/** Exactly the toolkit 1.11.0 `create_invoice` arguments we send (core `CanonicalInvoice`). */
export type CreateInvoiceArgs = CanonicalInvoice;
export type CreateInvoiceItem = CanonicalInvoiceItem;

/**
 * sha256 (lowercase hex) of the JCS of core's `canonicalSend(invoiceId)`, `{invoice_id,
 * send_to_recipient: false}`: the exact send a treasurer approval binds.
 */
export function sendArgsSha256(invoiceId: string): string {
  return jcsSha256(canonicalSend(invoiceId));
}

/**
 * sendNeedsTreasurer: Analyn's approval (or Judge-as-Treasurer, labelled) to send ONE invoice. It
 * names the run's invoice number. Given for an invoice that already exists (always so for the
 * agent's send_invoice), it is bound to that invoice: PayPal's invoice id and `sendArgsSha256` of the
 * exact send. Only the server chain may hold an approval given before the invoice existed, which
 * names the number alone. It never sends any other invoice.
 */
export interface TreasurerApproval {
  approverId: string;
  approvedAt: string;
  /** `FS-{runSlug}` of the invoice this approval sends. */
  invoiceNumber: string;
  /** PayPal's id of that invoice, when it existed at approval time; then it must match. */
  invoiceId?: string | null;
  /** `sendArgsSha256(invoiceId)`: carried with `invoiceId`, never without it. */
  sendArgsSha256?: string | null;
}

/** The treasurer's approval of sending one existing invoice, bound to it and to the exact send. */
export function invoiceSendApproval(approval: {
  approverId: string;
  approvedAt: string;
  invoiceNumber: string;
  invoiceId: string;
}): TreasurerApproval {
  return { ...approval, sendArgsSha256: sendArgsSha256(approval.invoiceId) };
}

/**
 * True only when the approval names exactly this invoice. An invoice id and a send hash come together
 * and must both match this invoice's; `bound` (the agent's send) requires them. Without `bound`, an
 * approval given before the invoice existed may name its number alone.
 */
export function approvalCovers(
  approval: TreasurerApproval | null | undefined,
  invoice: { invoiceNumber: string; invoiceId: string | null },
  options: { bound?: boolean } = {},
): boolean {
  if (!approval || typeof approval.approverId !== "string" || approval.approverId.length === 0) return false;
  if (approval.invoiceNumber !== invoice.invoiceNumber) return false;
  const named = approval.invoiceId != null;
  if (named !== (approval.sendArgsSha256 != null)) return false;
  if (!named) return options.bound !== true;
  return (
    invoice.invoiceId !== null &&
    approval.invoiceId === invoice.invoiceId &&
    approval.sendArgsSha256 === sendArgsSha256(invoice.invoiceId)
  );
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

/**
 * The code-built invoice for one run. It carries no date: the AUTO_CANCEL date is the date PayPal
 * gives the invoice + 25 days (core `autoCancelDate`), and there is no due date at all, because
 * toolkit 1.11.0 cannot send a payment_term and nothing PayPal does not hold may look like one (I8).
 */
export interface InvoicePlan {
  runId: string;
  invoiceNumber: string;
  reference: string;
  /** The memo, e.g. "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03". */
  note: string;
  totalCents: bigint;
  /**
   * What code builds every invoice call from (core `InvoiceExpectation`): the quote, the invoice
   * number, reference and memo, the business account as invoicer and the brand as the one payer.
   */
  expected: InvoiceExpectation;
  /** Core `canonicalInvoiceCall("create_invoice", expected)`: the quote's own names as item names. */
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

function quoteCents(value: unknown, what: string): bigint {
  check(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${what} must be non-negative integer cents`,
  );
  return BigInt(value);
}

/**
 * The quote's three lines, always three, in quote order (architecture §6.2: the items deep-equal the
 * quote). A zero line stays a 0.00 line rather than changing the invoice's shape, as core's
 * `invoiceEqualsQuote` expects. The quote must belong to this run's card and lot, its lines must sum
 * to its total and agree with its pools, and its own names must be labels core accepts for their
 * lines (the server chain sends them when the agent gives none); nothing here adjusts a figure.
 */
function quoteTotal(run: InvoiceRun): bigint {
  const { quote } = run;
  check(quote.currency === "USD", `Invoices are USD only (sandbox accounts are US): ${quote.currency}`);
  check(quote.rateCardSha256 === run.rateCardSha256, "The quote was computed from another rate card");
  check(quote.lotCode === run.lotCode, "The quote was computed for another lot");
  check(
    Array.isArray(quote.items) && quote.items.length === QUOTE_ITEM_KEYS.length,
    "A quote has exactly three lines",
  );
  const cents = QUOTE_ITEM_KEYS.map((key, i) => {
    const item = quote.items[i];
    check(item?.key === key, `Quote line ${i + 1} must be ${key}`);
    check(item.quantity === "1", `${key}: the quantity is always 1`);
    return quoteCents(item.unitAmountCents, `${key} amount`);
  });
  const names = itemLabelProblem(
    quote.items.map((item) => item.name),
    quote.items.map((item) => item.key),
  );
  check(names === null, `The quote's line labels: ${names}`);
  const [premium = 0n, bonus = 0n, disbursement = 0n] = cents;
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
  return total;
}

/**
 * Builds the code's expectation for one run and core's create body from it (no IO, no clock, no
 * date). The invoicer and the payer must be strict printable-ASCII e-mails, as the policy lattice
 * compares them (core `isAsciiEmail`).
 */
export function buildInvoicePlan(run: InvoiceRun, context: { businessEmail: string }): InvoicePlan {
  check(isAsciiEmail(context.businessEmail), "The invoicer must be the business account's e-mail");
  check(isAsciiEmail(run.payer.email), "The payer e-mail is not an e-mail address");
  check(run.payer.businessName.trim().length > 0, "The payer needs a business name");
  const invoiceNumber = invoiceNumberFor(run.seasonCode, run.runSeq);
  const reference = rateCardReference(run.rateCardSha256);
  check(reference.length <= REFERENCE_MAX, "reference too long");
  const note = invoiceMemo(run.seasonCode, run.rateCardSha256, run.lotCode);
  const totalCents = quoteTotal(run);
  const expected: InvoiceExpectation = {
    quote: run.quote,
    invoiceNumber,
    reference,
    memo: note,
    businessEmail: context.businessEmail,
    payer: { email: run.payer.email, businessName: run.payer.businessName },
  };
  const create = canonicalInvoiceCall("create_invoice", { ...expected, invoiceId: null, invoiceDate: null });
  check(create.ok && create.method === "create_invoice", `The quote cannot be invoiced: ${reasonOf(create)}`);
  return { runId: run.runId, invoiceNumber, reference, note, totalCents, expected, createArgs: create.args };
}

const reasonOf = (call: CanonicalInvoiceCall): string => (call.ok ? "" : call.reason);

/** Builds the PayPal-Request-Id for a conditional rule (register §8). */
export const conditionalRuleRequestId = (invoiceId: string): string => `cr-${invoiceId}`;

// ---------------------------------------------------------------- what the model's arguments may say

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** A path as audit text: `items[0].unit_amount.value`, other keys quoted. */
function pathText(path: readonly (string | number)[]): string {
  let out = "";
  for (const s of path) {
    if (typeof s === "number") out += `[${s}]`;
    else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) out += out === "" ? s : `.${s}`;
    else out += `[${JSON.stringify(s)}]`;
  }
  return out || "(body)";
}

/**
 * Where the model's arguments differ from the canonical body, by path: a key the body does not carry,
 * a key it carries that is missing, and any other difference of type, length or value. Strings are
 * compared code unit for code unit (no trim, case folding or normalisation), so "any byte" differs.
 * Key order carries no meaning in JSON and is not compared. It descends only while both sides nest,
 * so its depth is the canonical body's, whatever the model wrote. Empty: the two are the same JSON.
 */
export function draftDifferences(draft: unknown, canonical: unknown): string[] {
  const out: string[] = [];
  const walk = (a: unknown, b: unknown, path: (string | number)[]): void => {
    if (isRecord(a) && isRecord(b)) {
      for (const k of Object.keys(a)) {
        if (!Object.hasOwn(b, k)) out.push(`${pathText([...path, k])}: not in the canonical body`);
      }
      for (const k of Object.keys(b)) {
        if (!Object.hasOwn(a, k)) out.push(`${pathText([...path, k])}: missing`);
        else walk(a[k], b[k], [...path, k]);
      }
    } else if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        out.push(`${pathText(path)}: ${a.length} entries, the canonical body has ${b.length}`);
      } else {
        a.forEach((x, i) => {
          walk(x, b[i], [...path, i]);
        });
      }
    } else if (a !== b) {
      out.push(`${pathText(path)}: differs from the canonical body`);
    }
  };
  walk(draft, canonical, []);
  return out;
}

/** The labels a model's create_invoice arguments carry, and the body code builds from them. */
export type AgentCreateRead =
  | { ok: true; labels: readonly string[] | ItemLabels; args: CreateInvoiceArgs }
  | { ok: false; mismatches: string[] };

const KEYED_FORM: ReadonlySet<string> = new Set(["item_labels", "run_id"]);

/**
 * I1 at the money edge: what the model's create_invoice arguments may say. Either S4.4's
 * `{item_labels: {premium, bonus, disbursement}}` (with this run's `run_id`, if any), or a toolkit
 * draft that is, byte for byte, core's canonical body for the item names it carries. Anything else
 * (another amount, a date, a tip, free text, an extra key, a key missing…) is refused, and the model's
 * arguments are never what is sent: the body is `canonicalInvoiceCall`'s, built from the run, and the
 * labels are checked by core's closed per-line vocabulary.
 */
export function readAgentCreate(input: unknown, plan: InvoicePlan, runId: string): AgentCreateRead {
  const build = (labels: readonly unknown[] | ItemLabels): AgentCreateRead => {
    const call = canonicalInvoiceCall(
      "create_invoice",
      { ...plan.expected, invoiceId: null, invoiceDate: null },
      labels as readonly string[] | ItemLabels,
    );
    if (!call.ok || call.method !== "create_invoice")
      return { ok: false, mismatches: [`items: ${reasonOf(call)}`] };
    return { ok: true, labels: labels as readonly string[] | ItemLabels, args: call.args };
  };
  if (!isRecord(input)) return { ok: false, mismatches: ["(body): not an object"] };
  if (Object.hasOwn(input, "item_labels")) {
    const stray = Object.keys(input).filter((k) => !KEYED_FORM.has(k));
    if (stray.length > 0)
      return { ok: false, mismatches: stray.map((k) => `${pathText([k])}: not an input`) };
    if (Object.hasOwn(input, "run_id") && input.run_id !== runId) {
      return { ok: false, mismatches: ["run_id: not this run"] };
    }
    const labels = input.item_labels;
    if (!isRecord(labels))
      return { ok: false, mismatches: ["item_labels: not keyed premium, bonus, disbursement"] };
    return build(labels as unknown as ItemLabels);
  }
  const items = input.items;
  const names = Array.isArray(items) ? items.map((item) => (isRecord(item) ? item.name : undefined)) : [];
  const built = build(names);
  if (!built.ok) return built;
  const differences = draftDifferences(input, built.args);
  return differences.length === 0 ? built : { ok: false, mismatches: differences };
}
