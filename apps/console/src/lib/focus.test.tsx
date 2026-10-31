// lib/focus.ts, the console's one focus helper (WCAG 2.4.3, 2.4.7, 2.4.11).
// returnFocus: hands focus back when it is lost, to the opener or its successor by stable key (a redrawn row),
// else the screen's main control, and #fsc-main only when the screen has no control; never to <body>, never to
// anything inside what is going away; and a target outside the viewport or its scrollport is scrolled into view
// the least it can, at once. useFocusAfterRemoval: a control the answer removed hands focus on in that commit, to
// its successor by key first. useFocusOnLeave: what goes hands focus on before its DOM goes. useFocusGuard: the
// root's backstop, so whatever takes the focused control away (a route change, a control nobody hands on from)
// leaves focus on its successor, the nearest control that stayed, or the screen's, before anything paints.
// registerScreenControl takes a getter, never stale. focusInto: focus moves into a container that has just gone
// live (the phone raised over the scrim), and keeps trying each frame while a browser refuses it.

import { act, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusAcrossRemoval } from "../test/focus.js";
import {
  focusAndReveal,
  focusInto,
  focusKey,
  outOfView,
  registerScreenControl,
  rememberFocus,
  returnFocus,
  useFocusAfterRemoval,
  useFocusGuard,
  useFocusOnLeave,
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

  it("a target under a floating chip (the sound offer) is covered, and its scrollport scrolls it clear", () => {
    // Below 1280 px the drawer is full width and the one-time sound offer floats over its lower left: Next, given
    // focus by Count it once, sat under it (WCAG 2.4.11).
    const { drawer } = stage();
    const next = document.createElement("a");
    next.href = "#next";
    drawer.append(next);
    const offer = document.createElement("section");
    offer.className = "fsc-offer";
    document.body.append(offer);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(956);
    box(drawer, { top: 85, height: 758, width: 1036, left: 64 });
    box(offer, { top: 760, height: 48, width: 320, left: 88 });
    box(next, { top: 770, height: 16, width: 86, left: 104 });
    let scrollTop = 400;
    Object.defineProperty(drawer, "scrollTop", {
      configurable: true,
      get: () => scrollTop,
      set: (v: number) => {
        scrollTop = v;
      },
    });
    next.scrollIntoView = vi.fn();
    expect(outOfView(next)).toBe(true);
    returnFocus(next);
    // Up by what the chip covers below Next's top: 786 - 760 = 26 px.
    expect(scrollTop).toBe(400 + 26);
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

describe("registerScreenControl", () => {
  it("takes a getter, so the control the screen drew again (a slab remounted at rest) stays its main control", () => {
    const { slab, first } = stage();
    let current: HTMLElement = slab;
    const unregister = registerScreenControl(() => current);
    try {
      current = redraw(slab);
      first.focus();
      first.remove();
      returnFocus(null);
      // Not the screen's first control, and not the element the step registered before it was drawn again.
      expect(document.activeElement).toBe(current);
      expect(slab.isConnected).toBe(false);
    } finally {
      unregister();
    }
  });
});

describe("useFocusAfterRemoval tries the removed control's successor first", () => {
  it("a slab remounted under a new key takes the focus the spent one held, before the target given", () => {
    function Press() {
      const [root, setRoot] = useState<HTMLElement | null>(null);
      const [attempt, setAttempt] = useState(0);
      useFocusAfterRemoval(root, () => root?.querySelector<HTMLElement>('[data-testid="other"]') ?? null);
      return (
        <section ref={setRoot}>
          <button key={attempt} type="button" data-testid="slab" onClick={() => setAttempt((a) => a + 1)}>
            Mark Lantern Bay's payment received
          </button>
          <button type="button" data-testid="other">
            Open the rate card
          </button>
        </section>
      );
    }
    const view = render(<Press />);
    const spent = view.getByTestId("slab");
    spent.focus();
    act(() => {
      spent.click();
    });
    expect(spent.isConnected).toBe(false);
    expect(document.activeElement).toBe(view.getByTestId("slab"));
  });
});

describe("useFocusOnLeave", () => {
  function Scrim({ onPress }: { readonly onPress: () => void }) {
    const ref = useRef<HTMLButtonElement>(null);
    useFocusOnLeave(ref, () => document.querySelector<HTMLElement>('[data-testid="tab.member"]'));
    return (
      <button ref={ref} type="button" data-testid="scrim" onClick={onPress}>
        Use the phone
      </button>
    );
  }
  function Dock() {
    const [raised, setRaised] = useState(false);
    return (
      <div>
        <button type="button" role="tab" data-testid="tab.member">
          Member
        </button>
        {!raised && <Scrim onPress={() => setRaised(true)} />}
      </div>
    );
  }

  it("hands focus on in the layout cleanup of what goes: in the commit, before its DOM is taken away", async () => {
    const view = render(<Dock />);
    const scrim = view.getByTestId("scrim");
    const sampled = focusAcrossRemoval("scrim");
    try {
      scrim.focus();
      act(() => {
        scrim.click();
      });
      await sampled.frame();
      const tab = view.getByTestId("tab.member");
      expect(sampled.removals()).toBe(1);
      // Right after removeChild, then on the next frame: the tab, never <body>.
      expect(sampled.samples).toEqual([tab, tab]);
      expect(sampled.settled).toEqual([tab]);
    } finally {
      sampled.restore();
    }
  });

  it("leaves alone a focus that was somewhere else when it goes", () => {
    const view = render(
      <>
        <button type="button" data-testid="elsewhere">
          What's real
        </button>
        <Dock />
      </>,
    );
    const elsewhere = view.getByTestId("elsewhere");
    elsewhere.focus();
    act(() => {
      view.getByTestId("scrim").click();
    });
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe("useFocusGuard, the root's backstop", () => {
  function Guard() {
    useFocusGuard();
    return null;
  }

  /** Two screens in one <main>: a link on the first replaces it with the second (a route change), nothing more. */
  function Screens() {
    const [at, setAt] = useState<"approve" | "fanout">("approve");
    return (
      <>
        <Guard />
        <header>
          <button type="button" data-testid="whatsReal">
            What's real
          </button>
        </header>
        <main id="fsc-main" tabIndex={-1}>
          {at === "approve" ? (
            <section key="approve">
              <a
                href="/runs/2026A-r37/fanout"
                data-testid="fanout"
                onClick={(event) => {
                  event.preventDefault();
                  setAt("fanout");
                }}
              >
                see the fan-out
              </a>
            </section>
          ) : (
            <section key="fanout">
              <h1>The fan-out</h1>
              <button type="button" data-testid="payCash">
                Pay in cash
              </button>
            </section>
          )}
        </main>
      </>
    );
  }

  it("a control a commit takes away, that nothing hands on (a route change), gives focus to the new screen's control before anything paints", async () => {
    const view = render(<Screens />);
    const link = view.getByTestId("fanout");
    link.focus();
    const sampled = focusAcrossRemoval("fanout");
    try {
      act(() => {
        link.click();
      });
      await sampled.frame();
      const payCash = view.getByTestId("payCash");
      expect(sampled.removals()).toBe(1);
      expect(sampled.settled).toEqual([payCash]);
      expect(sampled.samples.slice(1)).toEqual([payCash]);
    } finally {
      sampled.restore();
    }
  });

  it("a control drawn again (the same key) takes its focus back, not the screen's first control", async () => {
    function Redrawn() {
      const [n, setN] = useState(0);
      return (
        <>
          <Guard />
          <main id="fsc-main" tabIndex={-1}>
            <button type="button" data-testid="first">
              Open hold H1
            </button>
            <button key={n} type="button" data-testid="slab" onClick={() => setN((x) => x + 1)}>
              Pay in cash
            </button>
          </main>
        </>
      );
    }
    const view = render(<Redrawn />);
    const slab = view.getByTestId("slab");
    slab.focus();
    act(() => {
      slab.click();
    });
    await frames(1);
    expect(slab.isConnected).toBe(false);
    expect(document.activeElement).toBe(view.getByTestId("slab"));
  });

  it("inside the screen, the nearest container that stayed hands focus to its first control", async () => {
    function Entry() {
      const [done, setDone] = useState(false);
      return (
        <>
          <Guard />
          <main id="fsc-main" tabIndex={-1}>
            <a href="#season" data-testid="season">
              Season 2026-A
            </a>
            <section data-testid="entry">
              {done ? (
                <p>
                  Entered by Analyn.{" "}
                  <a href="#next" data-testid="next">
                    Decide the holds
                  </a>
                </p>
              ) : (
                <input data-testid="field" onKeyDown={(event) => event.key === "Enter" && setDone(true)} />
              )}
            </section>
          </main>
        </>
      );
    }
    const view = render(<Entry />);
    const field = view.getByTestId("field");
    field.focus();
    act(() => {
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await frames(1);
    expect(field.isConnected).toBe(false);
    expect(document.activeElement).toBe(view.getByTestId("next"));
  });

  it("outside the screen (the stage's bar), a control that goes hands focus to the screen's main control", async () => {
    function Bar() {
      const [canReset, setCanReset] = useState(true);
      return (
        <>
          <Guard />
          <header>
            {canReset && (
              <button type="button" data-testid="reset" onClick={() => setCanReset(false)}>
                Reset
              </button>
            )}
          </header>
          <main id="fsc-main" tabIndex={-1}>
            <a href="#card" data-testid="card">
              Open the rate card
            </a>
            <button type="button" data-testid="press">
              Mark Lantern Bay's payment received
            </button>
          </main>
        </>
      );
    }
    const view = render(<Bar />);
    const press = view.getByTestId("press");
    const unregister = registerScreenControl(() => press);
    try {
      const reset = view.getByTestId("reset");
      reset.focus();
      act(() => {
        reset.click();
      });
      await frames(1);
      expect(document.activeElement).toBe(press);
    } finally {
      unregister();
    }
  });

  it("a focused control the browser stops letting take focus (turned disabled) hands focus on too", async () => {
    const view = render(<Screens />);
    const whatsReal = view.getByTestId("whatsReal") as HTMLButtonElement;
    whatsReal.focus();
    // A browser's focus fixup: the control turns disabled, and focus leaves it for <body> with nowhere to go (jsdom
    // blurs no disabled control, so the blur comes first here, in the same task).
    whatsReal.blur();
    whatsReal.disabled = true;
    await frames(1);
    expect(document.activeElement).toBe(view.getByTestId("fanout"));
  });

  it("leaves alone a focus the person let go to <body> (a press on the page), even when that control goes later", async () => {
    const view = render(<Screens />);
    const link = view.getByTestId("fanout");
    link.focus();
    link.blur();
    expect(document.activeElement).toBe(document.body);
    // Later (another task): the route changes on its own while focus is still where the person left it.
    await frames(1);
    act(() => {
      link.click();
    });
    await frames(1);
    expect(document.activeElement).toBe(document.body);
  });
});
