// The Judge stage end to end against the mock world: the first view makes no calls; the first press starts a
// session and the run's SSE stream drives every state after it (motion is evidence: nothing moves on a timer);
// the run pill names the next step; What's real, sound, the phone and Reset behave; each S1.6 layout holds.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";
import { recordRequests } from "../test/requests.js";
import { timersBeforeCommit } from "../test/timers.js";
import { resizeTo } from "../test/viewport.js";
import { createTestWorld } from "../test/world.js";
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

  it("after Reset on /judge the first press is pressable again: a second press starts a second session", async () => {
    const log = recordRequests();
    const view = await renderConsole({ path: "/judge", handlers: [log.handler] });
    const starts = () =>
      log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions").length;
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    expect(starts()).toBe(1);
    // The press is over (the payment is recorded and the run funded): the slab is spent, drawn committed.
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.reset"));
    });
    await waitFor(() => expect(stage.dataset.state).toBe("ready"));
    expect(view.router.state.location.pathname).toBe("/judge");
    // The slab is at rest, not the spent press: nothing says it can't be pressed.
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.markPaid.face").getAttribute("aria-disabled")).not.toBe("true"),
    );
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(starts()).toBe(2));
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
  });

  it("after a session ends on /judge (a renewal that lands elsewhere), a press starts a fresh session", async () => {
    const world = createTestWorld();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions", async ({ request }) => {
      starts += 1;
      if (starts !== 2) return undefined;
      const answer = await getResponse([...world.mock.handlers], request.clone());
      if (!answer?.ok) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          ...body,
          workspaceId: "019a0000-0000-7000-8000-00000000beef",
          runId: "019a0000-0000-7000-8000-00000000cafe",
          runSlug: "2026A-r38",
          consoleToken: "fst_another-workspace",
        },
        { status: answer.status, headers: answer.headers },
      );
    });
    const view = await renderConsole({ path: "/judge", world, handlers: [elsewhere] });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    await act(async () => {
      await view.runtime.session.renew();
    });
    expect(starts).toBe(2);
    await waitFor(() => expect(stage.dataset.state).toBe("session-ended"));
    // The notice says the stage is back at the first press: the stage still reads it, and the press works.
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
    expect(view.router.state.location.pathname).toBe("/judge");
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.markPaid.face").getAttribute("aria-disabled")).not.toBe("true"),
    );
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(starts).toBe(3));
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
  });

  it("a renewal that lands in another workspace ends the session and takes the stage back to /judge", async () => {
    // A Reset in another tab ended this session's workspace: fs-api answers the cookie's renewal with a fresh
    // workspace and run under the same session ID.
    const world = createTestWorld();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions", async ({ request }) => {
      starts += 1;
      if (starts === 1) return undefined;
      const answer = await getResponse([...world.mock.handlers], request.clone());
      if (!answer?.ok) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          ...body,
          workspaceId: "019a0000-0000-7000-8000-00000000beef",
          runId: "019a0000-0000-7000-8000-00000000cafe",
          runSlug: "2026A-r38",
          consoleToken: "fst_another-workspace",
        },
        { status: answer.status, headers: answer.headers },
      );
    });
    const view = await renderConsole({ path: "/judge", world, handlers: [elsewhere] });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    await view.navigate(`/runs/${runSlug}/split`);
    expect(view.router.state.location.pathname).toBe(`/runs/${runSlug}/split`);

    await act(async () => {
      await view.runtime.session.renew();
    });
    expect(starts).toBe(2);
    // The notice says the stage is back at the first press, and it is: /judge, with the first view's next step.
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/judge"));
    expect(stage.dataset.state).toBe("session-ended");
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("mark-paid"));
    expect(screen.queryByTestId("W-JG-01.reset")).toBeNull();
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

  it("the co-sign's raise over the scrim puts focus on the Chair's tab, the frame the phone now shows", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    (document.getElementById("fsc-main") as HTMLElement).focus();
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    const chair = screen.getByTestId("W-JG-01.tab.chair");
    await waitFor(() => expect(chair.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(chair));
  });

  it("a co-sign request while the phone is already up over the scrim moves focus from the Member tab to the Chair's", async () => {
    // The judge raised the phone from its ribbon lane (focus went to the Member tab, the frame it showed), and key 1
    // is signed meanwhile: the co-sign request switches the phone to the Chair's frame. Focus follows it to the
    // Chair's tab, not left on the Member tab of a frame the phone no longer shows.
    const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    const stage = screen.getByTestId("W-JG-01.stage");
    const lane = screen.getByTestId("W-JG-01.phoneTab");
    lane.focus();
    await act(async () => {
      fireEvent.click(lane);
    });
    await waitFor(() => expect(stage.dataset.raised).toBe("user"));
    const member = screen.getByTestId("W-JG-01.tab.member");
    await waitFor(() => expect(document.activeElement).toBe(member));
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    const chair = screen.getByTestId("W-JG-01.tab.chair");
    await waitFor(() => expect(chair.getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(document.activeElement).toBe(chair));
  });

  it.each(["full", "reduced"] as const)(
    "a raise over the scrim takes focus into the phone once the panel can take it, never leaving it on <body> (%s motion)",
    async (motion) => {
      // Key 1 (the treasurer's held Space on the approve slab) raises the Chair over the scrim below 1280 px: the
      // console goes inert under the focused slab, and a browser drops that focus to <body>. A panel it does not
      // render yet (visibility: hidden while a transition's delay runs) refuses the focus without a word, so Stage
      // must try again once it renders, not once and give up (WCAG 2.4.3). jsdom renders nothing and refuses
      // nothing: the spy refuses what a browser would, and the panel "renders" when the test says so.
      const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 }, motion });
      await press("W-JG-01.markPaid");
      await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
      const console_ = document.querySelector<HTMLElement>(".fsc-console");
      (document.getElementById("fsc-main") as HTMLElement).focus();

      let panelRendered = false;
      const focus = HTMLElement.prototype.focus;
      const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
        this: HTMLElement,
        options?: FocusOptions,
      ) {
        if (this.closest("[inert]")) return;
        if (!panelRendered && this.closest("#fsc-phone-panel")) return;
        focus.call(this, options);
      });
      try {
        act(() => {
          view.world.settle();
          view.world.resolveAll();
          view.world.sign("treasurer");
        });
        await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(true));
        // The browser's focus fixup: the inert console's focused control loses focus to <body>.
        const held = document.activeElement;
        if (held instanceof HTMLElement && held.closest("[inert]")) held.blur();
        expect(document.activeElement).toBe(document.body);
        // The panel's transition delay is over: it renders, and focus goes to the frame it shows.
        panelRendered = true;
        const chair = screen.getByTestId("W-JG-01.tab.chair");
        await waitFor(() => expect(document.activeElement).toBe(chair));
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("lowering a phone raised over the scrim focuses what raised it once the console is live, even when timers beat React's commit", async () => {
    // Below 1280 px the moment's raise lays the scrim over a console control that held focus. Lowering must hand
    // focus back to it after the commit that lifts the console's inert (a browser refuses focus to an inert
    // control, and the phone's panel goes inert in that same commit, so focus would fall to <body>, WCAG 2.4.3).
    const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    const console_ = document.querySelector<HTMLElement>(".fsc-console");
    const opener = document.getElementById("fsc-main") as HTMLElement;
    opener.focus();
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(true));
    await waitFor(() =>
      expect(document.getElementById("fsc-phone-panel")?.contains(document.activeElement)).toBe(true),
    );

    // jsdom focuses an inert control anyway: record, for every focus, whether the browser would have refused it.
    const focus = HTMLElement.prototype.focus;
    const refused: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.closest("[inert]")) refused.push(this.id || this.dataset.testid || this.tagName);
      focus.call(this, options);
    });
    const restoreTimers = timersBeforeCommit();
    try {
      await act(async () => {
        fireEvent.keyDown(document.body, { key: "Escape" });
      });
      await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(false));
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      restoreTimers();
      spy.mockRestore();
    }
    expect(refused).toEqual([]);
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined();
  });

  it.each(["full", "reduced"] as const)(
    "MM-1's raise over the scrim from <body> lowers with Escape to the screen, never leaving focus on <body> (%s motion)",
    async (motion) => {
      // On the real path the judge follows W-TR-07's "fan-out" link: the route change removes it, and focus falls
      // to <body>. M-014's payment lands, MM-1 raises the phone over the scrim (below 1280 px) and focus moves into
      // it, with nothing to hand it back to. Lowering makes the panel inert, and a browser drops the focus it held
      // to <body> (WCAG 2.4.3): it must go to the screen's main control instead, never the screen itself.
      const view = await renderConsole({ path: "/judge", viewport: { width: 1100, height: 800 }, motion });
      await press("W-JG-01.markPaid");
      await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
      const stage = screen.getByTestId("W-JG-01.stage");
      const console_ = document.querySelector<HTMLElement>(".fsc-console");
      const panel = document.getElementById("fsc-phone-panel") as HTMLElement;
      const main = document.getElementById("fsc-main") as HTMLElement;
      // Key 1 raises the Chair; the judge lowers it and the Chair co-signs.
      act(() => {
        view.world.settle();
        view.world.resolveAll();
        view.world.sign("treasurer");
      });
      await waitFor(() => expect(stage.dataset.raised).toBe("user"));
      await act(async () => {
        fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
      });
      await waitFor(() => expect(stage.dataset.raised).toBeUndefined());
      // The followed link is gone: focus is on <body> when M-014's payment lands.
      (document.activeElement as HTMLElement | null)?.blur();
      expect(document.activeElement).toBe(document.body);
      act(() => {
        view.world.cosign();
      });
      await waitFor(() => expect(stage.dataset.raised).toBe("user"));
      await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(true));
      await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
      expect(screen.getByTestId("W-JG-01.tab.member").getAttribute("aria-selected")).toBe("true");

      const focus = HTMLElement.prototype.focus;
      const refused: string[] = [];
      const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
        this: HTMLElement,
        options?: FocusOptions,
      ) {
        if (this.closest("[inert]")) {
          refused.push(this.id || this.dataset.testid || this.tagName);
          return;
        }
        focus.call(this, options);
      });
      try {
        await act(async () => {
          fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
        });
        expect(stage.dataset.raised).toBeUndefined();
        expect(panel.hasAttribute("inert")).toBe(true);
        // The browser's focus fixup: a control under the now-inert panel loses focus to <body>.
        const held = document.activeElement;
        if (held instanceof HTMLElement && held.closest("[inert]")) held.blur();
        // The screen's main control: a control in the screen, never the screen itself while it has one.
        const landed = document.activeElement;
        expect(landed).not.toBe(document.body);
        expect(landed).not.toBe(main);
        expect(main.contains(landed)).toBe(true);
        expect(landed?.matches("a[href], button, input, [tabindex]")).toBe(true);
      } finally {
        spy.mockRestore();
      }
      expect(refused).toEqual([]);
    },
  );

  it("an ended session lowers a phone raised over the scrim and keeps focus off <body>, even when timers beat React's commit", async () => {
    // The session ends from an effect (a renewal that landed in another workspace), not from a key or a press: its
    // lowering commits at default priority, after a zero-delay timer can fire. Focus goes back to what raised the
    // phone only once the console is live again, never to an inert control (a browser refuses it).
    const world = createTestWorld();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions", async ({ request }) => {
      starts += 1;
      if (starts === 1) return undefined;
      const answer = await getResponse([...world.mock.handlers], request.clone());
      if (!answer?.ok) return answer;
      const body = (await answer.json()) as Record<string, unknown>;
      return HttpResponse.json(
        {
          ...body,
          workspaceId: "019a0000-0000-7000-8000-00000000beef",
          runId: "019a0000-0000-7000-8000-00000000cafe",
          runSlug: "2026A-r38",
          consoleToken: "fst_another-workspace",
        },
        { status: answer.status, headers: answer.headers },
      );
    });
    const view = await renderConsole({
      path: "/judge",
      viewport: { width: 1100, height: 800 },
      world,
      handlers: [elsewhere],
    });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    const console_ = document.querySelector<HTMLElement>(".fsc-console");
    const opener = document.getElementById("fsc-main") as HTMLElement;
    opener.focus();
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(true));

    const focus = HTMLElement.prototype.focus;
    const refused: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (
      this: HTMLElement,
      options?: FocusOptions,
    ) {
      if (this.closest("[inert]")) refused.push(this.id || this.dataset.testid || this.tagName);
      focus.call(this, options);
    });
    const restoreTimers = timersBeforeCommit();
    try {
      // Outside act(): React schedules the ended session's commits as a browser would, not in one synchronous flush.
      const renewed = view.runtime.session.renew();
      await waitFor(() => expect(view.router.state.location.pathname).toBe("/judge"));
      await renewed;
      await waitFor(() => expect(console_?.hasAttribute("inert")).toBe(false));
      await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    } finally {
      restoreTimers();
      spy.mockRestore();
    }
    expect(starts).toBe(2);
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session-ended");
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined();
    expect(refused).toEqual([]);
    expect(console_?.contains(document.activeElement)).toBe(true);
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
