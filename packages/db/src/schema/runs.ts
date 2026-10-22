/**
 * Runs group (register §7): pay_runs, invoices, member_lines, holds, approvals, statements, cash_receipts,
 * review_requests.
 *
 * - `pay_runs.run_seq` comes from the one global sequence `fs_run_seq`, never reset (environments only ever
 *   raise its floor, see `ensureRunSeqFloor`); `run_slug` = `{seasonCode}-r{runSeq}` is generated.
 * - From POSTING on, a run must carry its batch digest and sender_batch_id (architecture §3).
 * - State columns are written only through optimistic `UPDATE … WHERE state = $expected` (I5).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  pgSequence,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { HOLD_GATES, HOLD_KINDS, HOLD_STATES, LANGS, LINE_STATES, RUN_STATES } from "../_shims/contracts.js";
import {
  cents,
  checkCurrency,
  checkIn,
  checkProvenance,
  checkSha,
  createdAt,
  currency,
  grams,
  id,
  provenance,
  sha256,
  tstz,
  updatedAt,
  version,
  wsFk,
  wsIdUnique,
} from "./_columns.js";
import { lots, members, rateCards, seasons } from "./coop.js";
import { llmCalls } from "./llm.js";
import { workspaceId } from "./workspace.js";

export const runSeq = pgSequence("fs_run_seq", { startWith: 1, minValue: 1, increment: 1, cache: 1 });

/** States at or beyond POSTING: a digest and sender_batch_id must exist (DENIED is reachable only from them). */
export const RUN_STATES_WITH_DIGEST = [
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
  "CLOSED",
  "DENIED",
] as const;

export const payRuns = pgTable(
  "pay_runs",
  {
    id: id(),
    workspaceId: workspaceId(),
    seasonId: uuid("season_id").notNull(),
    lotId: uuid("lot_id"),
    rateCardId: uuid("rate_card_id").notNull(),
    /** 2026A (denormalised so run_slug can be a generated column) */
    seasonCode: text("season_code").notNull(),
    runSeq: bigint("run_seq", { mode: "number" }).notNull().default(sql`nextval('fs_run_seq')`),
    runSlug: text("run_slug").notNull().generatedAlwaysAs(sql`season_code || '-r' || run_seq::text`),
    state: text("state", { enum: RUN_STATES }).notNull().default("DRAFT"),
    version: version(),
    currency: currency().notNull(),
    distributionCents: cents("distribution_cents"),
    feeReserveCents: cents("fee_reserve_cents"),
    auditFeeCents: cents("audit_fee_cents"),
    /** display-only FX, rational and fixed per run (₱ per US$ = fx_num / fx_den) */
    fxNum: bigint("fx_num", { mode: "bigint" }),
    fxDen: bigint("fx_den", { mode: "bigint" }),
    fxSource: text("fx_source"),
    quoteSha256: sha256("quote_sha256"),
    rateCardSha256: sha256("rate_card_sha256").notNull(),
    batchSha256: sha256("batch_sha256"),
    senderBatchId: text("sender_batch_id").unique("pay_runs_sender_batch_id_uq"),
    haltedReason: text("halted_reason"),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("pay_runs_state_ck", t.state, RUN_STATES),
    check(
      "pay_runs_digest_from_posting_ck",
      sql`${t.state} not in (${sql.raw(RUN_STATES_WITH_DIGEST.map((s) => `'${s}'`).join(", "))}) or (${t.batchSha256} is not null and ${t.senderBatchId} is not null)`,
    ),
    check("pay_runs_fx_ck", sql`${t.fxDen} is null or ${t.fxDen} > 0`),
    checkSha("pay_runs_quote_sha256_ck", t.quoteSha256, true),
    checkSha("pay_runs_rate_card_sha256_ck", t.rateCardSha256),
    checkSha("pay_runs_batch_sha256_ck", t.batchSha256, true),
    checkCurrency("pay_runs_currency_ck", t.currency),
    checkProvenance("pay_runs", t.provenance),
    unique("pay_runs_run_seq_uq").on(t.runSeq),
    unique("pay_runs_run_slug_uq").on(t.runSlug),
    index("pay_runs_ws_state_idx").on(t.workspaceId, t.state),
    wsIdUnique("pay_runs", t),
    wsFk("pay_runs_season_fk", t, t.seasonId, seasons),
    wsFk("pay_runs_lot_fk", t, t.lotId, lots),
    wsFk("pay_runs_rate_card_fk", t, t.rateCardId, rateCards),
  ],
);

/** PayPal Invoicing v2 statuses, plus NEW for a row checkpointed before create_invoice. */
export const INVOICE_STATUSES = [
  "NEW",
  "DRAFT",
  "SENT",
  "SCHEDULED",
  "UNPAID",
  "PAYMENT_PENDING",
  "PARTIALLY_PAID",
  "PAID",
  "MARKED_AS_PAID",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "MARKED_AS_REFUNDED",
] as const;

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    workspaceId: workspaceId(),
    runId: uuid("run_id").notNull(),
    paypalInvoiceId: text("paypal_invoice_id").unique("invoices_paypal_invoice_id_uq"),
    /** FS-{runSlug}, ≤ 25 characters; the create idempotency key */
    invoiceNumber: text("invoice_number").notNull().unique("invoices_invoice_number_uq"),
    status: text("status", { enum: INVOICE_STATUSES }).notNull().default("NEW"),
    amountCents: cents("amount_cents").notNull(),
    dueCents: cents("due_cents"),
    currency: currency().notNull(),
    payerViewUrl: text("payer_view_url"),
    autoCancelOn: date("auto_cancel_on"),
    createdAtPaypal: tstz("created_at_paypal"),
    sentAt: tstz("sent_at"),
    ruleCreatedAt: tstz("rule_created_at"),
    paymentRecordedAt: tstz("payment_recorded_at"),
    fundedAt: tstz("funded_at"),
    version: version(),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("invoices_status_ck", t.status, INVOICE_STATUSES),
    check("invoices_number_ck", sql`${t.invoiceNumber} ~ '^FS-' and length(${t.invoiceNumber}) <= 25`),
    check("invoices_amount_ck", sql`${t.amountCents} > 0 and (${t.dueCents} is null or ${t.dueCents} >= 0)`),
    checkCurrency("invoices_currency_ck", t.currency),
    checkProvenance("invoices", t.provenance),
    unique("invoices_run_uq").on(t.runId),
    wsIdUnique("invoices", t),
    wsFk("invoices_run_fk", t, t.runId, payRuns),
  ],
);

export const RAILS = ["ON", "OFF"] as const;

export const memberLines = pgTable(
  "member_lines",
  {
    id: id(),
    workspaceId: workspaceId(),
    runId: uuid("run_id").notNull(),
    memberId: uuid("member_id").notNull(),
    state: text("state", { enum: LINE_STATES }).notNull().default("COMPUTED"),
    version: version(),
    rail: text("rail", { enum: RAILS }).notNull(),
    currency: currency().notNull(),
    verifiedG: grams("verified_g").notNull(),
    grade1G: grams("grade1_g").notNull(),
    premiumCents: cents("premium_cents").notNull(),
    bonusCents: cents("bonus_cents").notNull(),
    deductionsCents: cents("deductions_cents").notNull(),
    creditsCents: cents("credits_cents").notNull(),
    netCents: cents("net_cents").notNull(),
    /** [{ruleId, amountCents, slipRowId}] computed by the engine */
    deductions: jsonb("deductions").notNull(),
    lineSha256: sha256("line_sha256"),
    /** "share R0 × 148.0 kg · slip 0403 row 2 · agreement 0.97" */
    trace: jsonb("trace"),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("member_lines_state_ck", t.state, LINE_STATES),
    checkIn("member_lines_rail_ck", t.rail, RAILS),
    checkCurrency("member_lines_currency_ck", t.currency),
    // I3 at line grain: net = premium + bonus − ruled deductions + credits, all in integer cents
    check(
      "member_lines_net_ck",
      sql`${t.netCents} = ${t.premiumCents} + ${t.bonusCents} - ${t.deductionsCents} + ${t.creditsCents}`,
    ),
    check(
      "member_lines_nonneg_ck",
      sql`${t.premiumCents} >= 0 and ${t.bonusCents} >= 0 and ${t.deductionsCents} >= 0 and ${t.creditsCents} >= 0 and ${t.verifiedG} >= 0 and ${t.grade1G} between 0 and ${t.verifiedG}`,
    ),
    checkSha("member_lines_line_sha256_ck", t.lineSha256, true),
    checkProvenance("member_lines", t.provenance),
    unique("member_lines_member_uq").on(t.runId, t.memberId),
    index("member_lines_run_state_idx").on(t.runId, t.state),
    wsIdUnique("member_lines", t),
    wsFk("member_lines_run_fk", t, t.runId, payRuns),
    wsFk("member_lines_member_fk", t, t.memberId, members),
  ],
);

export const holds = pgTable(
  "holds",
  {
    id: id(),
    workspaceId: workspaceId(),
    runId: uuid("run_id").notNull(),
    /** null for season-level holds (MASS_BALANCE) */
    lineId: uuid("line_id"),
    /** display handle, e.g. H1 */
    code: text("code"),
    kind: text("kind", { enum: HOLD_KINDS }).notNull(),
    gate: text("gate", { enum: HOLD_GATES }).notNull(),
    state: text("state", { enum: HOLD_STATES }).notNull().default("OPEN"),
    version: version(),
    engineParams: jsonb("engine_params"),
    /** "Claude's line": words and {{PLACEHOLDERS}} only, never a digit (I1) */
    claudeLine: text("claude_line"),
    evidence: jsonb("evidence"),
    raisedBy: text("raised_by").notNull(),
    resolvedBy: text("resolved_by"),
    resolution: jsonb("resolution"),
    resolvedAt: tstz("resolved_at"),
    provenance: provenance(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    checkIn("holds_kind_ck", t.kind, HOLD_KINDS),
    checkIn("holds_gate_ck", t.gate, HOLD_GATES),
    checkIn("holds_state_ck", t.state, HOLD_STATES),
    check("holds_claude_line_no_digits_ck", sql`${t.claudeLine} is null or ${t.claudeLine} !~ '[0-9]'`),
    check("holds_mass_balance_season_ck", sql`${t.kind} <> 'MASS_BALANCE' or ${t.lineId} is null`),
    checkProvenance("holds", t.provenance),
    index("holds_run_state_idx").on(t.runId, t.state),
    wsIdUnique("holds", t),
    wsFk("holds_run_fk", t, t.runId, payRuns),
    wsFk("holds_line_fk", t, t.lineId, memberLines),
  ],
);

export const APPROVAL_ROLES = ["treasurer", "board"] as const;
export const APPROVAL_DECISIONS = ["SIGNED", "DECLINED"] as const;

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    workspaceId: workspaceId(),
    runId: uuid("run_id").notNull(),
    role: text("role", { enum: APPROVAL_ROLES }).notNull(),
    decision: text("decision", { enum: APPROVAL_DECISIONS }).notNull(),
    approverId: text("approver_id").notNull(),
    keyId: text("key_id"),
    /** JCS{v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role, approverId, nonce, exp} */
    payloadJcs: text("payload_jcs"),
    signature: text("signature"),
    batchSha256: sha256("batch_sha256"),
    nonce: text("nonce").unique("approvals_nonce_uq"),
    exp: tstz("exp"),
    reason: text("reason"),
    voidedAt: tstz("voided_at"),
    voidReason: text("void_reason"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("approvals_role_ck", t.role, APPROVAL_ROLES),
    checkIn("approvals_decision_ck", t.decision, APPROVAL_DECISIONS),
    check(
      "approvals_signed_fields_ck",
      sql`${t.decision} <> 'SIGNED' or (${t.keyId} is not null and ${t.payloadJcs} is not null and ${t.signature} is not null and ${t.batchSha256} is not null and ${t.nonce} is not null and ${t.exp} is not null)`,
    ),
    checkSha("approvals_batch_sha256_ck", t.batchSha256, true),
    checkProvenance("approvals", t.provenance),
    // one live signature per role per run; voiding frees the slot for a fresh approval
    uniqueIndex("approvals_live_role_uq")
      .on(t.runId, t.role)
      .where(sql`voided_at is null and decision = 'SIGNED'`),
    wsIdUnique("approvals", t),
    wsFk("approvals_run_fk", t, t.runId, payRuns),
  ],
);

export const statements = pgTable(
  "statements",
  {
    id: id(),
    workspaceId: workspaceId(),
    lineId: uuid("line_id").notNull(),
    lang: text("lang", { enum: LANGS }).notNull(),
    /** [{id, text, placeholders}] — words only; code renders every number */
    sentences: jsonb("sentences").notNull(),
    smsText: text("sms_text"),
    audio: jsonb("audio"),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("statements_lang_ck", t.lang, LANGS),
    checkProvenance("statements", t.provenance),
    unique("statements_line_lang_uq").on(t.lineId, t.lang),
    wsIdUnique("statements", t),
    wsFk("statements_line_fk", t, t.lineId, memberLines),
  ],
);

export const cashReceipts = pgTable(
  "cash_receipts",
  {
    id: id(),
    workspaceId: workspaceId(),
    lineId: uuid("line_id").notNull(),
    amountCents: cents("amount_cents").notNull(),
    currency: currency().notNull(),
    paidAt: tstz("paid_at").notNull(),
    /** clerk persona attesting the cash hand-over (off-rail: attested, not moved by PayPal) */
    attestedBy: text("attested_by").notNull(),
    attestation: jsonb("attestation"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    check("cash_receipts_amount_ck", sql`${t.amountCents} >= 0`),
    checkCurrency("cash_receipts_currency_ck", t.currency),
    checkProvenance("cash_receipts", t.provenance),
    unique("cash_receipts_line_uq").on(t.lineId),
    wsIdUnique("cash_receipts", t),
    wsFk("cash_receipts_line_fk", t, t.lineId, memberLines),
  ],
);

export const REVIEW_STATES = ["OPEN", "ANSWERED", "CLOSED"] as const;

export const reviewRequests = pgTable(
  "review_requests",
  {
    id: id(),
    workspaceId: workspaceId(),
    lineId: uuid("line_id").notNull(),
    memberId: uuid("member_id").notNull(),
    message: text("message").notNull(),
    state: text("state", { enum: REVIEW_STATES }).notNull().default("OPEN"),
    answer: text("answer"),
    answeredBy: text("answered_by"),
    answeredAt: tstz("answered_at"),
    provenance: provenance(),
    createdAt: createdAt(),
  },
  (t) => [
    checkIn("review_requests_state_ck", t.state, REVIEW_STATES),
    checkProvenance("review_requests", t.provenance),
    wsIdUnique("review_requests", t),
    wsFk("review_requests_line_fk", t, t.lineId, memberLines),
    wsFk("review_requests_member_fk", t, t.memberId, members),
  ],
);
