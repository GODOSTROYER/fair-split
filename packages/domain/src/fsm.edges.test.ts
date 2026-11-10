// Tests that kill mutation-testing survivors (handoff T3) in the state machines (I5): which payout item
// statuses are final, and that a status that does not outrank the current one is dropped without a
// follow-up. They also pin every run, line and item edge, so a changed table is caught even when
// Stryker counts the table as a static mutant.
import { PAY_RUN_RANK, PAYOUT_ITEM_RANK, type PayoutItemStatus } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { applyItemStatus, isItemTerminal, lineMachine, runMachine } from "./fsm.js";

describe("fsm.item", () => {
  it("knows exactly which statuses are final", () => {
    const final = Object.fromEntries(
      (Object.keys(PAYOUT_ITEM_RANK) as PayoutItemStatus[]).map((s) => [s, isItemTerminal(s)]),
    );
    expect(final).toEqual({
      SUBMITTED: false,
      PENDING: false,
      ONHOLD: false,
      UNCLAIMED: false,
      RETURNED: true,
      FAILED: true,
      BLOCKED: true,
      SUCCESS: true,
      REFUNDED: true,
      REVERSED: true,
    });
  });

  it("a status that does not outrank the current one is dropped, with no follow-up", () => {
    expect(applyItemStatus("SUCCESS", "PENDING", { cancelRequested: false })).toEqual({
      applied: false,
      next: "SUCCESS",
      followUp: false,
      reason: "NOT_HIGHER",
    });
    expect(applyItemStatus("FAILED", "BLOCKED", { cancelRequested: true })).toEqual({
      applied: false,
      next: "FAILED",
      followUp: false,
      reason: "NOT_HIGHER",
    });
  });
});

describe("the edge tables, in full", () => {
  it("fsm.run has exactly the register's edges", () => {
    expect(runMachine.edges().map((e) => `${e.from} -${e.trigger}-> ${e.to}`)).toMatchInlineSnapshot(`
      [
        "DRAFT -QUOTE-> QUOTED",
        "QUOTED -INVOICE_SENT-> INVOICED",
        "INVOICED -FUND-> FUNDED",
        "INVOICED -CANCEL-> CANCELLED",
        "FUNDED -START_EXTRACTION-> EXTRACTING",
        "EXTRACTING -ROWS_SETTLED-> COMPUTED",
        "COMPUTED -OPEN_REVIEW-> IN_REVIEW",
        "IN_REVIEW -TREASURER_SIGNED-> TREASURER_APPROVED",
        "TREASURER_APPROVED -WITHIN_THRESHOLD-> APPROVED",
        "TREASURER_APPROVED -NEEDS_CHAIR-> AWAITING_BOARD",
        "AWAITING_BOARD -CHAIR_SIGNED-> APPROVED",
        "TREASURER_APPROVED -SEND_BACK-> IN_REVIEW",
        "AWAITING_BOARD -SEND_BACK-> IN_REVIEW",
        "APPROVED -SEND_BACK-> IN_REVIEW",
        "APPROVED -POST-> POSTING",
        "POSTING -ACCEPTED-> POSTED",
        "POSTING -REJECTED-> DENIED",
        "POSTED -PROCESSING-> SETTLING",
        "POSTED -BATCH_DENIED-> DENIED",
        "SETTLING -BATCH_DENIED-> DENIED",
        "SETTLING -ALL_TERMINAL-> SETTLED",
        "SETTLING -FOLLOW_UP-> NEEDS_FOLLOW_UP",
        "NEEDS_FOLLOW_UP -FOLLOW_UP_DONE-> SETTLED",
        "SETTLED -CLOSE-> CLOSED",
        "DRAFT -HALT-> HALTED",
        "QUOTED -HALT-> HALTED",
        "INVOICED -HALT-> HALTED",
        "FUNDED -HALT-> HALTED",
        "EXTRACTING -HALT-> HALTED",
        "COMPUTED -HALT-> HALTED",
        "IN_REVIEW -HALT-> HALTED",
        "TREASURER_APPROVED -HALT-> HALTED",
        "AWAITING_BOARD -HALT-> HALTED",
        "APPROVED -HALT-> HALTED",
      ]
    `);
  });

  it("fsm.run's terminal states and strip helpers", () => {
    const states = Object.keys(PAY_RUN_RANK) as (keyof typeof PAY_RUN_RANK)[];
    expect(states.filter((s) => runMachine.isTerminal(s)).sort()).toEqual([
      "CANCELLED",
      "CLOSED",
      "DENIED",
      "HALTED",
    ]);
  });

  it("fsm.line has exactly the register's edges", () => {
    const states = Object.keys(LINE_STATES) as (keyof typeof LINE_STATES)[];
    expect(Object.fromEntries(states.map((s) => [s, [...lineMachine.targets(s)]]))).toEqual(LINE_STATES);
    expect(Object.fromEntries(states.map((s) => [s, lineMachine.rank(s)]))).toEqual(LINE_RANKS);
  });
});

const LINE_STATES = {
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
} as const;

const LINE_RANKS = {
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
