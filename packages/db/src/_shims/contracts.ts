/**
 * TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
 *
 * Mirrors, name for name, the decision register:
 * - §7 workspace kinds, pay-run states, member-line states, hold kinds/gates/states, payout item ranks;
 * - §11 IC-01 RunEvent types and the TaskName registry;
 * - architecture §0 I8 provenance labels; S3.8 roles; S3.11 system flags.
 * Keep this file minimal: the swap to `@fairsplit/contracts` must be a mechanical import change.
 */

export const WORKSPACE_KINDS = ["showcase", "judge", "real"] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const ROLES = ["brand", "treasurer", "board", "clerk", "member", "judge", "operator"] as const;
export type Role = (typeof ROLES)[number];

/** I8: every data row says where it came from. */
export const PROVENANCES = ["live", "replay", "simulated_rail", "seeded"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const ACTOR_KINDS = ["human", "agent", "engine", "paypal", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const LANGS = ["ceb", "fil", "en"] as const;
export type Lang = (typeof LANGS)[number];

/** Register §7, pay run. CANCELLED, DENIED and HALTED are exits. */
export const RUN_STATES = [
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
] as const;
export type RunState = (typeof RUN_STATES)[number];

/** Register §7, member line. */
export const LINE_STATES = [
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
] as const;
export type LineState = (typeof LINE_STATES)[number];

export const HOLD_KINDS = [
  "DUPLICATE_SLIP",
  "IMPLAUSIBLE_YIELD",
  "NO_RULE",
  "RATE_MISMATCH",
  "SUSPECTED_INJECTION",
  "LOW_CONFIDENCE",
  "MASS_BALANCE",
] as const;
export type HoldKind = (typeof HOLD_KINDS)[number];

export const HOLD_GATES = ["BLOCKS_APPROVAL", "RESERVES_LINE"] as const;
export type HoldGate = (typeof HOLD_GATES)[number];

export const HOLD_STATES = ["OPEN", "ASKED_CHAIR", "RESOLVED", "EXCLUDED"] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** Register §7 payout item ranks. A status applies only if its rank is higher than the current one. */
export const ITEM_STATUS_RANK = {
  PENDING: 10,
  ONHOLD: 20,
  UNCLAIMED: 30,
  RETURNED: 40,
  FAILED: 50,
  BLOCKED: 50,
  SUCCESS: 60,
  REFUNDED: 70,
  REVERSED: 70,
} as const;
export type ItemStatus = keyof typeof ITEM_STATUS_RANK;
export const ITEM_STATUSES = Object.keys(ITEM_STATUS_RANK) as ItemStatus[];

/** IC-01 RunEvent types. */
export const RUN_EVENT_TYPES = [
  "run.state",
  "line.state",
  "item.updated",
  "hold.raised",
  "hold.resolved",
  "field.entered",
  "extract.row",
  "extract.field",
  "extract.quarantined",
  "approval.signed",
  "approval.declined",
  "presence",
  "webhook.received",
  "invoice.state",
  "policy.verdict",
  "agent.delta",
  "capture.synced",
  "flag.changed",
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** IC-01 TaskName registry (names only; argument schemas and idempotency keys are WS-CORE's). */
export const TASK_NAMES = [
  "ensureInvoice",
  "recordPayment",
  "processWebhook",
  "postPayoutBatch",
  "settleBatch",
  "cancelUnclaimed",
  "reroute",
  "extract",
  "readRateCard",
  "computeRun",
  "explain",
  "agentTurn",
  "pushNotify",
  "reconcile",
  "judgeReset",
  "warmCaches",
] as const;
export type TaskName = (typeof TASK_NAMES)[number];

/** S3.11 kill switches, per workspace; FS_KILL forces them on everywhere. */
export const SYSTEM_FLAGS = ["kill_payouts", "kill_paypal_live", "kill_ai_live"] as const;
export type SystemFlag = (typeof SYSTEM_FLAGS)[number];
