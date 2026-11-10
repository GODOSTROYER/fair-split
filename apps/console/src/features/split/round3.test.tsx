// UI gate round 3 on split review: the grid's words in the console's English ("Deductions", "Net US$"), the slip
// count without thumbnails, a column whose every value is zero hidden, the footer named for its figure ("Member net
// total"), the reconciliation above the grid (pool − deductions = member net, the engine's figures), and a narrow
// grid that opens a line's hidden parts under it. Every figure is the engine's; nothing here computes money.

import { UiProvider } from "@fairsplit/ui-web";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { ShortcutsProvider } from "../../lib/shortcuts.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import type { GridContext } from "./cells.js";
import { splitRows, splitTotals } from "./model.js";
import { SplitGrid, zeroColumns } from "./SplitGrid.js";
import { Reconcile } from "./SplitHeader.js";

const snapshot = seedSnapshot();

function inReview(): RunView {
  const world = createTestWorld();
  world.markPaid();
  world.enterByHand();
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

const context: GridContext = {
  isLive: () => false,
  waveDelay: () => 0,
  stamp: () => null,
  yieldLimit: "1.6",
  premiumRate: "US$0.29523 a kg",
};

function grid(view: RunView, columns?: "all" | "narrow"): ReactElement {
  const rows = splitRows(snapshot, view);
  return (
    <UiProvider motion="reduced">
      <ShortcutsProvider>
        <SplitGrid
          rows={rows}
          totals={splitTotals(snapshot, view, rows)}
          context={context}
          onOpen={() => undefined}
          {...(columns ? { columns } : {})}
        />
      </ShortcutsProvider>
    </UiProvider>
  );
}

const headers = () =>
  within(screen.getByTestId("W-TR-05.table"))
    .getAllByRole("columnheader")
    .map((th) => th.textContent);

describe("split review, round 3", () => {
  it("names its columns in English, the money column with its currency, and hides a column of zeros", () => {
    const view = inReview();
    const rows = splitRows(snapshot, view);
    const totals = splitTotals(snapshot, view, rows);
    render(grid(view));
    const names = headers();
    expect(names).toContain("Deductions");
    expect(names).toContain("Net US$");
    expect(names).not.toContain("Kaltas");
    expect(names).not.toContain("Net");
    // Credit shows only once a credit applies or waits for its hold.
    const credit = totals.creditsCents !== 0 || rows.some((r) => r.creditsCents !== 0 || r.pendingCredit);
    expect(zeroColumns(rows, totals).has("credit")).toBe(!credit);
    expect(names.includes("Credit")).toBe(credit);
  });

  it("prints the slip count alone, the carbon-copy chip only where a serial sits twice", () => {
    render(grid(inReview(), "all"));
    const table = screen.getByTestId("W-TR-05.table");
    expect(table.querySelector(".fsr-slips__crop")).toBeNull();
    // The static table prints its first lines before "Show all": every one of them a bare count.
    expect(table.querySelectorAll(".fsr-slips__count").length).toBe(
      table.querySelectorAll("tbody tr").length - 1,
    );
    expect(screen.getByTestId("W-TR-05.dup.M-007").textContent).toBe("0457 ×2");
  });

  it("names the footer for its figure: the members' net total, over its lines", () => {
    render(grid(inReview()));
    const foot = screen.getByTestId("W-TR-05.table").querySelector("tfoot");
    expect(foot?.textContent).toMatch(/^Member net total64 lines/);
  });

  it("reconciles above the grid: pool − deductions (+ credits) = member net, the engine's own figures", () => {
    const view = inReview();
    const rows = splitRows(snapshot, view);
    const totals = splitTotals(snapshot, view, rows);
    expect(totals.netCents + totals.deductionsCents - totals.creditsCents).toBe(totals.poolCents);
    render(<Reconcile totals={totals} />);
    const line = screen.getByTestId("W-TR-05.reconcile");
    const credits = totals.creditsCents > 0 ? ` plus credits ${format.amount(totals.creditsCents)}` : "";
    expect(line.querySelector(".fs-sr")?.textContent).toBe(
      `Pool ${format.money(totals.poolCents)} minus deductions ${format.amount(totals.deductionsCents)}${credits} equals member net ${format.money(totals.netCents)}`,
    );
    expect(screen.getByTestId("W-TR-05.reconcile.net").textContent).toBe(format.money(totals.netCents));
    expect(screen.getByTestId("W-TR-05.reconcile.net").textContent).toBe("US$4,214.85");
  });

  it("a narrow grid opens a line's hidden parts under it, and closes them again", () => {
    render(grid(inReview(), "narrow"));
    const names = headers();
    expect(names).not.toContain("Premium");
    expect(names[0]).toBe("Parts");
    const opener = screen.getByTestId("W-TR-05.expand.M-007");
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(opener.getAttribute("aria-label")).toMatch(/premium, bonus and deductions/);
    fireEvent.click(opener);
    const detail = screen.getByTestId("W-TR-05.detail.M-007");
    expect(detail.textContent).toMatch(/Premium54\.68/);
    expect(detail.textContent).toMatch(/Bonus\+27\.34/);
    expect(detail.textContent).toMatch(/CBU R1−1\.37/);
    expect(detail.textContent).toMatch(/Net US\$80\.65/);
    expect(screen.getByTestId("W-TR-05.expand.M-007").getAttribute("aria-expanded")).toBe("true");
    // The detail sits right under its line.
    const line = screen.getByTestId("W-TR-05.row.M-007").closest("tr");
    expect(line?.nextElementSibling?.contains(detail)).toBe(true);
    fireEvent.click(screen.getByTestId("W-TR-05.expand.M-007"));
    expect(screen.queryByTestId("W-TR-05.detail.M-007")).toBeNull();
  });

  it("a wide grid has no opener: every part is a column", () => {
    render(grid(inReview(), "all"));
    expect(screen.queryByTestId("W-TR-05.expand.M-007")).toBeNull();
    expect(headers()).toContain("Premium");
  });
});
