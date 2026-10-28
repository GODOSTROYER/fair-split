// SplitGrid through AG Grid itself. The screens' suites print the grid's static table (jsdom lays nothing out, so
// the container is never measured); here the boxes report a laptop's size, AG Grid mounts and draws its rows,
// and the context closures (isLive, waveDelay) must reach its cell renderers: a live engine recompute washes
// pencil at its place in the wave, PayPal's verified change washes jade, and history changes values in place.

import { UiProvider } from "@fairsplit/ui-web";
import { render, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyRunEvents, type RunView, sessionView } from "../../data/run-view.js";
import { ShortcutsProvider } from "../../lib/shortcuts.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import type { GridContext } from "./cells.js";
import { splitRows, splitTotals } from "./model.js";
import { SplitGrid } from "./SplitGrid.js";
import { waveDelays } from "./wave.js";

const snapshot = seedSnapshot();
const SLOW = 120_000;
const DRAWN = { timeout: 10_000 };

/** Every observed box reports 1,600 × 900 after layout, as a browser does: the grid holds all eleven columns. */
class MeasuredObserver {
  readonly #callback: ResizeObserverCallback;
  #timers: ReturnType<typeof setTimeout>[] = [];
  constructor(callback: ResizeObserverCallback) {
    this.#callback = callback;
  }
  observe(target: Element): void {
    const rect = { width: 1600, height: 900, x: 0, y: 0, top: 0, left: 0, right: 1600, bottom: 900 };
    const entry = { target, contentRect: rect } as unknown as ResizeObserverEntry;
    this.#timers.push(setTimeout(() => this.#callback([entry], this as unknown as ResizeObserver), 0));
  }
  unobserve(): void {}
  disconnect(): void {
    for (const t of this.#timers) clearTimeout(t);
    this.#timers = [];
  }
}

/** jsdom lays nothing out (every box is 0): AG Grid reads its viewport from these, so give it a laptop's. */
const BOX: Readonly<Record<string, number>> = {
  clientWidth: 1600,
  offsetWidth: 1600,
  clientHeight: 900,
  offsetHeight: 900,
};
const original = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", MeasuredObserver);
  for (const [key, value] of Object.entries(BOX)) {
    original.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, descriptor] of original) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  }
  original.clear();
});

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

function context(view: RunView, live: ReadonlySet<string>): GridContext {
  const delays = waveDelays(snapshot, view, splitRows(snapshot, view));
  return {
    isLive: (id) => typeof id === "string" && live.has(id),
    waveDelay: (memberNo) => delays.get(memberNo) ?? 0,
    stamp: () => null,
    yieldLimit: "1.6",
    premiumRate: "US$0.29523 a kg",
  };
}

function grid(view: RunView, live: ReadonlySet<string>): ReactElement {
  const rows = splitRows(snapshot, view);
  return (
    <UiProvider motion="full">
      <ShortcutsProvider>
        <SplitGrid
          rows={rows}
          totals={splitTotals(snapshot, view, rows)}
          context={context(view, live)}
          onOpen={() => undefined}
          columns="all"
        />
      </ShortcutsProvider>
    </UiProvider>
  );
}

/**
 * A cell inside AG Grid's own DOM. Until the container is measured the same cells print in the static table, so
 * every query here is scoped to `.ag-root`: the static table can never answer for AG Grid.
 */
const inGrid = (container: HTMLElement, testId: string) =>
  container.querySelector<HTMLElement>(`.ag-root [data-testid='${testId}']`);

/** Waits until AG Grid has drawn a member's row (it mounts after measuring; its cell renderers run async). */
async function drawn(container: HTMLElement, memberNo: string): Promise<void> {
  await waitFor(() => expect(inGrid(container, `W-TR-05.row.${memberNo}`)).not.toBeNull(), DRAWN);
}

describe("SplitGrid in AG Grid", () => {
  it(
    "mounts AG Grid once the container is measured, not the static table",
    async () => {
      const world = createTestWorld();
      world.markPaid();
      const { container } = render(grid(viewOf(world), new Set()));
      await drawn(container, "M-002");
      expect(container.querySelector(".ag-root")).not.toBeNull();
      expect(container.querySelector(".fsr-grid__frame--static")).toBeNull();
      expect(container.querySelector("[data-testid='W-TR-05.grid']")?.getAttribute("data-columns")).toBe(
        "all",
      );
    },
    SLOW,
  );

  it(
    "a live engine recompute washes AG Grid cells pencil, at their place in the wave",
    async () => {
      const world = createTestWorld();
      world.markPaid();
      world.enterByHand();
      const before = viewOf(world);
      const { container, rerender } = render(grid(before, new Set()));
      await drawn(container, "M-002");
      await waitFor(() => expect(inGrid(container, "W-TR-05.net.M-002")?.textContent).toMatch(/^\d/), DRAWN);
      expect(container.querySelectorAll(".ag-root .fsr-cell__wash")).toHaveLength(0);

      world.resolve("H1");
      const after = viewOf(world);
      const row = splitRows(snapshot, after).find((r) => r.memberNo === "M-002");
      const eventId = row?.amountsEventId;
      if (!eventId) throw new Error("no recompute event on M-002");
      rerender(grid(after, new Set([eventId])));

      const net = () => inGrid(container, "W-TR-05.net.M-002");
      await waitFor(
        () => expect(net()?.querySelector<HTMLElement>(".fsr-digits")?.dataset.swapMode).toBe("slide"),
        DRAWN,
      );
      const wash = net()?.closest(".fsr-cell")?.querySelector<HTMLElement>(".fsr-cell__wash");
      expect(wash?.dataset.cause).toBe("engine");
      const delays = waveDelays(snapshot, after, splitRows(snapshot, after));
      expect(wash?.style.animationDelay).toBe(`${delays.get("M-002")}ms`);
      expect(container.querySelectorAll(".ag-root .fsr-cell__wash[data-cause='paypal']")).toHaveLength(0);
    },
    SLOW,
  );

  it(
    "PayPal's verified change washes an AG Grid cell jade; replayed history washes nothing",
    async () => {
      const world = createTestWorld();
      world.markPaid();
      world.resolveAll();
      world.sign("treasurer");
      world.cosign();
      const paid = viewOf(world);
      const row = splitRows(snapshot, paid).find((r) => r.memberNo === "M-002");
      if (!row?.statusEventId || row.statusCause !== "paypal")
        throw new Error("M-002 was not paid by PayPal");

      const history = render(grid(paid, new Set()));
      await drawn(history.container, "M-002");
      await waitFor(
        () => expect(inGrid(history.container, "W-TR-05.status.M-002")?.dataset.tone).toBe("jade"),
        DRAWN,
      );
      expect(history.container.querySelectorAll(".ag-root .fsr-cell__wash")).toHaveLength(0);
      history.unmount();

      const { container } = render(grid(paid, new Set([row.statusEventId])));
      await drawn(container, "M-002");
      const status = () => inGrid(container, "W-TR-05.status.M-002");
      await waitFor(() => expect(status()?.dataset.tone).toBe("jade"), DRAWN);
      const wash = status()?.closest(".fsr-cell")?.querySelector<HTMLElement>(".fsr-cell__wash");
      expect(wash?.dataset.cause).toBe("paypal");
    },
    SLOW,
  );
});
