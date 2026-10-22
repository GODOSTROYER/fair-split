// IC-06 Invoices: the checkpointed invoice chain (S3 §S3.6.3). create → send → AUTO_CANCEL rule,
// each step stored before the next, so a retried task resumes where it stopped. Every call goes
// through tk(), i.e. the toolkit's PayPalAPI on our token (graft G1).

import type { Provenance } from "./_shims/contracts.js";
import type { CallPriority } from "./_shims/paypal-core.js";
import type { ToolkitMethod } from "./actions.js";
import { conditionalRuleRequestId } from "./agent.js";
import { utcDate } from "./dates.js";
import {
  autoCancelRuleArgs,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  type InvoicePlan,
  type InvoiceRun,
  reconcileAgentDraft,
} from "./invoice-plan.js";
import { centsToValue, readValueCents } from "./money.js";
import { type Tk, ToolkitError } from "./tk.js";

/** What `ensureInvoice` has already done for a run (one row, keyed by run). */
export interface InvoiceCheckpoint {
  invoiceId: string | null;
  invoiceNumber: string | null;
  adopted: boolean;
  invoiceDate: string | null;
  sentAt: string | null;
  payerViewUrl: string | null;
  autoCancelOn: string | null;
  ruleSetAt: string | null;
  paymentAttemptedAt: string | null;
  paymentRecordedAt: string | null;
  paymentId: string | null;
}

export const EMPTY_INVOICE_CHECKPOINT: Readonly<InvoiceCheckpoint> = Object.freeze({
  invoiceId: null,
  invoiceNumber: null,
  adopted: false,
  invoiceDate: null,
  sentAt: null,
  payerViewUrl: null,
  autoCancelOn: null,
  ruleSetAt: null,
  paymentAttemptedAt: null,
  paymentRecordedAt: null,
  paymentId: null,
});

/** IC-04 scoped repository port (TEMPORARY until WS-DATA's `invoices` repository lands). */
export interface InvoiceRepository {
  load(runId: string): Promise<Partial<InvoiceCheckpoint> | null>;
  save(runId: string, patch: Partial<InvoiceCheckpoint>): Promise<void>;
}

export interface InvoicesDeps {
  tk: Tk;
  repo: InvoiceRepository;
  /** PP_BUSINESS_EMAIL: the co-op's business account, invoicer and payout sender. */
  businessEmail: string;
  now?: () => Date;
  /**
   * Whether the AUTO_CANCEL rule goes on before the send. The register orders create → send →
   * rule; spike S2 settles whether PayPal accepts a rule after send. Default false.
   */
  ruleBeforeSend?: boolean;
}

export interface EnsureInvoiceOptions {
  /** The audit agent's create_invoice draft: its wording is used, its numbers must equal ours (I1). */
  draft?: unknown;
  priority?: CallPriority;
}

export interface EnsureInvoiceResult {
  status: "SENT" | "PENDING_APPROVAL";
  invoiceId: string;
  invoiceNumber: string;
  adopted: boolean;
  invoiceDate: string;
  payerViewUrl: string | null;
  /** Null until the AUTO_CANCEL rule is stored. */
  autoCancelOn: string | null;
  dueDate: string;
  /** PayPal calls this invocation made (the Judge budget is 11 per live run). */
  calls: number;
}

export interface RecordPaymentResult {
  invoiceId: string;
  recorded: boolean;
  alreadyRecorded: boolean;
  paymentId: string | null;
  /** I8: a recorded payment is a simulated rail, labelled as such. */
  provenance: Extract<Provenance, "simulated_rail">;
  calls: number;
}

export interface FundingCheck {
  state: "FUNDED" | "NOT_YET";
  invoiceStatus: string | null;
  dueCents: bigint | null;
  provenance: Extract<Provenance, "live" | "simulated_rail">;
}

/** The agent's draft broke invariant I1 or the register §8 fields. Nothing was sent. */
export class InvoiceDraftRejectedError extends Error {
  constructor(readonly mismatches: string[]) {
    super(`Agent invoice draft rejected: ${mismatches.join("; ")}`);
    this.name = "InvoiceDraftRejectedError";
  }
}

/** An invoice with our number exists but is not ours to adopt. HALT and alert. */
export class InvoiceAdoptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceAdoptError";
  }
}

/** A step was asked for out of order (e.g. a payment before the invoice exists). */
export class InvoiceStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceStateError";
  }
}

export const RECORD_PAYMENT_NOTE = "Sandbox: marked as paid (simulated rail)";
const FUNDED_STATUSES: ReadonlySet<string> = new Set(["PAID", "MARKED_AS_PAID"]);
const SENT_STATUSES: ReadonlySet<string> = new Set([
  "SENT",
  "UNPAID",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "MARKED_AS_PAID",
  "SHARED",
]);
const INVOICE_ID = /^[A-Za-z0-9_-]{1,127}$/;

interface LinkLike {
  href?: unknown;
  rel?: unknown;
}

interface InvoiceLike {
  id?: unknown;
  status?: unknown;
  detail?: {
    invoice_number?: unknown;
    reference?: unknown;
    invoice_date?: unknown;
    metadata?: { recipient_view_url?: unknown };
  };
  amount?: { value?: unknown };
  due_amount?: { value?: unknown };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function findLink(links: unknown, rel: string): string | null {
  if (!Array.isArray(links)) return null;
  for (const l of links as LinkLike[]) if (l?.rel === rel && typeof l.href === "string") return l.href;
  return null;
}

/** The 201 carries only `{rel:"self", href}` unless return=representation; the ID is the last segment. */
export function invoiceIdFromCreate(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const r = response as { id?: unknown; href?: unknown; links?: unknown };
  const id = str(r.id);
  if (id && INVOICE_ID.test(id)) return id;
  const href = str(r.href) ?? findLink(r.links, "self");
  if (!href) return null;
  try {
    const last = new URL(href).pathname.split("/").filter(Boolean).pop();
    return last && INVOICE_ID.test(last) ? last : null;
  } catch {
    return null;
  }
}

/** send returns a link_description (`rel: "payer-view"`), possibly wrapped in `links`. */
export function payerViewUrlFromSend(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const r = response as { href?: unknown; rel?: unknown; links?: unknown };
  if (typeof r.href === "string" && (r.rel === undefined || r.rel === "payer-view")) return r.href;
  return findLink(r.links, "payer-view");
}

export class Invoices {
  readonly #tk: Tk;
  readonly #repo: InvoiceRepository;
  readonly #businessEmail: string;
  readonly #now: () => Date;
  readonly #ruleBeforeSend: boolean;

  constructor(deps: InvoicesDeps) {
    this.#tk = deps.tk;
    this.#repo = deps.repo;
    this.#businessEmail = deps.businessEmail;
    this.#now = deps.now ?? (() => new Date());
    this.#ruleBeforeSend = deps.ruleBeforeSend ?? false;
  }

  async #checkpoint(runId: string): Promise<InvoiceCheckpoint> {
    return { ...EMPTY_INVOICE_CHECKPOINT, ...((await this.#repo.load(runId)) ?? {}) };
  }

  /** The code-owned invoice for a run, dated from the checkpoint once created (never re-dated). */
  async plan(run: InvoiceRun): Promise<InvoicePlan> {
    const cp = await this.#checkpoint(run.runId);
    return buildInvoicePlan(run, {
      invoiceDate: cp.invoiceDate ?? utcDate(this.#now()),
      businessEmail: this.#businessEmail,
    });
  }

  /**
   * ensureInvoice{target:'SENT'}: create (adopting a duplicate number), send with
   * send_to_recipient false once the treasurer approved, then the AUTO_CANCEL rule.
   */
  async ensureForRun(run: InvoiceRun, options: EnsureInvoiceOptions = {}): Promise<EnsureInvoiceResult> {
    const cp = await this.#checkpoint(run.runId);
    const plan = buildInvoicePlan(run, {
      invoiceDate: cp.invoiceDate ?? utcDate(this.#now()),
      businessEmail: this.#businessEmail,
    });
    if (cp.invoiceNumber && cp.invoiceNumber !== plan.invoiceNumber) {
      throw new InvoiceStateError(
        `Run ${run.runId} already holds ${cp.invoiceNumber}, not ${plan.invoiceNumber}`,
      );
    }
    let args: CreateInvoiceArgs = plan.createArgs;
    if (options.draft !== undefined) {
      const reconciled = reconcileAgentDraft(options.draft, plan);
      if (!reconciled.ok) throw new InvoiceDraftRejectedError(reconciled.mismatches);
      args = reconciled.args;
    }

    let calls = 0;
    const call = <T>(method: ToolkitMethod, callArgs: unknown, requestId?: string): Promise<T> => {
      calls += 1;
      return this.#tk<T>(method, callArgs, requestId, { priority: options.priority });
    };
    const save = (patch: Partial<InvoiceCheckpoint>) => this.#repo.save(run.runId, patch);
    const stamp = () => this.#now().toISOString();

    let { invoiceId, adopted, sentAt, payerViewUrl, ruleSetAt } = cp;
    if (!invoiceId) {
      const created = await this.#createOrAdopt(plan, args, call);
      invoiceId = created.invoiceId;
      adopted = created.adopted;
      await save({ invoiceId, invoiceNumber: plan.invoiceNumber, adopted, invoiceDate: plan.invoiceDate });
      if (created.alreadySent) {
        sentAt = stamp();
        payerViewUrl = created.payerViewUrl;
        await save({ sentAt, payerViewUrl });
      }
    }
    const id = invoiceId;

    const ensureRule = async () => {
      if (ruleSetAt) return;
      await call(
        "create_conditional_rules_for_invoice",
        autoCancelRuleArgs(id, plan.autoCancelOn),
        conditionalRuleRequestId(id),
      );
      ruleSetAt = stamp();
      await save({ ruleSetAt, autoCancelOn: plan.autoCancelOn });
    };

    const result = (status: EnsureInvoiceResult["status"]): EnsureInvoiceResult => ({
      status,
      invoiceId: id,
      invoiceNumber: plan.invoiceNumber,
      adopted,
      invoiceDate: plan.invoiceDate,
      payerViewUrl,
      autoCancelOn: ruleSetAt ? plan.autoCancelOn : null,
      dueDate: plan.dueDate,
      calls,
    });

    if (this.#ruleBeforeSend) await ensureRule();
    if (!sentAt) {
      if (!run.sendApproval) return result("PENDING_APPROVAL");
      payerViewUrl = await this.#send(id, call);
      sentAt = stamp();
      await save({ sentAt, payerViewUrl });
    }
    await ensureRule();
    return result("SENT");
  }

  async #createOrAdopt(
    plan: InvoicePlan,
    args: CreateInvoiceArgs,
    call: <T>(method: ToolkitMethod, args: unknown, requestId?: string) => Promise<T>,
  ): Promise<{ invoiceId: string; adopted: boolean; alreadySent: boolean; payerViewUrl: string | null }> {
    let failure: unknown;
    try {
      const created = await call<unknown>("create_invoice", args);
      const invoiceId = invoiceIdFromCreate(created);
      if (invoiceId) return { invoiceId, adopted: false, alreadySent: false, payerViewUrl: null };
      failure = new InvoiceStateError("create_invoice succeeded without a readable invoice id");
    } catch (error) {
      if (!(error instanceof ToolkitError)) throw error;
      failure = error;
    }
    // S3: on any failure or timeout, search by invoice_number and adopt the match. Never parse the
    // duplicate-number error; its text is unverified.
    let found: { items?: InvoiceLike[] } | null;
    try {
      found = await call<{ items?: InvoiceLike[] }>("search_invoicing", {
        resource_type: "invoice",
        invoice_filters: { invoice_number: plan.invoiceNumber },
      });
    } catch {
      // The create failure is the one to report; a retry of the task searches again.
      throw failure;
    }
    const matches = (found?.items ?? []).filter((i) => i?.detail?.invoice_number === plan.invoiceNumber);
    if (matches.length === 0) throw failure;
    if (matches.length > 1)
      throw new InvoiceAdoptError(`${matches.length} invoices carry ${plan.invoiceNumber}`);
    const match = matches[0] as InvoiceLike;
    const invoiceId = str(match.id);
    if (!invoiceId || !INVOICE_ID.test(invoiceId))
      throw new InvoiceAdoptError("The matching invoice has no usable id");
    const reference = str(match.detail?.reference);
    if (reference !== null && reference !== plan.reference) {
      throw new InvoiceAdoptError(`${plan.invoiceNumber} carries ${reference}, not ${plan.reference}`);
    }
    const total = readValueCents(match.amount?.value);
    if (total !== null && total !== plan.totalCents) {
      throw new InvoiceAdoptError(
        `${plan.invoiceNumber} asks for ${match.amount?.value}, not ${centsToValue(plan.totalCents)}`,
      );
    }
    const status = str(match.status);
    return {
      invoiceId,
      adopted: true,
      alreadySent: status !== null && SENT_STATUSES.has(status),
      payerViewUrl: str(match.detail?.metadata?.recipient_view_url),
    };
  }

  async #send(
    invoiceId: string,
    call: <T>(method: ToolkitMethod, args: unknown, requestId?: string) => Promise<T>,
  ): Promise<string | null> {
    try {
      return payerViewUrlFromSend(
        await call<unknown>("send_invoice", { invoice_id: invoiceId, send_to_recipient: false }),
      );
    } catch (error) {
      if (!(error instanceof ToolkitError)) throw error;
      // S3.10: a send that may have happened is checked with a GET.
      const invoice = await call<InvoiceLike>("get_invoice", { invoice_id: invoiceId });
      const status = str(invoice?.status);
      if (status !== null && SENT_STATUSES.has(status))
        return str(invoice.detail?.metadata?.recipient_view_url);
      throw error;
    }
  }

  /**
   * Judge Mode funding (C-14): record_payment_for_invoice, labelled as a simulated rail. A retry
   * GETs first and skips the call if PayPal already shows the invoice paid.
   */
  async recordPayment(
    run: InvoiceRun,
    options: { priority?: CallPriority } = {},
  ): Promise<RecordPaymentResult> {
    const cp = await this.#checkpoint(run.runId);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    if (!cp.sentAt) throw new InvoiceStateError(`Invoice ${cp.invoiceId} has not been sent`);
    const invoiceId = cp.invoiceId;
    const base = { invoiceId, provenance: "simulated_rail" as const };
    if (cp.paymentRecordedAt) {
      return { ...base, recorded: false, alreadyRecorded: true, paymentId: cp.paymentId, calls: 0 };
    }
    const plan = buildInvoicePlan(run, {
      invoiceDate: cp.invoiceDate ?? utcDate(this.#now()),
      businessEmail: this.#businessEmail,
    });
    let calls = 0;
    if (cp.paymentAttemptedAt) {
      calls += 1;
      const invoice = await this.#tk<InvoiceLike>(
        "get_invoice",
        { invoice_id: invoiceId },
        undefined,
        options,
      );
      if (isFunded(invoice)) {
        await this.#repo.save(run.runId, { paymentRecordedAt: this.#now().toISOString() });
        return { ...base, recorded: false, alreadyRecorded: true, paymentId: cp.paymentId, calls };
      }
    }
    await this.#repo.save(run.runId, { paymentAttemptedAt: this.#now().toISOString() });
    calls += 1;
    const res = await this.#tk<{ payment_id?: unknown }>(
      "record_payment_for_invoice",
      {
        invoice_id: invoiceId,
        method: "BANK_TRANSFER",
        payment_date: utcDate(this.#now()),
        amount: { currency_code: "USD", value: centsToValue(plan.totalCents) },
        note: RECORD_PAYMENT_NOTE,
      },
      undefined,
      options,
    );
    const paymentId = str(res?.payment_id);
    await this.#repo.save(run.runId, { paymentRecordedAt: this.#now().toISOString(), paymentId });
    return { ...base, recorded: true, alreadyRecorded: false, paymentId, calls };
  }

  /** Register §8 funding rule: FUNDED only when a fresh GET shows PAID or MARKED_AS_PAID with 0.00 due. */
  async confirmFunding(
    run: Pick<InvoiceRun, "runId">,
    options: { priority?: CallPriority } = {},
  ): Promise<FundingCheck> {
    const cp = await this.#checkpoint(run.runId);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    const invoice = await this.#tk<InvoiceLike>(
      "get_invoice",
      { invoice_id: cp.invoiceId },
      undefined,
      options,
    );
    const invoiceStatus = str(invoice?.status);
    return {
      state: isFunded(invoice) ? "FUNDED" : "NOT_YET",
      invoiceStatus,
      dueCents: readValueCents(invoice?.due_amount?.value),
      provenance: invoiceStatus === "MARKED_AS_PAID" ? "simulated_rail" : "live",
    };
  }
}

function isFunded(invoice: InvoiceLike | null | undefined): boolean {
  const status = str(invoice?.status);
  return status !== null && FUNDED_STATUSES.has(status) && invoice?.due_amount?.value === "0.00";
}
