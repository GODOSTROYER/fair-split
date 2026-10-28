// IC-06 Invoices: the checkpointed invoice chain (the approved plan's "Invoicing v2 via Agent
// Toolkit"; S3 §S3.6.3). create (adopting a duplicate number) → send with send_to_recipient false
// (sendNeedsTreasurer) → a payable GET (SCHEDULED → delete, recreate once) → AUTO_CANCEL on PayPal's
// invoice date + 25 days under `cr-{invoiceId}`. Each step is stored before the next, so a retried
// task resumes where it stopped. invoice_date and payment_term are never sent. Every call goes
// through tk(), i.e. the toolkit's PayPalAPI on our token (graft G1); the agent's create, send, rule
// and read run through these same steps (agent.ts), never through raw tk().
//
// The executor (I1): every create, rule and send body is WS-CORE's `canonicalInvoiceCall(method,
// expected, labels)`, built from the run and the checkpoint alone; the agent only ever contributes
// the three item labels, which core checks. When the agent's turn drives a step, its policy is
// passed in and core's `decide()` runs on exactly the body about to be sent, before tk() is called.

import type { PolicyCtx, Provenance, ToolCall } from "@fairsplit/contracts";
import {
  asciiEmailKey,
  type CanonicalInvoiceCall,
  canonicalInvoiceCall,
  decide,
  type InvoiceCallExpectation,
  type ItemLabels,
  itemLabelProblem,
} from "@fairsplit/domain";
import type { CallPriority } from "@fairsplit/paypal-core";
import type { ToolkitMethod } from "./actions.js";
import { parseIsoDate, ppDate } from "./dates.js";
import {
  approvalCovers,
  autoCancelWindowError,
  buildInvoicePlan,
  type CreateInvoiceArgs,
  conditionalRuleRequestId,
  draftDifferences,
  type InvoicePlan,
  type InvoiceRun,
  type TreasurerApproval,
} from "./invoice-plan.js";
import { centsToValue, readValueCents } from "./money.js";
import { type InvoicePolicy, InvoicePolicyDeniedError } from "./policy.js";
import { type Tk, TOOLKIT_SANDBOX, ToolkitError } from "./tk.js";

/** What the chain has already done for a run (one row, keyed by run). */
export interface InvoiceCheckpoint {
  invoiceId: string | null;
  invoiceNumber: string | null;
  adopted: boolean;
  /**
   * The three item labels the invoice carries (the agent's, or the quote's names), so a recreated
   * invoice reads as the first did. The note is always the memo, so it is not stored.
   */
  itemLabels: readonly string[] | null;
  /** The invoice date PayPal holds, read from a GET; we never send one. */
  invoiceDate: string | null;
  sentAt: string | null;
  payerViewUrl: string | null;
  /** A fresh GET after the send showed the invoice payable (SENT, UNPAID, SHARED, …). */
  payableAt: string | null;
  /** The invoice PayPal SCHEDULED and the chain deleted, to recreate it once; a second SCHEDULED halts. */
  scheduledInvoiceId: string | null;
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
  itemLabels: null,
  invoiceDate: null,
  sentAt: null,
  payerViewUrl: null,
  payableAt: null,
  scheduledInvoiceId: null,
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

/** ADR-0002 `PP_MODE`: PayPal's sandbox, or the contract-faithful simulator standing in for it. */
export type PayPalMode = "sandbox" | "simulator";
const PAYPAL_MODES: ReadonlySet<string> = new Set<PayPalMode>(["sandbox", "simulator"]);

export interface InvoicesDeps {
  tk: Tk;
  repo: InvoiceRepository;
  /** PP_BUSINESS_EMAIL: the co-op's business account, invoicer and payout sender. */
  businessEmail: string;
  /**
   * Required (I8): in simulator mode every PayPal-derived state is labelled `simulated_rail`, so a
   * wiring that forgets the mode cannot show a simulated PAID as live.
   */
  ppMode: PayPalMode;
  now?: () => Date;
  /**
   * Spike S2's fallback: put the AUTO_CANCEL rule on before the send, should PayPal refuse a rule on
   * a sent invoice. The plan orders create → send → payable GET → rule. Default false.
   */
  ruleBeforeSend?: boolean;
}

export interface InvoiceStepOptions {
  priority?: CallPriority;
  /**
   * The agent turn's lattice. With it, core's `decide()` runs on every body the step is about to
   * send, exactly as sent, and anything but ALLOW (or REQUIRE_APPROVAL for a send the treasurer
   * approved) sends nothing. The server chain (S4.4's fallback) runs without it.
   */
  policy?: InvoicePolicy;
}

export interface EnsureInvoiceOptions extends InvoiceStepOptions {
  /**
   * The audit agent's three item labels: S4.4's keyed `{premium, bonus, disbursement}`, or a list in
   * the quote's line order. Core checks them (I1); the body is `canonicalInvoiceCall`'s.
   */
  labels?: readonly string[] | ItemLabels;
}

export interface EnsureInvoiceResult {
  status: "SENT" | "PENDING_APPROVAL";
  invoiceId: string;
  invoiceNumber: string;
  adopted: boolean;
  /** PayPal's invoice date; null until a GET has read it (before the send). */
  invoiceDate: string | null;
  payerViewUrl: string | null;
  /** Null until the AUTO_CANCEL rule is stored. */
  autoCancelOn: string | null;
  /** True when PayPal SCHEDULED the first invoice and this call replaced it. */
  recreated: boolean;
  /** PayPal calls this invocation made (a live Judge run budgets about 11). */
  calls: number;
  /** I8: `live` on PayPal's sandbox, `simulated_rail` on the simulator (ADR-0002). */
  provenance: Extract<Provenance, "live" | "simulated_rail">;
}

export interface CreateStepResult {
  invoiceId: string;
  invoiceNumber: string;
  /** PayPal's invoice date when an adopted invoice showed it; null for a new one until a GET reads it. */
  invoiceDate: string | null;
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
  /** True when the checkpoint already showed the invoice sent and payable: nothing was called. */
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

/**
 * The agent's labels or arguments are not core's canonical body for this call (I1, register §8).
 * Nothing was sent.
 */
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

/** A step was asked for out of order (e.g. a payment before the invoice is payable). */
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

/**
 * After the send, PayPal does not show the invoice payable. SCHEDULED is recovered once by the
 * server chain (delete, recreate); anything else, or a second SCHEDULED, stops the live lane: HALT.
 */
export class InvoiceNotPayableError extends Error {
  constructor(
    readonly invoiceId: string,
    readonly status: string | null,
    reason: string,
  ) {
    super(`Invoice ${invoiceId} is not payable (${status ?? "no status"}): ${reason}`);
    this.name = "InvoiceNotPayableError";
  }
}

export const RECORD_PAYMENT_NOTE = "Sandbox: marked as paid (simulated rail)";
const FUNDED_STATUSES: ReadonlySet<string> = new Set(["PAID", "MARKED_AS_PAID"]);
/** PayPal shows the invoice sent: the brand can see it, pay it, or has paid it. */
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
 * What an invoice carrying our number may be in for us to adopt it: a draft, a sent invoice, or one
 * PayPal scheduled (the payable GET then recreates it once). Anything else (CANCELLED, AUTO_CANCELLED,
 * REFUNDED, PARTIALLY_REFUNDED, MARKED_AS_REFUNDED or a status we do not know) is a HALT: the run's
 * invoice is gone or was handled outside Fair Split.
 */
const ADOPTABLE_STATUSES: ReadonlySet<string> = new Set(["DRAFT", "SCHEDULED", ...SENT_STATUSES]);
const INVOICE_ID = /^[A-Za-z0-9_-]{1,127}$/;

interface LinkLike {
  href?: unknown;
  rel?: unknown;
}

interface MoneyLike {
  currency_code?: unknown;
  value?: unknown;
}

interface InvoiceLike {
  id?: unknown;
  status?: unknown;
  detail?: {
    invoice_number?: unknown;
    reference?: unknown;
    note?: unknown;
    terms_and_conditions?: unknown;
    currency_code?: unknown;
    invoice_date?: unknown;
    metadata?: { recipient_view_url?: unknown };
  };
  invoicer?: { email_address?: unknown };
  primary_recipients?: { billing_info?: { email_address?: unknown } }[];
  items?: {
    name?: unknown;
    description?: unknown;
    quantity?: unknown;
    unit_amount?: MoneyLike;
    tax?: { percent?: unknown; amount?: MoneyLike };
    discount?: { percent?: unknown; amount?: MoneyLike };
  }[];
  configuration?: {
    allow_tip?: unknown;
    partial_payment?: { allow_partial_payment?: unknown };
    payment_method_overrides?: unknown;
  };
  amount?: MoneyLike & {
    breakdown?: {
      shipping?: { amount?: MoneyLike };
      custom?: { amount?: MoneyLike };
      tax_total?: MoneyLike;
      discount?: { invoice_discount?: { percent?: unknown; amount?: MoneyLike }; item_discount?: MoneyLike };
    };
  };
  due_amount?: { value?: unknown };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Two strict printable-ASCII e-mails equal but for ASCII A-Z case (core `asciiEmailKey`). */
function sameEmail(a: unknown, b: string): boolean {
  const key = asciiEmailKey(a);
  return key !== null && key === asciiEmailKey(b);
}

/** A body is decided and sent as one frozen object: nothing told of the decision can change it. */
function frozen<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) frozen(v);
    Object.freeze(value);
  }
  return value;
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

function positiveMoney(money: MoneyLike | undefined): boolean {
  const cents = readValueCents(money?.value);
  return cents !== null && cents > 0n;
}

function positivePercent(value: unknown): boolean {
  return typeof value === "string" && Number(value) > 0;
}

/**
 * Everything on a PayPal invoice that could bill the brand something other than the quote, or let
 * it pay another amount: tips, partial payments, payment-method overrides, shipping, custom amounts,
 * taxes and discounts. The code-built invoice has none of them.
 */
export function invoiceMoneyExtras(body: unknown): string[] {
  const invoice = (body ?? {}) as InvoiceLike;
  const out: string[] = [];
  const config = invoice.configuration;
  if (config?.allow_tip === true) out.push("configuration.allow_tip");
  if (config?.partial_payment?.allow_partial_payment === true) out.push("configuration.partial_payment");
  if (Array.isArray(config?.payment_method_overrides) && config.payment_method_overrides.length > 0)
    out.push("configuration.payment_method_overrides");
  const breakdown = invoice.amount?.breakdown;
  if (positiveMoney(breakdown?.shipping?.amount)) out.push("amount.breakdown.shipping");
  if (positiveMoney(breakdown?.custom?.amount)) out.push("amount.breakdown.custom");
  if (positiveMoney(breakdown?.tax_total)) out.push("amount.breakdown.tax_total");
  const invoiceDiscount = breakdown?.discount?.invoice_discount;
  if (positiveMoney(invoiceDiscount?.amount) || positivePercent(invoiceDiscount?.percent))
    out.push("amount.breakdown.discount.invoice_discount");
  if (positiveMoney(breakdown?.discount?.item_discount)) out.push("amount.breakdown.discount.item_discount");
  (invoice.items ?? []).forEach((item, i) => {
    if (positiveMoney(item?.tax?.amount) || positivePercent(item?.tax?.percent)) out.push(`items[${i}].tax`);
    if (positiveMoney(item?.discount?.amount) || positivePercent(item?.discount?.percent))
      out.push(`items[${i}].discount`);
  });
  return out;
}

/**
 * Adopt only our own invoice, deep-equal to the canonical body `canonicalInvoice(quote, labels)` for
 * the labels it carries: the fresh GET must show our number, reference, the memo as its note,
 * currency, total, the business account as invoicer, the brand as the one recipient, the three quote
 * lines (quantity and amount; their names labels core accepts for their lines), no free text we never
 * send (line descriptions, terms), no money extras, a readable invoice date and a status we can carry
 * on from. Anything missing or different is a HALT (InvoiceAdoptError). Returns the status, PayPal's
 * invoice date (the AUTO_CANCEL date is computed from it) and the labels.
 */
function verifyAdoptable(
  invoice: InvoiceLike,
  plan: InvoicePlan,
  invoiceId: string,
): { status: string; invoiceDate: string; itemLabels: string[] } {
  const halt = (why: string) =>
    new InvoiceAdoptError(`${plan.invoiceNumber} (${invoiceId}) not adopted: ${why}`);
  if (str(invoice.id) !== invoiceId) throw halt("the GET returned another invoice");
  if (invoice.detail?.invoice_number !== plan.invoiceNumber) throw halt("it carries another invoice number");
  const invoiceDate = isoDateOrNull(invoice.detail?.invoice_date);
  if (invoiceDate === null) throw halt("its invoice date is unreadable");
  const reference = str(invoice.detail?.reference);
  if (reference !== plan.reference)
    throw halt(`it carries ${reference ?? "no reference"}, not ${plan.reference}`);
  if (str(invoice.detail?.note) !== plan.note) throw halt("its note is not the code-rendered memo");
  if (str(invoice.detail?.terms_and_conditions) !== null) throw halt("it carries terms we never send");
  const currency = str(invoice.detail?.currency_code) ?? str(invoice.amount?.currency_code);
  if (currency !== "USD") throw halt(`its currency is ${currency ?? "missing"}`);
  const total = readValueCents(invoice.amount?.value);
  if (total === null || total !== plan.totalCents) {
    throw halt(
      `it asks for ${str(invoice.amount?.value) ?? "no amount"}, not ${centsToValue(plan.totalCents)}`,
    );
  }
  if (!sameEmail(invoice.invoicer?.email_address, plan.expected.businessEmail)) {
    throw halt("another account is the invoicer");
  }
  const recipients = invoice.primary_recipients ?? [];
  if (
    recipients.length !== 1 ||
    !sameEmail(recipients[0]?.billing_info?.email_address, plan.expected.payer.email)
  ) {
    throw halt("it is addressed to someone else");
  }
  const items = invoice.items ?? [];
  const wanted = plan.createArgs.items;
  const sameItems =
    items.length === wanted.length &&
    wanted.every((want, i) => {
      const got = items[i];
      return (
        Number(got?.quantity) === Number(want.quantity) &&
        got?.unit_amount?.currency_code === "USD" &&
        readValueCents(got?.unit_amount?.value) === readValueCents(want.unit_amount.value)
      );
    });
  if (!sameItems) throw halt("its lines differ from the quote");
  const itemLabels = items.map((item) => item?.name);
  const labels = itemLabelProblem(
    itemLabels,
    plan.expected.quote.items.map((item) => item.key),
  );
  if (labels) throw halt(`its line labels are not ours: ${labels}`);
  if (items.some((item) => str(item?.description) !== null)) throw halt("its lines carry descriptions");
  const extras = invoiceMoneyExtras(invoice);
  if (extras.length > 0) throw halt(`it carries ${extras.join(", ")}`);
  const status = str(invoice.status);
  if (status === null || !ADOPTABLE_STATUSES.has(status)) throw halt(`its status is ${status ?? "unknown"}`);
  return { status, invoiceDate, itemLabels: itemLabels as string[] };
}

interface CreatedOrAdopted {
  invoiceId: string;
  adopted: boolean;
  /** The labels the invoice carries: the ones sent, or the adopted invoice's own. */
  itemLabels: string[];
  /** PayPal's date for an adopted invoice; a new one's is read by the next GET. */
  invoiceDate: string | null;
  /** PayPal shows the adopted invoice sent (SCHEDULED included: the payable GET recreates it). */
  alreadySent: boolean;
  /** The adoption GET, fresh after a send, showed it payable. */
  payable: boolean;
  payerViewUrl: string | null;
}

type Call = <T>(method: ToolkitMethod, args: unknown, requestId?: string) => Promise<T>;

/** A GET of the run's own invoice: read its date; RECREATE when a SCHEDULED invoice was deleted. */
type ReadOutcome = "READ" | "RECREATE";

export class Invoices {
  readonly #tk: Tk;
  readonly #repo: InvoiceRepository;
  readonly #businessEmail: string;
  readonly #now: () => Date;
  readonly #ruleBeforeSend: boolean;
  readonly #rail: Extract<Provenance, "live" | "simulated_rail">;

  constructor(deps: InvoicesDeps) {
    if (!PAYPAL_MODES.has(deps.ppMode)) {
      throw new TypeError(`Invoices needs PP_MODE (sandbox or simulator), not ${String(deps.ppMode)}`);
    }
    this.#tk = deps.tk;
    this.#repo = deps.repo;
    this.#businessEmail = deps.businessEmail;
    this.#now = deps.now ?? (() => new Date());
    this.#ruleBeforeSend = deps.ruleBeforeSend ?? false;
    this.#rail = deps.ppMode === "simulator" ? "simulated_rail" : "live";
  }

  /** What the chain has done for a run (read-only). */
  async checkpoint(runId: string): Promise<InvoiceCheckpoint> {
    return { ...EMPTY_INVOICE_CHECKPOINT, ...((await this.#repo.load(runId)) ?? {}) };
  }

  /** The code-owned invoice for a run. */
  async plan(run: InvoiceRun): Promise<InvoicePlan> {
    return this.#planFor(run, await this.checkpoint(run.runId));
  }

  #planFor(run: InvoiceRun, cp: InvoiceCheckpoint): InvoicePlan {
    const plan = buildInvoicePlan(run, { businessEmail: this.#businessEmail });
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

  #stamp(): string {
    return this.#now().toISOString();
  }

  /** Core's expectation for this run's invoice as the checkpoint knows it (PayPal's id and date). */
  #expected(plan: InvoicePlan, cp: InvoiceCheckpoint): InvoiceCallExpectation {
    return { ...plan.expected, invoiceId: cp.invoiceId, invoiceDate: cp.invoiceDate };
  }

  /** Core's `canonicalInvoiceCall` for a rule or a send; a run that cannot build it yet sends nothing. */
  #canonical<M extends "create_conditional_rules_for_invoice" | "send_invoice">(
    plan: InvoicePlan,
    cp: InvoiceCheckpoint,
    method: M,
  ): Extract<CanonicalInvoiceCall, { ok: true; method: M }> {
    const call = canonicalInvoiceCall(method, this.#expected(plan, cp));
    if (!call.ok) throw new InvoiceStateError(`No ${method} for ${plan.invoiceNumber}: ${call.reason}`);
    return call as Extract<CanonicalInvoiceCall, { ok: true; method: M }>;
  }

  /**
   * The create body, core's `canonicalInvoiceCall("create_invoice", expected, labels)`: with the
   * agent's labels (refused, nothing sent, unless core accepts them for their lines), else the labels
   * the run's invoice was first created with (so a recreated invoice reads the same), else the quote's
   * own names.
   */
  #createArgs(
    plan: InvoicePlan,
    labels: readonly string[] | ItemLabels | undefined,
    cp: InvoiceCheckpoint,
  ): CreateInvoiceArgs {
    const expected = this.#expected(plan, cp);
    if (labels !== undefined) {
      const call = canonicalInvoiceCall("create_invoice", expected, labels);
      if (!call.ok || call.method !== "create_invoice") {
        throw new InvoiceDraftRejectedError([`items: ${call.ok ? "not an invoice" : call.reason}`]);
      }
      return call.args;
    }
    if (cp.itemLabels) {
      const call = canonicalInvoiceCall("create_invoice", expected, cp.itemLabels);
      if (call.ok && call.method === "create_invoice") return call.args;
    }
    return plan.createArgs;
  }

  /**
   * The agent turn's lattice on the call about to be sent: core's `decide()` over exactly this body,
   * with the code's expectation for the invoice as the checkpoint knows it. Only ALLOW sends, or
   * REQUIRE_APPROVAL for a send whose treasurer approval this step has already checked.
   */
  async #decide(
    policy: InvoicePolicy | undefined,
    call: ToolCall,
    plan: InvoicePlan,
    cp: InvoiceCheckpoint,
    approved = false,
  ): Promise<void> {
    if (!policy) return;
    const env = await policy.env();
    const ctx: PolicyCtx = {
      flags: { ...env.flags },
      ppEnv: env.ppEnv,
      toolkitSandbox: TOOLKIT_SANDBOX,
      runState: env.runState,
      invoiceExists: cp.invoiceId !== null,
      holds: [...env.holds],
      budget: { ...env.budget },
      expected: {
        ...this.#expected(plan, cp),
        brandAllowlist: [...env.brandAllowlist],
      },
      today: ppDate(this.#now()),
    };
    const decision = decide(call, ctx);
    await policy.onDecision?.(call, decision);
    const allowed = decision.verdict === "ALLOW" || (approved && decision.verdict === "REQUIRE_APPROVAL");
    if (!allowed) throw new InvoicePolicyDeniedError(call, decision);
  }

  /**
   * The create step alone (the agent's create_invoice): create under FS-{runSlug}, or adopt the
   * invoice already carrying it, and checkpoint the result. Never sends. A run that already holds its
   * invoice is not created again (alreadyDone); an agent draft must still reconcile (I1).
   */
  async create(run: InvoiceRun, options: EnsureInvoiceOptions = {}): Promise<CreateStepResult> {
    let cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    const args = this.#createArgs(plan, options.labels, cp);
    const result = (alreadyDone: boolean, calls: number): CreateStepResult => ({
      invoiceId: cp.invoiceId as string,
      invoiceNumber: plan.invoiceNumber,
      invoiceDate: cp.invoiceDate,
      adopted: cp.adopted,
      alreadyDone,
      sent: cp.sentAt !== null,
      payerViewUrl: cp.payerViewUrl,
      calls,
    });
    if (cp.invoiceId) return result(true, 0);
    const { call, calls } = this.#caller(options.priority);
    await this.#createStep(run.runId, plan, cp, args, call, options.policy);
    cp = await this.checkpoint(run.runId);
    return result(false, calls());
  }

  /**
   * ensureInvoice{target:'SENT'}: create (adopting a duplicate number), send with
   * send_to_recipient false once the treasurer approved this invoice, GET it to confirm PayPal shows
   * it payable (a SCHEDULED invoice is deleted and recreated once), then the AUTO_CANCEL rule.
   */
  async ensureForRun(run: InvoiceRun, options: EnsureInvoiceOptions = {}): Promise<EnsureInvoiceResult> {
    let cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    const args = this.#createArgs(plan, options.labels, cp);
    const { policy } = options;
    if (run.sendApproval && run.sendApproval.invoiceNumber !== plan.invoiceNumber) {
      throw new InvoiceApprovalError(
        `The treasurer approved sending ${run.sendApproval.invoiceNumber}, not ${plan.invoiceNumber}`,
      );
    }
    const { call, calls } = this.#caller(options.priority);
    const reload = async () => {
      cp = await this.checkpoint(run.runId);
      return cp;
    };
    let recreated = false;
    const result = (status: EnsureInvoiceResult["status"]): EnsureInvoiceResult => ({
      status,
      invoiceId: cp.invoiceId as string,
      invoiceNumber: plan.invoiceNumber,
      adopted: cp.adopted,
      invoiceDate: cp.invoiceDate,
      payerViewUrl: cp.payerViewUrl,
      autoCancelOn: cp.ruleSetAt ? cp.autoCancelOn : null,
      recreated,
      calls: calls(),
      provenance: this.#rail,
    });

    // At most two passes: a SCHEDULED invoice is replaced once, and a second SCHEDULED halts.
    for (;;) {
      if (!cp.invoiceId) {
        await this.#createStep(run.runId, plan, cp, args, call, policy);
        await reload();
      }
      if (this.#ruleBeforeSend && !cp.ruleSetAt) {
        await this.#ruleStep(run.runId, plan, cp, call, { policy });
        await reload();
      }
      if (!cp.sentAt) {
        const approval = run.sendApproval;
        if (!approval) return result("PENDING_APPROVAL");
        // An approval of the SCHEDULED invoice this chain deleted does not send its replacement: the
        // recreated invoice waits for the treasurer's approval of it, unsent.
        if (approval.invoiceId != null && approval.invoiceId === cp.scheduledInvoiceId)
          return result("PENDING_APPROVAL");
        await this.#sendStep(run.runId, plan, cp, approval, call, { bound: false, policy });
        await reload();
      }
      if (!cp.payableAt) {
        const outcome = await this.#readInvoice(run.runId, cp, call, { recover: true });
        await reload();
        if (outcome === "RECREATE") {
          recreated = true;
          continue;
        }
      }
      if (!cp.ruleSetAt) {
        await this.#ruleStep(run.runId, plan, cp, call, { policy });
        await reload();
      }
      return result("SENT");
    }
  }

  /**
   * The send step alone (the agent's send_invoice): only with an approval bound to this invoice (its
   * PayPal id and `sendArgsSha256` of the exact send), then the payable GET. A SCHEDULED invoice is
   * left for the server chain to recreate (it throws InvoiceNotPayableError); the agent never deletes
   * an invoice.
   */
  async send(
    run: InvoiceRun,
    approval: TreasurerApproval | null,
    options: InvoiceStepOptions = {},
  ): Promise<SendStepResult> {
    let cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    const invoiceId = cp.invoiceId;
    if (cp.sentAt && cp.payableAt)
      return { invoiceId, payerViewUrl: cp.payerViewUrl, alreadyDone: true, calls: 0 };
    if (!cp.sentAt && !approval)
      throw new InvoiceApprovalError(`Sending ${plan.invoiceNumber} needs the treasurer's approval`);
    const { call, calls } = this.#caller(options.priority);
    if (!cp.sentAt && approval) {
      await this.#sendStep(run.runId, plan, cp, approval, call, { bound: true, policy: options.policy });
      cp = await this.checkpoint(run.runId);
    }
    await this.#readInvoice(run.runId, cp, call, { recover: false });
    cp = await this.checkpoint(run.runId);
    return { invoiceId, payerViewUrl: cp.payerViewUrl, alreadyDone: false, calls: calls() };
  }

  /**
   * The AUTO_CANCEL step alone (the agent's rule): core's canonical rule, on PayPal's invoice date +
   * 25 days, never another date. `draft`, the rule the agent wrote out in full, must be that body
   * exactly, or nothing is sent (InvoiceDraftRejectedError).
   */
  async ensureRule(
    run: InvoiceRun,
    options: InvoiceStepOptions & { draft?: unknown } = {},
  ): Promise<RuleStepResult> {
    let cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    const invoiceId = cp.invoiceId;
    if (cp.ruleSetAt && cp.autoCancelOn) {
      if (options.draft !== undefined) {
        const rule = this.#canonical(plan, cp, "create_conditional_rules_for_invoice");
        const differences = draftDifferences(options.draft, rule.args);
        if (differences.length > 0) throw new InvoiceDraftRejectedError(differences);
      }
      return { invoiceId, autoCancelOn: cp.autoCancelOn, alreadyDone: true, calls: 0 };
    }
    const { call, calls } = this.#caller(options.priority);
    await this.#ruleStep(run.runId, plan, cp, call, { draft: options.draft, policy: options.policy });
    cp = await this.checkpoint(run.runId);
    return { invoiceId, autoCancelOn: cp.autoCancelOn as string, alreadyDone: false, calls: calls() };
  }

  /** get_invoice for the run's own invoice (the agent's read). Writes nothing. */
  async fetch(run: InvoiceRun, options: InvoiceStepOptions = {}): Promise<unknown> {
    const cp = await this.checkpoint(run.runId);
    const plan = this.#planFor(run, cp);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    const args = frozen({ invoice_id: cp.invoiceId });
    await this.#decide(options.policy, { name: "get_invoice", args }, plan, cp);
    return this.#tk("get_invoice", args, undefined, { priority: options.priority });
  }

  /** Create or adopt, then checkpoint the invoice (and its sent and payable state, when PayPal shows them). */
  async #createStep(
    runId: string,
    plan: InvoicePlan,
    cp: InvoiceCheckpoint,
    args: CreateInvoiceArgs,
    call: Call,
    policy: InvoicePolicy | undefined,
  ): Promise<void> {
    const body = frozen(args);
    await this.#decide(policy, { name: "create_invoice", args: body }, plan, cp);
    const created = await this.#createOrAdopt(plan, body, call);
    const at = this.#stamp();
    await this.#repo.save(runId, {
      invoiceId: created.invoiceId,
      invoiceNumber: plan.invoiceNumber,
      adopted: created.adopted,
      itemLabels: created.itemLabels,
      invoiceDate: created.invoiceDate,
      ...(created.alreadySent
        ? {
            sentAt: at,
            payerViewUrl: created.payerViewUrl,
            ...(created.payable ? { payableAt: at } : {}),
          }
        : {}),
    });
  }

  async #sendStep(
    runId: string,
    plan: InvoicePlan,
    cp: InvoiceCheckpoint,
    approval: TreasurerApproval,
    call: Call,
    options: { bound: boolean; policy?: InvoicePolicy | undefined },
  ): Promise<void> {
    const invoiceId = cp.invoiceId as string;
    if (!approvalCovers(approval, { invoiceNumber: plan.invoiceNumber, invoiceId }, options)) {
      const named = approval?.invoiceId
        ? ` (${approval.invoiceId})`
        : options.bound
          ? " (no invoice id)"
          : "";
      throw new InvoiceApprovalError(
        `The treasurer's approval names ${approval?.invoiceNumber ?? "nothing"}${named}, not this send of ${plan.invoiceNumber} (${invoiceId})`,
      );
    }
    // sendNeedsTreasurer: the lattice asks for the approval this step has just checked.
    const body = frozen(this.#canonical(plan, cp, "send_invoice").args);
    await this.#decide(options.policy, { name: "send_invoice", args: body }, plan, cp, true);
    const payerViewUrl = await this.#send(body, call);
    await this.#repo.save(runId, { sentAt: this.#stamp(), payerViewUrl: payerViewUrl ?? cp.payerViewUrl });
  }

  /**
   * GETs the run's own invoice and stores the date PayPal gave it. After the send this is the plan's
   * payable GET: the status must be SENT, UNPAID, SHARED or later. SCHEDULED is deleted and recreated
   * once when `recover` is set (the server chain), else reported (InvoiceNotPayableError).
   */
  async #readInvoice(
    runId: string,
    cp: InvoiceCheckpoint,
    call: Call,
    options: { recover: boolean },
  ): Promise<ReadOutcome> {
    const invoiceId = cp.invoiceId as string;
    const notPayable = (status: string | null, why: string) =>
      new InvoiceNotPayableError(invoiceId, status, why);
    let invoice: InvoiceLike;
    try {
      invoice = await call<InvoiceLike>("get_invoice", { invoice_id: invoiceId });
    } catch (error) {
      // A retry after a crash between our delete of a SCHEDULED invoice and the checkpoint: it is gone.
      if (
        options.recover &&
        error instanceof ToolkitError &&
        error.status === 404 &&
        cp.scheduledInvoiceId === invoiceId
      ) {
        await this.#forget(runId);
        return "RECREATE";
      }
      throw error;
    }
    if (str(invoice?.id) !== invoiceId) throw notPayable(null, "the GET returned another invoice");
    const status = str(invoice.status);

    if (status === "SCHEDULED") {
      if (!options.recover)
        throw notPayable(status, "PayPal scheduled it; the server chain recreates it once");
      if (cp.scheduledInvoiceId !== null && cp.scheduledInvoiceId !== invoiceId)
        throw notPayable(status, "PayPal scheduled the recreated invoice too; the live lane stops");
      await this.#repo.save(runId, { scheduledInvoiceId: invoiceId });
      try {
        await call("delete_invoice", { invoice_id: invoiceId });
      } catch (error) {
        if (!(error instanceof ToolkitError && error.status === 404)) throw error;
      }
      await this.#forget(runId);
      return "RECREATE";
    }

    const sent = status !== null && SENT_STATUSES.has(status);
    if (!sent && !(status === "DRAFT" && !cp.sentAt)) {
      throw notPayable(status, cp.sentAt ? "PayPal does not show it sent" : "it is no longer a draft");
    }
    const invoiceDate = isoDateOrNull(invoice.detail?.invoice_date);
    if (invoiceDate === null) throw notPayable(status, "its invoice date is unreadable");
    const at = this.#stamp();
    await this.#repo.save(runId, {
      invoiceDate,
      ...(sent
        ? {
            // PayPal shows it sent although our send left no mark (a lost response): it was sent.
            ...(cp.sentAt ? {} : { sentAt: at }),
            payableAt: at,
            payerViewUrl: str(invoice.detail?.metadata?.recipient_view_url) ?? cp.payerViewUrl,
          }
        : {}),
    });
    return "READ";
  }

  /** Forgets a deleted invoice; the number is free again, so the chain creates the run's invoice anew. */
  async #forget(runId: string): Promise<void> {
    await this.#repo.save(runId, {
      invoiceId: null,
      adopted: false,
      invoiceDate: null,
      sentAt: null,
      payerViewUrl: null,
      payableAt: null,
      autoCancelOn: null,
      ruleSetAt: null,
    });
  }

  /**
   * Core's canonical AUTO_CANCEL rule, on PayPal's invoice date + 25 days (read with a GET first when
   * the run does not hold it yet), under request id `cr-{invoiceId}`. An agent's full `draft` of the
   * rule must be exactly that body; the date must be after PayPal's today and within 30 days.
   */
  async #ruleStep(
    runId: string,
    plan: InvoicePlan,
    cp: InvoiceCheckpoint,
    call: Call,
    options: { draft?: unknown; policy?: InvoicePolicy | undefined },
  ): Promise<void> {
    const invoiceId = cp.invoiceId as string;
    let dated = cp;
    if (dated.invoiceDate === null) {
      await this.#readInvoice(runId, cp, call, { recover: false });
      dated = { ...cp, invoiceDate: (await this.checkpoint(runId)).invoiceDate };
      if (dated.invoiceDate === null) throw new InvoiceStateError(`No invoice date for ${invoiceId}`);
    }
    const rule = this.#canonical(plan, dated, "create_conditional_rules_for_invoice");
    if (options.draft !== undefined) {
      const differences = draftDifferences(options.draft, rule.args);
      if (differences.length > 0) throw new InvoiceDraftRejectedError(differences);
    }
    const autoCancelOn = rule.args.rules[0].rule_expiry_terms.condition_rule_end_date;
    const outside = autoCancelWindowError(autoCancelOn, ppDate(this.#now()));
    if (outside) throw new InvoiceStateError(`No AUTO_CANCEL rule for ${invoiceId}: ${outside}`);
    const body = frozen(rule.args);
    await this.#decide(options.policy, { name: rule.method, args: body }, plan, dated);
    await call(rule.method, body, conditionalRuleRequestId(invoiceId));
    await this.#repo.save(runId, { ruleSetAt: this.#stamp(), autoCancelOn });
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
          itemLabels: args.items.map((item) => item.name),
          invoiceDate: null,
          alreadySent: false,
          payable: false,
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
    const { status, invoiceDate, itemLabels } = verifyAdoptable(invoice, plan, invoiceId);
    return {
      invoiceId,
      adopted: true,
      itemLabels,
      invoiceDate,
      alreadySent: status === "SCHEDULED" || SENT_STATUSES.has(status),
      payable: SENT_STATUSES.has(status),
      payerViewUrl: str(invoice.detail?.metadata?.recipient_view_url),
    };
  }

  async #send(body: { invoice_id: string; send_to_recipient: false }, call: Call): Promise<string | null> {
    try {
      return payerViewUrlFromSend(await call<unknown>("send_invoice", body));
    } catch (error) {
      if (!(error instanceof ToolkitError)) throw error;
      // S3.10: a send that may have happened is checked with a GET (SCHEDULED counts as sent: the
      // payable GET that follows deals with it).
      const invoice = await call<InvoiceLike>("get_invoice", { invoice_id: body.invoice_id });
      const status = str(invoice?.status);
      if (status !== null && (SENT_STATUSES.has(status) || status === "SCHEDULED"))
        return str(invoice.detail?.metadata?.recipient_view_url);
      throw error;
    }
  }

  /**
   * Judge Mode funding (C-14): record_payment_for_invoice for the code total, labelled as a simulated
   * rail, with no payment_date (PayPal dates it; S3). A retry GETs first and skips the call if PayPal
   * already shows the invoice paid.
   */
  async recordPayment(
    run: InvoiceRun,
    options: { priority?: CallPriority } = {},
  ): Promise<RecordPaymentResult> {
    const cp = await this.checkpoint(run.runId);
    if (!cp.invoiceId) throw new InvoiceStateError(`Run ${run.runId} has no invoice yet`);
    if (!cp.sentAt || !cp.payableAt)
      throw new InvoiceStateError(`Invoice ${cp.invoiceId} is not sent and payable yet`);
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
        await this.#repo.save(run.runId, { paymentRecordedAt: this.#stamp() });
        return { ...base, recorded: false, alreadyRecorded: true, paymentId: cp.paymentId, calls };
      }
    }
    await this.#repo.save(run.runId, { paymentAttemptedAt: this.#stamp() });
    calls += 1;
    const res = await this.#tk<{ payment_id?: unknown }>(
      "record_payment_for_invoice",
      {
        invoice_id: invoiceId,
        method: "BANK_TRANSFER",
        amount: { currency_code: "USD", value: centsToValue(plan.totalCents) },
        note: RECORD_PAYMENT_NOTE,
      },
      undefined,
      options,
    );
    const paymentId = str(res?.payment_id);
    await this.#repo.save(run.runId, { paymentRecordedAt: this.#stamp(), paymentId });
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
      // A recorded payment is a simulated rail on either rail; on the simulator, everything is.
      provenance: invoiceStatus === "MARKED_AS_PAID" ? "simulated_rail" : this.#rail,
    };
  }
}

function isFunded(invoice: InvoiceLike | null | undefined): boolean {
  const status = str(invoice?.status);
  return status !== null && FUNDED_STATUSES.has(status) && invoice?.due_amount?.value === "0.00";
}
