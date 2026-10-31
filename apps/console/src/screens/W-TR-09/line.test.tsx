// W-TR-09 against the mock world: a member's line beside the split (why the number is the number, the slips,
// the history, an SMS preview that is never sent, the cash-day actions) and the 80 mm statement on the daylight
// surface, with exact pesos for cash at the run's recorded rate and a Nadawat box.

import { webRoutes } from "@fairsplit/contracts";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations, focusAcrossRemoval, renderConsole } from "../../test/index.js";

// The split behind the drawer has its own suite; a stand-in keeps the drawer's tests and axe runs quick. Like AG
// Grid, it draws M-014's row again (a new element, the same row and column IDs) whenever the split re-renders.
vi.mock("../../features/split/SplitGrid.js", () => {
  let draws = 0;
  return {
    SplitGrid: () => {
      draws += 1;
      return (
        <div data-testid="W-TR-05.grid">
          <div key={draws} className="ag-row" row-id="M-014">
            <div className="ag-cell" col-id="member" tabIndex={-1}>
              M-014
            </div>
          </div>
        </div>
      );
    },
  };
});

/** M-014's member cell as the grid draws it now. */
const memberCell = () =>
  document.querySelector<HTMLElement>('.ag-row[row-id="M-014"] .ag-cell[col-id="member"]');

const RUN = "2026A-r37";
const SLOW = 120_000;
const WAIT = { timeout: 8_000 };
const stateOf = () => screen.queryByTestId("W-TR-09")?.dataset.state;

describe("W-TR-09 member line", () => {
  it.each(["Escape", "Close", "the scrim"] as const)(
    "closing by %s hands focus to M-014's cell in the commit that removes the drawer, never <body>",
    async (how) => {
      const view = await renderConsole({ path: webRoutes.split(RUN), viewport: { width: 1920 } });
      await waitFor(() => expect(memberCell()).not.toBeNull(), WAIT);
      memberCell()?.focus();
      await view.navigate(webRoutes.memberLine(RUN, "M-014"));
      await waitFor(() => expect(stateOf()).toBe("paid"), WAIT);
      expect(screen.getByTestId("W-TR-09.drawer").contains(document.activeElement)).toBe(true);
      const watch = focusAcrossRemoval("W-TR-09.drawer");
      try {
        if (how === "Escape") fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        else if (how === "Close") {
          const close = screen.getByTestId("W-TR-09.drawer.close");
          close.focus();
          fireEvent.click(close);
        } else {
          const scrim = screen.getByTestId("W-TR-09.drawer.scrim");
          // Pressing the scrim never takes focus off the drawer first (a browser's default moves it to <body>).
          expect(fireEvent.mouseDown(scrim)).toBe(false);
          fireEvent.click(scrim);
        }
        await waitFor(() => expect(screen.queryByTestId("W-TR-09.drawer")).toBeNull(), WAIT);
        expect(watch.removals()).toBe(1);
        await watch.frame();
      } finally {
        watch.restore();
      }
      const cell = memberCell();
      expect(document.activeElement).toBe(cell);
      // In the commit and on the frame after it: always the row's cell (as the grid drew it then), never <body>.
      for (const sample of watch.samples) {
        expect(sample).not.toBe(document.body);
        expect(sample?.matches('.ag-row[row-id="M-014"] .ag-cell[col-id="member"]')).toBe(true);
      }
    },
    SLOW,
  );

  it(
    "Nang Celing on the showcase: paid, 43.69 + 21.85 − CBU 1.09 = 64.45, about ₱4,028, her four slips",
    async () => {
      await renderConsole({ path: webRoutes.memberLine(RUN, "M-014"), viewport: { width: 1920 } });
      await waitFor(() => expect(stateOf()).toBe("paid"), WAIT);
      expect(screen.getByTestId("W-TR-09.amount").dataset.amountState).toBe("landed");
      expect(screen.getByTestId("W-TR-09.amount").textContent).toMatch(
        /US\$64\.45.*about ₱4,028 \(estimate\)/,
      );
      const receipt = screen.getByTestId("W-TR-09.receipt");
      expect(within(receipt).getByTestId("W-TR-09.receipt.premium").textContent).toMatch(/US\$43\.69/);
      expect(receipt.textContent).toMatch(/−US\$1\.09/);
      expect(within(screen.getByTestId("W-TR-09.slips")).getAllByRole("listitem")).toHaveLength(4);
      expect(screen.getByTestId("W-TR-09.sms.text").textContent).toMatch(
        /^Bulawanon Kakaw: Nang Celing, Bayad na/,
      );
      expect(screen.getByTestId("W-TR-09.sms.count").textContent).toMatch(/characters, GSM-7/);
      fireEvent.click(screen.getByTestId("W-TR-09.sms.en"));
      expect(screen.getByTestId("W-TR-09.sms.text").textContent).toMatch(/Mrs\. Bacus, Paid: US\$64\.45/);
      expect(screen.getByTestId("W-TR-09.print").getAttribute("href")).toBe(
        webRoutes.memberPrint(RUN, "M-014"),
      );
      expect(screen.getByTestId("W-TR-09.pair").dataset.state).toBe("unavailable");
      await expectNoAxeViolations(screen.getByTestId("W-TR-09.drawer"));
    },
    SLOW,
  );

  it(
    "Merlyn's cash is due at the bodega: exact ₱7,990.00 at ₱62.50, Mark received waits for cash day",
    async () => {
      await renderConsole({ path: webRoutes.memberLine(RUN, "M-053"), viewport: { width: 1920 } });
      await waitFor(() => expect(stateOf()).toBe("cash-due"), WAIT);
      expect(screen.getByTestId("W-TR-09.cash").textContent).toMatch(
        /₱7,990\.00 From US\$127\.84 at ₱62\.50 to the dollar\. Cash day 30 Oct/,
      );
      const received = screen.getByTestId("W-TR-09.markReceived");
      expect(received.dataset.state).toBe("unavailable");
      expect(screen.getByTestId("W-TR-09.markReceived.reason").textContent).toMatch(/cash day|wired/);
      await expectNoAxeViolations(screen.getByTestId("W-TR-09.drawer"));
    },
    SLOW,
  );

  it(
    "in a live run: Dioning's line is held by H1, and a phone pairs with a single-use code",
    async () => {
      const view = await renderConsole({
        path: webRoutes.memberLine(RUN, "M-007"),
        viewport: { width: 1920 },
      });
      await view.startSession();
      act(() => {
        view.world.markPaid();
      });
      await waitFor(() => expect(stateOf()).toBe("held"), WAIT);
      expect(screen.getByTestId("W-TR-09.amount").dataset.amountState).toBe("pencil");
      fireEvent.keyDown(screen.getByTestId("W-TR-09.pair.face"), { key: "Enter" });
      const code = await screen.findByTestId("W-TR-09.pair.code", {}, WAIT);
      expect(code.textContent).toMatch(/\d{3} \d{3}/);
    },
    SLOW,
  );

  it(
    "reduced motion keeps every fact and state: the line opens in place, its slabs step instead of travel",
    async () => {
      await renderConsole({
        path: webRoutes.memberLine(RUN, "M-053"),
        viewport: { width: 1920 },
        motion: "reduced",
      });
      await waitFor(() => expect(stateOf()).toBe("cash-due"), WAIT);
      expect(screen.getByTestId("W-TR-09.cash").textContent).toMatch(/₱7,990\.00/);
      expect(screen.getByTestId("W-TR-09.markReceived").dataset.motion).toBe("reduced");
      expect(screen.getByTestId("W-TR-09.markReceived").dataset.state).toBe("unavailable");
      expect(screen.getByTestId("W-TR-09.pair").dataset.motion).toBe("reduced");
      await expectNoAxeViolations(screen.getByTestId("W-TR-09.drawer"));
    },
    SLOW,
  );

  it(
    "a member the run lacks says so",
    async () => {
      await renderConsole({ path: webRoutes.memberLine(RUN, "M-099"), viewport: { width: 1920 } });
      await waitFor(() => expect(stateOf()).toBe("error"), WAIT);
      expect(screen.getByTestId("W-TR-09.notFound").textContent).toMatch(/No member with that number/);
    },
    SLOW,
  );
});

describe("W-TR-09 80 mm statement", () => {
  it(
    "Merlyn's cash statement: ₱7,990.00, the seal in black with its hash, the Nadawat box and a witness line",
    async () => {
      await renderConsole({ path: webRoutes.memberPrint(RUN, "M-053"), viewport: { width: 1280 } });
      await waitFor(() => expect(stateOf()).toBe("cash-due"), WAIT);
      expect(document.documentElement.dataset.theme).toBe("adlaw");
      const paper = screen.getByTestId("W-TR-09.paper");
      expect(screen.getByTestId("W-TR-09.print.amount").textContent).toMatch(
        /₱7,990\.00From US\$127\.84 at ₱62\.50 to the dollar/,
      );
      expect(paper.textContent).toMatch(/Nadawat/);
      expect(paper.textContent).toMatch(/Witness/);
      expect(paper.textContent).toMatch(/Rate card f2d7 026d, BR 2026-04, approved by the Board/);
      expect(screen.getByTestId("W-TR-09.print.seal").dataset.state).toBe("keys-2");
      expect(paper.textContent).toMatch(/Synthetic sample\. No real farmer was paid\./);
      await expectNoAxeViolations(screen.getByTestId("W-TR-09"));
    },
    SLOW,
  );

  it(
    "a PayPal member's statement shows the dollars, the peso estimate and PayPal's confirmation",
    async () => {
      await renderConsole({ path: webRoutes.memberPrint(RUN, "M-014"), viewport: { width: 1280 } });
      await waitFor(() => expect(stateOf()).toBe("paid"), WAIT);
      expect(screen.getByTestId("W-TR-09.print.amount").textContent).toMatch(
        /US\$64\.45about ₱4,028 \(estimate\)Paid by PayPal/,
      );
      expect(screen.getByTestId("W-TR-09.paper").textContent).not.toMatch(/Nadawat/);
    },
    SLOW,
  );
});
