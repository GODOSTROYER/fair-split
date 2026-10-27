// Invoicing v2: draft → send (UNPAID/SENT, or SCHEDULED for a future invoice_date) → record payment
// (MARKED_AS_PAID) or pay on the simulator's pay page (PAID); search, cancel, delete, conditional rules
// (AUTO_CANCEL with SPECIFIC_DATE) and invoice numbering.
import { type ErrorDetail, v2Error } from "../errors.js";
import type { Simulator } from "../simulator.js";
import type { Account, InvoiceRecord, Json, JsonObject } from "../state.js";
import { newExternalPaymentId, newInvoiceId, newRuleId, newTransactionId } from "../util/ids.js";
import { fromCents, money, multiplyQuantity, percentOf, toCents } from "../util/money.js";
import { addDays, isoSeconds, ptDate } from "../util/time.js";

export interface InvoiceCtx {
  clientId: string;
  account: Account;
  origin: string;
  debugId: string;
}

type Result = { status: number; body?: Json; responseSchema?: string };

/** A pay-page payment: the invoice, and the simulator account that paid (null for an external payer). */
export interface PagePayment {
  record: InvoiceRecord;
  payerKey: string | null;
}

const PAYABLE = new Set(["SENT", "UNPAID", "PARTIALLY_PAID"]);
const RULE_EDITABLE = new Set(["DRAFT", "SENT", "UNPAID", "SCHEDULED", "PARTIALLY_PAID"]);
const ISSUE_DATE_CONDITIONS = new Set([
  "THREE_DAYS_AFTER_ISSUE_DATE",
  "SEVEN_DAYS_AFTER_ISSUE_DATE",
  "FIFTEEN_DAYS_AFTER_ISSUE_DATE",
  "THIRTY_DAYS_AFTER_ISSUE_DATE",
]);
const DUE_DATE_OFFSETS: Record<string, number> = {
  ONE_DAY_AFTER_DUE_DATE: 1,
  SEVEN_DAYS_AFTER_DUE_DATE: 7,
  FIFTEEN_DAYS_AFTER_DUE_DATE: 15,
  THIRTY_DAYS_AFTER_DUE_DATE: 30,
};
const ISSUE_DATE_OFFSETS: Record<string, number> = {
  THREE_DAYS_AFTER_ISSUE_DATE: 3,
  SEVEN_DAYS_AFTER_ISSUE_DATE: 7,
  FIFTEEN_DAYS_AFTER_ISSUE_DATE: 15,
  THIRTY_DAYS_AFTER_ISSUE_DATE: 30,
};

function obj(v: Json | undefined): JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}
function arr(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}
function str(v: Json | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** Receiving fee in cents: `percentBps` of the amount, rounded half up, plus the fixed fee (none on zero). */
export function invoiceFeeCents(
  amountCents: number,
  fee: { percentBps: number; fixedCents: number },
): number {
  if (amountCents <= 0) return 0;
  return Math.floor((amountCents * fee.percentBps + 5_000) / 10_000) + fee.fixedCents;
}

export class InvoicingEngine {
  constructor(private readonly sim: Simulator) {}

  private fail(ctx: { debugId: string }, status: number, details: ErrorDetail[] = []): never {
    throw v2Error("invoicing", status, ctx.debugId, details);
  }

  private notFound(ctx: { debugId: string }, id: string): never {
    this.fail(ctx, 404, [
      {
        field: "invoice_id",
        value: id,
        location: "path",
        issue: "INVALID_RESOURCE_ID",
        description: "Requested resource ID was not found.",
      },
    ]);
  }

  private owned(ctx: InvoiceCtx, id: string): InvoiceRecord {
    this.sweepAutoCancel();
    const rec = this.sim.state.invoices[id];
    if (!rec || rec.deleted || rec.accountKey !== ctx.account.key) this.notFound(ctx, id);
    return rec;
  }

  private status(rec: InvoiceRecord): string {
    return String(rec.invoice.status);
  }

  payPageUrl(id: string): string {
    return `${this.sim.pagesBaseUrl}/sim/invoice/${id}/pay`;
  }

  private invoicerViewUrl(id: string): string {
    return `${this.sim.pagesBaseUrl}/sim/invoice/${id}`;
  }

  // ── amounts ──────────────────────────────────────────────────────────────────────────────────────

  /** Recomputes amount (with breakdown) and due_amount in integer cents. Throws 400 on bad amounts. */
  private computeAmounts(ctx: { debugId: string }, inv: JsonObject): number {
    const detail = obj(inv.detail);
    const currency = str(detail.currency_code) ?? "USD";
    const config = obj(inv.configuration);
    const taxAfterDiscount = config.tax_calculated_after_discount !== false;
    const bad = (
      field: string,
      issue = "INVALID_PARAMETER_VALUE",
      description = "The value of a field is invalid.",
    ) => this.fail(ctx, 400, [{ field, location: "body", issue, description }]);
    const cents = (m: Json | undefined, field: string): number => {
      const mm = obj(m);
      if (str(mm.currency_code) !== undefined && mm.currency_code !== currency)
        bad(`${field}/currency_code`, "CURRENCY_MISMATCH", "The currency must match the invoice currency.");
      const c = toCents(str(mm.value) ?? "");
      if (c === null)
        bad(`${field}/value`, "INVALID_DECIMAL_VALUE", "The value must have at most two decimals.");
      return c as number;
    };
    let itemTotal = 0;
    let itemDiscount = 0;
    let taxTotal = 0;
    const items = arr(inv.items);
    items.forEach((it0, idx) => {
      const it = obj(it0);
      const unit = cents(it.unit_amount, `/items/${idx}/unit_amount`);
      const line = multiplyQuantity(unit, str(it.quantity) ?? "1");
      if (line === null) bad(`/items/${idx}/quantity`);
      const lineCents = line as number;
      itemTotal += lineCents;
      let disc = 0;
      const d = obj(it.discount);
      if (str(d.percent) !== undefined) disc = percentOf(lineCents, str(d.percent) as string) ?? 0;
      else if (d.amount !== undefined) disc = cents(d.amount, `/items/${idx}/discount/amount`);
      if (d.percent !== undefined || d.amount !== undefined) d.amount = money(currency, disc);
      itemDiscount += disc;
      const tax = obj(it.tax);
      if (str(tax.percent) !== undefined) {
        const base = taxAfterDiscount ? lineCents - disc : lineCents;
        const t = percentOf(base, str(tax.percent) as string) ?? 0;
        tax.amount = money(currency, t);
        taxTotal += t;
      }
    });
    const amount = obj(inv.amount);
    const breakdownIn = obj(amount.breakdown);
    const discountIn = obj(breakdownIn.discount);
    const invoiceDiscountIn = obj(discountIn.invoice_discount);
    let invoiceDiscount = 0;
    if (str(invoiceDiscountIn.percent) !== undefined)
      invoiceDiscount = percentOf(itemTotal - itemDiscount, str(invoiceDiscountIn.percent) as string) ?? 0;
    else if (invoiceDiscountIn.amount !== undefined)
      invoiceDiscount = cents(invoiceDiscountIn.amount, "/amount/breakdown/discount/invoice_discount/amount");
    const shippingIn = obj(breakdownIn.shipping);
    const shipping =
      shippingIn.amount !== undefined ? cents(shippingIn.amount, "/amount/breakdown/shipping/amount") : 0;
    let shippingTax = 0;
    const shippingTaxIn = obj(shippingIn.tax);
    if (str(shippingTaxIn.percent) !== undefined) {
      shippingTax = percentOf(shipping, str(shippingTaxIn.percent) as string) ?? 0;
      shippingTaxIn.amount = money(currency, shippingTax);
    }
    const customIn = obj(breakdownIn.custom);
    const custom =
      customIn.amount !== undefined ? cents(customIn.amount, "/amount/breakdown/custom/amount") : 0;
    const total = itemTotal - itemDiscount - invoiceDiscount + taxTotal + shipping + shippingTax + custom;
    if (total < 0) bad("/amount", "INVALID_PARAMETER_VALUE", "The invoice total cannot be negative.");
    const breakdown: JsonObject = { item_total: money(currency, itemTotal) };
    if (itemDiscount > 0 || invoiceDiscount > 0) {
      const disc: JsonObject = { item_discount: money(currency, -itemDiscount) };
      if (invoiceDiscount > 0)
        disc.invoice_discount = { ...invoiceDiscountIn, amount: money(currency, -invoiceDiscount) };
      breakdown.discount = disc;
    }
    breakdown.tax_total = money(currency, taxTotal);
    if (shippingIn.amount !== undefined) breakdown.shipping = shippingIn;
    if (customIn.amount !== undefined) breakdown.custom = customIn;
    inv.amount = { currency_code: currency, value: fromCents(total), breakdown };
    const paid = this.paidCents(inv);
    inv.due_amount = money(currency, Math.max(0, total - paid));
    return total;
  }

  private paidCents(inv: JsonObject): number {
    let paid = 0;
    for (const t of arr(obj(inv.payments).transactions))
      paid += toCents(str(obj(obj(t).amount).value) ?? "0") ?? 0;
    return paid;
  }

  private totalCents(inv: JsonObject): number {
    return toCents(str(obj(inv.amount).value) ?? "0") ?? 0;
  }

  // ── representation ───────────────────────────────────────────────────────────────────────────────

  private links(rec: InvoiceRecord, origin: string): JsonObject[] {
    const base = `${origin}/v2/invoicing/invoices/${rec.id}`;
    const s = this.status(rec);
    const out: JsonObject[] = [{ href: base, rel: "self", method: "GET" }];
    if (s === "DRAFT" || s === "SCHEDULED") {
      out.push({ href: `${base}/send`, rel: "send", method: "POST" });
      out.push({ href: base, rel: "replace", method: "PUT" });
      out.push({ href: base, rel: "delete", method: "DELETE" });
    }
    if (PAYABLE.has(s)) {
      out.push({ href: `${base}/payments`, rel: "record-payment", method: "POST" });
      out.push({ href: `${base}/remind`, rel: "remind", method: "POST" });
      out.push({ href: `${base}/cancel`, rel: "cancel", method: "POST" });
      out.push({ href: base, rel: "replace", method: "PUT" });
    }
    if (s === "PAID" || s === "MARKED_AS_PAID" || s === "PARTIALLY_PAID")
      out.push({ href: `${base}/refunds`, rel: "record-refund", method: "POST" });
    out.push({ href: `${base}/generate-qr-code`, rel: "qr-code", method: "POST" });
    return out;
  }

  repr(rec: InvoiceRecord, origin: string): JsonObject {
    return { ...structuredClone(rec.invoice), links: this.links(rec, origin) };
  }

  private emit(rec: InvoiceRecord, eventType: string, summary: string): void {
    this.sim.webhooks.emit({
      clientId: rec.clientId,
      eventType,
      resourceType: "invoices",
      resourceVersion: "2.0",
      summary,
      resource: { invoice: this.repr(rec, this.sim.options.apiBaseUrl) },
      resourceIds: [rec.id],
    });
  }

  // ── numbering ────────────────────────────────────────────────────────────────────────────────────

  private numberInUse(accountKey: string, number: string, exceptId?: string): InvoiceRecord | undefined {
    return Object.values(this.sim.state.invoices).find(
      (r) =>
        !r.deleted &&
        r.accountKey === accountKey &&
        r.id !== exceptId &&
        str(obj(r.invoice.detail).invoice_number) === number,
    );
  }

  private nextNumber(accountKey: string): string {
    let n = this.sim.state.invoiceCounters[accountKey] ?? 0;
    let candidate: string;
    do {
      n++;
      candidate = String(n).padStart(4, "0");
    } while (this.numberInUse(accountKey, candidate));
    this.sim.state.invoiceCounters[accountKey] = n;
    return candidate;
  }

  generateNextNumber(ctx: InvoiceCtx): Result {
    const accountKey = ctx.account.key;
    const n = (this.sim.state.invoiceCounters[accountKey] ?? 0) + 1;
    let candidate = String(n).padStart(4, "0");
    let k = n;
    while (this.numberInUse(accountKey, candidate)) {
      k++;
      candidate = String(k).padStart(4, "0");
    }
    return { status: 200, body: { invoice_number: candidate } };
  }

  // ── create / read / update / delete ───────────────────────────────────────────────────────────────

  private build(ctx: InvoiceCtx, body: JsonObject, existing?: InvoiceRecord): JsonObject {
    const now = this.sim.clock.now();
    const detailIn = obj(body.detail);
    const invoicerIn = obj(body.invoicer);
    const invoicerEmail = str(invoicerIn.email_address);
    if (invoicerEmail !== undefined && invoicerEmail.toLowerCase() !== ctx.account.email.toLowerCase()) {
      this.fail(ctx, 422, [
        {
          field: "/invoicer/email_address",
          value: invoicerEmail,
          location: "body",
          issue: "USER_NOT_FOUND",
          description: "User is not associated with paypal based on invoicer email.",
        },
      ]);
    }
    const number = str(detailIn.invoice_number);
    if (number !== undefined) {
      const clash = this.numberInUse(ctx.account.key, number, existing?.id);
      if (clash) {
        // Shape as observed from PayPal; the text is unverified (S3.6.3 says never to parse it).
        this.fail(ctx, 422, [
          {
            field: "/detail/invoice_number",
            value: number,
            location: "body",
            issue: "DUPLICATE_INVOICE_NUMBER",
            description: "Invoice number already exists.",
          },
        ]);
      }
    }
    const id = existing?.id ?? newInvoiceId();
    const prevMeta = obj(obj(existing?.invoice.detail).metadata);
    const detail: JsonObject = { ...detailIn };
    detail.invoice_number =
      number ?? str(obj(existing?.invoice.detail).invoice_number) ?? this.nextNumber(ctx.account.key);
    detail.invoice_date =
      str(detailIn.invoice_date) ?? str(obj(existing?.invoice.detail).invoice_date) ?? ptDate(now);
    detail.metadata = {
      ...prevMeta,
      create_time: str(prevMeta.create_time) ?? isoSeconds(now),
      created_by: str(prevMeta.created_by) ?? ctx.account.email,
      last_update_time: isoSeconds(now),
      last_updated_by: ctx.account.email,
      created_by_flow: "REGULAR_SINGLE",
      recipient_view_url: this.payPageUrl(id),
      invoicer_view_url: this.invoicerViewUrl(id),
    };
    const invoicer: JsonObject = { ...invoicerIn, email_address: invoicerEmail ?? ctx.account.email };
    if (invoicer.business_name === undefined && ctx.account.business_name)
      invoicer.business_name = ctx.account.business_name;
    const configuration: JsonObject = {
      tax_calculated_after_discount: true,
      tax_inclusive: false,
      allow_tip: false,
      template_id: "TEMP-SIMULATOR-DEFAULT",
      ...obj(body.configuration),
      has_conditional_rule: (existing?.rules.length ?? 0) > 0,
    };
    const inv: JsonObject = {
      id,
      status: existing ? (existing.invoice.status ?? "DRAFT") : "DRAFT",
      detail,
      invoicer,
      primary_recipients: structuredClone(arr(body.primary_recipients)),
    };
    if (body.additional_recipients !== undefined)
      inv.additional_recipients = structuredClone(body.additional_recipients);
    inv.items = structuredClone(arr(body.items));
    inv.configuration = configuration;
    if (body.amount !== undefined) inv.amount = structuredClone(body.amount);
    if (existing?.invoice.payments !== undefined) inv.payments = structuredClone(existing.invoice.payments);
    this.computeAmounts(ctx, inv);
    return inv;
  }

  create(ctx: InvoiceCtx, body: JsonObject, prefer: string | null): Result {
    const inv = this.build(ctx, body);
    const rec: InvoiceRecord = {
      id: String(inv.id),
      clientId: ctx.clientId,
      accountKey: ctx.account.key,
      createdAt: this.sim.clock.now(),
      deleted: false,
      invoice: inv,
      rules: [],
    };
    this.sim.state.invoices[rec.id] = rec;
    this.sim.markDirty();
    this.emit(rec, "INVOICING.INVOICE.CREATED", "An invoice has been created.");
    if (prefer?.toLowerCase().includes("return=representation"))
      return { status: 201, body: this.repr(rec, ctx.origin) };
    return {
      status: 201,
      body: { href: `${ctx.origin}/v2/invoicing/invoices/${rec.id}`, rel: "self", method: "GET" },
      responseSchema: "link_description",
    };
  }

  get(ctx: InvoiceCtx, id: string): Result {
    return { status: 200, body: this.repr(this.owned(ctx, id), ctx.origin) };
  }

  update(ctx: InvoiceCtx, id: string, body: JsonObject): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    if (!["DRAFT", "SENT", "UNPAID", "SCHEDULED", "PARTIALLY_PAID"].includes(s)) {
      this.fail(ctx, 422, [
        { issue: "CANNOT_UPDATE_INVOICE", description: `An invoice in status ${s} cannot be updated.` },
      ]);
    }
    const inv = this.build(ctx, body, rec);
    inv.status = s;
    rec.invoice = inv;
    this.sim.markDirty();
    this.emit(rec, "INVOICING.INVOICE.UPDATED", "An invoice has been updated.");
    return { status: 200, body: this.repr(rec, ctx.origin) };
  }

  remove(ctx: InvoiceCtx, id: string): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    if (s !== "DRAFT" && s !== "SCHEDULED") {
      this.fail(ctx, 422, [
        {
          field: "invoice_id",
          value: id,
          location: "path",
          issue: "CANNOT_DELETE_INVOICE",
          description: "Only draft or scheduled invoices can be deleted.",
        },
      ]);
    }
    rec.deleted = true;
    this.sim.markDirty();
    return { status: 204 };
  }

  private page(ctx: InvoiceCtx, query: URLSearchParams, maxSize: number): { page: number; pageSize: number } {
    const page = Number(query.get("page") ?? "1");
    const pageSize = Number(query.get("page_size") ?? "20");
    if (!Number.isInteger(page) || page < 1 || page > 1000)
      this.fail(ctx, 400, [
        {
          field: "page",
          location: "query",
          issue: page < 1 ? "INVALID_INTEGER_MIN_VALUE" : "INVALID_INTEGER_MAX_VALUE",
        },
      ]);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > maxSize)
      this.fail(ctx, 400, [
        {
          field: "page_size",
          location: "query",
          issue: pageSize < 1 ? "INVALID_INTEGER_MIN_VALUE" : "INVALID_INTEGER_MAX_VALUE",
          description:
            pageSize < 1 ? "Value less than minimum value." : "The integer value of a field is too large.",
        },
      ]);
    return { page, pageSize };
  }

  private paged(
    ctx: InvoiceCtx,
    path: string,
    all: InvoiceRecord[],
    query: URLSearchParams,
    method: string,
  ): Result {
    const { page, pageSize } = this.page(ctx, query, 100);
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const body: JsonObject = {};
    if (query.get("total_required") === "true") {
      body.total_items = all.length;
      body.total_pages = totalPages;
    }
    body.items = all.slice((page - 1) * pageSize, page * pageSize).map((r) => this.repr(r, ctx.origin));
    const links: JsonObject[] = [
      { href: `${ctx.origin}${path}?page=${page}&page_size=${pageSize}`, rel: "self", method },
    ];
    if (page < totalPages)
      links.push({
        href: `${ctx.origin}${path}?page=${page + 1}&page_size=${pageSize}`,
        rel: "next",
        method,
      });
    if (page > 1)
      links.push({
        href: `${ctx.origin}${path}?page=${page - 1}&page_size=${pageSize}`,
        rel: "prev",
        method,
      });
    body.links = links;
    return { status: 200, body };
  }

  private mine(ctx: InvoiceCtx): InvoiceRecord[] {
    this.sweepAutoCancel();
    return Object.values(this.sim.state.invoices)
      .filter((r) => !r.deleted && r.accountKey === ctx.account.key)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  list(ctx: InvoiceCtx, query: URLSearchParams): Result {
    return this.paged(ctx, "/v2/invoicing/invoices", this.mine(ctx), query, "GET");
  }

  search(ctx: InvoiceCtx, body: JsonObject, query: URLSearchParams): Result {
    const statuses = arr(body.status).filter((s): s is string => typeof s === "string");
    const inRange = (value: string | undefined, range: JsonObject): boolean => {
      if (value === undefined) return false;
      const start = str(range.start);
      const end = str(range.end);
      return (start === undefined || value >= start) && (end === undefined || value <= end);
    };
    const matches = this.mine(ctx).filter((r) => {
      const inv = r.invoice;
      const detail = obj(inv.detail);
      if (str(body.invoice_number) !== undefined && detail.invoice_number !== body.invoice_number)
        return false;
      if (statuses.length > 0 && !statuses.includes(String(inv.status))) return false;
      if (str(body.reference) !== undefined && detail.reference !== body.reference) return false;
      if (str(body.memo) !== undefined && detail.memo !== body.memo) return false;
      if (str(body.currency_code) !== undefined && detail.currency_code !== body.currency_code) return false;
      const recipients = arr(inv.primary_recipients).map((p) => obj(obj(p).billing_info));
      const email = str(body.recipient_email)?.toLowerCase();
      if (email !== undefined && !recipients.some((b) => str(b.email_address)?.toLowerCase() === email))
        return false;
      const first = str(body.recipient_first_name);
      if (first !== undefined && !recipients.some((b) => obj(b.name).given_name === first)) return false;
      const last = str(body.recipient_last_name);
      if (last !== undefined && !recipients.some((b) => obj(b.name).surname === last)) return false;
      const biz = str(body.recipient_business_name);
      if (biz !== undefined && !recipients.some((b) => b.business_name === biz)) return false;
      const totalRange = obj(body.total_amount_range);
      if (body.total_amount_range !== undefined) {
        const total = this.totalCents(inv);
        const lo = toCents(str(obj(totalRange.lower_amount).value) ?? "0") ?? 0;
        const hi = toCents(str(obj(totalRange.upper_amount).value) ?? "0") ?? 0;
        if (total < lo || total > hi) return false;
      }
      if (
        body.invoice_date_range !== undefined &&
        !inRange(str(detail.invoice_date), obj(body.invoice_date_range))
      )
        return false;
      if (
        body.due_date_range !== undefined &&
        !inRange(str(obj(detail.payment_term).due_date), obj(body.due_date_range))
      )
        return false;
      if (
        body.creation_date_range !== undefined &&
        !inRange(isoSeconds(r.createdAt), obj(body.creation_date_range))
      )
        return false;
      return true;
    });
    return this.paged(ctx, "/v2/invoicing/search-invoices", matches, query, "POST");
  }

  // ── lifecycle ────────────────────────────────────────────────────────────────────────────────────

  send(ctx: InvoiceCtx, id: string, body: JsonObject): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    const payerView = { href: this.payPageUrl(rec.id), rel: "payer-view", method: "GET" };
    if (PAYABLE.has(s) || s === "SCHEDULED") {
      // "After you send an invoice, resending it has no effect."
      return { status: 200, body: payerView };
    }
    if (s !== "DRAFT") {
      this.fail(ctx, 422, [
        {
          field: "invoice_id",
          value: id,
          location: "path",
          issue: "INVALID_INVOICE_STATUS",
          description: `An invoice in status ${s} cannot be sent.`,
        },
      ]);
    }
    const now = this.sim.clock.now();
    const detail = obj(rec.invoice.detail);
    const meta = obj(detail.metadata);
    const invoiceDate = str(detail.invoice_date) ?? ptDate(now);
    if (invoiceDate > ptDate(now)) {
      rec.invoice.status = "SCHEDULED";
      meta.last_update_time = isoSeconds(now);
      detail.metadata = meta;
      this.sim.markDirty();
      this.emit(rec, "INVOICING.INVOICE.SCHEDULED", "An invoice has been scheduled.");
      return {
        status: 202,
        body: { href: `${ctx.origin}/v2/invoicing/invoices/${rec.id}`, rel: "self", method: "GET" },
      };
    }
    const toRecipient = body.send_to_recipient !== false;
    rec.invoice.status = toRecipient ? "SENT" : "UNPAID";
    if (meta.first_sent_time === undefined) meta.first_sent_time = isoSeconds(now);
    meta.last_sent_time = isoSeconds(now);
    meta.last_sent_by = ctx.account.email;
    meta.last_update_time = isoSeconds(now);
    detail.metadata = meta;
    this.sim.markDirty();
    this.emit(rec, "INVOICING.INVOICE.UPDATED", "An invoice has been sent.");
    return { status: 200, body: payerView };
  }

  remind(ctx: InvoiceCtx, id: string): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    if (!["SENT", "UNPAID", "PARTIALLY_PAID"].includes(s)) {
      this.fail(ctx, 422, [
        { issue: "CANNOT_REMIND_INVOICE", description: `An invoice in status ${s} cannot be reminded.` },
      ]);
    }
    return { status: 204 };
  }

  cancel(ctx: InvoiceCtx, id: string): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    const issue: Record<string, string> = {
      DRAFT: "CANNOT_CANCEL_DRAFT_INVOICE",
      PAID: "CANNOT_CANCEL_PAID_INVOICE",
      MARKED_AS_PAID: "CANNOT_CANCEL_PAID_INVOICE",
      REFUNDED: "CANNOT_CANCEL_REFUNDED_INVOICE",
      MARKED_AS_REFUNDED: "CANNOT_CANCEL_REFUNDED_INVOICE",
      SCHEDULED: "CANNOT_CANCEL_SCHEDULED_INVOICE",
      CANCELLED: "INVOICE_CANCELED_ALREADY",
      AUTO_CANCELLED: "INVOICE_CANCELED_ALREADY",
    };
    const blocked = issue[s];
    if (blocked)
      this.fail(ctx, 422, [
        { issue: blocked, description: `An invoice in status ${s} cannot be cancelled.` },
      ]);
    this.markCancelled(rec, "CANCELLED", ctx.account.email);
    return { status: 204 };
  }

  private markCancelled(rec: InvoiceRecord, status: "CANCELLED" | "AUTO_CANCELLED", by: string): void {
    const now = this.sim.clock.now();
    rec.invoice.status = status;
    const detail = obj(rec.invoice.detail);
    const meta = obj(detail.metadata);
    meta.cancel_time = isoSeconds(now);
    meta.cancelled_by = by;
    meta.last_update_time = isoSeconds(now);
    detail.metadata = meta;
    this.sim.markDirty();
    this.emit(rec, "INVOICING.INVOICE.CANCELLED", "An invoice has been cancelled.");
  }

  recordPayment(ctx: InvoiceCtx, id: string, body: JsonObject): Result {
    const rec = this.owned(ctx, id);
    const s = this.status(rec);
    if (!PAYABLE.has(s)) {
      this.fail(ctx, 422, [
        {
          issue: "CANNOT_PROCESS_PAYMENTS",
          description: `Payments cannot be recorded on an invoice in status ${s}.`,
        },
      ]);
    }
    const inv = rec.invoice;
    const currency = str(obj(inv.detail).currency_code) ?? "USD";
    const due = toCents(str(obj(inv.due_amount).value) ?? "0") ?? 0;
    let cents = due;
    if (body.amount !== undefined) {
      const amt = obj(body.amount);
      const c = toCents(str(amt.value) ?? "");
      if (c === null || str(amt.currency_code) !== currency) {
        this.fail(ctx, 400, [
          {
            field: "/amount",
            location: "body",
            issue: "INVALID_PARAMETER_VALUE",
            description: "The value of a field is invalid.",
          },
        ]);
      }
      cents = c as number;
      if (cents <= 0)
        this.fail(ctx, 400, [{ field: "/amount/value", location: "body", issue: "VALUE_CANNOT_BE_ZERO" }]);
    }
    if (cents > due) {
      this.fail(ctx, 422, [
        {
          field: "/amount/value",
          location: "body",
          issue: "PAYMENT_AMOUNT_GREATER_THAN_AMOUNT_DUE",
          description: "The payment amount is greater than the amount due.",
        },
      ]);
    }
    const now = this.sim.clock.now();
    const paymentId = newExternalPaymentId();
    const txn: JsonObject = {
      type: "EXTERNAL",
      payment_id: paymentId,
      payment_date: str(body.payment_date) ?? ptDate(now),
      method: str(body.method) ?? "OTHER",
    };
    if (typeof body.note === "string") txn.note = body.note;
    txn.amount = money(currency, cents);
    if (body.shipping_info !== undefined) txn.shipping_info = structuredClone(body.shipping_info);
    this.applyPayment(rec, txn, currency, true);
    return { status: 200, body: { payment_id: paymentId } };
  }

  private applyPayment(rec: InvoiceRecord, txn: JsonObject, currency: string, external: boolean): void {
    const inv = rec.invoice;
    const payments = obj(inv.payments);
    const txns = arr(payments.transactions);
    txns.push(txn);
    const paid = this.paidCents({ payments: { transactions: txns } });
    payments.transactions = txns;
    payments.paid_amount = money(currency, paid);
    inv.payments = payments;
    const total = this.totalCents(inv);
    inv.due_amount = money(currency, Math.max(0, total - paid));
    const fullyPaid = paid >= total;
    inv.status = fullyPaid ? (external ? "MARKED_AS_PAID" : "PAID") : "PARTIALLY_PAID";
    const detail = obj(inv.detail);
    const meta = obj(detail.metadata);
    meta.last_update_time = isoSeconds(this.sim.clock.now());
    detail.metadata = meta;
    this.sim.markDirty();
    this.emit(
      rec,
      "INVOICING.INVOICE.PAID",
      fullyPaid ? "An invoice has been paid." : "An invoice has been partially paid.",
    );
  }

  deletePayment(ctx: InvoiceCtx, id: string, transactionId: string): Result {
    const rec = this.owned(ctx, id);
    const inv = rec.invoice;
    const payments = obj(inv.payments);
    const txns = arr(payments.transactions);
    const idx = txns.findIndex((t) => obj(t).payment_id === transactionId);
    if (idx < 0)
      this.fail(ctx, 404, [
        { field: "transaction_id", value: transactionId, location: "path", issue: "INVALID_RESOURCE_ID" },
      ]);
    if (obj(txns[idx]).type !== "EXTERNAL")
      this.fail(ctx, 422, [
        { issue: "CANNOT_DELETE_EXTERNAL_PAYMENT", description: "Only external payments can be deleted." },
      ]);
    txns.splice(idx, 1);
    const currency = str(obj(inv.detail).currency_code) ?? "USD";
    const paid = this.paidCents({ payments: { transactions: txns } });
    payments.transactions = txns;
    payments.paid_amount = money(currency, paid);
    inv.payments = payments;
    inv.due_amount = money(currency, Math.max(0, this.totalCents(inv) - paid));
    inv.status =
      paid === 0 ? (obj(obj(inv.detail).metadata).first_sent_time ? "UNPAID" : "DRAFT") : "PARTIALLY_PAID";
    this.sim.markDirty();
    this.emit(rec, "INVOICING.INVOICE.UPDATED", "An invoice has been updated.");
    return { status: 204 };
  }

  /**
   * The simulator's public pay page: the invoice's billing recipient settles the full amount due with a
   * (simulated) PayPal payment. Nobody chooses the payer here, as nobody can on PayPal: it is the account
   * whose email is `primary_recipients[0].billing_info.email_address`, or, when no simulator account has that
   * email, an external payer whose money the simulator does not hold (nothing is debited).
   */
  payOnPage(id: string): PagePayment {
    return this.settle(id, undefined);
  }

  /**
   * Pays as the named simulator account instead of the billing recipient. Only the admin API (behind its
   * gate) and in-process code reach this; the public pay page never does.
   */
  payAs(id: string, payerKey: string): PagePayment {
    return this.settle(id, payerKey);
  }

  /** Either way: never the invoicer, never an unknown account, never a payer balance below zero. */
  private settle(id: string, payerKey: string | undefined): PagePayment {
    this.sweepAutoCancel();
    const rec = this.sim.state.invoices[id];
    if (!rec || rec.deleted) throw new Error("invoice not found");
    const s = this.status(rec);
    if (!PAYABLE.has(s)) throw new Error(`invoice is ${s}`);
    const inv = rec.invoice;
    const currency = str(obj(inv.detail).currency_code) ?? "USD";
    const due = toCents(str(obj(inv.due_amount).value) ?? "0") ?? 0;
    const recipient = obj(obj(arr(inv.primary_recipients)[0]).billing_info);
    const billedTo = str(recipient.email_address);
    let payer: Account | undefined;
    if (payerKey !== undefined) {
      payer = this.sim.accountByKey(payerKey);
      if (!payer) throw new Error("unknown payer account");
    } else if (billedTo !== undefined) {
      payer = this.sim.accountByEmail(billedTo);
    }
    if (payer?.key === rec.accountKey) throw new Error("an invoicer cannot pay its own invoice");
    if (payer && this.sim.balance(payer.key, currency).available < due)
      throw new Error("the payer's simulated PayPal balance does not cover the amount due");
    // Everything is checked: from here on the payment is posted in full.
    const now = this.sim.clock.now();
    const transactionId = newTransactionId();
    const feeCents = invoiceFeeCents(due, this.sim.options.invoiceFee);
    this.sim.post({
      accountKey: rec.accountKey,
      currency,
      availableCents: due - feeCents,
      withheldCents: 0,
      kind: "invoice.paid",
      ref: rec.id,
    });
    if (payer) {
      this.sim.post({
        accountKey: payer.key,
        currency,
        availableCents: -due,
        withheldCents: 0,
        kind: "invoice.payment",
        ref: rec.id,
      });
    }
    this.sim.recordTransaction({
      accountKey: rec.accountKey,
      at: now,
      updatedAt: now,
      transactionId,
      eventCode: "T0000",
      status: "S",
      currency,
      amountCents: due,
      feeCents: -feeCents,
      counterpartyKey: payer?.key ?? null,
      counterpartyEmail: payer?.email ?? billedTo ?? null,
      note: null,
      subject: null,
      invoiceNumber: str(obj(inv.detail).invoice_number) ?? null,
      customField: null,
    });
    const txn: JsonObject = {
      type: "PAYPAL",
      payment_id: transactionId,
      payment_date: ptDate(now),
      method: "PAYPAL",
      amount: money(currency, due),
    };
    this.applyPayment(rec, txn, currency, false);
    return { record: rec, payerKey: payer?.key ?? null };
  }

  // ── conditional rules ────────────────────────────────────────────────────────────────────────────

  private ruleLinks(rec: InvoiceRecord, ruleId: string, origin: string): JsonObject[] {
    const href = `${origin}/v2/invoicing/invoices/${rec.id}/conditional-rules/${ruleId}`;
    return [
      { href, rel: "self", method: "GET" },
      { href, rel: "update", method: "PUT" },
      { href, rel: "delete", method: "DELETE" },
    ];
  }

  private ruleRepr(rec: InvoiceRecord, rule: JsonObject, origin: string): JsonObject {
    return { ...structuredClone(rule), links: this.ruleLinks(rec, String(rule.conditional_rule_id), origin) };
  }

  private validateRule(ctx: InvoiceCtx, rec: InvoiceRecord, rule: JsonObject, path: string): JsonObject {
    const type = str(rule.conditional_rule_type) ?? "";
    const terms = obj(rule.rule_expiry_terms);
    const condition = str(terms.rule_expiry_condition) ?? "";
    const invalid = (field: string, description: string): never =>
      this.fail(ctx, 400, [{ field, location: "body", issue: "INVALID_PARAMETER_VALUE", description }]);
    if (type === "AUTO_CANCEL" && ISSUE_DATE_CONDITIONS.has(condition))
      invalid(
        `${path}/rule_expiry_terms/rule_expiry_condition`,
        "Issue-date conditions apply to early payment discounts.",
      );
    if (type === "EARLY_PAYMENT_DISCOUNT" && DUE_DATE_OFFSETS[condition] !== undefined)
      invalid(
        `${path}/rule_expiry_terms/rule_expiry_condition`,
        "Due-date conditions apply to auto-cancellation.",
      );
    if (type === "EARLY_PAYMENT_DISCOUNT") {
      if (
        str(rule.conditional_rule_value_type) === undefined ||
        str(rule.conditional_rule_value) === undefined
      )
        invalid(
          path,
          "conditional_rule_value_type and conditional_rule_value are required for EARLY_PAYMENT_DISCOUNT.",
        );
      if (rule.conditional_rule_value_type === "PERCENT") {
        const p = Number(rule.conditional_rule_value);
        if (!(p >= 1 && p <= 100))
          invalid(`${path}/conditional_rule_value`, "A percentage must be between 1 and 100.");
      }
    }
    const today = ptDate(this.sim.clock.now());
    const detail = obj(rec.invoice.detail);
    let endDate: string;
    if (condition === "SPECIFIC_DATE") {
      const d = str(terms.condition_rule_end_date);
      if (d === undefined)
        this.fail(ctx, 400, [
          {
            field: `${path}/rule_expiry_terms/condition_rule_end_date`,
            location: "body",
            issue: "MISSING_REQUIRED_PARAMETER",
            description: "condition_rule_end_date is required with SPECIFIC_DATE.",
          },
        ]);
      endDate = d as string;
      if (endDate <= today)
        invalid(`${path}/rule_expiry_terms/condition_rule_end_date`, "The date must be in the future.");
    } else if (ISSUE_DATE_OFFSETS[condition] !== undefined) {
      endDate = addDays(str(detail.invoice_date) ?? today, ISSUE_DATE_OFFSETS[condition] as number);
    } else {
      const due = str(obj(detail.payment_term).due_date) ?? str(detail.invoice_date) ?? today;
      endDate = addDays(due, DUE_DATE_OFFSETS[condition] ?? 0);
    }
    const now = isoSeconds(this.sim.clock.now());
    const out: JsonObject = {
      conditional_rule_id: str(rule.conditional_rule_id) ?? newRuleId(),
      conditional_rule_type: type,
    };
    if (rule.conditional_rule_value !== undefined) out.conditional_rule_value = rule.conditional_rule_value;
    if (rule.conditional_rule_value_type !== undefined)
      out.conditional_rule_value_type = rule.conditional_rule_value_type;
    out.rule_expiry_terms = { rule_expiry_condition: condition, condition_rule_end_date: endDate };
    out.create_time = now;
    out.update_time = now;
    return out;
  }

  private ruleOwner(ctx: InvoiceCtx, id: string): InvoiceRecord {
    const rec = this.owned(ctx, id);
    return rec;
  }

  createRules(ctx: InvoiceCtx, id: string, body: JsonObject): Result {
    const rec = this.ruleOwner(ctx, id);
    const s = this.status(rec);
    if (!RULE_EDITABLE.has(s))
      this.fail(ctx, 422, [
        {
          issue: "CANNOT_ADD_CONDITIONAL_RULE",
          description: `Rules cannot be added to an invoice in status ${s}.`,
        },
      ]);
    const incoming = arr(body.rules).map(obj);
    if (rec.rules.length + incoming.length > 5)
      this.fail(ctx, 400, [{ field: "/rules", location: "body", issue: "INVALID_ARRAY_MAX_ITEMS" }]);
    const created: JsonObject[] = [];
    incoming.forEach((r, idx) => {
      const type = str(r.conditional_rule_type);
      if ([...rec.rules, ...created].some((x) => x.conditional_rule_type === type))
        this.fail(ctx, 422, [
          {
            field: `/rules/${idx}/conditional_rule_type`,
            value: type ?? "",
            location: "body",
            issue: "CONDITIONAL_RULE_ALREADY_EXISTS",
            description: "The invoice already has a rule of this type.",
          },
        ]);
      const { conditional_rule_id: _ignored, ...rest } = r;
      created.push(this.validateRule(ctx, rec, rest, `/rules/${idx}`));
    });
    rec.rules.push(...created);
    obj(rec.invoice.configuration).has_conditional_rule = true;
    this.sim.markDirty();
    return {
      status: 201,
      body: {
        rules: created.map((r) => this.ruleRepr(rec, r, ctx.origin)),
        links: [
          {
            href: `${ctx.origin}/v2/invoicing/invoices/${rec.id}/conditional-rules`,
            rel: "self",
            method: "GET",
          },
        ],
      },
    };
  }

  listRules(ctx: InvoiceCtx, id: string): Result {
    const rec = this.ruleOwner(ctx, id);
    return {
      status: 200,
      body: {
        rules: rec.rules.map((r) => this.ruleRepr(rec, r, ctx.origin)),
        links: [
          {
            href: `${ctx.origin}/v2/invoicing/invoices/${rec.id}/conditional-rules`,
            rel: "self",
            method: "GET",
          },
        ],
      },
    };
  }

  private findRule(ctx: InvoiceCtx, rec: InvoiceRecord, ruleId: string): number {
    const idx = rec.rules.findIndex((r) => r.conditional_rule_id === ruleId);
    if (idx < 0)
      this.fail(ctx, 404, [
        { field: "conditional_rule_id", value: ruleId, location: "path", issue: "INVALID_RESOURCE_ID" },
      ]);
    return idx;
  }

  getRule(ctx: InvoiceCtx, id: string, ruleId: string): Result {
    const rec = this.ruleOwner(ctx, id);
    const rule = rec.rules[this.findRule(ctx, rec, ruleId)] as JsonObject;
    return { status: 200, body: this.ruleRepr(rec, rule, ctx.origin) };
  }

  updateRule(ctx: InvoiceCtx, id: string, ruleId: string, body: JsonObject): Result {
    const rec = this.ruleOwner(ctx, id);
    const idx = this.findRule(ctx, rec, ruleId);
    const prev = rec.rules[idx] as JsonObject;
    const next = this.validateRule(ctx, rec, { ...body, conditional_rule_id: ruleId }, "");
    next.create_time = prev.create_time ?? next.create_time ?? null;
    rec.rules[idx] = next;
    this.sim.markDirty();
    return { status: 200, body: this.ruleRepr(rec, next, ctx.origin) };
  }

  deleteRule(ctx: InvoiceCtx, id: string, ruleId: string): Result {
    const rec = this.ruleOwner(ctx, id);
    rec.rules.splice(this.findRule(ctx, rec, ruleId), 1);
    obj(rec.invoice.configuration).has_conditional_rule = rec.rules.length > 0;
    this.sim.markDirty();
    return { status: 204 };
  }

  /** AUTO_CANCEL: an unpaid invoice whose rule date has passed (merchant time) becomes AUTO_CANCELLED. */
  sweepAutoCancel(): void {
    const now = this.sim.clock.now();
    const today = ptDate(now);
    for (const rec of Object.values(this.sim.state.invoices)) {
      if (rec.deleted) continue;
      let s = this.status(rec);
      // A scheduled invoice goes out on its invoice date (merchant time).
      const detail = obj(rec.invoice.detail);
      if (s === "SCHEDULED" && (str(detail.invoice_date) ?? today) <= today) {
        rec.invoice.status = "SENT";
        const meta = obj(detail.metadata);
        meta.first_sent_time = meta.first_sent_time ?? isoSeconds(now);
        meta.last_sent_time = isoSeconds(now);
        meta.last_update_time = isoSeconds(now);
        detail.metadata = meta;
        s = "SENT";
        this.sim.markDirty();
        this.emit(rec, "INVOICING.INVOICE.UPDATED", "A scheduled invoice has been sent.");
      }
      if (!PAYABLE.has(s) && s !== "SCHEDULED") continue;
      const rule = rec.rules.find((r) => r.conditional_rule_type === "AUTO_CANCEL");
      if (!rule) continue;
      const end = str(obj(rule.rule_expiry_terms).condition_rule_end_date);
      if (end !== undefined && today > end) this.markCancelled(rec, "AUTO_CANCELLED", "SYSTEM");
    }
  }
}
