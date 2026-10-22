import {
  type MemberLineState,
  PAY_RUN_STATES,
  PAYOUT_ITEM_RANK,
  PAYOUT_ITEM_STATUSES,
  type PayoutItemStatus,
  type PayRunState,
} from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  applyItemStatus,
  fsm,
  isItemTerminal,
  itemStatusFromEvent,
  LINE_RANK,
  lineMachine,
  lineStateForItem,
  RUN_TRIGGERS,
  type RunTrigger,
  runMachine,
} from "./fsm.js";

describe("fsm.run", () => {
  it("walks the happy path of the register", () => {
    const path: [RunTrigger, PayRunState][] = [
      ["QUOTE", "QUOTED"],
      ["INVOICE_SENT", "INVOICED"],
      ["FUND", "FUNDED"],
      ["START_EXTRACTION", "EXTRACTING"],
      ["ROWS_SETTLED", "COMPUTED"],
      ["OPEN_REVIEW", "IN_REVIEW"],
      ["TREASURER_SIGNED", "TREASURER_APPROVED"],
      ["NEEDS_CHAIR", "AWAITING_BOARD"],
      ["CHAIR_SIGNED", "APPROVED"],
      ["POST", "POSTING"],
      ["ACCEPTED", "POSTED"],
      ["PROCESSING", "SETTLING"],
      ["FOLLOW_UP", "NEEDS_FOLLOW_UP"],
      ["FOLLOW_UP_DONE", "SETTLED"],
      ["CLOSE", "CLOSED"],
    ];
    let s: PayRunState = "DRAFT";
    for (const [t, to] of path) {
      const r = runMachine.next(s, t);
      expect(r).toMatchObject({ ok: true, to });
      if (r.ok) s = r.to;
    }
    expect(runMachine.isTerminal(s)).toBe(true);
    expect(fsm.run.next("TREASURER_APPROVED", "WITHIN_THRESHOLD")).toMatchObject({
      ok: true,
      to: "APPROVED",
    });
  });

  it("refuses jumps and anything out of a terminal state", () => {
    expect(runMachine.next("DRAFT", "FUND").ok).toBe(false);
    expect(runMachine.next("IN_REVIEW", "POST").ok).toBe(false);
    for (const t of RUN_TRIGGERS) {
      for (const s of ["CLOSED", "CANCELLED", "DENIED", "HALTED"] as const)
        expect(runMachine.next(s, t).ok).toBe(false);
    }
  });

  it("sends back to review (approvals voided), halts only below POSTING, and has the exits", () => {
    for (const s of ["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"] as const) {
      expect(runMachine.next(s, "SEND_BACK")).toMatchObject({ ok: true, to: "IN_REVIEW" });
    }
    expect(runMachine.next("POSTING", "SEND_BACK").ok).toBe(false);
    expect(runMachine.next("APPROVED", "HALT")).toMatchObject({ ok: true, to: "HALTED" });
    expect(runMachine.next("DRAFT", "HALT")).toMatchObject({ ok: true, to: "HALTED" });
    expect(runMachine.next("POSTING", "HALT").ok).toBe(false);
    expect(runMachine.next("INVOICED", "CANCEL")).toMatchObject({ ok: true, to: "CANCELLED" });
    expect(runMachine.next("POSTING", "REJECTED")).toMatchObject({ ok: true, to: "DENIED" });
    expect(runMachine.next("SETTLING", "BATCH_DENIED")).toMatchObject({ ok: true, to: "DENIED" });
    expect(runMachine.canTransition("IN_REVIEW", "TREASURER_APPROVED")).toBe(true);
    expect(runMachine.canTransition("IN_REVIEW", "POSTING")).toBe(false);
  });

  it("feeds the run strip (register §7)", () => {
    expect(runMachine.isFundedOrLater("FUNDED")).toBe(true);
    expect(runMachine.isFundedOrLater("INVOICED")).toBe(false);
    expect(runMachine.isComputedOrLater("IN_REVIEW")).toBe(true);
    expect(runMachine.isApprovedOrLater("POSTED")).toBe(true);
    expect(runMachine.isSettledOrLater("SETTLED")).toBe(true);
    expect(runMachine.isSettledOrLater("HALTED")).toBe(false);
  });

  it("inv.i5.forward-only: every run edge raises the rank except the documented send-back", () => {
    for (const e of runMachine.edges()) {
      if (e.trigger === "SEND_BACK") expect(e.to).toBe("IN_REVIEW");
      else expect(runMachine.isForward(e.from, e.to)).toBe(true);
    }
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...RUN_TRIGGERS), { maxLength: 60 }), (triggers) => {
        let s: PayRunState = "DRAFT";
        let reachedReview = false;
        for (const t of triggers) {
          const r = runMachine.next(s, t);
          if (!r.ok) continue;
          if (t !== "SEND_BACK") expect(runMachine.rank(r.to)).toBeGreaterThan(runMachine.rank(s));
          s = r.to;
          if (s === "IN_REVIEW") reachedReview = true;
          if (reachedReview) expect(runMachine.rank(s)).toBeGreaterThanOrEqual(runMachine.rank("IN_REVIEW"));
        }
        expect(PAY_RUN_STATES).toContain(s);
      }),
      { numRuns: 300 },
    );
  });
});

describe("fsm.line", () => {
  it("follows the register's member-line paths", () => {
    expect(lineMachine.canTransition("COMPUTED", "READY")).toBe(true);
    expect(lineMachine.canTransition("COMPUTED", "HELD")).toBe(true);
    expect(lineMachine.canTransition("HELD", "EXCLUDED")).toBe(true);
    expect(lineMachine.canTransition("READY", "OFF_RAIL_DUE")).toBe(true);
    expect(lineMachine.canTransition("OFF_RAIL_DUE", "OFF_RAIL_PAID")).toBe(true);
    expect(lineMachine.canTransition("SUBMITTED", "NEEDS_ACTION")).toBe(true);
    expect(lineMachine.canTransition("UNCLAIMED", "RETURNED")).toBe(true);
    expect(lineMachine.canTransition("RETURNED", "OFF_RAIL_DUE")).toBe(true);
    expect(lineMachine.canTransition("PAID", "UNCLAIMED")).toBe(false);
    expect(lineMachine.canTransition("HELD", "PAID")).toBe(false);
    expect(lineMachine.isTerminal("OFF_RAIL_PAID")).toBe(true);
    expect(lineMachine.targets("REROUTED")).toEqual(["SUBMITTED"]);
  });

  it("a re-route starts a new attempt", () => {
    const r = lineMachine.next({ state: "REROUTED", attempt: 0 }, "SUBMITTED");
    expect(r).toMatchObject({ ok: true, to: { state: "SUBMITTED", attempt: 1 } });
    expect(lineMachine.next({ state: "PAID", attempt: 0 }, "READY").ok).toBe(false);
  });

  it("inv.i5.forward-only: (attempt, rank) rises on every line edge except UNLOCK", () => {
    const states = Object.keys(LINE_RANK) as MemberLineState[];
    for (const from of states) {
      for (const to of lineMachine.targets(from)) {
        const r = lineMachine.next({ state: from, attempt: 0 }, to);
        if (!r.ok) throw new Error("edge refused");
        if (from === "LOCKED" && to === "READY") continue;
        expect(lineMachine.isForward(r.from, r.to)).toBe(true);
      }
    }
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...states), { maxLength: 80 }), (targets) => {
        let p = { state: "COMPUTED" as MemberLineState, attempt: 0 };
        for (const to of targets) {
          const r = lineMachine.next(p, to);
          if (!r.ok) continue;
          if (!(p.state === "LOCKED" && to === "READY")) expect(lineMachine.isForward(p, r.to)).toBe(true);
          p = r.to;
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("fsm.item", () => {
  it("maps event names to statuses before ranking", () => {
    expect(itemStatusFromEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toBe("SUCCESS");
    expect(itemStatusFromEvent("PAYMENT.PAYOUTS-ITEM.HELD")).toBe("ONHOLD");
    expect(itemStatusFromEvent("PAYMENT.PAYOUTS-ITEM.CANCELED")).toBe("RETURNED");
    expect(itemStatusFromEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED")).toBe("UNCLAIMED");
    expect(itemStatusFromEvent("PENDING")).toBe("PENDING");
    expect(itemStatusFromEvent("PAYMENT.PAYOUTSBATCH.SUCCESS")).toBeNull();
  });

  it("applies a status only when it outranks the current one", () => {
    expect(applyItemStatus("PENDING", "SUCCESS", { cancelRequested: false })).toEqual({
      applied: true,
      next: "SUCCESS",
      followUp: false,
    });
    expect(applyItemStatus("SUCCESS", "PENDING", { cancelRequested: false })).toMatchObject({
      applied: false,
      reason: "NOT_HIGHER",
    });
    expect(applyItemStatus("FAILED", "BLOCKED", { cancelRequested: false })).toMatchObject({
      applied: false,
    });
    expect(applyItemStatus("SUCCESS", "SUCCESS", { cancelRequested: false })).toMatchObject({
      applied: false,
    });
  });

  it("accepts RETURNED only after our own cancel of an UNCLAIMED item", () => {
    expect(applyItemStatus("UNCLAIMED", "RETURNED", { cancelRequested: true })).toMatchObject({
      applied: true,
      next: "RETURNED",
    });
    expect(applyItemStatus("UNCLAIMED", "RETURNED", { cancelRequested: false })).toMatchObject({
      applied: false,
      followUp: true,
      reason: "RETURNED_WITHOUT_CANCEL",
    });
    expect(applyItemStatus("PENDING", "RETURNED", { cancelRequested: true })).toMatchObject({
      applied: false,
      followUp: true,
    });
  });

  it("maps statuses to line states and knows which are terminal", () => {
    expect(lineStateForItem("SUCCESS")).toBe("PAID");
    expect(lineStateForItem("UNCLAIMED")).toBe("UNCLAIMED");
    expect(lineStateForItem("BLOCKED")).toBe("NEEDS_ACTION");
    expect(lineStateForItem("REFUNDED")).toBe("REVERSED");
    expect(isItemTerminal("UNCLAIMED")).toBe(false);
    expect(isItemTerminal("RETURNED")).toBe(true);
  });

  it("inv.i5.forward-only: an item's rank never falls, whatever events arrive in whatever order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...PAYOUT_ITEM_STATUSES), fc.boolean()), { maxLength: 40 }),
        (events) => {
          let s: PayoutItemStatus = "SUBMITTED";
          for (const [incoming, cancel] of events) {
            const r = applyItemStatus(s, incoming, { cancelRequested: cancel });
            expect(PAYOUT_ITEM_RANK[r.next]).toBeGreaterThanOrEqual(PAYOUT_ITEM_RANK[s]);
            if (r.applied && r.next === "RETURNED") expect(s).toBe("UNCLAIMED");
            s = r.next;
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
