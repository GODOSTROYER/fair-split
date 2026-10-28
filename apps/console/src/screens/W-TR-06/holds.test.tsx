// W-TR-06 Hold drawer against the mock world. H1 is MM-3, "The pink copy": opening it plays glide-in, converge,
// underline and ready over the two copies of slip 0457 (4 of 4 fields match); "Count it once" is pressed, and
// the engine's hold.resolved swings the needle to 1.62% and resolves the card flush in ink with the AS stamp,
// in full and reduced motion. H2 registers Merlyn's second plot, H3 returns the multa as a credit, and the
// flat "These are two deliveries" asks for a reason first.

import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clearMomentTrace, expectNoAxeViolations, renderConsole, tracedPhases } from "../../test/index.js";

// The split behind the drawer is W-TR-05's to test (its grid has its own suite, with the MM-3 wave); here it is a
// stand-in, so the drawer's tests and axe runs do not pay for 64 rows of AG Grid in jsdom.
vi.mock("../../features/split/SplitGrid.js", () => ({
  SplitGrid: () => <div data-testid="W-TR-05.grid" />,
}));

const RUN = "2026A-r37";
const SLOW = 120_000;
const WAIT = { timeout: 5_000 };

async function inReview(path: string, motion: "full" | "reduced" = "full", byHand = true) {
  const view = await renderConsole({ path, viewport: { width: 1920 }, motion });
  await view.startSession();
  act(() => {
    view.world.markPaid();
    if (byHand) view.world.enterByHand();
  });
  return view;
}

/** The drawer swaps its root as the run's view changes, so always read the current one. */
const stateOf = () => screen.queryByTestId("W-TR-06")?.dataset.state;
const press = (testId: string) => fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });

/** The phases since H1 was last opened (the showcase's decided H1 may show first, before the session). */
function sinceOpen(): string[] {
  const phases = tracedPhases("MM-3");
  return phases.slice(phases.lastIndexOf("glide-in"));
}

describe("W-TR-06 hold drawer", () => {
  it(
    "H1 opens as MM-3: the two copies glide in, converge and light 4 of 4 matching fields",
    async () => {
      clearMomentTrace();
      await inReview(webRoutes.holdDrawer(RUN, "H1"));
      await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
      await waitFor(() => expect(sinceOpen()).toContain("ready"), WAIT);
      expect(sinceOpen()).toEqual(["glide-in", "converge", "underline", "ready"]);
      expect(screen.getByTestId("W-TR-06.card.gate").textContent).toBe("Blocks approval. Changes kilos.");
      const card = screen.getByTestId("W-TR-06.card");
      expect(card.textContent).toMatch(
        /Slip 0457 is in two photos: the white original \(B\) and the pink duplicate \(D\)\. Counting both moves US\$17\.94 from 63 members to Nong Dioning and puts shrink at 2\.05%, over the 2\.0% limit\./,
      );
      expect(card.textContent).toMatch(/The second image is the office's pink copy of the same receipt\./);
      expect(screen.getByTestId("W-TR-06.twin.verdict").textContent).toBe("4 of 4 fields match. Same slip.");
      const twin = screen.getByTestId("W-TR-06.twin");
      expect(twin.dataset.lit).toBe("");
      // Canary is a person's decision: one underline beneath the two serials, nothing else on the slips. The
      // fields the engine matched read beneath as its own "=" marks, in pencil.
      const underlines = [...twin.querySelectorAll(".fsr-slip__underline")];
      expect(underlines).toHaveLength(2);
      expect(underlines.every((u) => u.getAttribute("data-box") === "serial")).toBe(true);
      expect(twin.querySelectorAll(".fsr-slip__highlight")).toHaveLength(0);
      for (const field of ["serial", "date", "member", "net"]) {
        const row = screen.getByTestId(`W-TR-06.twin.${field}`);
        expect(row.dataset.match).toBe("");
        expect(row.querySelector(".fsr-twin__eq")?.textContent).toBe("=");
      }
      expect(screen.getByTestId("W-TR-06.dial.status").dataset.status).toBe("OUTSIDE");
      expect(screen.getByTestId("W-TR-06.drawer").textContent).toMatch(/Hold 1 of 3/);
      await expectNoAxeViolations(screen.getByTestId("W-TR-06.drawer"));
    },
    SLOW,
  );

  it(
    "Count it once: pressed, the needle swings to 1.62%, the wave, resolved flush in ink with the AS stamp",
    async () => {
      clearMomentTrace();
      const view = await inReview(webRoutes.holdDrawer(RUN, "H1"));
      await waitFor(() => expect(sinceOpen()).toContain("ready"), WAIT);
      press("W-TR-06.countOnce");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      await waitFor(() => expect(tracedPhases("MM-3").slice(-1)[0]).toBe("resolved"), WAIT);
      const phases = sinceOpen();
      expect(phases.slice(phases.indexOf("pressed"))).toEqual([
        "pressed",
        "pressed",
        "needle",
        "wave",
        "resolved",
      ]);
      expect(view.world.hold("H1")?.state).toBe("RESOLVED");
      expect(screen.getByTestId("W-TR-06.dial.status").dataset.status).toBe("INSIDE");
      expect(screen.getByTestId("W-TR-06.result").textContent).toMatch(
        /Returned to 63 members: US\$17\.94\./,
      );
      expect(screen.getByTestId("W-TR-06.card.resolution").textContent).toMatch(/Resolved by AS/);
      expect(screen.getByTestId("W-TR-06.next").textContent).toBe("Next: hold H2");
      await expectNoAxeViolations(screen.getByTestId("W-TR-06.drawer"));
    },
    SLOW,
  );

  it(
    "reduced motion keeps every MM-3 phase",
    async () => {
      clearMomentTrace();
      await inReview(webRoutes.holdDrawer(RUN, "H1"), "reduced");
      await waitFor(() => expect(sinceOpen()).toContain("ready"), WAIT);
      expect(screen.getByTestId("W-TR-06.twin").dataset.motion).toBe("reduced");
      press("W-TR-06.countOnce");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      await waitFor(() => expect(tracedPhases("MM-3").slice(-1)[0]).toBe("resolved"), WAIT);
      expect(sinceOpen()).toEqual(
        expect.arrayContaining([
          "glide-in",
          "converge",
          "underline",
          "ready",
          "pressed",
          "needle",
          "wave",
          "resolved",
        ]),
      );
    },
    SLOW,
  );

  it(
    "These are two deliveries: a reason first, then an override the Chair co-signs",
    async () => {
      const view = await inReview(webRoutes.holdDrawer(RUN, "H1"));
      await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
      fireEvent.click(screen.getByTestId("W-TR-06.twoDeliveries"));
      const form = await screen.findByTestId("W-TR-06.reason");
      const submit = within(form).getByTestId("W-TR-06.reason.submit");
      expect(submit).toHaveProperty("disabled", true);
      fireEvent.change(within(form).getByTestId("W-TR-06.reason.text"), {
        target: { value: "Two sacks from two pickups that day" },
      });
      fireEvent.click(submit);
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      expect(view.world.hold("H1")?.resolution?.kind).toBe("TWO_DELIVERIES");
      expect(screen.getByTestId("W-TR-06.result").textContent).toMatch(/override: Ernesto co-signs/);
    },
    SLOW,
  );

  it(
    "H2 registers Merlyn's second plot from the registry: 470 trees, 0.64 kg a tree, inside the limit",
    async () => {
      const view = await inReview(webRoutes.holdDrawer(RUN, "H2"));
      await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
      expect(screen.getByTestId("W-TR-06.card").textContent).toMatch(
        /Merlyn Ponce: 300\.0 kg from 140 registered trees is 2\.14 kg a tree\. The limit is 1\.6\./,
      );
      expect(screen.getByTestId("W-TR-06.plot.P-053-B").textContent).toMatch(/not in the registry yet/);
      expect(screen.getByTestId("W-TR-06.yield.now").textContent).toBe("2.14 kg a tree now");
      await expectNoAxeViolations(screen.getByTestId("W-TR-06.drawer"));
      press("W-TR-06.registerPlot");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      expect(view.world.hold("H2")?.state).toBe("RESOLVED");
      expect(screen.getByTestId("W-TR-06.result").textContent).toMatch(
        /300\.0 kg from 470 trees is 0\.64 kg a tree\. Inside the limit\./,
      );
      expect(screen.getByTestId("W-TR-06.yield.now").textContent).toBe("0.64 kg a tree now");
    },
    SLOW,
  );

  it(
    "H3 returns the ₱200 multa as a credit the co-op pays; hauling (R2) stays; next is Approve",
    async () => {
      const view = await inReview(webRoutes.holdDrawer(RUN, "H3"));
      act(() => {
        view.world.resolve("H1");
        view.world.resolve("H2");
      });
      await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
      expect(screen.getByTestId("W-TR-06.card.gate").textContent).toBe(
        "Reserves this line only. Never redistributed.",
      );
      const marks = screen.getByTestId("W-TR-06.norule");
      expect(marks.textContent).toMatch(/Hauling ₱91\.20.*Matches R2/);
      expect(marks.textContent).toMatch(/Multa \(absent GA\) ₱200.*No rule/);
      press("W-TR-06.returnCredit");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      expect(screen.getByTestId("W-TR-06.result").textContent).toMatch(
        /Returned as a US\$3\.20 credit paid by the co-op\./,
      );
      await waitFor(
        () =>
          expect(screen.getByTestId("W-TR-06.next").textContent).toBe("Every hold is decided. Open Approve"),
        WAIT,
      );
    },
    SLOW,
  );

  it(
    "slip 0462 is decided on W-TR-04: its card links there; a hold the run lacks says so",
    async () => {
      const view = await inReview(webRoutes.holdDrawer(RUN, "Slip 0462 by hand"), "full", false);
      await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
      expect(screen.getByTestId("W-TR-06.byHand").getAttribute("href")).toBe("/season/2026-A/by-hand/0462");
      await view.navigate(webRoutes.holdDrawer(RUN, "H9"));
      await waitFor(() => expect(stateOf()).toBe("error"), WAIT);
      expect(screen.getByTestId("W-TR-06.notFound").textContent).toMatch(
        /No hold with that name in this run\./,
      );
    },
    SLOW,
  );
});
