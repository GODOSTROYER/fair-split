// UI gate round 4 on split review: the duplicate badge reads "0457 ×2" in a 1 px outline while H1 is open and
// "0457 counted once" in neutral ink once it is counted once; Verified kg is a right-aligned number column with no
// micro-bars; "2.14 kg a tree" leaves Merlyn's kilos cell for H2's note under her line; and no developer word shows.
// Every figure is the engine's or the line's own; nothing here computes money.

import { UiProvider } from "@fairsplit/ui-web";
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView } from "../../data/run-view.js";
import { developerWords } from "../../lib/plain.js";
import { ShortcutsProvider } from "../../lib/shortcuts.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import { duplicateLook, type GridContext } from "./cells.js";
import { holdNotes, yieldNote } from "./HoldNote.js";
import { decisionRows, splitRows, splitTotals } from "./model.js";
import { SplitGrid } from "./SplitGrid.js";

const snapshot = seedSnapshot();
const slip = (serial: string, copy: string) =>
  snapshot.slips.find((s) => s.serial === serial && s.copy === copy);

function review(decide?: (world: ReturnType<typeof createTestWorld>) => void): RunView {
  const world = createTestWorld();
  world.markPaid();
  world.enterByHand();
  decide?.(world);
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
  slip: (serial, copy) => slip(serial, copy) as never,
};

function grid(view: RunView): ReactElement {
  const rows = splitRows(snapshot, view);
  const pinned = decisionRows(rows);
  const rest = rows.filter((r) => !pinned.some((p) => p.memberNo === r.memberNo));
  return (
    <UiProvider motion="reduced">
      <ShortcutsProvider>
        <SplitGrid
          rows={rest}
          pinned={pinned}
          totals={splitTotals(snapshot, view, rows)}
          context={context}
          onOpen={() => undefined}
          columns="all"
        />
      </ShortcutsProvider>
    </UiProvider>
  );
}

describe("split review, round 4", () => {
  it("the duplicate badge: an outline while H1 is open, then '0457 counted once' in neutral ink", () => {
    const open = splitRows(snapshot, review()).find((r) => r.memberNo === "M-007");
    if (!open) throw new Error("no M-007");
    expect(duplicateLook(open)).toEqual({ serial: "0457", state: "open" });
    const { unmount } = render(grid(review()));
    const before = screen.getByTestId("W-TR-05.dup.M-007");
    expect(before.textContent).toBe("0457 ×2");
    expect(before.dataset.state).toBe("open");
    unmount();

    const decided = review((w) => w.resolve("H1"));
    const once = splitRows(snapshot, decided).find((r) => r.memberNo === "M-007");
    if (!once) throw new Error("no M-007");
    expect(duplicateLook(once)).toEqual({ serial: "0457", state: "once" });
    render(grid(decided));
    const after = screen.getByTestId("W-TR-05.dup.M-007");
    expect(after.textContent).toBe("0457 counted once");
    expect(after.dataset.state).toBe("once");
  });

  it("prints Verified kg as a bare number (no micro-bars) and moves '2.14 kg a tree' into H2's note", () => {
    const view = review();
    const rows = splitRows(snapshot, view);
    render(grid(view));
    const table = screen.getByTestId("W-TR-05.table");
    expect(table.querySelector(".fsr-kg__bar")).toBeNull();
    const kgHead = within(table)
      .getAllByRole("columnheader")
      .find((th) => th.dataset.col === "kg");
    expect(kgHead?.dataset.numeric).toBe("");
    const merlyn = screen.getByTestId("W-TR-05.row.M-053").closest("tr");
    expect(merlyn?.querySelector('[data-col="kg"]')?.textContent).toBe("300.0");
    expect(merlyn?.textContent).not.toMatch(/kg\/tree|kg a tree/);
    // H2's note sits right under Merlyn's line, the figure and its limit, one quiet way into the drawer.
    const note = screen.getByTestId("W-TR-05.note.H2");
    expect(merlyn?.nextElementSibling?.contains(note)).toBe(true);
    expect(note.textContent).toBe("2.14 kg a tree limit 1.6 kg · 140 registered treesOpen H2");
    expect(yieldNote(rows, "1.6")).toMatchObject({ label: "H2", perTree: "2.14", trees: 140 });
    expect(holdNotes(rows, "1.6", context.slip).map((n) => n.label)).toEqual(["H1", "H2"]);
    // Every visible word, text node by text node (textContent runs cells together).
    const words: string[] = [];
    const walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) words.push(node.textContent ?? "");
    expect(developerWords(words.join(" "))).toEqual([]);
  });

  it("H2's note goes once the plot is registered", () => {
    const rows = splitRows(
      snapshot,
      review((w) => w.resolve("H2")),
    );
    expect(yieldNote(rows, "1.6")).toBeNull();
  });
});
