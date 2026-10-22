import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  decideItemStatus,
  ITEM_STATUS_RANK,
  ITEM_STATUSES,
  type ItemStatus,
  itemStatusRank,
  parseItemStatus,
  toItemStatus,
} from "./item-status.js";
import { WEBHOOK_EVENT_TYPES } from "./webhook/event.js";

describe("toItemStatus (register §7)", () => {
  it.each([
    ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "SUCCESS"],
    ["PAYMENT.PAYOUTS-ITEM.HELD", "ONHOLD"],
    ["PAYMENT.PAYOUTS-ITEM.CANCELED", "RETURNED"],
    ["PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "UNCLAIMED"],
    ["PAYMENT.PAYOUTS-ITEM.FAILED", "FAILED"],
    ["PAYMENT.PAYOUTS-ITEM.RETURNED", "RETURNED"],
    ["PAYMENT.PAYOUTS-ITEM.BLOCKED", "BLOCKED"],
    ["PAYMENT.PAYOUTS-ITEM.REFUNDED", "REFUNDED"],
  ])("%s → %s", (event, status) => {
    expect(toItemStatus(event)).toBe(status);
  });

  it("maps every subscribed item event, and nothing else", () => {
    for (const event of WEBHOOK_EVENT_TYPES) {
      expect(toItemStatus(event) !== null).toBe(event.startsWith("PAYMENT.PAYOUTS-ITEM."));
    }
  });

  it.each([
    "PAYMENT.PAYOUTS-ITEM.CANCELLED",
    "PAYMENT.PAYOUTS-ITEM.DENIED",
    "PAYMENT.PAYOUTS-ITEM.toString",
    "PAYMENT.PAYOUTS-ITEM.__proto__",
    "payment.payouts-item.succeeded",
    "SUCCEEDED",
    "PAYMENT.PAYOUTSBATCH.SUCCESS",
    "",
  ])("returns null for %j", (event) => {
    expect(toItemStatus(event)).toBeNull();
  });

  it("returns null for arbitrary strings outside the item namespace", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (!s.startsWith("PAYMENT.PAYOUTS-ITEM.")) expect(toItemStatus(s)).toBeNull();
      }),
    );
  });

  it("parseItemStatus accepts exactly PayPal's transaction_status values", () => {
    for (const s of ITEM_STATUSES) expect(parseItemStatus(s)).toBe(s);
    expect(parseItemStatus("SUCCEEDED")).toBeNull();
    expect(parseItemStatus(42)).toBeNull();
  });

  it("carries the register's ranks", () => {
    expect(ITEM_STATUS_RANK).toEqual({
      PENDING: 10,
      ONHOLD: 20,
      UNCLAIMED: 30,
      RETURNED: 40,
      FAILED: 50,
      BLOCKED: 50,
      SUCCESS: 60,
      REFUNDED: 70,
      REVERSED: 70,
    });
    expect(itemStatusRank(null)).toBe(0);
  });
});

describe("decideItemStatus", () => {
  const noCancel = { cancelRequested: false };
  const cancelled = { cancelRequested: true };

  it("applies a higher rank and ignores an equal or lower one", () => {
    expect(decideItemStatus("PENDING", "SUCCESS", noCancel)).toEqual({
      apply: true,
      status: "SUCCESS",
      rank: 60,
    });
    expect(decideItemStatus("SUCCESS", "UNCLAIMED", noCancel)).toEqual({
      apply: false,
      reason: "NOT_HIGHER",
      followUp: false,
    });
    expect(decideItemStatus("FAILED", "BLOCKED", noCancel)).toMatchObject({
      apply: false,
      reason: "NOT_HIGHER",
    });
    expect(decideItemStatus("SUCCESS", "SUCCESS", noCancel)).toMatchObject({
      apply: false,
      reason: "NOT_HIGHER",
    });
    expect(decideItemStatus(null, "PENDING", noCancel)).toMatchObject({ apply: true });
  });

  it("accepts RETURNED only after our own cancel; otherwise asks for follow-up", () => {
    expect(decideItemStatus("UNCLAIMED", "RETURNED", cancelled)).toMatchObject({
      apply: true,
      status: "RETURNED",
    });
    expect(decideItemStatus("UNCLAIMED", "RETURNED", noCancel)).toEqual({
      apply: false,
      reason: "RETURNED_WITHOUT_CANCEL",
      followUp: true,
    });
  });

  it("lets a refund or reversal follow a success", () => {
    expect(decideItemStatus("SUCCESS", "REFUNDED", noCancel)).toMatchObject({ apply: true });
    expect(decideItemStatus("SUCCESS", "REVERSED", noCancel)).toMatchObject({ apply: true });
  });
});

const statusArb = fc.constantFrom<ItemStatus>(...ITEM_STATUSES);

function replay(events: readonly ItemStatus[], cancelRequested: boolean, start: ItemStatus | null = null) {
  let current = start;
  const applied: ItemStatus[] = [];
  for (const next of events) {
    const decision = decideItemStatus(current, next, { cancelRequested });
    if (decision.apply) {
      current = decision.status;
      applied.push(decision.status);
    }
  }
  return { current, applied };
}

describe("inv.i5.forward-only: payout item status ranks", () => {
  it("inv.i5.forward-only: applied ranks strictly increase for any event sequence", () => {
    fc.assert(
      fc.property(
        fc.array(statusArb, { maxLength: 40 }),
        fc.boolean(),
        fc.option(statusArb, { nil: null }),
        (events, cancel, start) => {
          const { applied } = replay(events, cancel, start);
          let previous = itemStatusRank(start);
          for (const status of applied) {
            expect(itemStatusRank(status)).toBeGreaterThan(previous);
            previous = itemStatusRank(status);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("inv.i5.forward-only: the final rank does not depend on arrival order", () => {
    fc.assert(
      fc.property(
        fc
          .array(statusArb, { minLength: 1, maxLength: 12 })
          .chain((events) =>
            fc.tuple(
              fc.constant(events),
              fc.shuffledSubarray(events, { minLength: events.length, maxLength: events.length }),
            ),
          ),
        fc.boolean(),
        ([events, shuffled], cancel) => {
          const a = replay(events, cancel).current;
          const b = replay(shuffled, cancel).current;
          expect(itemStatusRank(a)).toBe(itemStatusRank(b));
          const applicable = events.filter((s) => cancel || s !== "RETURNED").map(itemStatusRank);
          expect(itemStatusRank(a)).toBe(Math.max(0, ...applicable));
        },
      ),
      { numRuns: 1000 },
    );
  });

  it("inv.i5.forward-only: RETURNED is never applied without our cancel", () => {
    fc.assert(
      fc.property(fc.array(statusArb, { maxLength: 30 }), (events) => {
        expect(replay(events, false).applied).not.toContain("RETURNED");
      }),
      { numRuns: 500 },
    );
  });

  it("inv.i5.forward-only: webhook replay via toItemStatus is idempotent (duplicates change nothing)", () => {
    const itemEvents = WEBHOOK_EVENT_TYPES.filter((e) => e.startsWith("PAYMENT.PAYOUTS-ITEM."));
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...itemEvents), { maxLength: 20 }),
        fc.boolean(),
        (events, cancel) => {
          const statuses = events.map((e) => toItemStatus(e)).filter((s): s is ItemStatus => s !== null);
          const once = replay(statuses, cancel).current;
          const twice = replay([...statuses, ...statuses], cancel).current;
          expect(twice).toBe(once);
        },
      ),
      { numRuns: 500 },
    );
  });
});
