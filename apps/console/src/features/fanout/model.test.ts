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

describe("the fan's geometry: width is money", () => {
  it("k = 400 / Σ net, threads largest first, the cash band ending where the cash lines end", () => {
    const fan = fanView(snapshot, showcaseView(snapshot));
    expect(fan.netCents).toBe(snapshot.figures.netCents);
    expect(fan.k).toBeCloseTo(400 / snapshot.figures.netCents, 12);
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
    expect(widths).toBeCloseTo((400 * snapshot.figures.batchTotalCents) / snapshot.figures.netCents, 6);
    expect(fan.threads[0]?.width).toBeCloseTo(6.1, 1);
    expect(fan.threads.map((t) => t.stubY)).toEqual([30, 50, 70, 90, 110, 130, 150, 170]);
  });

  it("finds the 70% point along a thread's arc, not its parameter", () => {
    const start = pointAtLength(196, 100, 1120, 36, 0);
    const end = pointAtLength(196, 100, 1120, 36, 1);
    expect(start).toEqual({ x: 196, y: 100 });
    expect(end.x).toBeCloseTo(1120, 6);
    const p = pointAtLength(196, 100, 1120, 36, FAN.sentAt);
    expect(p.x).toBeGreaterThan(196 + 0.6 * 924);
    expect(p.x).toBeLessThan(1120);
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
    expect(threadTone("RETURNED", theirs, "RETURNED")).toBe("moved");
    expect(threadTone("RETURNED", theirs, "NEEDS_ACTION")).toBe("failed");
  });

  it("before the 201 nothing is drawn; the cash band already is", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    const view = viewOf(world);
    const fan = fanView(snapshot, view);
    expect(fan.threads.every((t) => t.tone === "unsent" && t.progress === 0)).toBe(true);
    expect(fan.slices).toHaveLength(56);
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
    expect(fan.cash).toEqual({ cents: snapshot.figures.endCashCents, members: 57 });
    expect(fan.slices.at(-1)).toMatchObject({ memberNo: "M-031", moved: true });
    expect(fan.band.end).toBeCloseTo(FAN.band.y0 + fan.k * snapshot.figures.endCashCents, 6);
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
