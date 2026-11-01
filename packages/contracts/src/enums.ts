// State names, kinds and statuses from decision register §7 (and the specs it defers to).
// A raw state name is never shown to a person: every enum here has a label map in labels.ts.
import { z } from "zod";

// ---------------------------------------------------------------- identity and tenancy

export const WorkspaceKind = z.enum(["showcase", "judge", "real"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKind>;

export const Role = z.enum(["brand", "treasurer", "board", "clerk", "member", "judge", "operator"]);
export type Role = z.infer<typeof Role>;

export const ActorKind = z.enum(["human", "agent", "engine", "paypal", "system"]);
export type ActorKind = z.infer<typeof ActorKind>;

/** S3 `device_keys.kind`: an app key, a persisted browser key, or a judge-session demo key (C-13). */
export const DeviceKeyKind = z.enum(["app", "web", "web_demo"]);
export type DeviceKeyKind = z.infer<typeof DeviceKeyKind>;

// ---------------------------------------------------------------- pay run

export const PayRunState = z.enum([
  "DRAFT",
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "EXTRACTING",
  "COMPUTED",
  "IN_REVIEW",
  "TREASURER_APPROVED",
  "AWAITING_BOARD",
  "APPROVED",
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
  "CLOSED",
  "CANCELLED",
  "DENIED",
  "HALTED",
]);
export type PayRunState = z.infer<typeof PayRunState>;
export const PAY_RUN_STATES = PayRunState.options;
export const PAY_RUN_EXIT_STATES = [
  "CANCELLED",
  "DENIED",
  "HALTED",
] as const satisfies readonly PayRunState[];

/** Forward order of the main path. Exit states rank above everything and are terminal. */
export const PAY_RUN_RANK: Readonly<Record<PayRunState, number>> = {
  DRAFT: 1,
  QUOTED: 2,
  INVOICED: 3,
  FUNDED: 4,
  EXTRACTING: 5,
  COMPUTED: 6,
  IN_REVIEW: 7,
  TREASURER_APPROVED: 8,
  AWAITING_BOARD: 9,
  APPROVED: 10,
  POSTING: 11,
  POSTED: 12,
  SETTLING: 13,
  NEEDS_FOLLOW_UP: 14,
  SETTLED: 15,
  CLOSED: 16,
  CANCELLED: 99,
  DENIED: 99,
  HALTED: 99,
};

/** Run strip on W-TR-01 (register §7). */
export const RunStripStep = z.enum(["RATIFIED", "FUNDED", "READ", "CHECKED", "APPROVED", "PAID"]);
export type RunStripStep = z.infer<typeof RunStripStep>;
export const RUN_STRIP_STEPS = RunStripStep.options;

// ---------------------------------------------------------------- member line

export const MemberLineState = z.enum([
  "COMPUTED",
  "READY",
  "HELD",
  "EXCLUDED",
  "OFF_RAIL_DUE",
  "OFF_RAIL_PAID",
  "LOCKED",
  "SUBMITTED",
  "PAYPAL_PENDING",
  "PAID",
  "UNCLAIMED",
  "PAYPAL_HELD",
  "NEEDS_ACTION",
  "REVERSED",
  "RETURNED",
  "REROUTED",
]);
export type MemberLineState = z.infer<typeof MemberLineState>;
export const MEMBER_LINE_STATES = MemberLineState.options;

/** How a line is paid. Cash lines are "off rail" and paid at the bodega. */
export const Rail = z.enum(["PAYPAL", "CASH"]);
export type Rail = z.infer<typeof Rail>;

/** Receiver kinds. Rhea's address belongs to no PayPal account (register C-07). */
export const ReceiverKind = z.enum(["SANDBOX_ACCOUNT", "NO_PAYPAL_ACCOUNT", "NONE"]);
export type ReceiverKind = z.infer<typeof ReceiverKind>;

// ---------------------------------------------------------------- holds

export const HoldKind = z.enum([
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
  "LOW_CONFIDENCE",
  "MASS_BALANCE",
]);
export type HoldKind = z.infer<typeof HoldKind>;
export const HOLD_KINDS = HoldKind.options;

export const HoldGate = z.enum(["BLOCKS_APPROVAL", "RESERVES_LINE"]);
export type HoldGate = z.infer<typeof HoldGate>;
export const HOLD_GATES = HoldGate.options;

export const HoldState = z.enum(["OPEN", "ASKED_CHAIR", "RESOLVED", "EXCLUDED"]);
export type HoldState = z.infer<typeof HoldState>;
export const HOLD_STATES = HoldState.options;

/** Resolutions a person can apply. The first six are the agent's `propose_resolution` set (S4.4). */
export const HoldResolutionKind = z.enum([
  "COUNT_ONCE",
  "TWO_DELIVERIES",
  "REGISTER_PLOT",
  "RETURN_AS_CREDIT",
  "APPLY_RULE",
  "EXCLUDE_LINE",
  "CONFIRM_AS_READ",
  "ENTERED_BY_HAND",
  "ENGINE_CLEARED",
]);
export type HoldResolutionKind = z.infer<typeof HoldResolutionKind>;
export const AGENT_RESOLUTIONS = [
  "COUNT_ONCE",
  "TWO_DELIVERIES",
  "REGISTER_PLOT",
  "RETURN_AS_CREDIT",
  "APPLY_RULE",
  "EXCLUDE_LINE",
] as const satisfies readonly HoldResolutionKind[];
export const AgentResolution = z.enum(AGENT_RESOLUTIONS);
export type AgentResolution = z.infer<typeof AgentResolution>;

export const HoldFinding = z.enum([
  "PINK_COPY_OF_SAME_SLIP",
  "RESHOOT_OF_SAME_SLIP",
  "UNREGISTERED_SECOND_PLOT",
  "FINE_NOT_IN_SCHEDULE",
  "CLERK_ARITHMETIC",
  "OTHER",
]);
export type HoldFinding = z.infer<typeof HoldFinding>;

// ---------------------------------------------------------------- PayPal mirror

/**
 * Payout item statuses with their ranks (register §7). SUBMITTED is ours: the row is written
 * before the POST. A status applies only if it outranks the current one.
 */
export const PayoutItemStatus = z.enum([
  "SUBMITTED",
  "PENDING",
  "ONHOLD",
  "UNCLAIMED",
  "RETURNED",
  "FAILED",
  "BLOCKED",
  "SUCCESS",
  "REFUNDED",
  "REVERSED",
]);
export type PayoutItemStatus = z.infer<typeof PayoutItemStatus>;
export const PAYOUT_ITEM_STATUSES = PayoutItemStatus.options;

export const PAYOUT_ITEM_RANK: Readonly<Record<PayoutItemStatus, number>> = {
  SUBMITTED: 0,
  PENDING: 10,
  ONHOLD: 20,
  UNCLAIMED: 30,
  RETURNED: 40,
  FAILED: 50,
  BLOCKED: 50,
  SUCCESS: 60,
  REFUNDED: 70,
  REVERSED: 70,
};

/** Webhook event-name suffixes (after `PAYMENT.PAYOUTS-ITEM.`) mapped to statuses before ranking. */
export const ITEM_EVENT_TO_STATUS: Readonly<Record<string, PayoutItemStatus>> = {
  SUCCEEDED: "SUCCESS",
  HELD: "ONHOLD",
  CANCELED: "RETURNED",
  UNCLAIMED: "UNCLAIMED",
  FAILED: "FAILED",
  RETURNED: "RETURNED",
  BLOCKED: "BLOCKED",
  REFUNDED: "REFUNDED",
  REVERSED: "REVERSED",
};

/** Item status to member line state (S3.5). */
export const ITEM_STATUS_TO_LINE_STATE: Readonly<Record<PayoutItemStatus, MemberLineState>> = {
  SUBMITTED: "SUBMITTED",
  PENDING: "PAYPAL_PENDING",
  ONHOLD: "PAYPAL_HELD",
  UNCLAIMED: "UNCLAIMED",
  RETURNED: "RETURNED",
  FAILED: "NEEDS_ACTION",
  BLOCKED: "NEEDS_ACTION",
  SUCCESS: "PAID",
  REFUNDED: "REVERSED",
  REVERSED: "REVERSED",
};

export const PayoutBatchStatus = z.enum([
  "SUBMITTED",
  "PENDING",
  "PROCESSING",
  "SUCCESS",
  "DENIED",
  "CANCELED",
]);
export type PayoutBatchStatus = z.infer<typeof PayoutBatchStatus>;

export const PayoutBatchKind = z.enum(["primary", "reroute"]);
export type PayoutBatchKind = z.infer<typeof PayoutBatchKind>;

/** PayPal Invoicing v2 statuses. A run is FUNDED only on PAID or MARKED_AS_PAID with 0.00 due. */
export const InvoiceStatus = z.enum([
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
]);
export type InvoiceStatus = z.infer<typeof InvoiceStatus>;
export const INVOICE_STATUSES = InvoiceStatus.options;

export const WEBHOOK_EVENT_TYPES = [
  "INVOICING.INVOICE.PAID",
  "INVOICING.INVOICE.CANCELLED",
  "INVOICING.INVOICE.UPDATED",
  "INVOICING.INVOICE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.PROCESSING",
  "PAYMENT.PAYOUTSBATCH.SUCCESS",
  "PAYMENT.PAYOUTSBATCH.DENIED",
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  "PAYMENT.PAYOUTS-ITEM.FAILED",
  "PAYMENT.PAYOUTS-ITEM.RETURNED",
  "PAYMENT.PAYOUTS-ITEM.CANCELED",
  "PAYMENT.PAYOUTS-ITEM.BLOCKED",
  "PAYMENT.PAYOUTS-ITEM.HELD",
  "PAYMENT.PAYOUTS-ITEM.REFUNDED",
] as const;
export const WebhookEventType = z.enum(WEBHOOK_EVENT_TYPES);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/** A Proof verification's outcome (W-PF-01): "sample" renders as "Sample", never "Verified". */
export const ProofStatus = z.enum(["verified", "sample", "replay", "failed"]);
export type ProofStatus = z.infer<typeof ProofStatus>;

export const WebhookVerified = z.enum(["self", "postback", "dev_mock", "fetched"]);
export type WebhookVerified = z.infer<typeof WebhookVerified>;

export const WebhookStatus = z.enum(["received", "applied", "orphan", "rejected"]);
export type WebhookStatus = z.infer<typeof WebhookStatus>;

export const CallPriority = z.enum(["live", "background"]);
export type CallPriority = z.infer<typeof CallPriority>;

// ---------------------------------------------------------------- infrastructure

export const TaskState = z.enum(["queued", "dispatched", "running", "done", "dead"]);
export type TaskState = z.infer<typeof TaskState>;

export const Executor = z.enum(["inline", "workflow", "worker"]);
export type Executor = z.infer<typeof Executor>;

export const SystemFlagName = z.enum(["kill_payouts", "kill_paypal_live", "kill_ai_live"]);
export type SystemFlagName = z.infer<typeof SystemFlagName>;

// ---------------------------------------------------------------- evidence

export const DocumentKind = z.enum(["slip_photo", "slip_page", "logbook_page", "rate_card_page"]);
export type DocumentKind = z.infer<typeof DocumentKind>;

export const CopyColor = z.enum([
  "WHITE_ORIGINAL",
  "PINK_DUPLICATE",
  "YELLOW_TRIPLICATE",
  "LOGBOOK_LINE",
  "UNKNOWN",
]);
export type CopyColor = z.infer<typeof CopyColor>;

export const Legibility = z.enum(["CLEAR", "SMUDGED", "OVERWRITTEN", "ILLEGIBLE", "ABSENT"]);
export type Legibility = z.infer<typeof Legibility>;

export const ReadVariant = z.enum(["A", "B", "ZOOM"]);
export type ReadVariant = z.infer<typeof ReadVariant>;

export const SlipRowState = z.enum(["AUTO_ACCEPTED", "NEEDS_HUMAN", "CONFIRMED", "REJECTED"]);
export type SlipRowState = z.infer<typeof SlipRowState>;

export const DecidedBy = z.enum(["agreement", "zoom", "person"]);
export type DecidedBy = z.infer<typeof DecidedBy>;

export const Grade = z.enum(["G1", "G2", "OFF"]);
export type Grade = z.infer<typeof Grade>;

/** Collection points: one bodega and two purok pickups. Hauling (R2) applies at purok pickups. */
export const Station = z.enum(["BODEGA", "PUROK_2", "PUROK_4"]);
export type Station = z.infer<typeof Station>;

/** Field names of the slip template's numbered boxes (S4.2 `Row`). */
export const SlipFieldName = z.enum([
  "serial",
  "line_no",
  "date",
  "member_no",
  "member_name",
  "plot_no",
  "sacks",
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_pct",
  "mc_less_kg",
  "payable_kg",
  "grade",
  "clerk_initials",
  "deductions",
]);
export type SlipFieldName = z.infer<typeof SlipFieldName>;

/** Fields whose doubt changes kilos, serial, member or grade: a doubt here blocks approval. */
export const BLOCKING_SLIP_FIELDS = [
  "serial",
  "member_no",
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_pct",
  "mc_less_kg",
  "payable_kg",
  "grade",
] as const satisfies readonly SlipFieldName[];

export const SignatureMark = z.enum(["SIGNED", "THUMBMARK", "NONE", "UNCLEAR"]);
export type SignatureMark = z.infer<typeof SignatureMark>;

export const AnomalyKind = z.enum(["INSTRUCTION_LIKE_TEXT", "ALTERED_VALUE", "UNKNOWN_MARK"]);
export type AnomalyKind = z.infer<typeof AnomalyKind>;

export const QuarantineSource = z.enum(["screen", "read_a", "read_b"]);
export type QuarantineSource = z.infer<typeof QuarantineSource>;

/** Where quarantined text sits relative to the slip's data (S4.2 injection rules). */
export const AnomalyOverlap = z.enum(["NONE", "FIELD", "KILO_FIELD", "DEDUCTION_LINE", "UNLOCATED"]);
export type AnomalyOverlap = z.infer<typeof AnomalyOverlap>;

// ---------------------------------------------------------------- approvals and agent

export const ApprovalRole = z.enum(["treasurer", "chair"]);
export type ApprovalRole = z.infer<typeof ApprovalRole>;

export const Verdict = z.enum(["ALLOW", "REQUIRE_APPROVAL", "DENY"]);
export type Verdict = z.infer<typeof Verdict>;
/** ALLOW (0) < REQUIRE_APPROVAL (1) < DENY (2). The lattice takes the maximum. */
export const VERDICT_RANK: Readonly<Record<Verdict, 0 | 1 | 2>> = { ALLOW: 0, REQUIRE_APPROVAL: 1, DENY: 2 };

export const POLICY_NAMES = [
  "killSwitch",
  "sandboxOnly",
  "allowlist",
  "phaseGate",
  "budgetCap",
  "invoiceEqualsQuote",
  "invoicerIsBusinessEmail",
  "recipientInBrandAllowlist",
  "referenceCarriesHash",
  "dueWithin30Days",
  "sendNeedsTreasurer",
] as const;
export const PolicyName = z.enum(POLICY_NAMES);
export type PolicyName = z.infer<typeof PolicyName>;

/** The 17 agent tools, declared in this fixed order in every session (S4.4). */
export const AGENT_TOOL_NAMES = [
  "get_run_summary",
  "list_holds",
  "get_hold",
  "get_rate_card",
  "get_invoice_quote",
  "get_slip_evidence",
  "get_logbook_entry",
  "get_member",
  "get_member_deliveries",
  "create_invoice",
  "send_invoice",
  "create_conditional_rules_for_invoice",
  "get_invoice",
  "get_payout_batch",
  "get_payout_item",
  "propose_resolution",
  "request_payout_batch",
] as const;
export const AgentToolName = z.enum(AGENT_TOOL_NAMES);
export type AgentToolName = z.infer<typeof AgentToolName>;

export const READ_TOOLS = [
  "get_run_summary",
  "list_holds",
  "get_hold",
  "get_rate_card",
  "get_invoice_quote",
  "get_slip_evidence",
  "get_logbook_entry",
  "get_member",
  "get_member_deliveries",
] as const satisfies readonly AgentToolName[];
export const TOOLKIT_TOOLS = [
  "create_invoice",
  "send_invoice",
  "create_conditional_rules_for_invoice",
  "get_invoice",
] as const satisfies readonly AgentToolName[];
export const PAYOUT_READ_TOOLS = [
  "get_payout_batch",
  "get_payout_item",
] as const satisfies readonly AgentToolName[];

export const AgentPurpose = z.enum(["DRAFT_INVOICE", "INVESTIGATE_HOLD", "REQUEST_BATCH"]);
export type AgentPurpose = z.infer<typeof AgentPurpose>;

export const AgentBlock = z.enum(["text", "thinking", "tool"]);
export type AgentBlock = z.infer<typeof AgentBlock>;

/** Run log lanes on W-TR-08. */
export const LogLane = z.enum(["MACHINE", "PEOPLE", "PAYPAL"]);
export type LogLane = z.infer<typeof LogLane>;

export const ReviewRequestState = z.enum(["open", "answered", "closed"]);
export type ReviewRequestState = z.infer<typeof ReviewRequestState>;
