// focusInto: focus moves into a container that has just gone live (the phone raised over the scrim), and keeps
// trying each frame while a browser refuses it (a control it does not render yet) and focus is lost, never
// leaving it on <body> (WCAG 2.4.3). jsdom refuses no focus, so each test's target refuses until it says so.
// focusBack: the phone lowered from over the scrim hands focus back to what raised it, or to the screen when
// nothing did (MM-1 raises it while focus is on <body>), never leaving it on the panel going inert.

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusBack, focusInto } from "./focus.js";

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

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("focusInto", () => {
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

/** The phone just lowered: its panel went inert in that commit, and the console under the scrim is live again. */
function lowered() {
  document.body.innerHTML = `
    <div id="console">
      <main id="main" tabindex="-1"><button id="slab">Approve</button></main>
      <aside id="drawer" tabindex="-1">Hold H1</aside>
    </div>
    <button id="lane">Phone</button>
    <div id="panel"><button id="tab">Member</button></div>`;
  const get = (id: string) => document.getElementById(id) as HTMLElement;
  get("tab").focus();
  get("panel").setAttribute("inert", "");
  return { main: get("main"), slab: get("slab"), drawer: get("drawer"), lane: get("lane"), tab: get("tab") };
}

describe("focusBack", () => {
  it("hands focus back to what raised the phone when it is still there and live", () => {
    const { main, slab } = lowered();
    focusBack(slab, () => main);
    expect(document.activeElement).toBe(slab);
  });

  it("with no opener, takes focus off the control the commit made inert (a browser drops it to <body>) to the fallback", () => {
    const { main, tab } = lowered();
    expect(document.activeElement).toBe(tab);
    focusBack(null, () => main);
    expect(document.activeElement).toBe(main);
  });

  it("with the opener gone or inert, and focus already on <body>, focuses the fallback", () => {
    const gone = lowered();
    const removed = gone.slab;
    removed.remove();
    gone.tab.blur();
    expect(document.activeElement).toBe(document.body);
    focusBack(removed, () => gone.main);
    expect(document.activeElement).toBe(gone.main);

    const covered = lowered();
    covered.main.setAttribute("inert", "");
    focusBack(
      covered.slab,
      () => covered.main,
      () => covered.drawer,
    );
    expect(document.activeElement).toBe(covered.drawer);
  });

  it("never focuses an inert fallback: it tries the next one", () => {
    const { main, drawer } = lowered();
    main.setAttribute("inert", "");
    const focus = vi.spyOn(main, "focus");
    focusBack(
      null,
      () => main,
      () => drawer,
    );
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(drawer);
  });

  it("leaves alone a focus the person moved somewhere live (the ribbon's lane)", () => {
    const { main, lane } = lowered();
    lane.focus();
    focusBack(null, () => main);
    expect(document.activeElement).toBe(lane);
  });
});
