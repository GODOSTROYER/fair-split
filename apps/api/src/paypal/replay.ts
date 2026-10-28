// The labelled REPLAY rail (S3.9, S3.11, C-06; I8). When Judge Mode decides a PayPal step replays (the 429
// circuit, kill_paypal_live, the simulator stub, the US$10,000 floor, an unknown balance, the daily, hourly,
// per-cookie or public quota), the step's own code runs unchanged on this rail: the same policy lattice, the same
// checkpoints, the same `PayoutsService` (I4 re-hashes the batch, approvals are checked, an armed tamper is
// refused), the same state machine. Only the transport differs, as between the simulator and the sandbox
// (ADR-0002): nothing here reaches the network, no limiter slot is taken, no `paypal_calls` row is written.
//
//   Invoicing (`tk`)  create / send / GET / AUTO_CANCEL rule / record payment, echoing this run's own canonical
//                     invoice (its number, reference, total and parties), under a replay id `INV2-RPLY-…`.
//   Payouts (`http`)  POST batch → `RPLY…` batch id; the settle GET answers each item as the SOURCE run's member
//                     ended at its settle GET (Rhea UNCLAIMED, the rest SUCCESS); cancel of an UNCLAIMED item →
//                     RETURNED; a re-routed item is paid.
//
// The source is the latest settled live run on this rail, else the showcase run r37 (whose real sandbox objects
// tools/seed-showcase-run.ts creates), else the seed snapshot (money/replay.ts `replaySource`); its real PayPal
// ids are named in the `judge.step.replayed` ledger entries, never written into this run's rows (they are UNIQUE
// and belong to the source). Every row and event a replayed step writes carries provenance `replay` (this rail's
// `provenance`), so the stage, Proof's weakest provenance and the ledger all say "replay".
import { createHash } from "node:crypto";
import type { PayoutItemStatus } from "@fairsplit/contracts";
import { type DbOrTx, schema } from "@fairsplit/db";
import { invoiceReference, minorToDecimal } from "@fairsplit/domain";
import type { PayPalFailure, PayPalHttp, PayPalRequest, PayPalResult } from "@fairsplit/paypal-core";
import { type Tk, ToolkitError, type ToolkitMethod } from "@fairsplit/paypal-toolkit";
import { and, eq } from "drizzle-orm";
import type { PayPalRail } from "./mode.js";

/** Where replayed PayPal steps come from (S3.9 lifecycle: "the latest settled live run, else showcase r37"). */
export interface ReplaySource {
  kind: "live_run" | "showcase" | "seed";
  runSlug: string;
  /** The day the source ran (UTC), for the label. */
  recordedOn: string;
  /** The source's own PayPal ids, named in the ledger (never written into a replayed run's rows). */
  invoiceId: string | null;
  payerViewUrl: string | null;
  payoutBatchId: string | null;
  /** Each member's item as PayPal answered the source's settle GET (an item later cancelled was UNCLAIMED). */
  items: ReadonlyMap<string, { status: PayoutItemStatus; feeCents: number | null }>;
}

export interface ReplayRailInfo {
  source: ReplaySource;
  /** Why the step replays (a judge replay reason), and the words the stage shows. */
  reason: string;
  label: string;
  /** The replayed Invoicing calls (money/toolkit.ts hands this out instead of the toolkit). */
  tk: Tk;
}

/** A rail whose PayPal steps replay: provenance `replay`, and `replay` set. */
export type ReplayPayPalRail = PayPalRail & { readonly replay: ReplayRailInfo };

export function isReplayRail(rail: PayPalRail): rail is ReplayPayPalRail {
  return rail.provenance === "replay" && "replay" in rail && rail.replay !== undefined;
}

const hex = (s: string) => createHash("sha256").update(s, "utf8").digest("hex").toUpperCase();

/** The replay id of this run's invoice: PayPal's shape, "RPLY" in it, unique per invoice number. */
export function replayInvoiceId(invoiceNumber: string): string {
  const h = hex(`replay:invoice:${invoiceNumber}`);
  return `INV2-RPLY-${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}`;
}

/** Replay ids of a batch and an item (PayPal's alphabet and length; unique per sender id). */
export const replayBatchId = (senderBatchId: string) =>
  `RPLY${hex(`replay:batch:${senderBatchId}`).slice(0, 16)}`;
export const replayItemId = (senderItemId: string) =>
  `RPLY${hex(`replay:item:${senderItemId}`).slice(0, 16)}`;

interface ReplayDeps {
  db: DbOrTx;
  now: () => Date;
  businessEmail: string;
  payerEmail: string;
  unclaimedReceiver: string | null;
  source: ReplaySource;
}

const debugId = (s: ReplaySource) => `replay-${s.runSlug}`;

// ---------------------------------------------------------------- Invoicing

type InvoiceStatus = "DRAFT" | "UNPAID" | "MARKED_AS_PAID";

function replayTk(d: ReplayDeps): Tk {
  // What this rail's own calls did, for the GETs that follow them before the caller checkpoints.
  const status = new Map<string, InvoiceStatus>();

  const invoiceBody = async (invoiceId: string): Promise<Record<string, unknown>> => {
    const [row] = await d.db
      .select({ inv: schema.invoices, rateCardSha256: schema.payRuns.rateCardSha256 })
      .from(schema.invoices)
      .innerJoin(
        schema.payRuns,
        and(
          eq(schema.payRuns.id, schema.invoices.runId),
          eq(schema.payRuns.workspaceId, schema.invoices.workspaceId),
        ),
      )
      .where(eq(schema.invoices.paypalInvoiceId, invoiceId));
    if (!row) throw replayError("get_invoice", 404, "RESOURCE_NOT_FOUND", d.source);
    const inv = row.inv;
    const now: InvoiceStatus =
      status.get(invoiceId) ?? (inv.paymentRecordedAt ? "MARKED_AS_PAID" : inv.sentAt ? "UNPAID" : "DRAFT");
    const total = minorToDecimal(Number(inv.amountCents));
    const day = (inv.createdAtPaypal ?? d.now()).toISOString().slice(0, 10);
    return {
      id: invoiceId,
      status: now,
      detail: {
        invoice_number: inv.invoiceNumber,
        reference: invoiceReference(row.rateCardSha256),
        currency_code: "USD",
        invoice_date: day,
        ...(d.source.payerViewUrl ? { metadata: { recipient_view_url: d.source.payerViewUrl } } : {}),
      },
      invoicer: { email_address: d.businessEmail },
      primary_recipients: [{ billing_info: { email_address: d.payerEmail } }],
      amount: { currency_code: "USD", value: total },
      due_amount: { currency_code: "USD", value: now === "MARKED_AS_PAID" ? "0.00" : total },
    };
  };

  const tk = async (method: string, args: unknown): Promise<unknown> => {
    const a = (args ?? {}) as {
      invoice_id?: string;
      /** the toolkit's create parameters are flat (domain canonicalInvoice); PayPal's REST body nests it */
      invoice_number?: string;
      detail?: { invoice_number?: string };
      rules?: unknown[];
    };
    switch (method) {
      case "create_invoice": {
        const number = a.invoice_number ?? a.detail?.invoice_number;
        if (!number) throw replayError(method, 400, "INVALID_REQUEST", d.source);
        const id = replayInvoiceId(number);
        status.set(id, "DRAFT");
        return {
          rel: "self",
          href: `https://api.sandbox.paypal.com/v2/invoicing/invoices/${id}`,
          method: "GET",
        };
      }
      case "send_invoice":
        if (!a.invoice_id) throw replayError(method, 400, "INVALID_REQUEST", d.source);
        status.set(a.invoice_id, "UNPAID");
        return d.source.payerViewUrl ? { rel: "payer-view", href: d.source.payerViewUrl, method: "GET" } : {};
      case "get_invoice":
        if (!a.invoice_id) throw replayError(method, 400, "INVALID_REQUEST", d.source);
        return invoiceBody(a.invoice_id);
      case "create_conditional_rules_for_invoice":
        return { rules: a.rules ?? [] };
      case "record_payment_for_invoice":
        if (!a.invoice_id) throw replayError(method, 400, "INVALID_REQUEST", d.source);
        status.set(a.invoice_id, "MARKED_AS_PAID");
        return { payment_id: `RPLY${hex(`replay:payment:${a.invoice_id}`).slice(0, 13)}` };
      case "search_invoicing":
        return { items: [] };
      default:
        throw replayError(method, 400, "NOT_REPLAYED", d.source);
    }
  };
  return tk as Tk;
}

/** PayPal's own refusal shape (money/errors.ts classifies a 4xx as PAYPAL_REJECTED, never retried). */
function replayError(method: string, status: number, code: string, source: ReplaySource): Error {
  return new ToolkitError({
    method: method as ToolkitMethod,
    status,
    code,
    message: `the replay of ${source.runSlug} has no answer (${code})`,
    debugId: debugId(source),
    requestId: null,
    transportError: null,
  });
}

// ---------------------------------------------------------------- Payouts

interface ItemRow {
  status: string;
  payoutItemId: string | null;
  senderItemId: string;
  receiver: string;
  amountCents: bigint;
  memberNo: string;
  batchPaypalId: string | null;
}

function replayHttp(d: ReplayDeps): PayPalHttp {
  const ok = <T>(status: number, body: T, req: PayPalRequest): PayPalResult<T> => ({
    ok: true,
    status,
    body,
    debugId: debugId(d.source),
    ms: 0,
    attempts: 1,
    requestId: req.requestId ?? null,
  });
  const fail = (status: number, name: string, message: string, req: PayPalRequest): PayPalFailure => ({
    ok: false,
    kind: "http",
    status,
    name,
    message,
    details: [],
    links: [],
    debugId: debugId(d.source),
    retryable: false,
    retryAfterMs: null,
    delivery: "received",
    ms: 0,
    attempts: 1,
    requestId: req.requestId ?? null,
  });

  /** As PayPal answered the source's settle GET for this member; a re-routed or unknown item is paid. */
  const statusOf = (row: ItemRow): string => {
    if (row.status === "RETURNED") return "RETURNED";
    const rerouted = /x\d+-/.test(row.senderItemId);
    if (d.unclaimedReceiver && row.receiver === d.unclaimedReceiver) return "UNCLAIMED";
    if (rerouted) return "SUCCESS";
    return d.source.items.get(row.memberNo)?.status ?? "SUCCESS";
  };
  const view = (row: ItemRow) => {
    const fee = d.source.items.get(row.memberNo)?.feeCents ?? null;
    return {
      payout_item_id: row.payoutItemId ?? replayItemId(row.senderItemId),
      payout_batch_id: row.batchPaypalId,
      transaction_status: statusOf(row),
      ...(fee !== null && !/x\d+-/.test(row.senderItemId)
        ? { payout_item_fee: { currency: "USD", value: minorToDecimal(fee) } }
        : {}),
      payout_item: {
        receiver: row.receiver,
        amount: { currency: "USD", value: minorToDecimal(Number(row.amountCents)) },
        sender_item_id: row.senderItemId,
      },
    };
  };
  const items = async (where: { batchId?: string; payoutItemId?: string }): Promise<ItemRow[]> =>
    d.db
      .select({
        status: schema.payoutItems.status,
        payoutItemId: schema.payoutItems.payoutItemId,
        senderItemId: schema.payoutItems.senderItemId,
        receiver: schema.payoutItems.receiver,
        amountCents: schema.payoutItems.amountCents,
        memberNo: schema.members.memberNo,
        batchPaypalId: schema.payoutBatches.paypalBatchId,
      })
      .from(schema.payoutItems)
      .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
      .innerJoin(schema.memberLines, eq(schema.memberLines.id, schema.payoutItems.lineId))
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(
        where.batchId
          ? eq(schema.payoutItems.batchId, where.batchId)
          : eq(schema.payoutItems.payoutItemId, where.payoutItemId ?? ""),
      );

  return {
    async request<T>(req: PayPalRequest): Promise<PayPalResult<T>> {
      const path = new URL(req.path, "https://api-m.sandbox.paypal.com").pathname;
      if (req.method === "POST" && path === "/v1/payments/payouts") {
        const body = req.body as { sender_batch_header?: { sender_batch_id?: string } } | undefined;
        const sbid = body?.sender_batch_header?.sender_batch_id;
        if (!sbid) return fail(400, "VALIDATION_ERROR", "No sender_batch_id.", req);
        return ok(
          201,
          {
            batch_header: {
              payout_batch_id: replayBatchId(sbid),
              batch_status: "PENDING",
              sender_batch_header: { sender_batch_id: sbid },
            },
            links: [],
          } as T,
          req,
        );
      }
      const batch = /^\/v1\/payments\/payouts\/([A-Za-z0-9_-]+)$/.exec(path);
      if (req.method === "GET" && batch?.[1]) {
        const [row] = await d.db
          .select()
          .from(schema.payoutBatches)
          .where(eq(schema.payoutBatches.paypalBatchId, batch[1]));
        if (!row) return fail(404, "INVALID_RESOURCE_ID", "No such replayed batch.", req);
        const rows = await items({ batchId: row.id });
        return ok(
          200,
          {
            total_items: rows.length,
            total_pages: 1,
            batch_header: {
              payout_batch_id: batch[1],
              batch_status: "SUCCESS",
              sender_batch_header: { sender_batch_id: row.senderBatchId },
            },
            items: rows.map(view),
          } as T,
          req,
        );
      }
      const item = /^\/v1\/payments\/payouts-item\/([A-Za-z0-9_-]+)(\/cancel)?$/.exec(path);
      if (item?.[1]) {
        const [row] = await items({ payoutItemId: item[1] });
        if (!row) return fail(404, "INVALID_RESOURCE_ID", "No such replayed item.", req);
        if (req.method === "GET" && !item[2]) return ok(200, view(row) as T, req);
        if (req.method === "POST" && item[2]) {
          if (statusOf(row) !== "UNCLAIMED") {
            return fail(400, "VALIDATION_ERROR", "Only items in Unclaimed status can be cancelled.", req);
          }
          return ok(200, { ...view(row), transaction_status: "RETURNED" } as T, req);
        }
      }
      return fail(404, "NOT_REPLAYED", `${req.method} ${path} has no replay.`, req);
    },
  };
}

/**
 * The replay rail over `base`: provenance `replay`, the Payouts transport and the Invoicing calls answered from the
 * source, everything else (labels, webhook verifier, OAuth for anything else) the base rail's.
 */
export function replayRail(
  base: PayPalRail,
  o: {
    db: DbOrTx;
    now: () => Date;
    businessEmail: string;
    payerEmail: string;
    unclaimedReceiver: string | null;
    source: ReplaySource;
    reason: string;
    label: string;
  },
): ReplayPayPalRail {
  const d: ReplayDeps = {
    db: o.db,
    now: o.now,
    businessEmail: o.businessEmail,
    payerEmail: o.payerEmail,
    unclaimedReceiver: o.unclaimedReceiver,
    source: o.source,
  };
  return {
    ...base,
    provenance: "replay",
    core: { ...base.core, http: replayHttp(d) },
    replay: { source: o.source, reason: o.reason, label: o.label, tk: replayTk(d) },
    describe: () => base.describe(),
  };
}
