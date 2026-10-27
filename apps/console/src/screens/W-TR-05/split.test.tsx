// W-TR-05 Split review against the mock world: every state (empty, ready, declined), the lines with their amount
// grammar and statuses, the dial and filters, a row opening its hold, and MM-3's wave: a live decision slides
// the changed digits and washes them pencil in a downward wave, while a decision made before the screen opened
// shows its amounts in place. jsdom lays nothing out, so the lines print in the grid's static table, drawn by the
// same cell renderers (features/split/cells.test.tsx covers those cells one by one).

import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../../data/query.js";
import type { RunView } from "../../data/run-view.js";
import { expectNoAxeViolations, renderConsole } from "../../test/index.js";

const RUN = "2026A-r37";
const SLOW = 180_000;
const WAIT = { timeout: 30_000 };

const stateOf = () => screen.queryByTestId("W-TR-05")?.dataset.state;

async function gridRows(count?: number) {
  const grid = await screen.findByTestId("W-TR-05.grid", {}, WAIT);
  // The static table prints the first lines and offers the rest: reveal them when a test counts every line.
  if (count !== undefined && count > 16) {
    const more = await within(grid).findByTestId("W-TR-05.showAll", {}, WAIT);
    fireEvent.click(more);
  }
  await waitFor(() => {
    const rows = within(grid).getAllByTestId(/^W-TR-05\.row\./);
    if (count === undefined) expect(rows.length).toBeGreaterThan(0);
    else expect(rows).toHaveLength(count);
  }, WAIT);
  return grid;
}

describe("W-TR-05 split review", () => {
  it(
    "shows the showcase run's 64 lines, balanced to the cent, PayPal's confirmations in jade",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await gridRows(64);
      expect(stateOf()).toBe("ready");
      expect(screen.getByTestId("W-TR-05.totals.balanced").dataset.tone).toBe("ink");
      expect(screen.getByTestId("W-TR-05.totals.net").textContent).toBe("4,218.17");
      expect(screen.getByTestId("W-TR-05.totals").textContent).toMatch(
        /Gross = pool, to the cent \(4,273\.50\)/,
      );
      const celing = screen.getByTestId("W-TR-05.net.M-014");
      expect(celing.dataset.amountState).toBe("landed");
      expect(celing.textContent).toBe("64.45");
      expect(screen.getByTestId("W-TR-05.status.M-014").dataset.tone).toBe("jade");
      expect(screen.getByTestId("W-TR-05.status.M-053").dataset.tone).toBe("hatch");
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("INSIDE");
      expect(screen.getByTestId("W-TR-05.provenance").textContent).toMatch(
        /Computed by engine v1, rate card f2d7 026d/,
      );
      // axe on a filtered grid: the same structure (row and column headers, labels), fewer rows to walk.
      fireEvent.click(screen.getByTestId("W-TR-05.filter.paypal"));
      await gridRows(7);
      await expectNoAxeViolations(view.container);
    },
    SLOW,
  );

  it(
    "is empty until the slips are read, then lists the holds with the by-hand field first",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await view.startSession();
      await waitFor(() => expect(stateOf()).toBe("empty"), WAIT);
      expect(screen.getByTestId("W-TR-05.empty").textContent).toMatch(/No lines yet/);
      await expectNoAxeViolations(screen.getByTestId("W-TR-05"));
      act(() => {
        view.world.markPaid();
      });
      await waitFor(() => expect(stateOf()).toBe("ready"), WAIT);
      await gridRows(64);
      expect(screen.getByTestId("W-TR-05.summary").textContent).toBe("3 holds, 1 by hand");
      expect(screen.getByTestId("W-TR-05.next").textContent).toBe("Enter slip 0462 by hand");
      expect(screen.getByTestId("W-TR-05.filter.held").textContent).toBe("Held 3");
      expect(screen.getByTestId("W-TR-05.filter.cash").textContent).toBe("Cash 56");
      expect(screen.getByTestId("W-TR-05.status.M-007").dataset.state).toBe("held");
      expect(screen.getByTestId("W-TR-05.status.M-018").dataset.state).toBe("reserved");
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("PENDING");
      fireEvent.click(screen.getByTestId("W-TR-05.filter.held"));
      await gridRows(3);
    },
    SLOW,
  );

  it(
    "counts slip 0457 once in a live wave: Dioning drops to 62.71, the other lines gain cents, washed pencil",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.enterByHand();
      });
      await gridRows(64);
      await waitFor(() => expect(screen.getByTestId("W-TR-05.net.M-007").textContent).toMatch(/80.65/), WAIT);
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("OUTSIDE");
      act(() => {
        view.world.resolve("H1");
      });
      await waitFor(
        () =>
          expect(screen.getByTestId("W-TR-05.net.M-007").querySelector(".fs-sr")?.textContent).toBe("62.71"),
        WAIT,
      );
      expect(
        screen.getByTestId("W-TR-05.net.M-007").querySelector<HTMLElement>(".fsr-digits")?.dataset.swapMode,
      ).toBe("slide");
      expect(document.querySelectorAll(".fsr-cell__wash[data-cause='engine']").length).toBeGreaterThanOrEqual(
        63,
      );
      expect(document.querySelectorAll(".fsr-cell__wash[data-cause='paypal']")).toHaveLength(0);
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("INSIDE");
      expect(screen.getByTestId("W-TR-05.summary").textContent).toBe("2 holds, 0 by hand");
    },
    SLOW,
  );

  it(
    "a decision made before the screen opened shows its amounts in place, with no wave",
    async () => {
      const view = await renderConsole({ path: webRoutes.judge(), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.enterByHand();
        view.world.resolve("H1");
      });
      // Wait until the stream has delivered the decision, so it is history by the time the screen opens.
      await waitFor(() => {
        const run = view.runtime.client.getQueryData<RunView>(queryKeys.run(RUN));
        expect(Object.values(run?.holds ?? {}).find((h) => h.label === "H1")?.state).toBe("RESOLVED");
      }, WAIT);
      await view.navigate(webRoutes.split(RUN));
      await gridRows(64);
      await waitFor(() => expect(screen.getByTestId("W-TR-05.net.M-007").textContent).toBe("62.71"), WAIT);
      expect(document.querySelectorAll(".fsr-cell__wash")).toHaveLength(0);
    },
    SLOW,
  );

  it(
    "opens H1's drawer from Dioning's row",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await view.startSession();
      act(() => {
        view.world.markPaid();
      });
      await gridRows(64);
      fireEvent.click(screen.getByTestId("W-TR-05.row.M-007"));
      await waitFor(() => expect(view.router.state.location.search).toMatchObject({ hold: "H1" }), WAIT);
      await screen.findByTestId("W-TR-06", {}, WAIT);
    },
    SLOW,
  );

  it(
    "says PayPal declined the batch in red, the only red on the screen",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await gridRows(64);
      act(() => {
        view.runtime.client.setQueryData<RunView>(queryKeys.run(RUN), (old) =>
          old ? { ...old, state: "DENIED" } : old,
        );
      });
      await waitFor(() => expect(stateOf()).toBe("declined"), WAIT);
      expect(screen.getByTestId("W-TR-05.declined").dataset.tone).toBe("red");
    },
    SLOW,
  );
});
