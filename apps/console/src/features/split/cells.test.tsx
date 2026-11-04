// MM-3's grid wave on the cells themselves (the grid's renderers, without AG Grid): a live engine recompute slides
// only the digits that changed and washes the cell pencil, at its place in the downward wave; PayPal's verified
// change washes jade; history and replays change the value in place, with no wash and no slide; reduced motion
// keeps the change with a pencil wash. The wave's timing is a pure function of the two computations.

import { TIMING } from "@fairsplit/motion";
import { UiProvider } from "@fairsplit/ui-web";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView } from "../../data/run-view.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { type GridContext, type GridRow, NetCell, StatusCell } from "./cells.js";
import { splitRows } from "./model.js";
import { waveDelays, waveStartMs } from "./wave.js";

const snapshot = seedSnapshot();

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

function context(live: ReadonlySet<string>, delays: ReadonlyMap<string, number>): GridContext {
  return {
    isLive: (id) => typeof id === "string" && live.has(id),
    waveDelay: (memberNo) => delays.get(memberNo) ?? 0,
    stamp: () => null,
    yieldLimit: "1.6",
    premiumRate: "US$0.29523 a kg",
  };
}

type CellProps = Parameters<typeof NetCell>[0];
const props = (row: GridRow, ctx: GridContext) => ({ data: row, context: ctx }) as unknown as CellProps;

function wrap(node: ReactElement, motion: "full" | "reduced" = "full") {
  return <UiProvider motion={motion}>{node}</UiProvider>;
}

function rowsAt(decide: (w: ReturnType<typeof createTestWorld>) => void) {
  const world = createTestWorld();
  world.markPaid();
  world.enterByHand();
  const before = viewOf(world);
  decide(world);
  const after = viewOf(world);
  return { before, after, world };
}

describe("the MM-3 wave's timing", () => {
  it("starts at the act's wave step, 6 ms a changed row, capped at 380 ms; unchanged rows keep still", () => {
    const { after } = rowsAt((w) => w.resolve("H1"));
    const rows = splitRows(snapshot, after);
    const delays = waveDelays(snapshot, after, rows);
    expect(waveStartMs()).toBe(200);
    expect(delays.size).toBe(64);
    const values = [...delays.values()];
    expect(Math.min(...values)).toBe(200);
    expect(Math.max(...values)).toBe(200 + Math.min(63 * TIMING.waveStep, TIMING.waveCap));
    expect(values[1]).toBe(200 + TIMING.waveStep);
  });

  it("the wave compares the computation with the one before it; reading alone starts none", () => {
    const { after } = rowsAt((w) => {
      w.resolve("H1");
      w.resolve("H3");
    });
    expect(waveDelays(snapshot, after, splitRows(snapshot, after)).size).toBe(64);
    const world = createTestWorld();
    world.markPaid();
    const read = viewOf(world);
    expect(waveDelays(snapshot, read, splitRows(snapshot, read)).size).toBe(0);
  });
});

describe("a cell in the wave", () => {
  it("a live recompute slides the digits that changed and washes pencil at its place in the wave", () => {
    const { before, after } = rowsAt((w) => w.resolve("H1"));
    const was = splitRows(snapshot, before).find((r) => r.memberNo === "M-007");
    const now = splitRows(snapshot, after).find((r) => r.memberNo === "M-007");
    if (!was || !now) throw new Error("no M-007");
    const eventId = now.amountsEventId ?? "";
    const ctx = context(new Set([eventId]), new Map([["M-007", 236]]));
    const { container, rerender } = render(wrap(<NetCell {...props({ kind: "line", ...was }, ctx)} />));
    expect(container.textContent).toBe("80.65");
    rerender(wrap(<NetCell {...props({ kind: "line", ...now }, ctx)} />));
    const swap = container.querySelector<HTMLElement>(".fsr-digits");
    expect(swap?.dataset.swapMode).toBe("slide");
    expect(container.querySelector(".fs-sr")?.textContent).toBe("62.71");
    const wash = container.querySelector<HTMLElement>(".fsr-cell__wash");
    expect(wash?.dataset.cause).toBe("engine");
    expect(wash?.style.animationDelay).toBe("236ms");
    expect(container.querySelector("[data-amount-state]")?.getAttribute("data-amount-state")).toBe("pencil");
  });

  it("history changes the value in place: no slide, no wash", () => {
    const { before, after } = rowsAt((w) => w.resolve("H1"));
    const was = splitRows(snapshot, before).find((r) => r.memberNo === "M-007");
    const now = splitRows(snapshot, after).find((r) => r.memberNo === "M-007");
    if (!was || !now) throw new Error("no M-007");
    const ctx = context(new Set(), new Map([["M-007", 236]]));
    const { container, rerender } = render(wrap(<NetCell {...props({ kind: "line", ...was }, ctx)} />));
    rerender(wrap(<NetCell {...props({ kind: "line", ...now }, ctx)} />));
    expect(container.querySelector<HTMLElement>(".fsr-digits")?.dataset.swap).toBe("none");
    expect(container.querySelector(".fsr-cell__wash")).toBeNull();
    expect(container.textContent).toBe("62.71");
  });

  it("reduced motion keeps the change, with a pencil wash instead of the slide", () => {
    const { before, after } = rowsAt((w) => w.resolve("H1"));
    const was = splitRows(snapshot, before).find((r) => r.memberNo === "M-007");
    const now = splitRows(snapshot, after).find((r) => r.memberNo === "M-007");
    if (!was || !now) throw new Error("no M-007");
    const ctx = context(new Set([now.amountsEventId ?? ""]), new Map([["M-007", 200]]));
    const { container, rerender } = render(
      wrap(<NetCell {...props({ kind: "line", ...was }, ctx)} />, "reduced"),
    );
    rerender(wrap(<NetCell {...props({ kind: "line", ...now }, ctx)} />, "reduced"));
    expect(container.querySelector<HTMLElement>(".fsr-digits")?.dataset.swapMode).toBe("wash");
  });

  it("PayPal's verified change washes jade; the status reads Paid in a jade flush chip", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    const view = viewOf(world);
    const row = splitRows(snapshot, view).find((r) => r.memberNo === "M-014");
    if (!row) throw new Error("no M-014");
    expect(row.statusCause).toBe("paypal");
    const ctx = context(new Set([row.statusEventId ?? ""]), new Map());
    const { container } = render(wrap(<StatusCell {...props({ kind: "line", ...row }, ctx)} />));
    expect(container.querySelector<HTMLElement>(".fsr-cell__wash")?.dataset.cause).toBe("paypal");
    const status = container.querySelector<HTMLElement>("[data-testid='W-TR-05.status.M-014']");
    expect(status?.dataset.tone).toBe("jade");
    expect(status?.textContent).toBe("Paid (Simulated PayPal sandbox)");
  });
});
