// W-TR-08's model: the split fan on one linear scale (width is money), each thread's honest state from the
// item's actual PayPal status, the live share on PayPal, the re-route to cash, and the latency dots.

import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import {
  FAN,
  fanoutState,
  fanView,
  latency,
  parkedThread,
  pointAtLength,
  restingPhase,
  summaryFacts,
  threadTone,
} from "./model.js";

const snapshot = seedSnapshot();

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

function posted() {
  const world = createTestWorld();
  world.markPaid();
  world.resolveAll();
  world.sign("treasurer");
  world.cosign();
  return world;
}

/** The two numbers of an SVG path's start ("M196 143.2C…" → [196, 143.2]) and end. */
function ends(d: string): { from: [number, number]; to: [number, number] } {
  const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  return {
    from: [nums[0] ?? Number.NaN, nums[1] ?? Number.NaN],
    to: [nums.at(-2) ?? Number.NaN, nums.at(-1) ?? Number.NaN],
  };
}

describe("the fan's geometry: width is money", () => {
  it("k = 276 / Σ net, threads largest first, spread one row apart so every label has room", () => {
    const fan = fanView(snapshot, showcaseView(snapshot));
    expect(fan.netCents).toBe(snapshot.figures.netCents);
    expect(fan.k).toBeCloseTo(276 / snapshot.figures.netCents, 12);
    expect(fan.threads.map((t) => t.memberNo)).toEqual([
      "M-014",
      "M-007",
      "M-060",
      "M-018",
      "M-039",
      "M-022",
      "M-002",
      "M-031",
    ]);
    const widths = fan.threads.reduce((s, t) => s + t.width, 0);
    expect(widths).toBeCloseTo((276 * snapshot.figures.batchTotalCents) / snapshot.figures.netCents, 6);
    expect(fan.threads[0]?.width).toBeCloseTo(4.2, 1);
    expect(fan.threads.map((t) => t.stubY)).toEqual([24, 52, 80, 108, 136, 164, 192, 220]);
    // 28 units a row is 17.8 px at the 892 px stage: a 12 px name and a 14 px figure never touch.
    expect(FAN.stub.step * (892 / FAN.width)).toBeGreaterThan(17.5);
    // The 56 cash lines' column stays under half the picture: the eight PayPal threads read first.
    expect((fan.cash.bottom - fan.cash.top) / FAN.height).toBeLessThanOrEqual(0.46);
  });

  it("signature 6: one seal, 64 lines, eight PayPal threads and 56 dashed cash lines", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const fan = fanView(snapshot, viewOf(world));
    expect(fan.threads).toHaveLength(8);
    expect(fan.cashLines).toHaveLength(56);
    expect(fan.threads.length + fan.cashLines.length).toBe(64);
    expect(fan.cashLines.every((c) => !c.moved)).toBe(true);
    // Every line leaves the bar as wide as its money, the cash lines below the threads, in member order.
    const memberOrder = fan.cashLines.map((c) => c.memberNo);
    expect(memberOrder).toEqual([...memberOrder].sort());
    const railBottom = FAN.bar.y0 + fan.threads.reduce((s, t) => s + t.width, 0);
    const first = fan.cashLines[0];
    if (!first) throw new Error("no cash line");
    expect(ends(first.d).from[0]).toBe(FAN.bar.x1);
    expect(ends(first.d).from[1]).toBeCloseTo(railBottom + first.h / 2, 1);
    // …and ends in one column under the stubs, each end mark as tall as its money, touching the next.
    expect(ends(first.d).to[0]).toBe(FAN.endX);
    expect(first.endY).toBe(FAN.cash.y0);
    for (let i = 1; i < fan.cashLines.length; i++) {
      const a = fan.cashLines[i - 1];
      const b = fan.cashLines[i];
      if (!a || !b) continue;
      expect(b.endY).toBeCloseTo(a.endY + a.h, 9);
    }
    const stubsBottom = (fan.threads.at(-1)?.stubY ?? 0) + FAN.stub.h;
    expect(fan.cash.top).toBeGreaterThan(stubsBottom);
    expect(fan.cash.bottom).toBeLessThanOrEqual(FAN.height);
    expect(fan.cash.bottom).toBeCloseTo(FAN.cash.y0 + fan.k * fan.cash.cents, 6);
    // A dashed stroke a little narrower than its slot: the 56 read as 56, not as a band.
    expect(fan.cashLines.every((c) => c.stroke >= 1 && c.stroke <= Math.max(1, c.h))).toBe(true);
    expect(fan.cash.amountState).toBe("pencil");
  });

  it("finds the 70% point along a thread's arc, not its parameter", () => {
    const start = pointAtLength(196, 100, 1040, 36, 0);
    const end = pointAtLength(196, 100, 1040, 36, 1);
    expect(start).toEqual({ x: 196, y: 100 });
    expect(end.x).toBeCloseTo(1040, 6);
    const p = pointAtLength(196, 100, 1040, 36, FAN.sentAt);
    expect(p.x).toBeGreaterThan(196 + 0.6 * 844);
    expect(p.x).toBeLessThan(1040);
  });
});

describe("each thread follows the item's actual status", () => {
  it("graphite to 70% when sent, jade only on SUCCESS, a canary cap when parked, red for a PayPal failure", () => {
    expect(threadTone(null, undefined, undefined)).toBe("unsent");
    expect(threadTone("PENDING", undefined, undefined)).toBe("sent");
    expect(threadTone("SUCCESS", undefined, undefined)).toBe("landed");
    expect(threadTone("UNCLAIMED", undefined, undefined)).toBe("parked");
    expect(threadTone("FAILED", undefined, undefined)).toBe("failed");
    expect(threadTone("BLOCKED", undefined, undefined)).toBe("failed");
    const ours = { source: "cancel" } as Parameters<typeof threadTone>[1];
    expect(threadTone("RETURNED", ours, "OFF_RAIL_DUE")).toBe("moved");
    const theirs = { source: "webhook" } as Parameters<typeof threadTone>[1];
    expect(threadTone("RETURNED", theirs, "RETURNED")).toBe("failed");
    expect(threadTone("RETURNED", theirs, "NEEDS_ACTION")).toBe("failed");
  });

  it("before the 201 nothing is drawn; the cash band already is", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const view = viewOf(world);
    const fan = fanView(snapshot, view);
    expect(fan.threads.every((t) => t.tone === "unsent" && t.progress === 0)).toBe(true);
    expect(fan.threads.every((t) => t.amountState === "pencil")).toBe(true);
    expect(fan.cashLines).toHaveLength(56);
    expect(restingPhase(view, fan)).toBe("ready");
  });

  it("after both keys: seven land jade, Rhea parks; 8.7% of value is on PayPal, 8 of 64 members", () => {
    const view = viewOf(posted());
    const fan = fanView(snapshot, view);
    expect(fan.threads.filter((t) => t.tone === "landed")).toHaveLength(7);
    expect(parkedThread(fan)?.memberNo).toBe("M-031");
    expect(fan.paypal).toMatchObject({ members: 8, share: "8.7%" });
    expect(fanoutState(view, fan)).toBe("parked");
    expect(restingPhase(view, fan)).toBe("parked");
  });

  it("Pay in cash at the bodega: her thread retracts, the band grows by her line, 7 of 64 and 8.1%, settled", () => {
    const world = posted();
    world.payCash("M-031");
    const view = viewOf(world);
    const fan = fanView(snapshot, view);
    const rhea = fan.threads.find((t) => t.memberNo === "M-031");
    expect(rhea?.tone).toBe("moved");
    expect(rhea?.progress).toBe(0);
    expect(fan.paypal).toMatchObject({ members: 7, share: "8.1%" });
    expect(fan.cash).toMatchObject({
      cents: snapshot.figures.endCashCents,
      members: 57,
      amountState: "hollow",
    });
    // Her own dashed line leaves from her thread's slot and ends on top of the cash column.
    const line = fan.cashLines[0];
    expect(line).toMatchObject({ memberNo: "M-031", moved: true, endY: FAN.cash.y0 });
    expect(ends(line?.d ?? "").from).toEqual([FAN.bar.x1, ends(rhea?.d ?? "").from[1]]);
    expect(fan.cashLines.filter((c) => c.moved)).toHaveLength(1);
    expect(fan.cash.bottom).toBeCloseTo(FAN.cash.y0 + fan.k * snapshot.figures.endCashCents, 6);
    expect(fanoutState(view, fan)).toBe("done");
    expect(restingPhase(view, fan)).toBe("settled");
    expect(summaryFacts(snapshot, fan)).toEqual({ paid: 7, cash: 57, kept: "US$21.14" });
  });

  it("the showcase is the seeded end: 7 paid by PayPal, Rhea moved to cash, settled", () => {
    const view = showcaseView(snapshot);
    const fan = fanView(snapshot, view);
    expect(fan.threads.filter((t) => t.tone === "landed")).toHaveLength(7);
    expect(fan.threads.find((t) => t.memberNo === "M-031")?.tone).toBe("moved");
    expect(fanoutState(view, fan)).toBe("done");
    expect(fan.paypal.share).toBe("8.1%");
  });

  it("PayPal declining the batch is the only red state", () => {
    const view = { ...viewOf(posted()), state: "DENIED" as const };
    const fan = fanView(snapshot, view);
    expect(fanoutState(view, fan)).toBe("denied");
    expect(restingPhase(view, fan)).toBe("denied");
  });
});

describe("latency dots at the true receipt times", () => {
  it("one dot per confirmed payment, measured from funding, with the median and the slowest", () => {
    const view = viewOf(posted());
    const lat = latency(view, fanView(snapshot, view));
    expect(lat.dots).toHaveLength(7);
    expect(lat.p50).not.toBeNull();
    expect(lat.max).toBeGreaterThanOrEqual(lat.p50 ?? 0);
  });

  it("no funding notice, no dots (the showcase has no event times)", () => {
    const view = showcaseView(snapshot);
    expect(latency(view, fanView(snapshot, view)).dots).toEqual([]);
  });
});
