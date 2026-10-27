// Proof's read model over the seeded season (IC-03): every figure W-PF-01 prints is computed here from the bundle
// and the run's line states, never typed. The paid tiers conserve money (I3) and progress only climbs (I5).

import type { MemberLineState, PayoutItemStatus } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { format } from "../../lib/format.js";
import { deriveFigures } from "./metrics.js";
import {
  advanceProgress,
  amountStateOf,
  countItems,
  isSettled,
  ledgerFacts,
  lineStateOf,
  liveItems,
  memberOfItem,
  mergeItems,
  NO_ITEMS,
  type ProgressCounts,
  paidTiers,
  plotField,
  premiumAllocation,
  railSplit,
} from "./model.js";

const snapshot = getSnapshot();
const bundle = snapshot.proof;
const showcaseStates = snapshot.run.lineStates as Readonly<Record<string, MemberLineState>>;

describe("Proof's figures from the seeded settled run", () => {
  const items = mergeItems(bundle.batch.items);
  const facts = ledgerFacts(bundle.ledger);
  const figures = deriveFigures({
    bundle,
    items,
    lineStates: showcaseStates,
    facts,
    holds: snapshot.holds,
    seeded: snapshot.figures,
  });

  it("explains 64 of 64 lines", () => {
    expect(figures.lines).toEqual({ total: snapshot.figures.members, explained: snapshot.figures.members });
    expect(figures.lines.total).toBe(64);
  });

  it("allocates 100% of the premium with nothing deducted from it (R0)", () => {
    expect(figures.premium.allocatedCents).toBe(snapshot.figures.premiumPoolCents);
    expect(figures.premium.allocatedBp).toBe(10_000);
    expect(figures.premium.deductedFromPremiumCents).toBe(0);
  });

  it("pays in three tiers: 7 by PayPal, 0 of 57 attested, 57 due in cash", () => {
    const { tiers } = figures;
    expect(tiers.paypal).toEqual({
      members: snapshot.figures.endPaidMembers,
      cents: snapshot.figures.endPaidCents,
    });
    expect(format.money(tiers.paypal.cents)).toBe("US$341.74");
    expect(tiers.attested).toEqual({ members: 0, cents: 0, ofMembers: snapshot.figures.endCashMembers });
    expect(tiers.due.cash).toEqual({
      members: snapshot.figures.endCashMembers,
      cents: snapshot.figures.endCashCents,
    });
    expect(tiers.due.paypal).toEqual({ members: 0, cents: 0 });
    expect(format.money(tiers.due.cents)).toBe("US$3,876.43");
  });

  it("says 7 of 64 on PayPal, 8.1% of value, and 57 in cash", () => {
    expect(figures.rails.paypalMembers).toBe(7);
    expect(figures.rails.cashMembers).toBe(57);
    expect(format.percentBp(figures.rails.paypalValueBp, 1)).toBe("8.1%");
    expect(snapshot.figures.display.proofShare).toContain("8.1% of value");
  });

  it("counts three holds caught and US$21.14 kept for members", () => {
    expect(figures.holds?.caught).toBe(3);
    expect(format.money(figures.holds?.keptCents ?? 0)).toBe("US$21.14");
    expect((figures.holds?.duplicateCents ?? 0) + (figures.holds?.creditCents ?? 0)).toBe(
      figures.holds?.keptCents,
    );
  });

  it("times invoice to last confirmation from the chain's own timestamps", () => {
    expect(facts.fundedAt).not.toBeNull();
    expect(facts.lastItemEventAt).not.toBeNull();
    expect(figures.timingMs).toBeGreaterThan(0);
  });

  it("reads the chain: slips in photos, both keys registered, the lines root", () => {
    expect(facts.photosAccepted).toBeGreaterThan(0);
    expect(facts.slipsAccepted).toBeGreaterThanOrEqual(facts.photosAccepted);
    expect(facts.keys.map((k) => k.keyId)).toEqual(
      expect.arrayContaining(bundle.approvals.map((a) => a.keyId)),
    );
    expect(facts.computed?.lineCount).toBe(64);
    expect(facts.computed?.balanced).toBe(true);
  });

  it("premiumAllocation matches the pool exactly", () => {
    expect(premiumAllocation(bundle).poolCents).toBe(bundle.pools.premiumPoolCents);
  });
});

describe("inv.i3 money is conserved across the paid tiers", () => {
  const statuses: PayoutItemStatus[] = [
    "SUBMITTED",
    "PENDING",
    "SUCCESS",
    "ONHOLD",
    "UNCLAIMED",
    "RETURNED",
    "FAILED",
    "BLOCKED",
    "REVERSED",
  ];
  const lineStates: MemberLineState[] = [
    "HELD",
    "EXCLUDED",
    "LOCKED",
    "SUBMITTED",
    "PAYPAL_PENDING",
    "PAID",
    "OFF_RAIL_DUE",
    "OFF_RAIL_PAID",
    "UNCLAIMED",
  ];

  it("inv.i3.tiers: every line lands in exactly one tier and the tiers sum to Σ net, whatever the statuses", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...statuses), {
          minLength: bundle.batch.items.length,
          maxLength: bundle.batch.items.length,
        }),
        fc.dictionary(
          fc.constantFrom(...bundle.lines.map((l) => l.memberNo)),
          fc.constantFrom(...lineStates),
        ),
        (itemStatuses, states) => {
          const items = mergeItems(
            bundle.batch.items.map((item, i) => ({ ...item, status: itemStatuses[i] ?? item.status })),
          );
          const tiers = paidTiers(bundle.lines, items, states);
          const net = bundle.lines.reduce((s, l) => s + l.netCents, 0);
          const sum = tiers.paypal.cents + tiers.attested.cents + tiers.due.cents + tiers.reserved.cents;
          const members =
            tiers.paypal.members + tiers.attested.members + tiers.due.members + tiers.reserved.members;
          expect(sum).toBe(net);
          expect(tiers.netCents).toBe(net);
          expect(members).toBe(bundle.lines.length);
          expect(tiers.due.cents).toBe(tiers.due.cash.cents + tiers.due.paypal.cents);
          const rails = railSplit(tiers);
          expect(rails.paypalCents + rails.cashCents + tiers.reserved.cents).toBe(net);
        },
      ),
      { numRuns: 60 },
    );
  });

  it("a SUCCESS with no notice behind it is not paid (nothing turns jade before PayPal confirms)", () => {
    const unproven = bundle.batch.items.map((i) => ({ ...i, status: "SUCCESS" as const, eventId: null }));
    const tiers = paidTiers(bundle.lines, mergeItems(unproven), {});
    expect(tiers.paypal.members).toBe(0);
    expect(tiers.due.paypal.members).toBe(bundle.batch.items.length);
  });
});

describe("a live run's items", () => {
  it("stay sent until the run's own events say otherwise, then read 8 of 64 on PayPal (8.7%)", () => {
    const items = liveItems(bundle.batch.items, new Map());
    expect(items.every((i) => i.status === "SUBMITTED")).toBe(true);
    const tiers = paidTiers(bundle.lines, items, {});
    const rails = railSplit(tiers);
    expect(rails.paypalMembers).toBe(8);
    expect(format.percentBp(rails.paypalValueBp, 1)).toBe("8.7%");
    expect(tiers.paypal.members).toBe(0);
  });

  it("inv.i5.items: a stale live status never takes a paid item back", () => {
    const paid = bundle.batch.items[0];
    if (!paid) throw new Error("seed has items");
    const merged = mergeItems(
      [paid],
      new Map([
        [
          paid.senderItemId,
          { status: "PENDING", payoutItemId: null, eventId: "9", source: "webhook", at: null },
        ],
      ]),
    );
    expect(merged[0]?.status).toBe(paid.status);
  });
});

describe("inv.i5 progress only moves forward", () => {
  const progress = (confirmed: number): ProgressCounts => ({
    ...NO_ITEMS,
    total: 8,
    confirmed,
    sent: 8 - confirmed,
  });

  it("inv.i5.progress: a replayed or reordered picture never lowers the confirmed count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 8 }), { minLength: 1, maxLength: 20 }),
        (confirmations) => {
          let current: ProgressCounts | null = null;
          let best = 0;
          for (const c of confirmations) {
            current = advanceProgress(current, progress(c));
            best = Math.max(best, current.confirmed);
            expect(current.confirmed).toBe(best);
          }
        },
      ),
    );
  });

  it("counts items by group and knows when the batch has settled", () => {
    const c = countItems([
      "SUCCESS",
      "SUCCESS",
      "UNCLAIMED",
      "SUBMITTED",
      "RETURNED",
      "FAILED",
      "REVERSED",
      "ONHOLD",
    ]);
    expect(c).toMatchObject({
      total: 8,
      confirmed: 2,
      parked: 1,
      sent: 1,
      returned: 1,
      failed: 1,
      reversed: 1,
      held: 1,
    });
    expect(isSettled(c)).toBe(false);
    expect(isSettled(countItems(["SUCCESS", "RETURNED"]))).toBe(true);
    expect(isSettled(NO_ITEMS)).toBe(false);
  });
});

describe("line words and grammar", () => {
  it("reads the member from a sender item ID, re-routes included", () => {
    expect(memberOfItem("r37-M-014")).toBe("M-014");
    expect(memberOfItem("r37x1-M-031")).toBe("M-031");
    expect(memberOfItem("batch-1")).toBeNull();
  });

  it("derives a line's state from its item when the run's states are unknown", () => {
    const items = mergeItems(bundle.batch.items);
    const rhea = items.find((i) => i.memberNo === "M-031");
    const celing = items.find((i) => i.memberNo === "M-014");
    expect(lineStateOf({ memberNo: "M-031", rail: "PAYPAL" }, rhea, {})).toBe("OFF_RAIL_DUE");
    expect(lineStateOf({ memberNo: "M-014", rail: "PAYPAL" }, celing, {})).toBe("PAID");
    expect(lineStateOf({ memberNo: "M-001", rail: "CASH" }, undefined, {})).toBe("OFF_RAIL_DUE");
    expect(lineStateOf({ memberNo: "M-001", rail: "CASH" }, undefined, { "M-001": "OFF_RAIL_PAID" })).toBe(
      "OFF_RAIL_PAID",
    );
  });

  it("follows S2.2.1's amount grammar", () => {
    expect(amountStateOf("PAID")).toBe("landed");
    expect(amountStateOf("OFF_RAIL_PAID")).toBe("attested");
    expect(amountStateOf("OFF_RAIL_DUE")).toBe("hollow");
    expect(amountStateOf("SUBMITTED")).toBe("hollow");
    expect(amountStateOf("HELD")).toBe("pencil");
    expect(amountStateOf("LOCKED")).toBe("ink");
  });
});

describe("the plot field", () => {
  it("places one abstract dot per member inside the field, none overlapping", () => {
    const dots = plotField(bundle.lines, 640, 220);
    expect(dots).toHaveLength(64);
    for (const d of dots) {
      expect(d.x - d.r).toBeGreaterThanOrEqual(-0.5);
      expect(d.y - d.r).toBeGreaterThanOrEqual(-0.5);
      expect(d.x + d.r).toBeLessThanOrEqual(640.5);
      expect(d.y + d.r).toBeLessThanOrEqual(220.5);
    }
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) {
        const a = dots[i];
        const b = dots[j];
        if (!a || !b) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.r + b.r - 0.2);
      }
    }
    expect(plotField([], 640, 220)).toEqual([]);
  });
});
