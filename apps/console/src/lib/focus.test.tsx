// lib/focus.ts, the console's one focus helper (WCAG 2.4.3, 2.4.7, 2.4.11).
// returnFocus: hands focus back when it is lost, to the opener or its successor by stable key (a redrawn row),
// else the screen's main control, and #fsc-main only when the screen has no control; never to <body>, never to
// anything inside what is going away; and a target outside the viewport or its scrollport is scrolled into view
// the least it can, at once. useFocusAfterRemoval: a control the answer removed hands focus on in that commit.
// focusInto: focus moves into a container that has just gone live (the phone raised over the scrim), and keeps
// trying each frame while a browser refuses it (a control it does not render yet) and focus is lost.

import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  focusAndReveal,
  focusInto,
  focusKey,
  outOfView,
  registerScreenControl,
  rememberFocus,
  returnFocus,
  useFocusAfterRemoval,
} from "./focus.js";

function frames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let left = n;
    const tick = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function box(el: Element, rect: { top: number; left?: number; width?: number; height?: number }) {
  const { top, left = 0, width = 100, height = 20 } = rect;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top,
    left,
    width,
    height,
    bottom: top + height,
    right: left + width,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A stage: a screen with two controls, a drawer beside it, the ribbon's lane. */
function stage() {
  document.body.innerHTML = `
    <main id="fsc-main" tabindex="-1">
      <div class="ag-row" row-id="M-007"><div class="ag-cell" col-id="member" tabindex="-1">M-007</div></div>
      <button id="first">Open hold H1</button>
      <button id="slab" data-testid="W-TR-07.approve.face">Approve</button>
    </main>
    <aside class="fsc-drawer" tabindex="-1" data-testid="drawer">
      <h2 class="fsc-drawer__title" tabindex="-1">Hold H1</h2>
      <button id="close">Close</button>
    </aside>
    <button id="lane">Phone</button>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  const cell = document.querySelector<HTMLElement>(".ag-cell") as HTMLElement;
  const drawer = document.querySelector<HTMLElement>(".fsc-drawer") as HTMLElement;
  return {
    main: get("fsc-main"),
    first: get("first"),
    slab: get("slab"),
    close: get("close"),
    lane: get("lane"),
    cell,
    drawer,
  };
}

/** The grid draws a row again (its data changed): same row and column, a new element. */
function redraw(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  el.replaceWith(copy);
  return copy;
}

describe("focusKey and rememberFocus", () => {
  it("keys a control by data-focus-key, then its test ID, then its grid cell's row and column", () => {
    const { slab, cell } = stage();
    expect(focusKey(slab)).toBe('[data-testid="W-TR-07.approve.face"]');
    slab.dataset.focusKey = "approve";
    expect(focusKey(slab)).toBe('[data-focus-key="approve"]');
    expect(focusKey(cell)).toBe('.ag-row[row-id="M-007"] .ag-cell[col-id="member"]');
    cell.focus();
    expect(rememberFocus()).toEqual({ el: cell, key: focusKey(cell) });
    (document.activeElement as HTMLElement).blur();
    expect(rememberFocus()).toBeNull();
  });
});

describe("returnFocus", () => {
  it("hands focus back to the opener when focus is lost", () => {
    const { slab } = stage();
    expect(document.activeElement).toBe(document.body);
    expect(returnFocus(slab)).toBe(slab);
    expect(document.activeElement).toBe(slab);
  });

  it("finds a redrawn opener's successor by its key, not the screen", () => {
    const { cell } = stage();
    const place = rememberFocus(cell);
    const next = redraw(cell);
    expect(cell.isConnected).toBe(false);
    returnFocus(place);
    expect(document.activeElement).toBe(next);
  });

  it("with the opener gone for good, lands on the screen's main control, and on #fsc-main only when it has none", () => {
    const { slab, first, main } = stage();
    const place = rememberFocus(slab);
    slab.remove();
    returnFocus(place);
    // The first control of the screen (the grid's cell is not in the tab order).
    expect(document.activeElement).toBe(first);

    const registered = stage();
    const unregister = registerScreenControl(registered.slab);
    try {
      returnFocus(null);
      expect(document.activeElement).toBe(registered.slab);
    } finally {
      unregister();
    }

    for (const el of main.querySelectorAll("button")) el.remove();
    document.body.innerHTML = '<main id="fsc-main" tabindex="-1"><p>Nothing to press</p></main>';
    returnFocus(null);
    expect(document.activeElement).toBe(document.getElementById("fsc-main"));
  });

  it("never lands inside what is going away, and focus inside it counts as lost", () => {
    const { drawer, close, cell } = stage();
    close.focus();
    // From the drawer's cleanup, before its DOM goes: the opener takes focus.
    expect(returnFocus(rememberFocus(cell), { leaving: drawer })).toBe(cell);
    close.focus();
    returnFocus(close, { leaving: drawer });
    expect(drawer.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
  });

  it("skips an inert target and an inert screen: a drawer that covers the screen takes it", () => {
    const { main, slab, drawer } = stage();
    main.setAttribute("inert", "");
    const focus = vi.spyOn(slab, "focus");
    returnFocus(slab);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(drawer.querySelector(".fsc-drawer__title"));
  });

  it("leaves alone a focus the person moved somewhere live, unless told to move it", () => {
    const { lane, slab } = stage();
    lane.focus();
    expect(returnFocus(slab)).toBeNull();
    expect(document.activeElement).toBe(lane);
    returnFocus(slab, { when: "always" });
    expect(document.activeElement).toBe(slab);
  });

  it("focus held under an inert subtree is lost (a browser drops it to <body> at its next style update)", () => {
    const { main, slab, lane } = stage();
    slab.focus();
    main.setAttribute("inert", "");
    returnFocus(lane);
    expect(document.activeElement).toBe(lane);
  });

  it("when the same commit takes the target away after all, a microtask later it lands on what is there", async () => {
    const { drawer, close, slab, first } = stage();
    close.focus();
    returnFocus(slab, { leaving: drawer });
    expect(document.activeElement).toBe(slab);
    // The route change removes the screen too, in the same commit.
    slab.remove();
    drawer.remove();
    expect(document.activeElement).toBe(document.body);
    await Promise.resolve();
    expect(document.activeElement).toBe(first);
  });
});

describe("returnFocus reveals what it focuses", () => {
  it("scrolls a target above the viewport into view, the least it can, at once", () => {
    const { slab } = stage();
    const scroll = vi.fn();
    slab.scrollIntoView = scroll;
    box(slab, { top: -208 });
    returnFocus(slab);
    expect(document.activeElement).toBe(slab);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" });
  });

  it("scrolls a target below its scrollport (the drawer) even while it is inside the viewport", () => {
    const { drawer } = stage();
    const next = document.createElement("a");
    next.href = "#next";
    drawer.append(next);
    const scroll = vi.fn();
    next.scrollIntoView = scroll;
    box(drawer, { top: 49, height: 814, width: 560 });
    box(next, { top: 1028, height: 16 });
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(1200);
    expect(outOfView(next)).toBe(true);
    returnFocus(next);
    expect(scroll).toHaveBeenCalledTimes(1);

    box(next, { top: 823, height: 16 });
    expect(outOfView(next)).toBe(false);
  });

  it("keeps the target in view while the layout settles: a result line unfolding above it pushes it down a frame later", async () => {
    const { drawer } = stage();
    const next = document.createElement("a");
    next.href = "#next";
    drawer.append(next);
    const scroll = vi.fn();
    next.scrollIntoView = scroll;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    box(drawer, { top: 85, height: 558, width: 1036 });
    box(next, { top: 611, height: 16 });
    returnFocus(next);
    expect(document.activeElement).toBe(next);
    expect(scroll).not.toHaveBeenCalled();
    // The answer's result line unfolds above Next: 58 px lower, under the drawer's fold.
    box(next, { top: 669, height: 16 });
    await frames(2);
    expect(scroll).toHaveBeenCalledWith({ block: "nearest", inline: "nearest", behavior: "instant" });
  });

  it("stops keeping it in view once the person scrolls on their own", async () => {
    const { drawer } = stage();
    const next = document.createElement("a");
    next.href = "#next";
    drawer.append(next);
    const scroll = vi.fn();
    next.scrollIntoView = scroll;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    box(drawer, { top: 85, height: 558, width: 1036 });
    box(next, { top: 611, height: 16 });
    returnFocus(next);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120 }));
    box(next, { top: 900, height: 16 });
    await frames(3);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("a grid cell under the grid's sticky totals row is unseen, and scrolls clear of it", () => {
    // AG Grid 35 draws its pinned rows sticky inside the scrolling viewport: M-007's cell scrolled to the
    // viewport's bottom edge sits under the totals row (WCAG 2.4.11), though it is inside the scrollport.
    document.body.innerHTML = `
      <main id="fsc-main" tabindex="-1">
        <div class="ag-grid-viewport" style="overflow: auto">
          <div class="ag-row" row-id="M-007"><div class="ag-cell" col-id="member" tabindex="-1">M-007</div></div>
          <div class="ag-grid-pinned-bottom-rows" style="position: sticky; bottom: 0px">Totals</div>
        </div>
      </main>`;
    const viewport = document.querySelector<HTMLElement>(".ag-grid-viewport") as HTMLElement;
    const totals = document.querySelector<HTMLElement>(".ag-grid-pinned-bottom-rows") as HTMLElement;
    const cell = document.querySelector<HTMLElement>(".ag-cell") as HTMLElement;
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
    box(viewport, { top: 268, height: 358, width: 910 });
    box(totals, { top: 585, height: 41, width: 910 });
    box(cell, { top: 587, height: 39, width: 200 });
    let scrollTop = 39;
    Object.defineProperty(viewport, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    cell.scrollIntoView = vi.fn();
    expect(outOfView(cell)).toBe(true);
    returnFocus(cell);
    expect(document.activeElement).toBe(cell);
    // It scrolls on by what the totals row covers (626 - 585 = 41 px), no more.
    expect(scrollTop).toBe(39 + 41);
  });

  it("leaves a target in view where it is", () => {
    const { slab } = stage();
    const scroll = vi.fn();
    slab.scrollIntoView = scroll;
    box(slab, { top: 400 });
    returnFocus(slab);
    expect(scroll).not.toHaveBeenCalled();
  });

  it("focusAndReveal says when a browser refused the focus, and scrolls nothing then", () => {
    const { slab } = stage();
    const scroll = vi.fn();
    slab.scrollIntoView = scroll;
    box(slab, { top: -100 });
    vi.spyOn(slab, "focus").mockImplementation(() => undefined);
    expect(focusAndReveal(slab)).toBe(false);
    expect(scroll).not.toHaveBeenCalled();
  });
});

describe("useFocusAfterRemoval", () => {
  it("hands focus on in the commit that removed the focused control, not a task later", () => {
    function Card() {
      const [root, setRoot] = useState<HTMLElement | null>(null);
      const [decided, setDecided] = useState(false);
      useFocusAfterRemoval(root, () => root?.querySelector<HTMLElement>("[data-focus-after]") ?? null);
      return (
        <section ref={setRoot}>
          {decided ? (
            <a href="#next" data-focus-after="" data-testid="next">
              Next: hold H2
            </a>
          ) : (
            <button type="button" data-testid="decide" onClick={() => setDecided(true)}>
              Count it once
            </button>
          )}
        </section>
      );
    }
    const view = render(<Card />);
    const decide = view.getByTestId("decide");
    decide.focus();
    act(() => {
      decide.click();
    });
    // No await: the commit's own layout effect moved it.
    expect(document.activeElement).toBe(view.getByTestId("next"));
  });
});

describe("focusInto", () => {
  /** A console with a slab, a live control outside it (the ribbon's lane), and a panel whose tab refuses focus. */
  function scene() {
    document.body.innerHTML = `
      <div id="console"><button id="slab">Approve</button></div>
      <button id="lane">Phone</button>
      <div id="panel"><button id="tab">Chair</button></div>`;
    const get = (id: string) => document.getElementById(id) as HTMLElement;
    const tab = get("tab");
    const state = { rendered: false };
    const focus = HTMLElement.prototype.focus;
    vi.spyOn(tab, "focus").mockImplementation(function (this: HTMLElement, options?: FocusOptions) {
      if (state.rendered) focus.call(this, options);
    });
    /** The browser's focus fixup: the console goes inert, and the control it held loses focus to <body>. */
    const consoleGoesInert = () => {
      get("console").setAttribute("inert", "");
      get("slab").blur();
    };
    return { slab: get("slab"), lane: get("lane"), panel: get("panel"), tab, state, consoleGoesInert };
  }

  it("moves focus into the container at once when its target can take it", () => {
    const { slab, panel, tab, state } = scene();
    state.rendered = true;
    slab.focus();
    focusInto(panel, () => tab);
    expect(document.activeElement).toBe(tab);
  });

  it("refused at first, it tries again each frame while focus is lost, and lands once the target renders", async () => {
    const { slab, panel, tab, state, consoleGoesInert } = scene();
    slab.focus();
    focusInto(panel, () => tab);
    expect(document.activeElement).toBe(slab);
    consoleGoesInert();
    await frames(3);
    expect(document.activeElement).toBe(document.body);
    state.rendered = true;
    await frames(3);
    expect(document.activeElement).toBe(tab);
  });

  it("keeps trying while focus is still on the live control it was on at the call (the ribbon's lane)", async () => {
    const { lane, panel, tab, state } = scene();
    lane.focus();
    focusInto(panel, () => tab);
    await frames(2);
    expect(document.activeElement).toBe(lane);
    state.rendered = true;
    await frames(3);
    expect(document.activeElement).toBe(tab);
  });

  it("leaves alone a focus the person moved somewhere live meanwhile", async () => {
    const { slab, lane, panel, tab, state, consoleGoesInert } = scene();
    slab.focus();
    focusInto(panel, () => tab);
    consoleGoesInert();
    lane.focus();
    state.rendered = true;
    await frames(3);
    expect(document.activeElement).toBe(lane);
  });

  it("gives up after its patience, and its cancel stops it at once", async () => {
    const late = scene();
    late.slab.focus();
    focusInto(late.panel, () => late.tab, 30);
    late.consoleGoesInert();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await frames(2);
    late.state.rendered = true;
    await frames(3);
    expect(document.activeElement).toBe(document.body);

    const cancelled = scene();
    cancelled.slab.focus();
    const cancel = focusInto(cancelled.panel, () => cancelled.tab);
    cancelled.consoleGoesInert();
    cancel();
    cancelled.state.rendered = true;
    await frames(3);
    expect(document.activeElement).toBe(document.body);
  });
});
