// Invoicing v2 steps, each a single toolkit call with a body code built (I1): IC-02 `canonicalInvoice` for the
// create (the agent may choose only the three item labels), `canonicalSend` (send_to_recipient false),
// `autoCancelRuleArgs` (SPECIFIC_DATE at PayPal's invoice date + 25 days, request id `cr-{invoiceId}`), and the
// Judge Mode payment record ("Sandbox: marked as paid (simulated rail)"). No step holds a database
// transaction open across PayPal: callers checkpoint before and after (S3.6.3, S3.10).
import type { InvoiceStatus } from "@fairsplit/contracts";
import { InvoiceStatus as InvoiceStatusSchema } from "@fairsplit/contracts";
import {
  autoCancelDate,
  autoCancelRuleArgs,
  canonicalInvoice,
  canonicalSend,
  minorToDecimal,
  parseDecimalMinor,
  parseStrictIsoDate,
} from "@fairsplit/domain";
import {
  conditionalRuleRequestId,
  invoiceIdFromCreate,
  payerViewUrlFromSend,
  RECORD_PAYMENT_NOTE,
  type Tk,
  ToolkitError,
} from "@fairsplit/paypal-toolkit";
import { classifyPayPal, PayPalStepError } from "./errors.js";
import type { InvoiceWorld } from "./policy.js";

interface InvoiceLike {
  id?: unknown;
  status?: unknown;
  detail?: {
    invoice_number?: unknown;
    reference?: unknown;
    currency_code?: unknown;
    invoice_date?: unknown;
    metadata?: { recipient_view_url?: unknown };
  };
  invoicer?: { email_address?: unknown };
  primary_recipients?: { billing_info?: { email_address?: unknown } }[];
  amount?: { currency_code?: unknown; value?: unknown };
  due_amount?: { value?: unknown };
}

/** What a fresh GET of the invoice says (S3.5: the only funding evidence). */
export interface InvoiceSnapshot {
  invoiceId: string;
  /** PayPal's status when it is one we know; null otherwise (an unknown status changes nothing). */
  status: InvoiceStatus | null;
  rawStatus: string | null;
  invoiceNumber: string | null;
  reference: string | null;
  totalCents: number | null;
  dueCents: number | null;
  invoiceDate: string | null;
  payerViewUrl: string | null;
  invoicer: string | null;
  recipients: string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function snapshotOf(invoiceId: string, inv: InvoiceLike | null | undefined): InvoiceSnapshot {
  const raw = str(inv?.status);
  const parsed = InvoiceStatusSchema.safeParse(raw);
  const total = str(inv?.amount?.value);
  const due = str(inv?.due_amount?.value);
  return {
    invoiceId,
    status: parsed.success ? parsed.data : null,
    rawStatus: raw,
    invoiceNumber: str(inv?.detail?.invoice_number),
    reference: str(inv?.detail?.reference),
    totalCents: total === null ? null : parseDecimalMinor(total),
    dueCents: due === null ? null : parseDecimalMinor(due),
    invoiceDate: parseStrictIsoDate(inv?.detail?.invoice_date),
    payerViewUrl: str(inv?.detail?.metadata?.recipient_view_url),
    invoicer: str(inv?.invoicer?.email_address),
    recipients: (inv?.primary_recipients ?? [])
      .map((r) => str(r?.billing_info?.email_address))
      .filter((e): e is string => e !== null),
  };
}

/** Register §8 funding rule: PAID or MARKED_AS_PAID with 0.00 due, on a fresh GET. */
export function isFunded(s: InvoiceSnapshot): boolean {
  return (s.status === "PAID" || s.status === "MARKED_AS_PAID") && s.dueCents === 0;
}

/** SENT, UNPAID, SHARED (or already paid): the invoice is in the payer's hands. */
export const PAYABLE: ReadonlySet<string> = new Set([
  "SENT",
  "UNPAID",
  "SHARED",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "MARKED_AS_PAID",
]);

export async function getInvoice(tk: Tk, invoiceId: string): Promise<InvoiceSnapshot> {
  try {
    return snapshotOf(invoiceId, await tk<InvoiceLike>("get_invoice", { invoice_id: invoiceId }));
  } catch (e) {
    throw classifyPayPal(e, "the invoice status check");
  }
}

/** Only our own invoice is ever adopted: number, reference, total, invoicer and the one recipient all match. */
function adoptable(s: InvoiceSnapshot, w: InvoiceWorld): string | null {
  const e = w.expected;
  if (s.invoiceNumber !== e.invoiceNumber) return "it carries another invoice number";
  if (s.reference !== e.reference) return "it carries another reference";
  if (s.totalCents !== w.quote.totalCents) return "it asks for another total";
  if (s.invoicer?.toLowerCase() !== e.businessEmail.toLowerCase()) return "another account is the invoicer";
  if (s.recipients.length !== 1 || s.recipients[0]?.toLowerCase() !== e.payer.email.toLowerCase())
    return "it is addressed to someone else";
  if (s.rawStatus === null || !["DRAFT", ...PAYABLE].includes(s.rawStatus))
    return `its status is ${s.rawStatus ?? "unknown"}`;
  return null;
}

/**
 * create_invoice with the canonical body. On a failure or timeout PayPal may still hold it: search by number
 * and adopt only our own (never parse the duplicate-number error, whose text is unverified).
 */
export async function createOrAdopt(
  tk: Tk,
  w: InvoiceWorld,
  labels?: readonly string[],
): Promise<{ invoiceId: string; adopted: boolean; body: ReturnType<typeof canonicalInvoice> }> {
  const body = canonicalInvoice(w.expected, labels);
  let failure: unknown;
  try {
    const created = await tk<unknown>("create_invoice", body);
    const invoiceId = invoiceIdFromCreate(created);
    if (invoiceId) return { invoiceId, adopted: false, body };
    failure = new PayPalStepError("QUEUED", "PayPal created the invoice without a readable id; checking.", {
      transient: true,
      retryAfterMs: 5_000,
    });
  } catch (e) {
    if (!(e instanceof ToolkitError)) throw classifyPayPal(e, "creating the invoice");
    failure = e;
  }
  let found: { items?: InvoiceLike[] } | null = null;
  try {
    found = await tk<{ items?: InvoiceLike[] }>("search_invoicing", {
      resource_type: "invoice",
      invoice_filters: { invoice_number: w.expected.invoiceNumber },
    });
  } catch {
    throw classifyPayPal(failure, "creating the invoice");
  }
  const matches = (found?.items ?? []).filter((i) => i?.detail?.invoice_number === w.expected.invoiceNumber);
  const candidate = matches.length === 1 ? str(matches[0]?.id) : null;
  if (!candidate) throw classifyPayPal(failure, "creating the invoice");
  const snapshot = await getInvoice(tk, candidate);
  const why = adoptable(snapshot, w);
  if (why) {
    throw new PayPalStepError(
      "PAYPAL_REJECTED",
      `${w.expected.invoiceNumber} exists at PayPal but is not ours: ${why}.`,
      {
        transient: false,
      },
    );
  }
  return { invoiceId: candidate, adopted: true, body };
}

/** send_invoice {send_to_recipient: false}; a send that may have happened is checked with a GET (S3.10). */
export async function sendInvoice(tk: Tk, invoiceId: string): Promise<{ payerViewUrl: string | null }> {
  try {
    return {
      payerViewUrl: payerViewUrlFromSend(await tk<unknown>("send_invoice", canonicalSend(invoiceId))),
    };
  } catch (e) {
    if (!(e instanceof ToolkitError)) throw classifyPayPal(e, "sending the invoice");
    const s = await getInvoice(tk, invoiceId);
    if (s.rawStatus && PAYABLE.has(s.rawStatus)) return { payerViewUrl: s.payerViewUrl };
    throw classifyPayPal(e, "sending the invoice");
  }
}

/** The AUTO_CANCEL rule (C-27): PayPal's invoice date + 25 days, request id `cr-{invoiceId}`. */
export async function addAutoCancelRule(tk: Tk, invoiceId: string, invoiceDate: string): Promise<string> {
  const on = autoCancelDate(invoiceDate);
  try {
    await tk(
      "create_conditional_rules_for_invoice",
      autoCancelRuleArgs(invoiceId, on),
      conditionalRuleRequestId(invoiceId),
    );
    return on;
  } catch (e) {
    throw classifyPayPal(e, "the auto-cancel rule");
  }
}

/** Judge Mode funding (C-14): record_payment_for_invoice, BANK_TRANSFER, the full total, no payment_date. */
export async function recordPayment(
  tk: Tk,
  invoiceId: string,
  totalCents: number,
): Promise<{ paymentId: string | null }> {
  try {
    const res = await tk<{ payment_id?: unknown }>("record_payment_for_invoice", {
      invoice_id: invoiceId,
      method: "BANK_TRANSFER",
      amount: { currency_code: "USD", value: minorToDecimal(totalCents) },
      note: RECORD_PAYMENT_NOTE,
    });
    return { paymentId: str(res?.payment_id) };
  } catch (e) {
    throw classifyPayPal(e, "recording the payment");
  }
}

/** The canonical create body, for the agent's tool and the tamper demo. */
export { canonicalInvoice };
