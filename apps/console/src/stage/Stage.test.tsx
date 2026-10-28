// The Judge stage end to end against the mock world: the first view makes no calls; the first press starts a
// session and the run's SSE stream drives every state after it (motion is evidence: nothing moves on a timer);
// the run pill names the next step; What's real, sound, the phone and Reset behave; each S1.6 layout holds.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";
import { resizeTo } from "../test/viewport.js";
import { frameCaption } from "./PhoneDock.js";

// These render the whole console over the mock world; on a busy machine that is slow, so they wait longer than
// the kit's defaults rather than fail on load.
configure({ asyncUtilTimeout: 6000 });

async function press(testId: string) {
  await act(async () => {
    fireEvent.keyDown(screen.getByTestId(`${testId}.face`), { key: "Enter" });
  });
}

describe("Judge stage", () => {
  it("opens on the first view with no session and no calls", async () => {
    const view = await renderConsole({ path: "/judge" });
    const callSpy = vi.spyOn(view.adapter, "call");
    const stage = screen.getByTestId("W-JG-01.stage");
    expect(stage.dataset.state).toBe("ready");
    expect(stage.dataset.layout).toBe("tab");
    expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("mark-paid");
    expect(screen.getByTestId("W-JG-01.notice").textContent).toMatch(/simulated PayPal sandbox/i);
    expect(screen.getByTestId("W-JG-01.ribbon.paypal").textContent).toMatch(/FS-2026A-r37/);
    expect(screen.getByTestId("W-JG-01.caption").textContent).toMatch(
      /Slip reading replays a recorded Claude run/,
    );
    expect(screen.queryByTestId("W-JG-01.reset")).toBeNull();
    expect(callSpy).not.toHaveBeenCalled();
    expect(view.world.run.state).toBe("INVOICED");
    expect(view.world.events()).toEqual([]);
  });

  it("the first press starts the run; the stream moves the stage, the pill and the ribbon", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    // Reading after funding is asynchronous on the server: the world plays it when the test says so.
    act(() => {
      view.world.settle();
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("by-hand"));
    expect(screen.getByTestId("W-JG-01.runPill.state").textContent).toBe("In review");
    expect(screen.getByTestId("W-JG-01.ribbon.machine").textContent).toMatch(
      /Raised by the engine|Lines computed|In review/,
    );
    expect(screen.getByTestId("W-JG-01.reset")).toBeTruthy();
    // The rest of the loop arrives the same way: by events, never by timers.
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    act(() => {
      view.world.enterByHand("64.80");
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("holds"));
    expect(screen.getByTestId("W-JG-01.runPill.next").getAttribute("href")).toBe(
      `/runs/${runSlug}/split?hold=H1`,
    );
  });

  it("the rail's next mark is the pill's: pencil while the machine reads, canary only for a person", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    const pill = () => screen.getByTestId("W-JG-01.runPill").closest("[data-actor]") as HTMLElement;
    const square = () =>
      document.querySelector<HTMLElement>('.fsc-rail__place[data-place="next"] .fsc-rail__square');
    await waitFor(() => expect(pill().dataset.actor).toBe("machine"));
    expect(square()?.dataset.actor).toBe("machine");
    act(() => {
      view.world.settle();
    });
    await waitFor(() => expect(pill().dataset.actor).toBe("person"));
    expect(square()?.dataset.actor).toBe("person");
  });

  it("the skip link moves focus to the screen without scrolling the stage, so the top bar stays in view", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470, height: 956 } });
    const main = document.getElementById("fsc-main") as HTMLElement;
    const focus = vi.spyOn(main, "focus");
    const skip = screen.getByText("Skip to the screen");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      skip.dispatchEvent(event);
    });
    // No fragment navigation (it scrolls the overflow-hidden stage by the bar's height): focus, without scrolling.
    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(main);
    // And the stage itself cannot be scrolled by script: clip, not hidden (a hidden box is still a scroller).
    const css = readFileSync(resolve(process.cwd(), "src/theme/stage.css"), "utf8");
    const stageRule = /\n\.fsc-stage \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(stageRule).toMatch(/overflow:\s*clip;/);
    // Enter on the link leaves the screen :focus-visible (the last input was a key): the landmark is the target,
    // so it draws no ring around the whole screen. jsdom matches no :focus-visible, so the rule is read and its
    // selector, without the pseudo-class, must be the screen's.
    const base = readFileSync(resolve(process.cwd(), "src/theme/base.css"), "utf8");
    const unringed = [...base.matchAll(/([^{}]+):focus-visible\s*\{([^}]*)\}/g)]
      .filter((m) => /outline:\s*none/.test(m[2] ?? ""))
      .map((m) => (m[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim());
    expect(unringed.some((selector) => main.matches(selector))).toBe(true);
  });

  it.each([
    [1024, "push-full", true],
    [1470, "push", false],
    [1920, "overlay", true],
  ])("a drawer at %i px (%s) leaves the screen it covers inert: %s", async (width, mode, inert) => {
    await renderConsole({ path: "/runs/2026A-r37/split?hold=H1", viewport: { width, height: 900 } });
    const drawer = await screen.findByTestId("W-TR-06.drawer");
    expect(drawer.dataset.mode).toBe(mode);
    const main = document.getElementById("fsc-main") as HTMLElement;
    // Tab never lands on a W-TR-05 control the drawer hides (S1.12: drawers never cover the focused element).
    expect(main.hasAttribute("inert")).toBe(inert);
    expect(main.contains(drawer)).toBe(false);
  });

  it("Reset ends the session and returns the first view", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.reset"));
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("ready"));
    expect(view.world.run.state).toBe("INVOICED");
    expect(view.world.events()).toEqual([]);
    expect(runSlug).toBe(view.world.runSlug);
    expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("mark-paid");
  });

  it("What's real separates real from simulated PayPal, and holds Try to break it", async () => {
    await renderConsole({ path: "/judge" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.whatsRealOpen"));
    });
    const sheet = await screen.findByTestId("W-JG-01.whatsReal");
    expect(sheet.dataset.rail).toBe("simulator");
    expect(within(sheet).getByText("PayPal, simulated")).toBeTruthy();
    expect(within(sheet).getByTestId("W-JG-01.tryToBreak").textContent).toMatch(/Try to break it/);
    await expectNoAxeViolations(sheet);
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId("W-JG-01.whatsReal.close"));
    });
    await waitFor(() => expect(screen.queryByTestId("W-JG-01.whatsReal")).toBeNull());
  });

  it("keeps sound off until the viewer turns it on", async () => {
    await renderConsole({ path: "/judge" });
    const toggle = screen.getByTestId("W-JG-01.sound");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      fireEvent.click(toggle);
    });
  });

  it("raises the phone from its ribbon lane and lowers it with Escape (1024–1679 px)", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470 } });
    const tab = screen.getByTestId("W-JG-01.phoneTab");
    // The collapsed phone is the ribbon's fourth lane: it never covers the screen.
    expect(screen.getByTestId("W-JG-01.ribbon").contains(tab)).toBe(true);
    expect(tab.getAttribute("aria-expanded")).toBe("false");
    expect(tab.textContent).toMatch(/Gisusi pa/);
    await act(async () => {
      fireEvent.click(tab);
    });
    expect(tab.getAttribute("aria-expanded")).toBe("true");
    // The viewer's own raise lays the scrim over the console.
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
    expect(screen.getByTestId("W-JG-01.phoneBackdrop")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });

  it("under the viewer's scrim the console is inert and focus is in the phone; lowering hands focus back", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470 } });
    const tab = screen.getByTestId("W-JG-01.phoneTab");
    const console_ = document.querySelector<HTMLElement>(".fsc-console");
    tab.focus();
    await act(async () => {
      fireEvent.click(tab);
    });
    // Nothing under the scrim takes a key (Space on the hidden approve slab would sign key 1).
    expect(console_?.hasAttribute("inert")).toBe(true);
    await waitFor(() =>
      expect(document.getElementById("fsc-phone-panel")?.contains(document.activeElement)).toBe(true),
    );
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(console_?.hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(tab));
  });

  it("a moment raises the phone beside a lit console: no scrim, both screens read at once", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1470 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    // Key 1 signs: the co-sign request raises the Chair's frame (S1.6), as a moment.
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("moment"));
    expect(screen.queryByTestId("W-JG-01.phoneBackdrop")).toBeNull();
    expect(screen.getByTestId("W-JG-01.phoneTab").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("W-JG-01.poster.chair")).toBeTruthy();
  });

  it("below 1280 px a moment's raise takes the phone over a scrim: no room to squeeze the screen beside it", async () => {
    // At 1024 px the squeeze left the screen 488 px: the approve column ran under the phone and the fan's labels
    // overlapped. Below 1280 px the moment raises the phone the way S1.6's table has it, over the scrim.
    const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.phoneTab").getAttribute("aria-expanded")).toBe("true"),
    );
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
    expect(screen.getByTestId("W-JG-01.phoneBackdrop")).toBeTruthy();
    expect(document.querySelector(".fsc-console")?.hasAttribute("inert")).toBe(true);
  });

  it("docks the phone under a scrim from 1680 px, and the scrim hands it focus", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1920, height: 1080 } });
    expect(screen.getByTestId("W-JG-01.stage").dataset.layout).toBe("dock");
    const scrim = screen.getByTestId("W-JG-01.phoneScrim");
    await act(async () => {
      fireEvent.click(scrim);
    });
    expect(screen.queryByTestId("W-JG-01.phoneScrim")).toBeNull();
    // The viewer raised it: a raise they asked for, recorded as theirs (a moment raises it as "moment").
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
  });

  it("becomes a phone visit under 1024 px, and follows the window as it resizes", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 390, height: 844 } });
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("phone-visit");
    expect(screen.getByTestId("W-JG-01.visit")).toBeTruthy();
    expect(screen.queryByTestId("W-JG-01.rail")).toBeNull();
    expect(screen.getByTestId("W-JG-01.poster.member")).toBeTruthy();
    resizeTo(1280, 800);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.layout).toBe("tab"));
    expect(screen.getByTestId("W-JG-01.rail").dataset.collapsed).toBeUndefined();
    resizeTo(1100, 800);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.rail").dataset.collapsed).toBe(""));
  });

  it("names the phone frames after their personas and opens them on the app's demo state", async () => {
    await renderConsole({ path: "/judge" });
    const frames = await screen.findAllByTestId(/^W-JG-01\.frame\.(member|chair|clerk)$/);
    expect(frames.map((f) => f.getAttribute("name"))).toEqual(["member", "chair", "clerk"]);
    expect(frames[0]?.getAttribute("src")).toBe("/app/?theme=adlaw&demo=member&stage=checking");
    expect(frames.every((f) => f.getAttribute("referrerpolicy") === "no-referrer")).toBe(true);
  });

  it("the caption under the phone says what the frame shows: 'running here' only once the app answers", async () => {
    await renderConsole({ path: "/judge" });
    // jsdom's frames never answer fs.ready: the frame shows the preview, and the caption must not claim the app.
    const caption = () => screen.getByTestId("W-JG-01.frame").querySelector("figcaption")?.textContent ?? "";
    await waitFor(() =>
      expect(caption()).toBe("A preview drawn from the run, until the app's web build answers."),
    );
    expect(caption()).not.toMatch(/running here/);
    expect(frameCaption("stub", false, "app")).toBe("A development stand-in, not the app.");
    expect(frameCaption("waiting", true, "app")).toMatch(/isn't running here/);
    expect(frameCaption("app", true, "The app's web build, running here.")).toBe(
      "The app's web build, running here.",
    );
  });

  it("has no axe violations in the first view or in a session", async () => {
    const view = await renderConsole({ path: "/judge" });
    await expectNoAxeViolations(view.container);
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    await expectNoAxeViolations(view.container);
  });

  it("reduced motion keeps every state: the stage still moves on events", async () => {
    const view = await renderConsole({ path: "/judge", motion: "reduced" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("reading"));
    act(() => {
      view.world.settle();
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("by-hand"));
  });
});
