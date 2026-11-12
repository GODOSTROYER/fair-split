// W-TR-05 Split review against the mock world: every state (empty, ready, declined), the lines with their amount
// grammar and statuses, the dial and filters, a row opening its hold, and MM-3's wave: a live decision slides
// the changed digits and washes them pencil in a downward wave, while a decision made before the screen opened
// shows its amounts in place. jsdom lays nothing out, so the lines print in the grid's static table, drawn by the
// same cell renderers (features/split/cells.test.tsx covers those cells one by one).

import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../data/query.js";
import type { RunView } from "../../data/run-view.js";
import { expectNoAxeViolations, type RenderedConsole, renderConsole } from "../../test/index.js";

/** Reads the season snapshot again through `load`, as the screen would after its cache was dropped. */
async function reloadSnapshot(view: RenderedConsole, load: () => Promise<never>): Promise<void> {
  vi.spyOn(view.adapter.pending, "snapshot").mockImplementation(load);
  await act(async () => {
    void view.runtime.client.resetQueries({ queryKey: ["snapshot"] });
    void view.runtime.client.resetQueries({ queryKey: queryKeys.run(RUN) });
  });
}

/** The needle's rotation as the dial draws it (Motion writes it as a style or an attribute). */
function needleTurn(): string {
  const needle = screen.getByTestId("W-TR-05.dial").querySelector(".fs-dial__needle")?.parentElement;
  return needle?.style.transform || needle?.getAttribute("transform") || "";
}

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
      // A checked fact: "Balanced" with a check, its equations on demand (the title), not a sentence on the bench.
      expect(screen.getByTestId("W-TR-05.totals").textContent).toBe("Balanced");
      expect(screen.getByTestId("W-TR-05.totals").getAttribute("title")).toMatch(
        /Gross = pool, to the cent \(4,273\.50\)/,
      );
      const celing = screen.getByTestId("W-TR-05.net.M-014");
      expect(celing.dataset.amountState).toBe("landed");
      expect(celing.textContent).toBe("64.45");
      expect(screen.getByTestId("W-TR-05.status.M-014").dataset.tone).toBe("jade");
      expect(screen.getByTestId("W-TR-05.status.M-053").dataset.tone).toBe("hatch");
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("INSIDE");
      // Round 5, the title row: the noun, the season in grey, the review's state in one chip; then one id line: the
      // run id (the lines, the engine and the rate card's hash its title) and the one provenance phrase, here the
      // simulated PayPal's (the grid holds its statuses). No glyph anywhere on the screen.
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Split review 2026-A");
      const provenance = screen.getByTestId("W-TR-05.provenance");
      expect(provenance.textContent).toBe("r37");
      expect(provenance.closest(".fs-t-id")).not.toBeNull();
      expect(provenance.getAttribute("title")).toMatch(/^64 lines · engine v1 · .* · rate card f2d7 026d$/);
      expect(screen.getByTestId("W-TR-05.head.provenance").textContent).toMatch(
        /^Synthetic co-op · simulated PayPal/,
      );
      expect(screen.queryByTestId("W-TR-05.simulated")).toBeNull();
      expect(screen.getByTestId("W-TR-05").querySelectorAll("[data-fs-glyph]")).toHaveLength(0);
      expect(screen.getByTestId("W-TR-05.summary").textContent).toBe("PayPal complete · cash due");
      expect(screen.getByTestId("W-TR-05.summary").dataset.tone).toBe("hatch");
      expect(screen.getByTestId("W-TR-05.filter.paypal").textContent).not.toMatch(/planned/);
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
      const grid = await gridRows(64);
      // The four open decisions lead the grid, in the run pill's order: slip 0462 by hand, then H1, H2, H3.
      const first = within(grid)
        .getAllByTestId(/^W-TR-05\.row\./)
        .slice(0, 4)
        .map((el) => el.dataset.testid?.replace("W-TR-05.row.", ""));
      expect(first).toEqual(["M-060", "M-007", "M-053", "M-018"]);
      expect(grid.dataset.pinned).toBe("4");
      // The screen's money is the pool, in pencil: the engine's figure, and nobody has signed.
      expect(screen.getByTestId("W-TR-05.pool").dataset.amountState).toBe("pencil");
      expect(screen.getByTestId("W-TR-05.pool").textContent).toBe("US$4,273.50");
      // Minimum confidence waits behind "All columns": sixty of the 64 lines have none.
      expect(within(grid).queryByRole("columnheader", { name: /confidence/i })).toBeNull();
      fireEvent.click(screen.getByTestId("W-TR-05.allColumns"));
      await waitFor(() =>
        expect(within(grid).getByRole("columnheader", { name: /confidence/i })).toBeTruthy(),
      );
      fireEvent.click(screen.getByTestId("W-TR-05.allColumns"));
      // The open decisions are the title row's chip, in amber (a person must decide); the bench links the next one.
      expect(screen.getByTestId("W-TR-05.summary").textContent).toBe("3 holds open · 1 by hand");
      expect(screen.getByTestId("W-TR-05.summary").dataset.tone).toBe("canary");
      // Round 6: the bench names no next step (the pill and the held rows do): one next action, said once.
      expect(screen.queryByTestId("W-TR-05.next")).toBeNull();
      expect(screen.getByTestId("W-TR-05.filter.held").textContent).toBe("Held 3");
      // Before the keys the rails are a plan, and say so; nothing PayPal is on the screen yet, so the id line says
      // the seeded slips.
      expect(screen.getByTestId("W-TR-05.filter.cash").textContent).toBe("Cash 56 planned");
      expect(screen.getByTestId("W-TR-05.head.provenance").textContent).toMatch(
        /^Synthetic co-op · seeded slips/,
      );
      // The console is English: a held line reads "Held", its hold beside it.
      expect(screen.getByTestId("W-TR-05.status.M-007").textContent).toBe("Held H1");
      expect(screen.getByTestId("W-TR-05.status.M-018").textContent).toBe("Reserved H3");
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
      expect(screen.getByTestId("W-TR-05.summary").textContent).toBe("2 holds open");
      // The instrument reads the new value, the old one as micro, in the one term (round 5): "Shrink · limit 2.0%".
      expect(screen.getByTestId("W-TR-05.reading").textContent).toMatch(/Shrink · limit 2\.0% · was 2\.05%/);
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
    "reduced motion: the needle cuts to 1.62% under a crossfade and the digits change under a pencil wash",
    async () => {
      const view = await renderConsole({
        path: webRoutes.split(RUN),
        viewport: { width: 1920 },
        motion: "reduced",
      });
      await view.startSession();
      act(() => {
        view.world.markPaid();
        view.world.enterByHand();
      });
      await gridRows(64);
      await waitFor(() => expect(screen.getByTestId("W-TR-05.net.M-007").textContent).toMatch(/80.65/), WAIT);
      expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("OUTSIDE");
      const visual = () => screen.getByTestId("W-TR-05.dial").querySelector<HTMLElement>(".fsr-dial__visual");
      const before = visual();
      expect(before?.dataset.motion).toBe("reduced");
      const outside = needleTurn();

      act(() => {
        view.world.resolve("H1");
      });
      await waitFor(
        () => expect(screen.getByTestId("W-TR-05.dial.status").dataset.status).toBe("INSIDE"),
        WAIT,
      );
      // The needle stands at its new value at once (no spring to watch) and fades in where it landed: the dial
      // is drawn afresh for the new value, so its 200 ms fade plays for this change.
      const after = visual();
      expect(after).not.toBe(before);
      expect(after?.hasAttribute("data-cut")).toBe(true);
      const cut = needleTurn();
      expect(cut).not.toBe(outside);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 250));
      });
      expect(needleTurn()).toBe(cut);
      // The digits change in place under a pencil wash instead of sliding.
      await waitFor(() => expect(screen.getByTestId("W-TR-05.net.M-007").textContent).toBe("62.71"), WAIT);
      expect(
        screen.getByTestId("W-TR-05.net.M-007").querySelector<HTMLElement>(".fsr-digits")?.dataset.swapMode,
      ).toBe("wash");
      await expectNoAxeViolations(screen.getByTestId("W-TR-05.bench"));
    },
    SLOW,
  );

  it(
    "prints dashed beds at their final size while the lines load, and says so",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await gridRows();
      await reloadSnapshot(view, () => new Promise<never>(() => undefined));
      await waitFor(() => expect(stateOf()).toBe("loading"), WAIT);
      const root = screen.getByTestId("W-TR-05");
      expect(screen.getByTestId("W-TR-05.loading").getAttribute("aria-hidden")).toBe("true");
      expect(within(root).getByRole("status").textContent).toBe("Printing the lines");
      expect(screen.queryByTestId("W-TR-05.grid")).toBeNull();
      await expectNoAxeViolations(root);
    },
    SLOW,
  );

  it(
    "says when the lines could not be read, and Try again brings them back",
    async () => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await gridRows();
      await reloadSnapshot(view, () => Promise.reject(new Error("The season could not be read.")));
      await waitFor(() => expect(stateOf()).toBe("error"), WAIT);
      const notice = screen.getByTestId("W-TR-05.error");
      expect(notice.textContent).toMatch(/This step failed\. Nothing changed\./);
      expect(notice.textContent).toMatch(/The season could not be read\./);
      expect(notice.dataset.tone).toBe("neutral");
      await expectNoAxeViolations(screen.getByTestId("W-TR-05"));

      vi.restoreAllMocks();
      fireEvent.click(within(notice).getByTestId("W-TR-05.error.retry"));
      await waitFor(() => expect(stateOf()).toBe("ready"), WAIT);
      await gridRows(64);
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
