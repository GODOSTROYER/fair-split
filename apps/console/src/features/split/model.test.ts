// W-TR-05's model against the seed and the mock world's own events: which engine computation applies at each
// decision, money conserved on every one of them (I3), the dial, the filters and the yield bar.

import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import {
  basisEventId,
  filterCounts,
  filterRows,
  massBalanceView,
  nextOpenCard,
  openCounts,
  splitBasis,
  splitRows,
  splitTotals,
} from "./model.js";

const snapshot = seedSnapshot();

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  const base = sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId });
  return applyRunEvents(base, world.events());
}

function inReview() {
  const world = createTestWorld();
  world.markPaid();
  return world;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

function expectConserved(view: RunView) {
  const rows = splitRows(snapshot, view);
  const totals = splitTotals(snapshot, view, rows);
  const gross = sum(rows.map((r) => r.grossCents));
  const net = sum(rows.map((r) => r.netCents));
  const deductions = sum(rows.map((r) => r.deductionsCents));
  const credits = sum(rows.map((r) => r.creditsCents));
  expect(rows).toHaveLength(64);
  expect(gross).toBe(totals.poolCents);
  expect(net + deductions - credits).toBe(totals.poolCents);
  expect(net).toBe(totals.netCents);
  expect(credits).toBe(totals.creditsCents);
  expect(totals.balanced).toBe(true);
  return { rows, totals };
}

describe("which computation applies", () => {
  it("the showcase is the resolved computation, with every line on it", () => {
    const view = showcaseView(snapshot);
    expect(splitBasis(view)).toBe("resolved");
    expect(splitRows(snapshot, view)).toHaveLength(snapshot.figures.members);
  });

  it("a session before reading has no lines yet (the empty state)", () => {
    const world = createTestWorld();
    const view = viewOf(world);
    expect(view.state).toBe("INVOICED");
    expect(splitRows(snapshot, view)).toEqual([]);
  });

  it("walks read → by hand → resolved as the people decide", () => {
    const world = inReview();
    expect(splitBasis(viewOf(world))).toBe("read");
    world.enterByHand();
    expect(splitBasis(viewOf(world))).toBe("byHand");
    world.resolve("H1");
    const view = viewOf(world);
    expect(splitBasis(view)).toBe("resolved");
    expect(basisEventId(view)).toBe(view.holds[world.holdId("H1")]?.eventId);
  });

  it("two deliveries keep both slips counted: the by-hand computation still applies", () => {
    const world = inReview();
    world.enterByHand();
    world.resolve("H1", { resolution: "TWO_DELIVERIES", reason: "Two sacks that day" });
    expect(splitBasis(viewOf(world))).toBe("byHand");
  });
});

describe("inv.i3 money is conserved on every computation the screen shows", () => {
  it("inv.i3 after reading", () => {
    expectConserved(viewOf(inReview()));
  });

  it("inv.i3 after slip 0462 by hand", () => {
    const world = inReview();
    world.enterByHand();
    expectConserved(viewOf(world));
  });

  it("inv.i3 with H1 counted once while H3's credit still waits", () => {
    const world = inReview();
    world.enterByHand();
    world.resolve("H1");
    const { rows } = expectConserved(viewOf(world));
    const tidoy = rows.find((r) => r.memberNo === "M-018");
    expect(tidoy?.pendingCredit).toEqual({ cents: 320, label: "H3" });
    expect(tidoy?.creditsCents).toBe(0);
    expect(tidoy?.netCents).toBe(5243);
  });

  it("inv.i3 with every hold decided, and on the showcase", () => {
    const world = inReview();
    world.resolveAll();
    const { rows, totals } = expectConserved(viewOf(world));
    expect(rows.find((r) => r.memberNo === "M-018")?.creditsCents).toBe(320);
    expect(totals.netCents).toBe(snapshot.figures.netCents);
    expectConserved(showcaseView(snapshot));
  });
});

describe("counting slip 0457 once", () => {
  it("moves Nong Dioning from 80.65 to 62.71 and gives 63 other members their cents back", () => {
    const world = inReview();
    world.enterByHand();
    const before = splitRows(snapshot, viewOf(world));
    world.resolve("H1");
    const after = splitRows(snapshot, viewOf(world));
    const dioning = (rows: typeof before) => rows.find((r) => r.memberNo === "M-007")?.netCents;
    expect(dioning(before)).toBe(8065);
    expect(dioning(after)).toBe(6271);
    const gained = after.filter((r) => {
      const was = before.find((b) => b.memberNo === r.memberNo);
      return r.memberNo !== "M-007" && was !== undefined && r.grossCents > was.grossCents;
    });
    expect(gained).toHaveLength(63);
  });
});

describe("the dial", () => {
  it("waits for slip 0462, swings to 2.05% when it is entered, settles at 1.62% once counted once", () => {
    const world = inReview();
    const read = massBalanceView(snapshot, viewOf(world));
    expect(read.status).toBe("PENDING");
    expect(read.waitingFor).toBe("0462");
    world.enterByHand();
    const twice = massBalanceView(snapshot, viewOf(world));
    expect(twice).toMatchObject({ status: "OUTSIDE", display: "2.05%", limitDisplay: "2.0%", value: 2.05 });
    world.resolve("H1");
    const once = massBalanceView(snapshot, viewOf(world));
    expect(once).toMatchObject({ status: "INSIDE", display: "1.62%", value: 1.62 });
  });
});

describe("filters, counts and the next decision", () => {
  it("All 64, Held 3, By hand 1, PayPal 8, Cash 56 in review", () => {
    const world = inReview();
    const view = viewOf(world);
    const rows = splitRows(snapshot, view);
    expect(filterCounts(rows)).toEqual({ all: 64, held: 3, byHand: 1, paypal: 8, cash: 56 });
    expect(openCounts(view)).toEqual({ holds: 3, byHand: 1 });
    expect(filterRows(rows, "held").map((r) => r.memberNo)).toEqual(["M-007", "M-018", "M-053"]);
    expect(nextOpenCard(view)?.label).toBe("H1");
  });

  it("H3 reserves Nong Tidoy's line; H1 and H2 hold theirs", () => {
    const rows = splitRows(snapshot, viewOf(inReview()));
    const kind = (no: string) => rows.find((r) => r.memberNo === no)?.status.kind;
    expect(kind("M-007")).toBe("held");
    expect(kind("M-053")).toBe("held");
    expect(kind("M-018")).toBe("reserved");
    expect(kind("M-014")).toBe("line");
  });

  it("counts fall as holds are decided", () => {
    const world = inReview();
    world.resolveAll();
    const view = viewOf(world);
    expect(openCounts(view)).toEqual({ holds: 0, byHand: 0 });
    expect(nextOpenCard(view)).toBeNull();
    expect(filterCounts(splitRows(snapshot, view)).held).toBe(0);
  });
});

describe("the yield bar and confidence", () => {
  it("Merlyn reads 2.14 kg a tree over the limit, 0.64 once her second plot is registered", () => {
    const world = inReview();
    const merlyn = () => splitRows(snapshot, viewOf(world)).find((r) => r.memberNo === "M-053");
    expect(merlyn()).toMatchObject({ trees: 140, kgPerTree: "2.14", overYield: true });
    world.resolve("H2", {
      resolution: "REGISTER_PLOT",
      plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 },
    });
    expect(merlyn()).toMatchObject({ trees: 470, kgPerTree: "0.64", overYield: false });
  });

  it("slip 0462 waits for a person, then carries the treasurer's stamp", () => {
    const world = inReview();
    const arnel = () => splitRows(snapshot, viewOf(world)).find((r) => r.memberNo === "M-060");
    expect(arnel()?.confidence).toEqual({ kind: "you", score: 0.4, serial: "0462" });
    world.enterByHand();
    expect(arnel()?.confidence.kind).toBe("by-hand");
  });

  it("the showcase's lines are ink after both keys and landed when PayPal confirmed", () => {
    const rows = splitRows(snapshot, showcaseView(snapshot));
    const celing = rows.find((r) => r.memberNo === "M-014");
    expect(celing?.amountState).toBe("landed");
    expect(celing?.partsState).toBe("ink");
    const rhea = rows.find((r) => r.memberNo === "M-031");
    expect(rhea?.movedToCash).toBe(true);
    expect(rhea?.amountState).toBe("hollow");
  });
});
