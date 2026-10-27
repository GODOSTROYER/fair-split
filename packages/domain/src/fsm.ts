// I5: state only moves forward. Pure ranked tables (architecture §4, register §7, S3.5); persistence
// writes `UPDATE … SET state=$next WHERE id=$id AND state=$expected`.
// Documented exceptions, each of which voids approvals or starts a new attempt:
//   run   SEND_BACK  TREASURER_APPROVED | AWAITING_BOARD | APPROVED → IN_REVIEW (line edit, decline, digest mismatch)
//   line  UNLOCK     LOCKED → READY (approvals voided before posting)
//   line  REROUTED → SUBMITTED starts attempt n+1, so (attempt, rank) still increases
import {
  ITEM_EVENT_TO_STATUS,
  ITEM_STATUS_TO_LINE_STATE,
  type MemberLineState,
  PAY_RUN_RANK,
  PAYOUT_ITEM_RANK,
  type PayoutItemStatus,
  type PayRunState,
} from "@fairsplit/contracts";
import { match } from "ts-pattern";

export type Transition<S> = { ok: true; from: S; to: S } | { ok: false; from: S; reason: string };

// ---------------------------------------------------------------- pay run

export const RUN_TRIGGERS = [
  "QUOTE",
  "INVOICE_SENT",
  "FUND",
  "CANCEL",
  "START_EXTRACTION",
  "ROWS_SETTLED",
  "OPEN_REVIEW",
  "TREASURER_SIGNED",
  "WITHIN_THRESHOLD",
  "NEEDS_CHAIR",
  "CHAIR_SIGNED",
  "SEND_BACK",
  "POST",
  "ACCEPTED",
  "REJECTED",
  "PROCESSING",
  "BATCH_DENIED",
  "ALL_TERMINAL",
  "FOLLOW_UP",
  "FOLLOW_UP_DONE",
  "CLOSE",
  "HALT",
] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** States below POSTING may be HALTED by the kill switch (architecture §4, which register §7 adopts). */
const BELOW_POSTING: readonly PayRunState[] = [
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
];

const RUN_EDGES: Readonly<Record<RunTrigger, { from: readonly PayRunState[]; to: PayRunState }>> = {
  QUOTE: { from: ["DRAFT"], to: "QUOTED" },
  INVOICE_SENT: { from: ["QUOTED"], to: "INVOICED" },
  /** Guard (caller): a fresh GET shows PAID or MARKED_AS_PAID with 0.00 due. */
  FUND: { from: ["INVOICED"], to: "FUNDED" },
  CANCEL: { from: ["INVOICED"], to: "CANCELLED" },
  START_EXTRACTION: { from: ["FUNDED"], to: "EXTRACTING" },
  ROWS_SETTLED: { from: ["EXTRACTING"], to: "COMPUTED" },
  OPEN_REVIEW: { from: ["COMPUTED"], to: "IN_REVIEW" },
  /** Guard: no open BLOCKS_APPROVAL hold; the signed batchSha256 equals the recomputed one. */
  TREASURER_SIGNED: { from: ["IN_REVIEW"], to: "TREASURER_APPROVED" },
  WITHIN_THRESHOLD: { from: ["TREASURER_APPROVED"], to: "APPROVED" },
  NEEDS_CHAIR: { from: ["TREASURER_APPROVED"], to: "AWAITING_BOARD" },
  CHAIR_SIGNED: { from: ["AWAITING_BOARD"], to: "APPROVED" },
  SEND_BACK: { from: ["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"], to: "IN_REVIEW" },
  /** Guard: kill_payouts off (read fresh), both digests match, a limiter token is held. */
  POST: { from: ["APPROVED"], to: "POSTING" },
  ACCEPTED: { from: ["POSTING"], to: "POSTED" },
  REJECTED: { from: ["POSTING"], to: "DENIED" },
  PROCESSING: { from: ["POSTED"], to: "SETTLING" },
  BATCH_DENIED: { from: ["POSTED", "SETTLING"], to: "DENIED" },
  ALL_TERMINAL: { from: ["SETTLING"], to: "SETTLED" },
  FOLLOW_UP: { from: ["SETTLING"], to: "NEEDS_FOLLOW_UP" },
  FOLLOW_UP_DONE: { from: ["NEEDS_FOLLOW_UP"], to: "SETTLED" },
  CLOSE: { from: ["SETTLED"], to: "CLOSED" },
  HALT: { from: BELOW_POSTING, to: "HALTED" },
};

const RUN_TERMINAL: ReadonlySet<PayRunState> = new Set(["CLOSED", "CANCELLED", "DENIED", "HALTED"]);

export const runMachine = {
  triggers: RUN_TRIGGERS,
  rank: (s: PayRunState): number => PAY_RUN_RANK[s],
  isTerminal: (s: PayRunState): boolean => RUN_TERMINAL.has(s),
  next(from: PayRunState, trigger: RunTrigger): Transition<PayRunState> {
    const edge = RUN_EDGES[trigger];
    if (!edge.from.includes(from))
      return { ok: false, from, reason: `${trigger} is not allowed from ${from}` };
    return { ok: true, from, to: edge.to };
  },
  /** Every (from, trigger, to) edge in the table. */
  edges(): { from: PayRunState; trigger: RunTrigger; to: PayRunState }[] {
    return RUN_TRIGGERS.flatMap((t) =>
      RUN_EDGES[t].from.map((f) => ({ from: f, trigger: t, to: RUN_EDGES[t].to })),
    );
  },
  canTransition(from: PayRunState, to: PayRunState): boolean {
    return RUN_TRIGGERS.some((t) => RUN_EDGES[t].from.includes(from) && RUN_EDGES[t].to === to);
  },
  /** True for every edge except the documented send-back, which voids approvals. */
  isForward(from: PayRunState, to: PayRunState): boolean {
    return PAY_RUN_RANK[to] > PAY_RUN_RANK[from];
  },
  /** Run-strip helpers (register §7). */
  isFundedOrLater: (s: PayRunState) => PAY_RUN_RANK[s] >= PAY_RUN_RANK.FUNDED && PAY_RUN_RANK[s] < 99,
  isComputedOrLater: (s: PayRunState) => PAY_RUN_RANK[s] >= PAY_RUN_RANK.COMPUTED && PAY_RUN_RANK[s] < 99,
  isApprovedOrLater: (s: PayRunState) => PAY_RUN_RANK[s] >= PAY_RUN_RANK.APPROVED && PAY_RUN_RANK[s] < 99,
  isSettledOrLater: (s: PayRunState) => PAY_RUN_RANK[s] >= PAY_RUN_RANK.SETTLED && PAY_RUN_RANK[s] < 99,
} as const;

// ---------------------------------------------------------------- member line

export const LINE_RANK: Readonly<Record<MemberLineState, number>> = {
  COMPUTED: 1,
  HELD: 2,
  READY: 3,
  LOCKED: 4,
  SUBMITTED: 5,
  PAYPAL_PENDING: 6,
  PAYPAL_HELD: 7,
  UNCLAIMED: 8,
  RETURNED: 9,
  REROUTED: 10,
  NEEDS_ACTION: 11,
  PAID: 12,
  REVERSED: 13,
  OFF_RAIL_DUE: 20,
  OFF_RAIL_PAID: 21,
  EXCLUDED: 30,
};

const LINE_EDGES: Readonly<Record<MemberLineState, readonly MemberLineState[]>> = {
  COMPUTED: ["READY", "HELD"],
  HELD: ["READY", "EXCLUDED"],
  READY: ["OFF_RAIL_DUE", "LOCKED"],
  LOCKED: ["SUBMITTED", "READY"],
  SUBMITTED: ["PAYPAL_PENDING", "NEEDS_ACTION"],
  PAYPAL_PENDING: ["PAYPAL_HELD", "UNCLAIMED", "NEEDS_ACTION", "PAID", "REVERSED"],
  PAYPAL_HELD: ["UNCLAIMED", "NEEDS_ACTION", "PAID", "REVERSED"],
  UNCLAIMED: ["RETURNED", "NEEDS_ACTION", "PAID", "REVERSED"],
  RETURNED: ["OFF_RAIL_DUE", "REROUTED"],
  REROUTED: ["SUBMITTED"],
  NEEDS_ACTION: ["PAID", "REVERSED"],
  PAID: ["REVERSED"],
  REVERSED: [],
  OFF_RAIL_DUE: ["OFF_RAIL_PAID"],
  OFF_RAIL_PAID: [],
  EXCLUDED: [],
};

export interface LineProgress {
  state: MemberLineState;
  /** Increments each time a returned line is re-routed (REROUTED → SUBMITTED). */
  attempt: number;
}

export const lineMachine = {
  rank: (s: MemberLineState): number => LINE_RANK[s],
  isTerminal: (s: MemberLineState): boolean => LINE_EDGES[s].length === 0,
  targets: (s: MemberLineState): readonly MemberLineState[] => LINE_EDGES[s],
  canTransition: (from: MemberLineState, to: MemberLineState): boolean => LINE_EDGES[from].includes(to),
  next(from: LineProgress, to: MemberLineState): Transition<LineProgress> {
    if (!LINE_EDGES[from.state].includes(to)) {
      return { ok: false, from, reason: `${from.state} → ${to} is not a line transition` };
    }
    const attempt = from.state === "REROUTED" && to === "SUBMITTED" ? from.attempt + 1 : from.attempt;
    return { ok: true, from, to: { state: to, attempt } };
  },
  /** Lexicographic (attempt, rank) order; UNLOCK is the only edge that is not forward. */
  isForward(from: LineProgress, to: LineProgress): boolean {
    if (to.attempt !== from.attempt) return to.attempt > from.attempt;
    return LINE_RANK[to.state] > LINE_RANK[from.state];
  },
} as const;

// ---------------------------------------------------------------- payout item

/** Event names map to statuses before ranking: SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED. */
export function itemStatusFromEvent(eventTypeOrStatus: string): PayoutItemStatus | null {
  const suffix = eventTypeOrStatus.startsWith("PAYMENT.PAYOUTS-ITEM.")
    ? eventTypeOrStatus.slice("PAYMENT.PAYOUTS-ITEM.".length)
    : eventTypeOrStatus;
  const mapped = ITEM_EVENT_TO_STATUS[suffix];
  if (mapped) return mapped;
  return suffix in PAYOUT_ITEM_RANK ? (suffix as PayoutItemStatus) : null;
}

export type ItemApply =
  | { applied: true; next: PayoutItemStatus; followUp: false }
  | {
      applied: false;
      next: PayoutItemStatus;
      followUp: boolean;
      reason: "NOT_HIGHER" | "RETURNED_WITHOUT_CANCEL";
    };

/**
 * A status applies only if it outranks the current one. RETURNED is accepted only after our own
 * cancel; without it the event is stored and the run needs a follow-up (S3.5).
 */
export function applyItemStatus(
  current: PayoutItemStatus,
  incoming: PayoutItemStatus,
  ctx: { cancelRequested: boolean },
): ItemApply {
  if (PAYOUT_ITEM_RANK[incoming] <= PAYOUT_ITEM_RANK[current]) {
    return { applied: false, next: current, followUp: false, reason: "NOT_HIGHER" };
  }
  if (incoming === "RETURNED" && !(ctx.cancelRequested && current === "UNCLAIMED")) {
    return { applied: false, next: current, followUp: true, reason: "RETURNED_WITHOUT_CANCEL" };
  }
  return { applied: true, next: incoming, followUp: false };
}

/** Item status → member line state (S3.5 table). */
export function lineStateForItem(status: PayoutItemStatus): MemberLineState {
  return ITEM_STATUS_TO_LINE_STATE[status];
}

/** Whether an item status is final for settlement purposes. */
export function isItemTerminal(status: PayoutItemStatus): boolean {
  return match(status)
    .with("SUBMITTED", "PENDING", "ONHOLD", "UNCLAIMED", () => false)
    .with("RETURNED", "FAILED", "BLOCKED", "SUCCESS", "REFUNDED", "REVERSED", () => true)
    .exhaustive();
}

export const itemMachine = {
  rank: (s: PayoutItemStatus): number => PAYOUT_ITEM_RANK[s],
  fromEvent: itemStatusFromEvent,
  apply: applyItemStatus,
  toLineState: lineStateForItem,
  isTerminal: isItemTerminal,
} as const;

/** IC-02 `fsm.run | fsm.line | fsm.item`. */
export const fsm = { run: runMachine, line: lineMachine, item: itemMachine } as const;
