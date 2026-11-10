// W-TR-06 Hold drawer against the mock world. H1 is MM-3, "The pink copy": opening it plays glide-in, converge,
// pairs and ready over the two copies of slip 0457 (4 of 4 fields match); "Count it once" is pressed, and
// the engine's hold.resolved swings the needle to 1.62% and resolves the card flush in ink with the AS stamp,
// in full and reduced motion. H2 registers Merlyn's second plot, H3 returns the multa as a credit, and the
// flat "These are two deliveries" asks for a reason first.

import { webRoutes } from "@fairsplit/contracts";
import { TIMING } from "@fairsplit/motion";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { REVEAL_SETTLE_MS } from "../../lib/focus.js";
import {
  clearMomentTrace,
  expectNoAxeViolations,
  fakeResizeObserver,
  focusAcrossRemoval,
  renderConsole,
  tracedPhases,
} from "../../test/index.js";

// The split behind the drawer is W-TR-05's to test (its grid has its own suite, with the MM-3 wave); here it is a
// stand-in, so the drawer's tests and axe runs do not pay for 64 rows of AG Grid in jsdom. Like AG Grid, it draws
// M-007's row again (a new element with the same row and column IDs) every time the split re-renders.
vi.mock("../../features/split/SplitGrid.js", () => {
  let draws = 0;
  return {
    SplitGrid: () => {
      draws += 1;
      return (
        <div data-testid="W-TR-05.grid">
          <div key={draws} className="ag-row" row-id="M-007" data-draw={draws}>
            <div className="ag-cell" col-id="member" tabIndex={-1}>
              M-007
            </div>
          </div>
        </div>
      );
    },
  };
});

/** M-007's member cell as the grid draws it now. */
const heldCell = () =>
  document.querySelector<HTMLElement>('.ag-row[row-id="M-007"] .ag-cell[col-id="member"]');

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
      expect(sinceOpen()).toEqual(["glide-in", "converge", "pairs", "ready"]);
      expect(screen.getByTestId("W-TR-06.card.gate").textContent).toBe("Blocks approval. Changes kilos.");
      const card = screen.getByTestId("W-TR-06.card");
      // The decision leads (UI gate round 3): counting both as a number line, then the money back and the dial's
      // move directly above "Count it once" (holds.css draws the paired receipts after them).
      expect(card.textContent).toMatch(/63 members −US\$17\.94 → Nong Dioning \+US\$17\.94/);
      expect(card.textContent).toMatch(/\+US\$17\.94 to 63 members · 2\.05% → 1\.62%/);
      expect(card.textContent).not.toMatch(/Counting both moves/);
      expect(card.textContent).not.toMatch(/pink copy of the same receipt/);
      expect(card.querySelector(".fs-hold__effect")?.nextElementSibling).toBe(
        card.querySelector(".fs-hold__actions"),
      );
      const twin = screen.getByTestId("W-TR-06.twin");
      expect(card.contains(twin)).toBe(true);
      // The copies' photos are their captions; the pair is the seed's, said by its glyph (its words its name).
      expect(card.textContent).toMatch(/B · white original/);
      expect(card.textContent).toMatch(/D · pink duplicate/);
      expect(screen.getByTestId("W-TR-06.twin.standIn").getAttribute("title")).toBe(
        "Seed stand-in, not a Claude recording",
      );
      expect(screen.getByTestId("W-TR-06.twin.verdict").textContent).toBe(
        "4/4 fields matchSeed stand-in, not a Claude recording",
      );
      expect(screen.getByTestId("W-TR-06.twin.verdict").getAttribute("title")).toBe(
        "4 of 4 fields match. Same slip.",
      );
      expect(twin.dataset.lit).toBe("");
      // Canary is a person's decision: the matching field pairs light in turn (serial, date, member, net kg,
      // TIMING.pairStagger apart), with nothing drawn on the slips themselves: no underline, no highlight.
      expect(twin.querySelectorAll(".fsr-slip__underline")).toHaveLength(0);
      expect(twin.querySelectorAll(".fsr-slip__highlight")).toHaveLength(0);
      ["serial", "date", "member", "net"].forEach((field, i) => {
        const row = screen.getByTestId(`W-TR-06.twin.${field}`);
        expect(row.dataset.match).toBe("");
        expect(row.dataset.lit).toBe("");
        expect(row.style.getPropertyValue("--fsr-pair-at")).toBe(`${i * TIMING.pairStagger}ms`);
        expect(row.querySelector(".fsr-twin__eq")?.textContent).toBe("=");
      });
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
      const face = screen.getByTestId("W-TR-06.countOnce.face");
      face.focus();
      press("W-TR-06.countOnce");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      await waitFor(() => expect(tracedPhases("MM-3").slice(-1)[0]).toBe("resolved"), WAIT);
      // The answer takes "Count it once" away: focus stays in the drawer, never on <body> (WCAG 2.4.3).
      await waitFor(() => expect(face.isConnected).toBe(false), WAIT);
      await waitFor(
        () => expect(screen.getByTestId("W-TR-06.drawer").contains(document.activeElement)).toBe(true),
        WAIT,
      );
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
      // The outcome leads the decided drawer: the delta, the card renamed for what was decided, the old reading.
      expect(screen.getByTestId("W-TR-06.result").textContent).toBe("+US$17.94 back to 63 members");
      expect(document.getElementById("W-TR-06.card-title")?.textContent).toBe("Slip 0457, counted once");
      expect(screen.getByTestId("W-TR-06.dialBlock").textContent).toMatch(/was 2\.05%/);
      expect(screen.getByTestId("W-TR-06.card.resolution").textContent).toMatch(/Resolved by AS/);
      expect(screen.getByTestId("W-TR-06.next").textContent).toBe("Next: hold H2");
      await expectNoAxeViolations(screen.getByTestId("W-TR-06.drawer"));
    },
    SLOW,
  );

  it.each(["full", "reduced"] as const)(
    "Count it once from M-007's row: focus lands on Next inside the drawer's scrollport, and closing hands it back to M-007's cell, redrawn (%s motion)",
    async (motion) => {
      // In a browser the drawer scrolls (its scrollport ends at 863 px at 1470), and Next is drawn under its fold
      // (top 1028): focus there is unseen unless it scrolls into view. Closing, the row that opened the drawer was
      // drawn again when H1 resolved: focus finds it by its row and column, never the screen, never <body>.
      clearMomentTrace();
      const view = await inReview(webRoutes.split(RUN), motion);
      await waitFor(() => expect(heldCell()).not.toBeNull(), WAIT);
      const original = heldCell();
      original?.focus();
      await view.navigate(webRoutes.holdDrawer(RUN, "H1"));
      await waitFor(() => expect(sinceOpen()).toContain("ready"), WAIT);
      const drawer = screen.getByTestId("W-TR-06.drawer");
      expect(drawer.contains(document.activeElement)).toBe(true);

      const rect = Element.prototype.getBoundingClientRect;
      const at = (top: number, height: number, width = 560) =>
        ({
          top,
          height,
          width,
          left: 900,
          bottom: top + height,
          right: 900 + width,
          x: 900,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        if (this.matches?.(".fsc-drawer")) return at(49, 814);
        if ((this as HTMLElement).dataset?.testid === "W-TR-06.next") return at(1028, 16, 120);
        return rect.call(this);
      });
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(1200);
      const scrolled: Element[] = [];
      vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
      try {
        const face = screen.getByTestId("W-TR-06.countOnce.face");
        face.focus();
        press("W-TR-06.countOnce");
        await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
        await waitFor(() => expect(face.isConnected).toBe(false), WAIT);
        const next = await screen.findByTestId("W-TR-06.next");
        await waitFor(() => expect(document.activeElement).toBe(next), WAIT);
        expect(scrolled).toContain(next);
      } finally {
        vi.restoreAllMocks();
      }

      const watch = focusAcrossRemoval("W-TR-06.drawer");
      try {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        await waitFor(() => expect(screen.queryByTestId("W-TR-06.drawer")).toBeNull(), WAIT);
        await watch.frame();
      } finally {
        watch.restore();
      }
      const cell = heldCell();
      expect(document.activeElement).toBe(cell);
      // The cell focused is the row as drawn now: the one that opened the drawer was drawn again meanwhile.
      expect(original?.isConnected).toBe(false);
      expect(watch.samples.length).toBeGreaterThanOrEqual(2);
      // In the commit and on the frame after it: always the row's cell (as the grid drew it then), never <body>.
      for (const sample of watch.samples) {
        expect(sample).not.toBe(document.body);
        expect(sample?.matches('.ag-row[row-id="M-007"] .ag-cell[col-id="member"]')).toBe(true);
      }
    },
    SLOW,
  );

  it(
    "Count it once: a result line that unfolds above Next after the settle window (MM-3's wave on a slow machine) still brings Next back into the drawer",
    async () => {
      // At 1100 × 768 the drawer's scrollport is 85..643 and Next sits at 611 once it takes focus. On a machine four
      // times slower, MM-3 reaches its wave, and the result line is drawn above Next, 2.4 s later: Next is pushed
      // 58 px down, under the fold, long after any time-boxed watch has ended (WCAG 2.4.7, 2.4.11).
      const layout = fakeResizeObserver();
      clearMomentTrace();
      await inReview(webRoutes.holdDrawer(RUN, "H1"));
      await waitFor(() => expect(sinceOpen()).toContain("ready"), WAIT);
      let nextTop = 611;
      const rect = Element.prototype.getBoundingClientRect;
      const at = (top: number, height: number, width = 1036) =>
        ({
          top,
          height,
          width,
          left: 64,
          bottom: top + height,
          right: 64 + width,
          x: 64,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
        if (this.matches?.(".fsc-drawer")) return at(85, 558);
        if ((this as HTMLElement).dataset?.testid === "W-TR-06.next") return at(nextTop, 16, 120);
        return rect.call(this);
      });
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
      const scrolled: Element[] = [];
      vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
      try {
        const face = screen.getByTestId("W-TR-06.countOnce.face");
        face.focus();
        press("W-TR-06.countOnce");
        const next = await screen.findByTestId("W-TR-06.next");
        await waitFor(() => expect(document.activeElement).toBe(next), WAIT);
        // The settle window has ended; nothing has moved Next yet.
        const now = performance.now();
        vi.spyOn(performance, "now").mockReturnValue(now + REVEAL_SETTLE_MS + 924);
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        scrolled.length = 0;
        nextTop = 669;
        layout.resized(screen.getByTestId("W-TR-06"));
        expect(scrolled).toEqual([next]);
      } finally {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
      }
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
          "pairs",
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
      expect(document.getElementById("W-TR-06.card-title")?.textContent).toBe("Merlyn Ponce: 2.14 kg a tree");
      expect(screen.getByTestId("W-TR-06.card").textContent).toMatch(
        /300\.0 kg from 140 registered trees\. The limit is 1\.6 kg a tree\./,
      );
      expect(screen.getByTestId("W-TR-06.plot.P-053-B").textContent).toMatch(/Not registered/);
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
      expect(screen.getByTestId("W-TR-06.card").textContent).toMatch(
        /Multa \(absent GA\) ₱200 matches no Schedule A rule\..*\+US\$3\.20 correction credit from the co-op/,
      );
      press("W-TR-06.returnCredit");
      await waitFor(() => expect(stateOf()).toBe("resolved"), WAIT);
      expect(screen.getByTestId("W-TR-06.result").textContent).toMatch(
        /^\+US\$3\.20 credit, paid by the co-op$/,
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

it.each(["H1", "H2", "H3"])(
  "inv.i8.hold-voice: %s attributes its sentence to the seed stand-in",
  async (hold) => {
    await inReview(webRoutes.holdDrawer(RUN, hold), "reduced");
    await waitFor(() => expect(stateOf()).toBe("open"), WAIT);
    const card = screen.getByTestId("W-TR-06.card");
    expect(card.textContent).toContain("Seed stand-in, not a Claude recording");
    expect(card.textContent).not.toMatch(/Claude:/);
    expect(card.querySelector('[data-provenance="claude"]')).toBeNull();
  },
  SLOW,
);
