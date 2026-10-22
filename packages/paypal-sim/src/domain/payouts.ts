// Payouts v1: batch creation with PayPal's synchronous checks (ERRPYO test values, duplicate
// sender_batch_id with a HATEOAS link to the original, insufficient funds, sandbox-only EMAIL/PAYPAL_ID),
// asynchronous PENDING → PROCESSING → SUCCESS with per-item outcomes, cancel of UNCLAIMED items, fees and
// the sender's balance.
import { type ErrorDetail, v1Error } from "../errors.js";
import type { Simulator } from "../simulator.js";
import type { Account, BatchRecord, ItemRecord, JsonObject } from "../state.js";
import { newBatchId, newDebugId, newItemId, newTransactionId } from "../util/ids.js";
import { fromCents, payoutMoney, toCents } from "../util/money.js";
import { DAY_MS, isoSeconds } from "../util/time.js";

const INFO = "https://developer.paypal.com/docs/api/payments.payouts-batch/#errors";

/**
 * Create-payout test values from PayPal's "Test and go live" table (trigger: items[0]/note). Names come from
 * the table; the HTTP status of ERRPYO002 (403) and ERRPYO005 (422) follow PayPal's examples, the others are
 * the simulator's best reading and are labelled as such in the README.
 */
export const CREATE_TEST_VALUES: Record<string, { status: number; name: string; message: string }> = {
  ERRPYO001: { status: 403, name: "SENDER_RESTRICTED", message: "Sender is restricted." },
  ERRPYO002: { status: 403, name: "SENDER_EMAIL_UNCONFIRMED", message: "Authorization error occurred" },
  ERRPYO003: { status: 403, name: "AUTHORIZATION_ERROR", message: "Authorization error occurred" },
  ERRPYO005: {
    status: 422,
    name: "INSUFFICIENT_FUNDS",
    message: "Sender does not have sufficient funds. Please add funds and retry.",
  },
  ERRPYO006: { status: 500, name: "INTERNAL_ERROR", message: "An internal service error has occurred." },
  ERRPYO010: { status: 400, name: "VALIDATION_ERROR", message: "Invalid request - see details" },
  ERRPYO011: {
    status: 403,
    name: "REQUIRED_SCOPE_MISSING",
    message: "Access token does not have required scope.",
  },
  ERRPYO012: { status: 403, name: "SENDER_LOCKED", message: "Sender account is locked." },
  ERRPYO014: { status: 400, name: "USER_BUSINESS_ERROR", message: "User business error." },
  ERRPYO035: { status: 429, name: "RATE_LIMIT_VALIDATION", message: "Rate limit reached." },
  ERRPYO036: { status: 500, name: "REQUEST_TIMEOUT_EXCEEDED", message: "Request timeout exceeded." },
  ERRPYO037: { status: 400, name: "SYNC_MODE_NOT_APPLICABLE", message: "Sync mode is not applicable." },
  ERRPYO038: { status: 422, name: "NON_HOLDING_CURRENCY", message: "Sender does not hold this currency." },
  ERRPYO039: { status: 409, name: "PREVIOUS_REQUEST_IN_PROGRESS", message: "Previous request in progress." },
  ERRPYO040: { status: 403, name: "CIP_NOT_VERIFIED", message: "Sender identity is not verified." },
};

/** Cancel-item test values (trigger: the path parameter). */
export const CANCEL_TEST_VALUES: Record<string, { status: number; name: string; message: string }> = {
  ERRPOI001: { status: 404, name: "INVALID_RESOURCE_ID", message: "Requested resource ID was not found." },
  ERRPYO004: { status: 400, name: "BATCH_NOT_COMPLETED", message: "Batch is not completed yet." },
  ERRPYO007: { status: 400, name: "ITEM_ALREADY_CANCELLED", message: "Item has already been cancelled." },
  ERRPYO008: { status: 400, name: "ITEM_CANCELLATION_FAILED", message: "Item cancellation failed." },
  ERRPYO009: {
    status: 400,
    name: "ITEM_INCORRECT_STATUS",
    message: "Item cannot be cancelled. Only items in Unclaimed status can be cancelled.",
  },
};

const DUPLICATE_WINDOW_MS = 30 * DAY_MS;

export interface PayoutCtx {
  clientId: string;
  account: Account;
  origin: string;
  debugId: string;
}

type Result = { status: number; body: JsonObject };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export class PayoutEngine {
  constructor(private readonly sim: Simulator) {}

  private err(status: number, name: string, message: string, debugId: string, details: ErrorDetail[] = []) {
    return v1Error("payouts", status, name, message, debugId, details);
  }

  // ── representations ──────────────────────────────────────────────────────────────────────────────

  private link(origin: string, path: string, rel: string): JsonObject {
    return { href: `${origin}${path}`, rel, method: "GET", encType: "application/json" };
  }

  batchHeader(b: BatchRecord): JsonObject {
    const header: JsonObject = {
      payout_batch_id: b.id,
      batch_status: b.status,
      time_created: isoSeconds(b.createdAt),
    };
    if (b.completedAt !== null) header.time_completed = isoSeconds(b.completedAt);
    header.sender_batch_header = b.senderBatchHeader;
    const items = b.itemIds.map((id) => this.sim.state.items[id]).filter((i): i is ItemRecord => Boolean(i));
    if (b.status !== "PENDING" && b.status !== "DENIED") header.funding_source = "BALANCE";
    if (b.status === "SUCCESS" || b.status === "PROCESSING") {
      const paid = items.filter((i) => i.status !== "PENDING" && i.status !== "FAILED");
      header.amount = payoutMoney(
        b.currency,
        paid.reduce((s, i) => s + i.amountCents, 0),
      );
      header.fees = payoutMoney(
        b.currency,
        paid.reduce((s, i) => s + i.feeCents, 0),
      );
    }
    return header;
  }

  itemJson(i: ItemRecord, origin: string, mode: "batch" | "item"): JsonObject {
    const batch = this.sim.state.batches[i.batchId];
    const out: JsonObject = { payout_item_id: i.id };
    if (i.transactionId) out.transaction_id = i.transactionId;
    if (i.activityId) out.activity_id = i.activityId;
    out.transaction_status = i.status;
    if (i.timeProcessed !== null && i.status !== "FAILED")
      out.payout_item_fee = payoutMoney(i.currency, i.feeCents);
    out.payout_batch_id = i.batchId;
    if (mode === "item" && batch) out.sender_batch_id = batch.senderBatchId;
    out.payout_item = i.item;
    if (i.timeProcessed !== null) out.time_processed = isoSeconds(i.timeProcessed);
    if (i.errors) out.errors = i.errors;
    out.links =
      mode === "item"
        ? [
            this.link(origin, `/v1/payments/payouts-item/${i.id}`, "self"),
            this.link(origin, `/v1/payments/payouts/${i.batchId}`, "batch"),
          ]
        : [this.link(origin, `/v1/payments/payouts-item/${i.id}`, "item")];
    return out;
  }

  batchResource(b: BatchRecord, origin: string): JsonObject {
    return {
      batch_header: this.batchHeader(b),
      links: [this.link(origin, `/v1/payments/payouts/${b.id}`, "self")],
    };
  }

  // ── POST /v1/payments/payouts ────────────────────────────────────────────────────────────────────

  create(ctx: PayoutCtx, body: JsonObject): Result {
    const header = (body.sender_batch_header ?? {}) as JsonObject;
    const items = (Array.isArray(body.items) ? body.items : []) as JsonObject[];
    const first = items[0] ?? {};

    // 1. PayPal's documented test values reject the whole POST synchronously.
    const testValue = str(first.note);
    if (testValue && CREATE_TEST_VALUES[testValue]) {
      const t = CREATE_TEST_VALUES[testValue];
      throw this.err(t.status, t.name, t.message, ctx.debugId);
    }
    if (str(first.sender_batch_id) === "ERRPYO013") {
      throw this.err(400, "VALIDATION_ERROR", "Invalid request - see details", ctx.debugId, [
        { field: "items[0].note", location: "body", issue: "Note is required for Venmo payouts (ERRPYO013)" },
      ]);
    }

    const senderBatchId = str(header.sender_batch_id);
    if (!senderBatchId) {
      throw this.err(
        400,
        "INVALID_REQUEST",
        "Request is not well-formed, syntactically incorrect, or violates schema.",
        ctx.debugId,
        [
          {
            field: "/sender_batch_header/sender_batch_id",
            location: "body",
            issue: "MISSING_REQUIRED_PARAMETER",
          },
        ],
      );
    }

    // 2. Recipient types: the sandbox supports EMAIL and PAYPAL_ID; PHONE (and Venmo) are rejected.
    const headerType = str(header.recipient_type) ?? "EMAIL";
    const normalized: { item: JsonObject; type: string; cents: number; currency: string }[] = [];
    for (const [idx, it] of items.entries()) {
      const type = str(it.recipient_type) ?? headerType;
      const wallet = str(it.recipient_wallet) ?? "PAYPAL";
      if (type === "PHONE" || wallet === "VENMO") {
        throw this.err(400, "VALIDATION_ERROR", "Invalid request - see details", ctx.debugId, [
          {
            field: `items[${idx}].recipient_type`,
            location: "body",
            issue: "Recipient type PHONE (and Venmo) is not supported in the PayPal sandbox; use EMAIL.",
          },
        ]);
      }
      if (type !== "EMAIL" && type !== "PAYPAL_ID") {
        throw this.err(
          400,
          "INVALID_REQUEST",
          "Request is not well-formed, syntactically incorrect, or violates schema.",
          ctx.debugId,
          [
            {
              field: `/items/${idx}/recipient_type`,
              value: type,
              location: "body",
              issue: "INVALID_PARAMETER_VALUE",
            },
          ],
        );
      }
      const amount = (it.amount ?? {}) as JsonObject;
      const cents = toCents(str(amount.value) ?? "");
      const currency = str(amount.currency) ?? "";
      if (cents === null || cents <= 0 || !/^[A-Z]{3}$/.test(currency)) {
        throw this.err(
          400,
          "INVALID_REQUEST",
          "Request is not well-formed, syntactically incorrect, or violates schema.",
          ctx.debugId,
          [
            {
              field: `/items/${idx}/amount`,
              location: "body",
              issue: "INVALID_PARAMETER_VALUE",
              ...(str(amount.value) !== undefined ? { value: str(amount.value) as string } : {}),
            },
          ],
        );
      }
      normalized.push({ item: it, type, cents, currency });
    }

    // 3. sender_batch_id is unique for 30 days: PayPal answers with a link to the original batch.
    const dupKey = `${ctx.account.key}:${senderBatchId}`;
    const existing = this.sim.state.senderBatchIndex[dupKey];
    const now = this.sim.clock.now();
    if (existing && now - existing.at < DUPLICATE_WINDOW_MS) {
      throw this.err(400, "USER_BUSINESS_ERROR", "User business error.", ctx.debugId, [
        {
          field: "SENDER_BATCH_ID",
          location: "body",
          issue: "Batch with given sender_batch_id already exists",
          link: [this.link(ctx.origin, `/v1/payments/payouts/${existing.batchId}`, "self")],
        },
      ]);
    }

    // 4. Funds: amount plus the per-item fee must be available, per currency.
    const fee = this.sim.options.payoutFeeCents;
    const need = new Map<string, number>();
    for (const n of normalized) need.set(n.currency, (need.get(n.currency) ?? 0) + n.cents + fee);
    for (const [currency, cents] of need) {
      const held = this.sim.currencies(ctx.account.key).includes(currency);
      if (!held) {
        const t = CREATE_TEST_VALUES.ERRPYO038 as { status: number; name: string; message: string };
        throw this.err(t.status, t.name, t.message, ctx.debugId);
      }
      if (this.sim.balance(ctx.account.key, currency).available < cents) {
        const t = CREATE_TEST_VALUES.ERRPYO005 as { status: number; name: string; message: string };
        throw this.err(t.status, t.name, t.message, ctx.debugId);
      }
    }

    // 5. Accept: PENDING batch, funds held, processing scheduled.
    const batchId = newBatchId();
    const senderHeader: JsonObject = { sender_batch_id: senderBatchId };
    for (const k of ["recipient_type", "email_subject", "email_message", "note"]) {
      const v = header[k];
      if (typeof v === "string") senderHeader[k] = v;
    }
    if (senderHeader.recipient_type === undefined) senderHeader.recipient_type = "EMAIL";
    const batch: BatchRecord = {
      id: batchId,
      clientId: ctx.clientId,
      accountKey: ctx.account.key,
      senderBatchId,
      senderBatchHeader: senderHeader,
      status: "PENDING",
      createdAt: now,
      completedAt: null,
      itemIds: [],
      currency: normalized[0]?.currency ?? "USD",
    };
    for (const [index, n] of normalized.entries()) {
      const id = newItemId();
      const detail: JsonObject = {
        recipient_type: n.type,
        amount: payoutMoney(n.currency, n.cents),
      };
      if (typeof n.item.note === "string") detail.note = n.item.note;
      detail.receiver = str(n.item.receiver) ?? "";
      if (typeof n.item.sender_item_id === "string") detail.sender_item_id = n.item.sender_item_id;
      detail.recipient_wallet = "PAYPAL";
      if (typeof n.item.purpose === "string") detail.purpose = n.item.purpose;
      const rec: ItemRecord = {
        id,
        batchId,
        index,
        status: "PENDING",
        receiver: str(n.item.receiver) ?? "",
        receiverAccountKey: null,
        currency: n.currency,
        amountCents: n.cents,
        feeCents: fee,
        item: detail,
        transactionId: null,
        activityId: null,
        timeProcessed: null,
        unclaimedSince: null,
        errors: null,
      };
      this.sim.state.items[id] = rec;
      batch.itemIds.push(id);
      this.sim.post({
        accountKey: ctx.account.key,
        currency: n.currency,
        availableCents: -(n.cents + fee),
        withheldCents: n.cents + fee,
        kind: "payout.hold",
        ref: id,
      });
    }
    this.sim.state.batches[batchId] = batch;
    this.sim.state.senderBatchIndex[dupKey] = { batchId, at: now };
    this.sim.markDirty();
    this.sim.scheduler.schedule(this.sim.options.timing.batchProcessingS, () => this.toProcessing(batchId));
    return {
      status: 201,
      body: {
        batch_header: {
          payout_batch_id: batchId,
          batch_status: "PENDING",
          sender_batch_header: senderHeader,
        },
        links: [this.link(ctx.origin, `/v1/payments/payouts/${batchId}`, "self")],
      },
    };
  }

  // ── asynchronous processing ──────────────────────────────────────────────────────────────────────

  private emitBatch(b: BatchRecord, eventType: string, summary: string): void {
    this.sim.webhooks.emit({
      clientId: b.clientId,
      eventType,
      resourceType: "payouts",
      summary,
      resource: this.batchResource(b, this.sim.options.apiBaseUrl),
      resourceIds: [b.id],
    });
  }

  private emitItem(i: ItemRecord, eventType: string, summary: string): void {
    const b = this.sim.state.batches[i.batchId];
    if (!b) return;
    this.sim.webhooks.emit({
      clientId: b.clientId,
      eventType,
      resourceType: "payouts_item",
      summary,
      resource: this.itemJson(i, this.sim.options.apiBaseUrl, "item"),
      resourceIds: [i.id, i.batchId, ...(i.transactionId ? [i.transactionId] : [])],
    });
  }

  private toProcessing(batchId: string): void {
    const b = this.sim.state.batches[batchId];
    if (b?.status !== "PENDING") return;
    if (this.sim.state.denyNextBatch) {
      this.sim.state.denyNextBatch = false;
      b.status = "DENIED";
      b.completedAt = this.sim.clock.now();
      for (const id of b.itemIds) {
        const i = this.sim.state.items[id];
        if (!i) continue;
        i.status = "FAILED";
        this.release(i, true);
      }
      this.emitBatch(b, "PAYMENT.PAYOUTSBATCH.DENIED", "Payouts batch got denied.");
      this.sim.markDirty();
      return;
    }
    b.status = "PROCESSING";
    this.emitBatch(b, "PAYMENT.PAYOUTSBATCH.PROCESSING", "Payouts batch is being processed.");
    this.sim.markDirty();
    this.scheduleItems(b);
  }

  private scheduleItems(b: BatchRecord): void {
    const { itemS, batchCompleteS } = this.sim.options.timing;
    const pending = b.itemIds.filter((id) => this.sim.state.items[id]?.status === "PENDING");
    pending.forEach((id, n) => {
      this.sim.scheduler.schedule(itemS * (n + 1), () => this.processItem(id));
    });
    this.sim.scheduler.schedule(itemS * pending.length + batchCompleteS, () => this.complete(b.id));
  }

  /** Releases an item's hold: the withheld amount leaves the balance, or returns when `refund`. */
  private release(i: ItemRecord, refund: boolean): void {
    const b = this.sim.state.batches[i.batchId];
    if (!b) return;
    this.sim.post({
      accountKey: b.accountKey,
      currency: i.currency,
      availableCents: refund ? i.amountCents + i.feeCents : 0,
      withheldCents: -(i.amountCents + i.feeCents),
      kind: refund ? "payout.hold.released" : "payout.sent",
      ref: i.id,
    });
  }

  private resolveReceiver(i: ItemRecord): Account | undefined {
    const type = str(i.item.recipient_type) ?? "EMAIL";
    return type === "PAYPAL_ID" ? this.sim.accountByPayerId(i.receiver) : this.sim.accountByEmail(i.receiver);
  }

  private processItem(itemId: string): void {
    const i = this.sim.state.items[itemId];
    const b = i ? this.sim.state.batches[i.batchId] : undefined;
    if (!i || !b || i.status !== "PENDING") return;
    const now = this.sim.clock.now();
    const receiver = this.resolveReceiver(i);
    const sender = this.sim.accountByKey(b.accountKey);
    i.timeProcessed = now;
    if (receiver && sender && receiver.key === sender.key) {
      i.status = "FAILED";
      this.release(i, true);
      i.feeCents = 0;
      i.errors = {
        name: "SELF_PAY_NOT_ALLOWED",
        message: "Sender and receiver cannot be the same.",
        debug_id: newDebugId(),
        information_link: INFO,
      };
      this.emitItem(i, "PAYMENT.PAYOUTS-ITEM.FAILED", "Payout item failed.");
      this.sim.markDirty();
      return;
    }
    i.transactionId = newTransactionId();
    i.activityId = newTransactionId();
    this.release(i, false);
    if (receiver) {
      i.status = "SUCCESS";
      i.receiverAccountKey = receiver.key;
      this.sim.post({
        accountKey: receiver.key,
        currency: i.currency,
        availableCents: i.amountCents,
        withheldCents: 0,
        kind: "payout.received",
        ref: i.id,
      });
    } else {
      i.status = "UNCLAIMED";
      i.unclaimedSince = now;
      i.errors = {
        name: "RECEIVER_UNREGISTERED",
        message: "Receiver is unregistered",
        debug_id: newDebugId(),
        information_link: INFO,
      };
    }
    this.sim.recordTransaction({
      accountKey: b.accountKey,
      at: now,
      updatedAt: now,
      transactionId: i.transactionId,
      eventCode: "T0001",
      status: i.status === "SUCCESS" ? "S" : "P",
      currency: i.currency,
      amountCents: -i.amountCents,
      feeCents: -i.feeCents,
      counterpartyKey: receiver?.key ?? null,
      counterpartyEmail: i.receiver,
      note: str(i.item.note) ?? null,
      subject: str(b.senderBatchHeader.email_subject) ?? null,
      invoiceNumber: null,
      customField: str(i.item.sender_item_id) ?? null,
    });
    if (i.status === "SUCCESS")
      this.emitItem(i, "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "Payout item has succeeded.");
    else this.emitItem(i, "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "Payout item is unclaimed.");
    this.sim.markDirty();
  }

  private complete(batchId: string): void {
    const b = this.sim.state.batches[batchId];
    if (b?.status !== "PROCESSING") return;
    const open = b.itemIds.some((id) => this.sim.state.items[id]?.status === "PENDING");
    if (open) {
      this.scheduleItems(b);
      return;
    }
    b.status = "SUCCESS";
    b.completedAt = this.sim.clock.now();
    this.emitBatch(b, "PAYMENT.PAYOUTSBATCH.SUCCESS", "Payouts batch completed successfully.");
    this.sim.markDirty();
  }

  /** After restoring a snapshot, continue batches that were still in flight. */
  resume(): void {
    for (const b of Object.values(this.sim.state.batches)) {
      if (b.status === "PENDING")
        this.sim.scheduler.schedule(this.sim.options.timing.batchProcessingS, () => this.toProcessing(b.id));
      else if (b.status === "PROCESSING") this.scheduleItems(b);
    }
  }

  /** UNCLAIMED items return to the sender after the claim window (30 days by default). */
  sweepUnclaimed(): void {
    const now = this.sim.clock.now();
    for (const i of Object.values(this.sim.state.items)) {
      if (i.status !== "UNCLAIMED" || i.unclaimedSince === null) continue;
      if (now - i.unclaimedSince < this.sim.unclaimedReturnMs) continue;
      this.returnItem(i, "PAYMENT.PAYOUTS-ITEM.RETURNED", "Payout item has been returned.");
    }
  }

  private returnItem(i: ItemRecord, eventType: string, summary: string): void {
    const b = this.sim.state.batches[i.batchId];
    if (!b) return;
    const now = this.sim.clock.now();
    i.status = "RETURNED";
    i.errors = null;
    this.sim.post({
      accountKey: b.accountKey,
      currency: i.currency,
      availableCents: i.amountCents + i.feeCents,
      withheldCents: 0,
      kind: "payout.returned",
      ref: i.id,
    });
    for (const t of this.sim.state.transactions) {
      if (t.transactionId === i.transactionId && t.eventCode === "T0001") {
        t.status = "V";
        t.updatedAt = now;
      }
    }
    this.sim.recordTransaction({
      accountKey: b.accountKey,
      at: now,
      updatedAt: now,
      transactionId: newTransactionId(),
      eventCode: "T1115",
      status: "S",
      currency: i.currency,
      amountCents: i.amountCents,
      feeCents: i.feeCents,
      counterpartyKey: null,
      counterpartyEmail: i.receiver,
      note: "Unclaimed payout returned",
      subject: null,
      invoiceNumber: null,
      customField: str(i.item.sender_item_id) ?? null,
    });
    this.emitItem(i, eventType, summary);
    this.sim.markDirty();
  }

  // ── reads and cancel ─────────────────────────────────────────────────────────────────────────────

  private ownedBatch(ctx: PayoutCtx, id: string): BatchRecord {
    const b = this.sim.state.batches[id];
    if (!b || b.accountKey !== ctx.account.key)
      throw this.err(404, "INVALID_RESOURCE_ID", "Requested resource ID was not found.", ctx.debugId);
    return b;
  }

  private ownedItem(ctx: PayoutCtx, id: string): ItemRecord {
    const i = this.sim.state.items[id];
    const b = i ? this.sim.state.batches[i.batchId] : undefined;
    if (!i || !b || b.accountKey !== ctx.account.key)
      throw this.err(404, "INVALID_RESOURCE_ID", "Requested resource ID was not found.", ctx.debugId);
    return i;
  }

  getBatch(ctx: PayoutCtx, id: string, query: URLSearchParams): Result {
    this.sweepUnclaimed();
    const b = this.ownedBatch(ctx, id);
    const pageSize = Number(query.get("page_size") ?? "1000");
    const page = Number(query.get("page") ?? "1");
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 1000 ||
      !Number.isInteger(page) ||
      page < 1
    ) {
      throw this.err(
        400,
        "INVALID_REQUEST",
        "Request is not well-formed, syntactically incorrect, or violates schema.",
        ctx.debugId,
        [{ field: "page_size", location: "query", issue: "INVALID_PARAMETER_VALUE" }],
      );
    }
    const totalRequired = query.get("total_required") === "true";
    const onlyHeader = query.get("fields") === "batch_header";
    const all = b.itemIds.map((i) => this.sim.state.items[i]).filter((i): i is ItemRecord => Boolean(i));
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const slice = all.slice((page - 1) * pageSize, page * pageSize);
    const body: JsonObject = {};
    if (totalRequired) {
      body.total_items = all.length;
      body.total_pages = totalPages;
    }
    body.batch_header = this.batchHeader(b);
    if (!onlyHeader) body.items = slice.map((i) => this.itemJson(i, ctx.origin, "batch"));
    const links: JsonObject[] = [
      this.link(ctx.origin, `/v1/payments/payouts/${b.id}?page_size=${pageSize}&page=${page}`, "self"),
    ];
    if (page < totalPages)
      links.push(
        this.link(ctx.origin, `/v1/payments/payouts/${b.id}?page_size=${pageSize}&page=${page + 1}`, "next"),
      );
    if (page > 1)
      links.push(
        this.link(
          ctx.origin,
          `/v1/payments/payouts/${b.id}?page_size=${pageSize}&page=${page - 1}`,
          "previous",
        ),
      );
    body.links = links;
    return { status: 200, body };
  }

  getItem(ctx: PayoutCtx, id: string): Result {
    this.sweepUnclaimed();
    return { status: 200, body: this.itemJson(this.ownedItem(ctx, id), ctx.origin, "item") };
  }

  cancelItem(ctx: PayoutCtx, id: string): Result {
    const test = CANCEL_TEST_VALUES[id];
    if (test) throw this.err(test.status, test.name, test.message, ctx.debugId);
    this.sweepUnclaimed();
    const i = this.ownedItem(ctx, id);
    if (i.status === "RETURNED") {
      const t = CANCEL_TEST_VALUES.ERRPYO007 as { status: number; name: string; message: string };
      throw this.err(t.status, t.name, t.message, ctx.debugId);
    }
    if (i.status !== "UNCLAIMED") {
      const t = CANCEL_TEST_VALUES.ERRPYO009 as { status: number; name: string; message: string };
      throw this.err(t.status, t.name, t.message, ctx.debugId);
    }
    this.returnItem(i, "PAYMENT.PAYOUTS-ITEM.CANCELED", "Payout item has been canceled.");
    return { status: 200, body: this.itemJson(i, ctx.origin, "item") };
  }

  /** Total of a batch in cents (for summaries and tests). */
  totals(batchId: string): { amount: string; fees: string } {
    const b = this.sim.state.batches[batchId];
    const items = (b?.itemIds ?? [])
      .map((id) => this.sim.state.items[id])
      .filter((i): i is ItemRecord => Boolean(i));
    return {
      amount: fromCents(items.reduce((s, i) => s + i.amountCents, 0)),
      fees: fromCents(items.reduce((s, i) => s + i.feeCents, 0)),
    };
  }
}
