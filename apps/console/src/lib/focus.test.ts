// focusInto: focus moves into a container that has just gone live (the phone raised over the scrim), and keeps
// trying each frame while a browser refuses it (a control it does not render yet) and focus is lost, never
// leaving it on <body> (WCAG 2.4.3). jsdom refuses no focus, so each test's target refuses until it says so.

import { afterEach, describe, expect, it, vi } from "vitest";
import { focusInto } from "./focus.js";

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
