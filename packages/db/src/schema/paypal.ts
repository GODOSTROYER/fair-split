/**
 * PayPal mirror group (register §7, §8): payout_batches, payout_items, webhook_events, paypal_calls
 * (also the limiter window), reconciliation_reports.
 *
 * - Batch and item rows are written as SUBMITTED before the POST, so early webhooks join on our keys.
 * - Item statuses follow register ranks; `status_rank` must equal the status's rank and only ever rises
 *   (SQL trigger, migrations/0002); RETURNED additionally needs `cancel_requested_at` (our own cancel).
 */
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { ITEM_STATUS_RANK } from "../_shims/contracts.js";
import {
  cents,
  checkCurrency,
  checkIn,
  checkProvenance,
  checkSha,
  createdAt,
  currency,
  id,
  provenance,
  sha256,
  tstz,
  updatedAt,
  version,
  wsFk,
  wsIdUnique,
} from "./_columns.js";
import { memberLines, payRuns } from "./runs.js";
import { workspaceId, workspaceIdKept, workspaceIdNullable } from "./workspace.js";

/** Our own pre-POST status (rank 0) followed by PayPal's ranked item statuses. */
export const PAYOUT_ITEM_STATUS_RANK = { SUBMITTED: 0, ...ITEM_STATUS_RANK } as const;
export type PayoutItemStatus = keyof typeof PAYOUT_ITEM_STATUS_RANK;
export const PAYOUT_ITEM_STATUSES = Object.keys(PAYOUT_ITEM_STATUS_RANK) as PayoutItemStatus[];

export const BATCH_STATUSES = [
  "SUBMITTED",
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "DENIED",
  "CANCELED",
] as const;
export const BATCH_KINDS = ["primary", "reroute"] as const;

export const payoutBatches = pgTable(
  "payout_batches",
  {
    id: id(),
    workspaceId: workspaceId(),
    runId: uuid("run_id").notNull(),
    /** {season}-{rc8}-r{runSeq}, a re-route adds -x{n} (≤ 256 chars) */
    senderBatchId: text("sender_batch_id").notNull().unique("payout_batches_sender_batch_id_uq"),
    /** PayPal-Request-Id = sha256(sender_batch_id) */
    requestId: sha256("request_id").notNull(),
    paypalBatchId: text("paypal_batch_id").unique("payout_batches_paypal_batch_id_uq"),
    batchSha256: sha256("batch_sha256").notNull(),
    kind: text("kind", { enum: BATCH_KINDS }).notNull(),
    status: text("status", { enum: BATCH_STATUSES }).notNull().default("SUBMITTED"),
    itemCount: integer("item_count").notNull(),
    totalCents: cents("total_cents").notNull(),
    currency: currency().notNull(),
    adopted: boolean("adopted").notNull().default(false),
    submittedAt: tstz("submitted_at").notNull().defaultNow(),
    version: version(),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("payout_batches_kind_ck", t.kind, BATCH_KINDS),
    checkIn("payout_batches_status_ck", t.status, BATCH_STATUSES),
    check("payout_batches_sender_batch_id_ck", sql`length(${t.senderBatchId}) between 1 and 256`),
    check("payout_batches_items_ck", sql`${t.itemCount} between 1 and 15000 and ${t.totalCents} > 0`),
    checkSha("payout_batches_request_id_ck", t.requestId),
    checkSha("payout_batches_batch_sha256_ck", t.batchSha256),
    checkCurrency("payout_batches_currency_ck", t.currency),
    checkProvenance("payout_batches", t.provenance),
    index("payout_batches_run_idx").on(t.runId),
    wsIdUnique("payout_batches", t),
    wsFk("payout_batches_run_fk", t, t.runId, payRuns),
  ],
);

export const CANCEL_INTENTS = ["cash", "reroute"] as const;

export const payoutItems = pgTable(
  "payout_items",
  {
    id: id(),
    workspaceId: workspaceId(),
    batchId: uuid("batch_id").notNull(),
    lineId: uuid("line_id").notNull(),
    /** r{runSeq}-{memberNo}; a re-route uses r{runSeq}x{n}-{memberNo} (≤ 63 chars) */
    senderItemId: text("sender_item_id").notNull().unique("payout_items_sender_item_id_uq"),
    payoutItemId: text("payout_item_id").unique("payout_items_payout_item_id_uq"),
    receiver: text("receiver").notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: currency().notNull(),
    status: text("status", { enum: PAYOUT_ITEM_STATUSES as [PayoutItemStatus, ...PayoutItemStatus[]] })
      .notNull()
      .default("SUBMITTED"),
    statusRank: integer("status_rank").notNull().default(0),
    /** raw transaction_status as PayPal reported it */
    transactionStatus: text("transaction_status"),
    feeCents: cents("fee_cents"),
    feeCurrency: currency("fee_currency"),
    errors: jsonb("errors"),
    cancelRequestedAt: tstz("cancel_requested_at"),
    cancelIntent: text("cancel_intent", { enum: CANCEL_INTENTS }),
    supersedesItemId: uuid("supersedes_item_id"),
    version: version(),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("payout_items_status_ck", t.status, PAYOUT_ITEM_STATUSES),
    check(
      "payout_items_status_rank_ck",
      sql`${t.statusRank} = case ${t.status} ${sql.raw(
        Object.entries(PAYOUT_ITEM_STATUS_RANK)
          .map(([s, r]) => `when '${s}' then ${r}`)
          .join(" "),
      )} end`,
    ),
    checkIn("payout_items_cancel_intent_ck", t.cancelIntent, CANCEL_INTENTS),
    check("payout_items_sender_item_id_ck", sql`length(${t.senderItemId}) between 1 and 63`),
    check("payout_items_receiver_ck", sql`length(${t.receiver}) between 3 and 127`),
    check("payout_items_amount_ck", sql`${t.amountCents} > 0`),
    checkCurrency("payout_items_currency_ck", t.currency),
    check("payout_items_fee_currency_ck", sql`${t.feeCurrency} is null or ${t.feeCurrency} ~ '^[A-Z]{3}$'`),
    checkProvenance("payout_items", t.provenance),
    index("payout_items_batch_idx").on(t.batchId),
    index("payout_items_line_idx").on(t.lineId),
    wsIdUnique("payout_items", t),
    wsFk("payout_items_batch_fk", t, t.batchId, payoutBatches),
    wsFk("payout_items_line_fk", t, t.lineId, memberLines),
    wsFk("payout_items_supersedes_fk", t, t.supersedesItemId, { workspaceId: t.workspaceId, id: t.id }),
  ],
);

export const WEBHOOK_VERIFIED = ["self", "postback", "dev_mock", "fetched"] as const;
export const WEBHOOK_STATUSES = ["received", "applied", "orphan", "rejected"] as const;

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    /** null until the event is resolved to a workspace (S3 deviation 4); SET NULL on purge, so dedupe survives */
    workspaceId: workspaceIdKept(),
    paypalEventId: text("paypal_event_id").notNull().unique("webhook_events_paypal_event_id_uq"),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type"),
    /** the key it resolved by: sender_item_id, payout_item_id, payout_batch_id or invoice id */
    resourceKey: text("resource_key"),
    verified: text("verified", { enum: WEBHOOK_VERIFIED }),
    raw: text("raw").notNull(),
    status: text("status", { enum: WEBHOOK_STATUSES }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    appliedAt: tstz("applied_at"),
    error: text("error"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("webhook_events_verified_ck", t.verified, WEBHOOK_VERIFIED),
    checkIn("webhook_events_status_ck", t.status, WEBHOOK_STATUSES),
    // nothing unverified is ever applied: only rejected rows lack a verification mode
    check("webhook_events_verified_status_ck", sql`(${t.status} = 'rejected') = (${t.verified} is null)`),
    checkProvenance("webhook_events", t.provenance),
    index("webhook_events_status_idx").on(t.status, t.receivedAt),
    index("webhook_events_resource_idx").on(t.resourceKey),
  ],
);

export const CALL_PRIORITIES = ["live", "background"] as const;

export const paypalCalls = pgTable(
  "paypal_calls",
  {
    id: id(),
    /** null for system calls (OAuth, health checks); SET NULL on purge: the window and circuit are global */
    workspaceId: workspaceIdKept(),
    /** the moment the limiter granted the slot; the 60 s window and the 6 min circuit read this column */
    at: tstz("at").notNull().default(sql`clock_timestamp()`),
    purpose: text("purpose").notNull(),
    priority: text("priority", { enum: CALL_PRIORITIES }).notNull(),
    method: text("method"),
    path: text("path"),
    /** HTTP status; null while in flight (or if the caller never reported back) */
    status: integer("status"),
    debugId: text("debug_id"),
    requestId: text("request_id"),
    ms: integer("ms"),
    error: text("error"),
    /** when the response (or failure) was recorded; a 429 opens the circuit from this instant */
    respondedAt: tstz("responded_at"),
  },
  (t) => [
    checkIn("paypal_calls_priority_ck", t.priority, CALL_PRIORITIES),
    index("paypal_calls_at_idx").on(t.at),
    index("paypal_calls_429_idx").on(t.respondedAt).where(sql`status = 429`),
  ],
);

export const RECONCILIATION_KINDS = ["hot", "sweep", "nightly", "catchup", "health", "balance"] as const;

export const reconciliationReports = pgTable(
  "reconciliation_reports",
  {
    id: id(),
    /** null for system-wide reports (health checks) */
    workspaceId: workspaceIdNullable(),
    kind: text("kind", { enum: RECONCILIATION_KINDS }).notNull(),
    windowStart: tstz("window_start"),
    windowEnd: tstz("window_end"),
    summary: jsonb("summary").notNull(),
    /** Transaction Search data lags ~3 h; scope propagation ~9 h */
    lagging: boolean("lagging").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("reconciliation_reports_kind_ck", t.kind, RECONCILIATION_KINDS),
    index("reconciliation_reports_kind_idx").on(t.kind, t.createdAt),
  ],
);
