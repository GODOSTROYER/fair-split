// IC-06 Invoices: the checkpointed invoice chain (S3 §S3.6.3). create → send → AUTO_CANCEL rule,
// each step stored before the next, so a retried task resumes where it stopped. Every call goes
// through tk(), i.e. the toolkit's PayPalAPI on our token (graft G1). The agent's send and rule run
// through the same checkpointed steps (agent.ts), never through raw tk().

import type { Provenance } from "./_shims/contracts.js";
import type { CallPriority } from "./_shims/paypal-core.js";
import type { ToolkitMethod } from "./actions.js";
import { parseIsoDate, utcDate } from "./dates.js";
import {
  approvalCovers,
  autoCancelDate,
  autoCancelRuleArgs,
  autoCancelWindowError,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  conditionalRuleRequestId,
  type InvoicePlan,
  type InvoiceRun,
  reconcileAgentDraft,
  type TreasurerApproval,
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
  /** The audit agent's create_invoice draft (agent.ts DRAFT): it may only choose the note's closing (I1). */
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
  /** PayPal calls this invocation made (the Judge budget is 11 per live run). */
  calls: number;
}

export interface CreateStepResult {
  invoiceId: string;
  invoiceNumber: string;
  invoiceDate: string;
  adopted: boolean;
  /** True when the checkpoint already held the run's invoice: nothing was called. */
  alreadyDone: boolean;
  /** True when PayPal already shows the (adopted) invoice sent. */
  sent: boolean;
  payerViewUrl: string | null;
  calls: number;
}

export interface SendStepResult {
  invoiceId: string;
  payerViewUrl: string | null;
  /** True when the checkpoint already showed the invoice sent: nothing was called. */
  alreadyDone: boolean;
  calls: number;
}

export interface RuleStepResult {
  invoiceId: string;
  autoCancelOn: string;
  alreadyDone: boolean;
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

/** The treasurer's approval names another invoice. Nothing was sent. */
export class InvoiceApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceApprovalError";
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
/**
 * What an invoice carrying our number may be in for us to adopt it. Anything else (CANCELLED,
 * AUTO_CANCELLED, REFUNDED, PARTIALLY_REFUNDED, MARKED_AS_REFUNDED, SCHEDULED or a status we do not
 * know) is a HALT: the run's invoice is gone or was handled outside Fair Split.
 */
const ADOPTABLE_STATUSES: ReadonlySet<string> = new Set(["DRAFT", ...SENT_STATUSES]);
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
    currency_code?: unknown;
    invoice_date?: unknown;
    metadata?: { recipient_view_url?: unknown };
  };
  invoicer?: { email_address?: unknown };
  primary_recipients?: { billing_info?: { email_address?: unknown } }[];
  items?: {
    name?: unknown;
    quantity?: unknown;
    unit_amount?: { currency_code?: unknown; value?: unknown };
  }[];
  amount?: { currency_code?: unknown; value?: unknown };
  due_amount?: { value?: unknown };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sameEmail(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.trim().toLowerCase();
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

function isoDateOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    parseIsoDate(value);
    return value;
  } catch {
    return null;
  }
}

/**
 * Adopt only our own invoice: the fresh GET must show our number, reference, currency, total, the
 * business account as invoicer, the brand as the one recipient, the three quote lines, a readable
 * invoice date and a status we can carry on from. Anything missing or different is a HALT
 * (InvoiceAdoptError). Returns the status and PayPal's invoice date, which the AUTO_CANCEL date is
 * computed from (the invoice may have been created on an earlier day than the retry that adopts it).
 */
function verifyAdoptable(
  invoice: InvoiceLike,
  plan: InvoicePlan,
  invoiceId: string,
): { status: string; invoiceDate: string } {
  const halt = (why: string) =>
    new InvoiceAdoptError(`${plan.invoiceNumber} (${invoiceId}) not adopted: ${why}`);
  if (str(invoice.id) !== invoiceId) throw halt("the GET returned another invoice");
  if (invoice.detail?.invoice_number !== plan.invoiceNumber) throw halt("it carries another invoice number");
  const invoiceDate = isoDateOrNull(invoice.detail?.invoice_date);
  if (invoiceDate === null) throw halt("its invoice date is unreadable");
  const reference = str(invoice.detail?.reference);
  if (reference !== plan.reference)
    throw halt(`it carries ${reference ?? "no reference"}, not ${plan.reference}`);
  const currency = str(invoice.detail?.currency_code) ?? str(invoice.amount?.currency_code);
  if (currency !== "USD") throw halt(`its currency is ${currency ?? "missing"}`);
  const total = readValueCents(invoice.amount?.value);
  if (total === null || total !== plan.totalCents) {
    throw halt(
      `it asks for ${str(invoice.amount?.value) ?? "no amount"}, not ${centsToValue(plan.totalCents)}`,
    );
  }
  if (!sameEmail(invoice.invoicer?.email_address, plan.createArgs.invoicer_email_address)) {
    throw halt("another account is the invoicer");
  }
  const recipients = invoice.primary_recipients ?? [];
  const payer = plan.createArgs.primary_recipients[0]?.billing_info.email_address ?? "";
  if (recipients.length !== 1 || !sameEmail(recipients[0]?.billing_info?.email_address, payer)) {
    throw halt("it is addressed to someone else");
  }
  const items = invoice.items ?? [];
  const wanted = plan.createArgs.items;
  const sameItems =
    items.length === wanted.length &&
    wanted.every((want, i) => {
      const got = items[i];
      return (
        got?.name === want.name &&
        Number(got?.quantity) === Number(want.quantity) &&
        got?.unit_amount?.currency_code === "USD" &&
        readValueCents(got?.unit_amount?.value) === readValueCents(want.unit_amount.value)
      );
    });
  if (!sameItems) throw halt("its lines differ from the quote");
  const status = str(invoice.status);
  if (status === null || !ADOPTABLE_STATUSES.has(status)) throw halt(`its status is ${status ?? "unknown"}`);
  return { status, invoiceDate };
}

interface CreatedOrAdopted {
  invoiceId: string;
  adopted: boolean;
  /** The invoice date PayPal holds: ours for a new invoice, PayPal's for an adopted one. */
  invoiceDate: string;
  alreadySent: boolean;
  payerViewUrl: string | null;
}

type Call = <T>(method: ToolkitMethod, args: unknown, requestId?: string) => Promise<T>;

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

  /** What the chain has done for a run (read-only). */
  async checkpoint(runId: string): Promise<InvoiceCheckpoint> {
    return { ...EMPTY_INVOICE_CHECKPOINT, ...((await this.#repo.load(runId)) ?? {}) };
  }

  /** The code-owned invoice for a run, dated from the checkpoint once created (never re-dated). */
  async plan(run: InvoiceRun): Promise<InvoicePlan> {
    return this.#planFor(run, await this.checkpoint(run.runId));
  }

  #planFor(run: InvoiceRun, cp: InvoiceCheckpoint): InvoicePlan {
    const plan = buildInvoicePlan(run, {
      invoiceDate: cp.invoiceDate ?? utcDate(this.#now()),
      businessEmail: this.#businessEmail,
    });
    if (cp.invoiceNumber && cp.invoiceNumber !== plan.invoiceNumber) {
      throw new InvoiceStateError(
        `Run ${run.runId} already holds ${cp.invoiceNumber}, not ${plan.invoiceNumber}`,
      );
    }
    return plan;
  }

  #caller(priority: CallPriority | undefined): { call: Call; calls: () => number } {
    let calls = 0;
    const call: Call = <T>(method: ToolkitMethod, callArgs: unknown, requestId?: string) => {
      calls += 1;
      return this.#tk<T>(method, callArgs, requestId, { priority });
    };
    return { call, calls: () => calls };
  }

  /** The create arguments: the plan's, or an agent draft that reconciles with them (I1). */
  #argsFor(plan: InvoicePlan, draft: unknown): CreateInvoiceArgs {
    if (draft === undefined) return plan.createArgs;
    const reconciled = reconcileAgentDraft(draft, plan);
    if (!reconciled.ok) throw new InvoiceDraftRejectedError(reconciled.mismatches);
    return reconciled.args;
  }

  /**
   * The create step alone (the agent's create_invoice): create under FS-{runSlug}, or adopt the
   * invoice already carrying it, and checkpoint the result. Never sends. A run that already holds its
   * invoice is not created again (alreadyDone); an agent draft must still reconcile (I1).
   */
  async create(run: InvoiceRun, options: EnsureInvoiceOptions = {}): Promise<CreateStepResult> {
    const cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    const args = this.#argsFor(plan, options.draft);
    const base = { invoiceNumber: plan.invoiceNumber, invoiceDate: plan.invoiceDate };
    if (cp.invoiceId) {
      return {
        ...base,
        invoiceId: cp.invoiceId,
        adopted: cp.adopted,
        alreadyDone: true,
        sent: cp.sentAt !== null,
        payerViewUrl: cp.payerViewUrl,
        calls: 0,
      };
    }
    const { call, calls } = this.#caller(options.priority);
    const created = await this.#createStep(run.runId, plan, args, call);
    return {
      ...base,
      invoiceDate: created.invoiceDate,
      invoiceId: created.invoiceId,
      adopted: created.adopted,
      alreadyDone: false,
      sent: created.sentAt !== null,
      payerViewUrl: created.payerViewUrl,
      calls: calls(),
    };
  }

  /**
   * ensureInvoice{target:'SENT'}: create (adopting a duplicate number), send with
   * send_to_recipient false once the treasurer approved this invoice, then the AUTO_CANCEL rule.
   */
  async ensureForRun(run: InvoiceRun, options: EnsureInvoiceOptions = {}): Promise<EnsureInvoiceResult> {
    const cp = await this.checkpoint(run.runId);
    let plan = this.#planFor(run, cp);
    const args = this.#argsFor(plan, options.draft);
    if (run.sendApproval && run.sendApproval.invoiceNumber !== plan.invoiceNumber) {
      throw new InvoiceApprovalError(
        `The treasurer approved sending ${run.sendApproval.invoiceNumber}, not ${plan.invoiceNumber}`,
      );
    }

    const { call, calls } = this.#caller(options.priority);
    const stamp = () => this.#now().toISOString();

    let { invoiceId, adopted, sentAt, payerViewUrl, ruleSetAt } = cp;
    if (!invoiceId) {
      const created = await this.#createStep(run.runId, plan, args, call);
      ({ invoiceId, adopted, sentAt, payerViewUrl } = created);
      // An adopted invoice keeps the date PayPal holds; the AUTO_CANCEL date follows it.
      if (created.invoiceDate !== plan.invoiceDate) {
        plan = this.#planFor(run, { ...cp, invoiceDate: created.invoiceDate });
      }
    }
    const id = invoiceId;

    const ensureRule = async () => {
      if (ruleSetAt) return;
      await this.#ruleStep(run.runId, id, plan.invoiceDate, call);
      ruleSetAt = stamp();
    };

    const result = (status: EnsureInvoiceResult["status"]): EnsureInvoiceResult => ({
      status,
      invoiceId: id,
      invoiceNumber: plan.invoiceNumber,
      adopted,
      invoiceDate: plan.invoiceDate,
      payerViewUrl,
      autoCancelOn: ruleSetAt ? plan.autoCancelOn : null,
      calls: calls(),
    });

    if (this.#ruleBeforeSend) await ensureRule();
    if (!sentAt) {
      if (!run.sendApproval) return result("PENDING_APPROVAL");
      payerViewUrl = await this.#sendStep(run.runId, plan, id, run.sendApproval, call);
      sentAt = stamp();
    }
    await ensureRule();
    return result("SENT");
  }

  /** The send step alone (the agent's send_invoice): only with an approval naming this invoice. */
  async send(
    run: InvoiceRun,
    approval: TreasurerApproval,
    options: { priority?: CallPriority } = {},
  ): Promise<SendStepResult> {
    const cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    if (cp.sentAt)
      return { invoiceId: cp.invoiceId, payerViewUrl: cp.payerViewUrl, alreadyDone: true, calls: 0 };
    const { call, calls } = this.#caller(options.priority);
    const payerViewUrl = await this.#sendStep(run.runId, plan, cp.invoiceId, approval, call);
    return { invoiceId: cp.invoiceId, payerViewUrl, alreadyDone: false, calls: calls() };
  }

  /** The AUTO_CANCEL step alone (the agent's rule): invoice date + 25 days, never another date. */
  async ensureRule(run: InvoiceRun, options: { priority?: CallPriority } = {}): Promise<RuleStepResult> {
    const cp = await this.checkpoint(run.runId);
    this.#planFor(run, cp);
    if (!cp.invoiceId || !cp.invoiceDate) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    const autoCancelOn = autoCancelDate(cp.invoiceDate);
    if (cp.ruleSetAt) return { invoiceId: cp.invoiceId, autoCancelOn, alreadyDone: true, calls: 0 };
    const { call, calls } = this.#caller(options.priority);
    await this.#ruleStep(run.runId, cp.invoiceId, cp.invoiceDate, call);
    return { invoiceId: cp.invoiceId, autoCancelOn, alreadyDone: false, calls: calls() };
  }

  /** get_invoice for the run's own invoice (the agent's read). */
  async fetch(run: InvoiceRun, options: { priority?: CallPriority } = {}): Promise<unknown> {
    const cp = await this.checkpoint(run.runId);
    this.#planFor(run, cp);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    return this.#tk("get_invoice", { invoice_id: cp.invoiceId }, undefined, options);
  }

  /** Create or adopt, then checkpoint the invoice (and its sent state, when PayPal shows it sent). */
  async #createStep(
    runId: string,
    plan: InvoicePlan,
    args: CreateInvoiceArgs,
    call: Call,
  ): Promise<{
    invoiceId: string;
    adopted: boolean;
    invoiceDate: string;
    sentAt: string | null;
    payerViewUrl: string | null;
  }> {
    const created = await this.#createOrAdopt(plan, args, call);
    const { invoiceId, adopted, invoiceDate } = created;
    await this.#repo.save(runId, { invoiceId, invoiceNumber: plan.invoiceNumber, adopted, invoiceDate });
    if (!created.alreadySent) return { invoiceId, adopted, invoiceDate, sentAt: null, payerViewUrl: null };
    const sentAt = this.#now().toISOString();
    await this.#repo.save(runId, { sentAt, payerViewUrl: created.payerViewUrl });
    return { invoiceId, adopted, invoiceDate, sentAt, payerViewUrl: created.payerViewUrl };
  }

  async #sendStep(
    runId: string,
    plan: InvoicePlan,
    invoiceId: string,
    approval: TreasurerApproval,
    call: Call,
  ): Promise<string | null> {
    if (!approvalCovers(approval, { invoiceNumber: plan.invoiceNumber, invoiceId })) {
      throw new InvoiceApprovalError(
        `The treasurer's approval names ${approval?.invoiceNumber ?? "nothing"}${approval?.invoiceId ? ` (${approval.invoiceId})` : ""}, not ${plan.invoiceNumber} (${invoiceId})`,
      );
    }
    const payerViewUrl = await this.#send(invoiceId, call);
    await this.#repo.save(runId, { sentAt: this.#now().toISOString(), payerViewUrl });
    return payerViewUrl;
  }

  async #ruleStep(runId: string, invoiceId: string, invoiceDate: string, call: Call): Promise<void> {
    const autoCancelOn = autoCancelDate(invoiceDate);
    const outside = autoCancelWindowError(autoCancelOn, utcDate(this.#now()));
    if (outside) throw new InvoiceStateError(`No AUTO_CANCEL rule for ${invoiceId}: ${outside}`);
    await call(
      "create_conditional_rules_for_invoice",
      autoCancelRuleArgs(invoiceId, autoCancelOn),
      conditionalRuleRequestId(invoiceId),
    );
    await this.#repo.save(runId, { ruleSetAt: this.#now().toISOString(), autoCancelOn });
  }

  async #createOrAdopt(plan: InvoicePlan, args: CreateInvoiceArgs, call: Call): Promise<CreatedOrAdopted> {
    let failure: unknown;
    try {
      const created = await call<unknown>("create_invoice", args);
      const invoiceId = invoiceIdFromCreate(created);
      if (invoiceId) {
        return {
          invoiceId,
          adopted: false,
          invoiceDate: args.invoice_date,
          alreadySent: false,
          payerViewUrl: null,
        };
      }
      failure = new InvoiceStateError("create_invoice succeeded without a readable invoice id");
    } catch (error) {
      if (!(error instanceof ToolkitError)) throw error;
      failure = error;
    }
    // S3: on any failure or timeout, search by invoice_number and adopt the match. Never parse the
    // duplicate-number error; its text is unverified. The match is verified on a fresh GET.
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
    const invoiceId = str((matches[0] as InvoiceLike).id);
    if (!invoiceId || !INVOICE_ID.test(invoiceId))
      throw new InvoiceAdoptError("The matching invoice has no usable id");
    let invoice: InvoiceLike;
    try {
      invoice = await call<InvoiceLike>("get_invoice", { invoice_id: invoiceId });
    } catch {
      throw failure;
    }
    const { status, invoiceDate } = verifyAdoptable(invoice, plan, invoiceId);
    return {
      invoiceId,
      adopted: true,
      invoiceDate,
      alreadySent: SENT_STATUSES.has(status),
      payerViewUrl: str(invoice.detail?.metadata?.recipient_view_url),
    };
  }

  async #send(invoiceId: string, call: Call): Promise<string | null> {
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
    const cp = await this.checkpoint(run.runId);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    if (!cp.sentAt) throw new InvoiceStateError(`Invoice ${cp.invoiceId} has not been sent`);
    const invoiceId = cp.invoiceId;
    const base = { invoiceId, provenance: "simulated_rail" as const };
    if (cp.paymentRecordedAt) {
      return { ...base, recorded: false, alreadyRecorded: true, paymentId: cp.paymentId, calls: 0 };
    }
    const plan = this.#planFor(run, cp);
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
    const cp = await this.checkpoint(run.runId);
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
