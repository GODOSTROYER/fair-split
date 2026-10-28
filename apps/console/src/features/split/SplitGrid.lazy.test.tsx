// S2.11: AG Grid is Split review's own lazy chunk. The split screen's code (SplitGrid, its static table, the cell
// renderers) loads and prints every line without it; AG Grid and its token theme load only through a dynamic
// import, once the grid's container has a measured size. Here AG Grid cannot load at all: any static import of it
// fails this file's imports.

import { UiProvider } from "@fairsplit/ui-web";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { applyRunEvents, sessionView } from "../../data/run-view.js";
import { ShortcutsProvider } from "../../lib/shortcuts.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { splitRows, splitTotals } from "./model.js";

vi.mock("ag-grid-react", () => {
  throw new Error("AG Grid (ag-grid-react) was loaded with the split screen's code");
});
vi.mock("ag-grid-community", () => {
  throw new Error("AG Grid (ag-grid-community) was loaded with the split screen's code");
});

describe("AG Grid is its own lazy chunk", () => {
  it("the split screen's grid prints its lines from the static table without loading AG Grid", async () => {
    const { SplitGrid } = await import("./SplitGrid.js");
    const snapshot = seedSnapshot();
    const world = createTestWorld();
    world.markPaid();
    const view = applyRunEvents(
      sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
      world.events(),
    );
    const rows = splitRows(snapshot, view);
    const { container } = render(
      <UiProvider motion="full">
        <ShortcutsProvider>
          <SplitGrid
            rows={rows}
            totals={splitTotals(snapshot, view, rows)}
            context={{
              isLive: () => false,
              waveDelay: () => 0,
              stamp: () => null,
              yieldLimit: "1.6",
              premiumRate: "US$0.29523 a kg",
            }}
            onOpen={() => undefined}
          />
        </ShortcutsProvider>
      </UiProvider>,
    );
    expect(container.querySelector(".fsr-grid__frame--static")).not.toBeNull();
    expect(container.querySelector("[data-testid='W-TR-05.row.M-002']")).not.toBeNull();
    expect(container.querySelector(".ag-root")).toBeNull();
  });
});
