// Transaction Search over the simulator's own activity (payout items T0001, returns T1115, invoice payments
// received on the pay page T0000) and the balances read. Recorded payments (MARKED_AS_PAID) move no money
// inside PayPal, so they create no transaction, exactly as the reconciliation spec expects.
import { v2Error } from "../errors.js";
import type { Simulator } from "../simulator.js";
import type { Account, JsonObject, TransactionRecord } from "../state.js";
import { money } from "../util/money.js";
import { isoSeconds } from "../util/time.js";

export interface ReportingCtx {
  account: Account;
  origin: string;
  debugId: string;
}

type Result = { status: number; body: JsonObject };

const MAX_RANGE_MS = 31 * 86_400_000;

/** transaction_note / transaction_subject / invoice_id / custom_field only allow this character set. */
function sanitize(s: string, max: number): string {
  return s
    .replace(/[^a-zA-Z0-9_'\-., ":;!?]/g, " ")
    .slice(0, max)
    .trim();
}

function parseTime(v: string | null): number | null {
  if (v === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.test(v)) return Number.NaN;
  const t = Date.parse(v);
  return Number.isNaN(t) ? Number.NaN : t;
}

export class ReportingEngine {
  constructor(private readonly sim: Simulator) {}

  private bad(ctx: ReportingCtx, field: string, issue: string, description: string, value?: string): never {
    throw v2Error("reporting", 400, ctx.debugId, [
      { field, ...(value !== undefined ? { value } : {}), location: "query", issue, description },
    ]);
  }

  private txnJson(t: TransactionRecord, withPayer: boolean): JsonObject {
    const counterparty = t.counterpartyKey ? this.sim.accountByKey(t.counterpartyKey) : undefined;
    const info: JsonObject = {};
    if (counterparty) info.paypal_account_id = counterparty.payer_id;
    info.transaction_id = t.transactionId;
    info.transaction_event_code = t.eventCode;
    info.transaction_initiation_date = isoSeconds(t.at);
    info.transaction_updated_date = isoSeconds(t.updatedAt);
    info.transaction_amount = money(t.currency, t.amountCents);
    info.fee_amount = money(t.currency, t.feeCents);
    info.transaction_status = t.status;
    if (t.subject) {
      const s = sanitize(t.subject, 256);
      if (s) info.transaction_subject = s;
    }
    if (t.note) {
      const s = sanitize(t.note, 4000);
      if (s) info.transaction_note = s;
    }
    if (t.invoiceNumber) {
      const s = sanitize(t.invoiceNumber, 127);
      if (s) info.invoice_id = s;
    }
    if (t.customField) {
      const s = sanitize(t.customField, 127);
      if (s) info.custom_field = s;
    }
    info.protection_eligibility = "02";
    const out: JsonObject = { transaction_info: info };
    if (withPayer) {
      const payer: JsonObject = {};
      if (counterparty) payer.account_id = counterparty.payer_id;
      if (t.counterpartyEmail) payer.email_address = t.counterpartyEmail;
      if (counterparty) {
        payer.address_status = "Y";
        payer.payer_status = "Y";
        const name: JsonObject = {};
        if (counterparty.given_name) name.given_name = counterparty.given_name;
        if (counterparty.surname) name.surname = counterparty.surname;
        if (Object.keys(name).length > 0) payer.payer_name = name;
        payer.country_code = counterparty.country_code;
      }
      out.payer_info = payer;
    }
    return out;
  }

  search(ctx: ReportingCtx, query: URLSearchParams): Result {
    const startRaw = query.get("start_date");
    const endRaw = query.get("end_date");
    if (startRaw === null)
      this.bad(ctx, "start_date", "MISSING_REQUIRED_PARAMETER", "A required field is missing.");
    if (endRaw === null)
      this.bad(ctx, "end_date", "MISSING_REQUIRED_PARAMETER", "A required field is missing.");
    const start = parseTime(startRaw);
    const end = parseTime(endRaw);
    if (start === null || Number.isNaN(start))
      this.bad(
        ctx,
        "start_date",
        "INVALID_PARAMETER_SYNTAX",
        "The value of a field does not conform to the expected format.",
        startRaw ?? "",
      );
    if (end === null || Number.isNaN(end))
      this.bad(
        ctx,
        "end_date",
        "INVALID_PARAMETER_SYNTAX",
        "The value of a field does not conform to the expected format.",
        endRaw ?? "",
      );
    const s = start as number;
    const e = end as number;
    if (e < s)
      this.bad(ctx, "end_date", "INVALID_PARAMETER_VALUE", "end_date must not be before start_date.");
    if (e - s > MAX_RANGE_MS)
      this.bad(ctx, "start_date", "INVALID_PARAMETER_VALUE", "Date range is greater than 31 days");
    const pageSize = Number(query.get("page_size") ?? "100");
    const page = Number(query.get("page") ?? "1");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500)
      this.bad(
        ctx,
        "page_size",
        pageSize < 1 ? "INVALID_INTEGER_MIN_VALUE" : "INVALID_INTEGER_MAX_VALUE",
        "page_size must be 1 to 500.",
      );
    if (!Number.isInteger(page) || page < 1)
      this.bad(ctx, "page", "INVALID_INTEGER_MIN_VALUE", "page must be at least 1.");
    const fields = (query.get("fields") ?? "transaction_info").split(",").map((f) => f.trim());
    const withPayer = fields.includes("all") || fields.includes("payer_info");
    const lagMs = this.sim.options.reportingLagSeconds * 1000;
    const now = this.sim.clock.now();
    const refreshed = now - lagMs;
    const filters = {
      id: query.get("transaction_id"),
      type: query.get("transaction_type"),
      status: query.get("transaction_status"),
      currency: query.get("transaction_currency"),
    };
    const rows = this.sim.state.transactions
      .filter((t) => t.accountKey === ctx.account.key && t.at >= s && t.at <= e && t.at <= refreshed)
      .filter((t) => filters.id === null || t.transactionId === filters.id)
      .filter((t) => filters.type === null || t.eventCode === filters.type)
      .filter((t) => filters.status === null || t.status === filters.status)
      .filter((t) => filters.currency === null || t.currency === filters.currency)
      .sort((a, b) => a.at - b.at);
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const slice = rows.slice((page - 1) * pageSize, page * pageSize);
    const body: JsonObject = {};
    if (slice.length > 0) body.transaction_details = slice.map((t) => this.txnJson(t, withPayer));
    body.account_number = ctx.account.payer_id;
    body.start_date = isoSeconds(s);
    body.end_date = isoSeconds(e);
    body.last_refreshed_datetime = isoSeconds(refreshed);
    body.page = page;
    body.total_items = rows.length;
    body.total_pages = totalPages;
    const qs = (p: number) => {
      const q = new URLSearchParams(query);
      q.set("page", String(p));
      q.set("page_size", String(pageSize));
      return q.toString();
    };
    const links: JsonObject[] = [
      { href: `${ctx.origin}/v1/reporting/transactions?${qs(page)}`, rel: "self", method: "GET" },
    ];
    if (page < totalPages)
      links.push({
        href: `${ctx.origin}/v1/reporting/transactions?${qs(page + 1)}`,
        rel: "next",
        method: "GET",
      });
    body.links = links;
    return { status: 200, body };
  }

  balances(ctx: ReportingCtx, query: URLSearchParams): Result {
    const asOfRaw = query.get("as_of_time");
    let asOf = this.sim.clock.now();
    if (asOfRaw !== null) {
      const t = parseTime(asOfRaw);
      if (t === null || Number.isNaN(t))
        this.bad(
          ctx,
          "as_of_time",
          "INVALID_PARAMETER_SYNTAX",
          "The value of a field does not conform to the expected format.",
          asOfRaw,
        );
      asOf = t as number;
    }
    const currencyFilter = query.get("currency_code");
    if (currencyFilter !== null && !/^[A-Z]{3}$/.test(currencyFilter))
      this.bad(
        ctx,
        "currency_code",
        "INVALID_PARAMETER_VALUE",
        "The value of a field is invalid.",
        currencyFilter,
      );
    const currencies = this.sim
      .currencies(ctx.account.key)
      .filter((c) => currencyFilter === null || c === currencyFilter);
    const balances = currencies.map((c, idx) => {
      const b = this.sim.balance(ctx.account.key, c, asOf);
      return {
        currency: c,
        primary: idx === 0 && c === "USD",
        total_balance: money(c, b.available + b.withheld),
        available_balance: money(c, b.available),
        withheld_balance: money(c, b.withheld),
      };
    });
    return {
      status: 200,
      body: {
        balances,
        account_id: ctx.account.payer_id,
        as_of_time: isoSeconds(asOf),
        last_refresh_time: isoSeconds(this.sim.clock.now()),
      },
    };
  }
}
