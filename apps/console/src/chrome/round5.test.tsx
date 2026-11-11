// UI gate round 5's shared pieces on the stage: nothing clipped (whole rows, edge fades, room above the panel's foot),
// a top bar of six calm items with the toast folded into the Next pill (plain words, no time, always "Next:"), drawers
// that hug or pin their action, the title row (a noun, a grey suffix, the state's chip, one id line with one
// provenance phrase), captions without ids, the phone visit's two icons and the rail's role words.

import { act, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogRow } from "../data/describe.js";
import { chairCaption, developerWords, KEY_CAPTION, ruleTitle, shrinkLabel } from "../lib/plain.js";
import { ShortcutsProvider } from "../lib/shortcuts.js";
import { cascaded, readRules } from "../test/css.js";
import { renderConsole } from "../test/render.js";
import { PROVENANCE } from "./copy.js";
import { pillWords } from "./next-step.js";
import { Cell, ScreenHead } from "./ScreenGrid.js";
import { PEEK_ROWS, SNAP, SnapScroll, scrollEdges, wholeRowsHeight } from "./SnapScroll.js";
import { StageDrawer } from "./StageDrawer.js";
import { shrinkToast, toastWords } from "./toast.js";

configure({ asyncUtilTimeout: 6000 });

const stage = readRules("src/theme/stage.css");
const snap = readRules("src/theme/snap.css");
const grid = readRules("src/theme/grid.css");
const at = (width: number) => ({ width, height: 1080, motion: "full" as const });

/** A detached element with these classes (and attributes), for the cascade helper, inside `parent` when given. */
function el(className: string, attrs: Record<string, string> = {}, parent?: HTMLElement): HTMLElement {
  const node = document.createElement("div");
  node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.append(node);
  return node;
}

function row(words: string, extra: Partial<LogRow> = {}): LogRow {
  return {
    id: "e1",
    lane: "PAYPAL",
    words,
    detail: "",
    at: "2026-11-11T06:54:14Z",
    type: "webhook.received",
    provenance: "simulated_rail",
    duplicate: false,
    ...extra,
  };
}

describe("nothing clipped (round 5)", () => {
  it("a scroll column shows a whole number of rows: head, rows, foot", () => {
    expect(wholeRowsHeight({ available: 500, row: 48, head: 36, foot: 48 })).toEqual({
      rows: 8,
      height: 36 + 8 * 48 + 48,
    });
    // Never less than one row, never a part of one.
    expect(wholeRowsHeight({ available: 60, row: 48, head: 36 }).rows).toBe(1);
    for (const available of [301, 433, 777, 1009]) {
      const { rows, height } = wholeRowsHeight({ available, row: 48, head: 40, foot: 40 });
      expect((height - 80) / 48).toBe(rows);
      expect(height).toBeLessThanOrEqual(available);
    }
  });

  it("fades an edge only where there is more beyond it", () => {
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 900, clientHeight: 400 })).toEqual({
      start: false,
      end: true,
    });
    expect(scrollEdges({ scrollTop: 500, scrollHeight: 900, clientHeight: 400 })).toEqual({
      start: true,
      end: false,
    });
    expect(scrollEdges({ scrollTop: 0, scrollHeight: 400, clientHeight: 400 })).toEqual({
      start: false,
      end: false,
    });
  });

  it("the fade is 24 px and the room above a panel's foot 32 px, from the tokens; a log peeks 4 rows", () => {
    expect(SNAP).toEqual({ fade: 24, end: 32 });
    expect(PEEK_ROWS).toBe(4);
    const fade = el("fsc-snap__fade", { "data-edge": "end" });
    expect(cascaded(snap, fade, "height", at(1920))).toBe("var(--fs-console-fade)");
    expect(cascaded(snap, fade, "bottom", at(1920))).toBe("var(--fsc-snap-foot, 0px)");
    expect(cascaded(snap, el("fsc-peek"), "margin-bottom", at(1920))).toBe("var(--fs-console-end)");
    expect(cascaded(snap, el("fsc-end"), "padding-bottom", at(1920))).toBe("var(--fs-console-end)");
  });

  it("rows snap under the sticky head; the scroller keeps a stable gutter", () => {
    const scroller = el("fsc-snap__scroller", { "data-snap": "rows" });
    expect(cascaded(snap, scroller, "scroll-snap-type", at(1920))).toBe("y mandatory");
    expect(cascaded(snap, scroller, "scroll-padding-top", at(1920))).toBe("var(--fsc-snap-head, 0px)");
    expect(cascaded(snap, scroller, "scrollbar-gutter", at(1920))).toBe("stable");
  });

  it("SnapScroll is a named, focusable region with a fade at each edge", () => {
    render(
      <SnapScroll label="Members" row={48} rows={4} testId="col">
        <table>
          <thead data-snap-head="">
            <tr>
              <th>Member</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Nang Celing</td>
            </tr>
          </tbody>
        </table>
      </SnapScroll>,
    );
    const region = screen.getByRole("region", { name: "Members" });
    expect(region.tabIndex).toBe(0);
    expect(region.dataset.snap).toBe("rows");
    const col = screen.getByTestId("col");
    expect(col.querySelectorAll(".fsc-snap__fade")).toHaveLength(2);
    expect(col.style.getPropertyValue("--fsc-snap-row")).toBe("48px");
  });
});

describe("the toast's plain words (round 5)", () => {
  it("a batch PayPal took is 'accepted', never a success", () => {
    const words = toastWords(row("PayPal notice: PAYMENT.PAYOUTSBATCH.SUCCESS"), {
      type: "webhook.received",
      payload: { eventType: "PAYMENT.PAYOUTSBATCH.SUCCESS", duplicate: false },
    } as never);
    expect(words).toBe("PayPal accepted the batch");
    expect(words).not.toMatch(/success|notice/i);
  });

  it("says the season check as 'Shrink 2.05% · over limit'", () => {
    expect(shrinkToast("Season check: shrink 2.05%, over 2.0%")).toBe("Shrink 2.05% · over limit");
    expect(shrinkToast("Season check: shrink 1.62%, inside 2.0%")).toBe("Shrink 1.62% · within limit");
    expect(
      toastWords(row("Season check: shrink 2.05%, over 2.0%", { lane: "MACHINE", type: "hold.raised" }), {
        type: "hold.raised",
      } as never),
    ).toBe("Shrink 2.05% · over limit");
  });

  it("keeps a refusal's plain words; never a time, a 'Notice:' or a full stop", () => {
    expect(toastWords(row("Refused · invoice must equal quote", { lane: "MACHINE" }))).toBe(
      "Refused · invoice must equal quote",
    );
    expect(toastWords(row("Delivery repeated, already applied."))).toBe("Delivery repeated, already applied");
    const paid = toastWords(row("Paid Consolacion Bacus US$64.45 (Simulated PayPal sandbox)"), {
      type: "item.updated",
      payload: { to: "SUCCESS" },
    } as never);
    expect(paid).toBe("Paid Consolacion Bacus · US$64.45");
    for (const words of [paid, "PayPal accepted the batch"]) {
      expect(words).not.toMatch(/\d{2}:\d{2}|PHT|Notice:|\.$/);
      expect(developerWords(words)).toEqual([]);
    }
  });

  it("the pill always starts 'Next:'; a name keeps its capital", () => {
    expect(pillWords("Next: mark the invoice paid")).toBe("Next: mark the invoice paid");
    expect(pillWords("Review cash handover")).toBe("Next: review cash handover");
    expect(pillWords("Open Proof")).toBe("Next: open Proof");
    expect(pillWords("Reading 12 photos")).toBe("Next: reading 12 photos");
    expect(pillWords("PayPal confirms")).toBe("Next: PayPal confirms");
  });
});

async function press(testId: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });
  });
}

describe("the top bar keeps six calm items (round 5)", () => {
  it("folds the toast into the Next pill: the event's words for 3 s, then 'Next: …' again", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    act(() => {
      view.world.settle();
    });
    await screen.findByTestId("W-JG-01.toast");
    // Each new event re-keys the toast: read the one on screen now.
    await waitFor(() => {
      const now = screen.getByTestId("W-JG-01.toast");
      expect(screen.getByTestId("W-JG-01.runPill.next").contains(now)).toBe(true);
      expect(now.getAttribute("aria-hidden")).toBe("true");
    });
    const toast = screen.getByTestId("W-JG-01.toast");
    // The status area holds no toast; the bar never grows a seventh item.
    const bar = screen.getByTestId("W-JG-01.bar");
    expect(bar.querySelector(".fsc-bar__status [data-testid='W-JG-01.toast']")).toBeNull();
    expect(bar.querySelectorAll("a[href], button").length).toBeLessThanOrEqual(6);
    // The pill's own words always start "Next:", and its name stays them.
    expect(screen.getByTestId("W-JG-01.runPill.words").textContent).toMatch(/^Next: /);
    // No time and no "Notice:" in the toast.
    expect(toast.textContent).not.toMatch(/\d{2}:\d{2}:\d{2}|PHT|Notice:/);
  });

  it("the Next words are never underlined; hover is the plate-2 fill", () => {
    const next = el("fsc-pill__next");
    expect(cascaded(stage, next, "text-decoration", at(1920))).toBe("none");
    for (const rule of stage) {
      if (/fsc-pill__next/.test(rule.selector))
        expect(rule.declarations["text-decoration"] ?? "none").toBe("none");
    }
  });

  it("the swap is a 150 ms crossfade", () => {
    const words = el("fsc-pill__words");
    const say = el("fsc-pill__say", {}, words);
    expect(cascaded(stage, say, "transition", at(1920))).toBe(
      "opacity var(--fs-dur-swap) var(--fs-ease-out)",
    );
  });

  it.each([1280, 1470])("What's real keeps its word at %i px, and the indicator its whole name", (width) => {
    const link = el("fsc-barlink fsc-barlink--real");
    const label = el("fs-t-label", {}, link);
    expect(cascaded(stage, label, "clip-path", at(width))).toBeUndefined();
    expect(cascaded(stage, label, "position", at(width))).toBeUndefined();
    // Round 6: the disclosure is never shortened; "Simulated PayPal sandbox" stays whole at every width.
    expect(cascaded(stage, el("fsc-bar__tagrest"), "clip-path", at(width))).toBeUndefined();
  });

  it("at 1920 the indicator says its whole name", () => {
    expect(cascaded(stage, el("fsc-bar__tagrest"), "clip-path", at(1920))).toBeUndefined();
  });

  it("the indicator's text and name stay 'Simulated PayPal sandbox'", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1280, height: 800 } });
    expect(screen.getByTestId("W-JG-01.notice").textContent).toBe("Simulated PayPal sandbox");
    expect(
      within(screen.getByTestId("W-JG-01.bar")).getByTestId("W-JG-01.whatsRealOpen").textContent,
    ).toContain("What's real");
  });
});

describe("the title row (round 5)", () => {
  it("a noun title with a grey suffix, the state's chip on the row, one id line with one provenance phrase", () => {
    render(
      <div className="fsc-screen">
        <ScreenHead
          title="Season"
          suffix="2026-A"
          titleId="t"
          status={<span data-testid="chip">Awaiting payment</span>}
          meta="r1"
          provenance={PROVENANCE.seededSlips}
          testId="head"
        />
        <Cell>x</Cell>
      </div>,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Season 2026-A");
    expect(screen.getByText("2026-A").classList.contains("fsc-screen__suffix")).toBe(true);
    expect(screen.getByTestId("chip").parentElement?.classList.contains("fsc-screen__status")).toBe(true);
    expect(screen.getByText("r1").classList.contains("fs-t-id")).toBe(true);
    const phrase = screen.getByTestId("head.provenance");
    expect(phrase.textContent).toContain("Synthetic co-op · seeded slips");
    expect(phrase.getAttribute("title")).toBe(PROVENANCE.seededSlips.title);
    expect(cascaded(grid, el("fsc-screen__suffix"), "color", at(1920))).toBe("var(--fs-ink-2)");
  });
});

describe("captions for people (round 5)", () => {
  it("the Chair's key is said in words, its rule only in a title", () => {
    expect(chairCaption(30000)).toBe("Co-signs batches over US$300");
    expect(ruleTitle("R5")).toBe("Rule R5");
    expect(KEY_CAPTION).toBe("Key on this browser");
    expect(shrinkLabel(200)).toBe("Shrink · limit 2.0%");
    for (const words of [chairCaption(30000), KEY_CAPTION, shrinkLabel(200)]) {
      expect(developerWords(words)).toEqual([]);
      expect(words).not.toMatch(/\bR\d\b|fs-[a-z]+-/);
    }
  });
});

describe("drawers hug their content or pin their action (round 5)", () => {
  it("a footer is sticky at the foot; a hugging drawer ends at its content; no scrim when asked", () => {
    render(
      <ShortcutsProvider>
        <StageDrawer
          label="Hold H1"
          onClose={() => undefined}
          testId="W-TR-06.drawer"
          mode="overlay"
          hug
          scrim={false}
          footer={<button type="button">Next hold</button>}
        >
          <p>Counted once</p>
        </StageDrawer>
      </ShortcutsProvider>,
    );
    const drawer = screen.getByTestId("W-TR-06.drawer");
    expect(drawer.dataset.hug).toBe("");
    expect(screen.queryByTestId("W-TR-06.drawer.scrim")).toBeNull();
    const foot = screen.getByTestId("W-TR-06.drawer.foot");
    expect(foot.textContent).toBe("Next hold");
    expect(cascaded(stage, el("fsc-drawer__foot"), "position", at(1920))).toBe("sticky");
    expect(cascaded(stage, el("fsc-drawer__foot"), "bottom", at(1920))).toBe("0");
    expect(cascaded(stage, el("fsc-drawer", { "data-hug": "" }), "bottom", at(1920))).toBe("auto");
  });
});

describe("the phone visit and the rail (round 5)", { timeout: 60_000 }, () => {
  it("the 390 header has two icons; the log, sound and Reset are in its menu", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 390, height: 844 } });
    const bar = screen.getByTestId("W-JG-01.bar");
    const controls = bar.querySelectorAll(".fsc-bar__utils button, .fsc-bar__utils a[href]");
    expect(controls).toHaveLength(2);
    for (const id of ["W-JG-01.logOpen", "W-JG-01.sound", "W-JG-01.reset"]) {
      expect(within(bar).queryByTestId(id)).toBeNull();
    }
    await act(async () => {
      fireEvent.click(within(bar).getByTestId("W-JG-01.visit.more"));
    });
    const menu = await screen.findByTestId("W-JG-01.visit.menu");
    expect(within(menu).getByTestId("W-JG-01.logOpen")).toBeTruthy();
    expect(within(menu).getByTestId("W-JG-01.sound")).toBeTruthy();
  });

  it("the folded rail says each role under its avatar; the phone glyph's tooltip is 'Open phone'", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470, height: 956 } });
    const toggle = screen.getByTestId("W-JG-01.phoneTab");
    expect(toggle.getAttribute("title")).toBe("Open phone");
    expect(screen.getByTestId("W-JG-01.tab.member").textContent).toContain("Member");
    expect(screen.getByTestId("W-JG-01.tab.chair").textContent).toContain("Chair");
    expect(screen.getByTestId("W-JG-01.tab.clerk").textContent).toContain("Clerk");
  });
});
