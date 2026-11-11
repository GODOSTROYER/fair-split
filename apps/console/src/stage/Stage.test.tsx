// The Judge stage end to end against the mock world: the first view makes no calls; the first press starts a
// session and the run's SSE stream drives every state after it (motion is evidence: nothing moves on a timer);
// the run pill names the next step; What's real, sound, the phone and Reset behave; each S1.6 layout holds.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { getResponse, HttpResponse, http } from "msw";
import { describe, expect, it, vi } from "vitest";
import { screenControl } from "../lib/focus.js";
import { developerWords } from "../lib/plain.js";
import { expectNoAxeViolations } from "../test/axe.js";
import { focusAcrossRemoval } from "../test/focus.js";
import { renderConsole } from "../test/render.js";
import { recordRequests } from "../test/requests.js";
import { clickStageMenuItem, closeStageMenu, queryStageMenuItem, stageMenuItem } from "../test/stage-menu.js";
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
  it("keeps a viewer's raise through co-sign cues and resets to Member", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1366 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    fireEvent.click(screen.getByTestId("W-JG-01.phoneTab"));
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.tab.chair").getAttribute("aria-selected")).toBe("true"),
    );
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
    act(() => view.world.cosign());
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
    await act(async () => {
      await view.runtime.session.reset();
    });
    expect(screen.getByTestId("W-JG-01.tab.member").getAttribute("aria-selected")).toBe("true");
  });
  it("ignores unrelated frame focus until the story names that persona", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1366 } });
    const sendFocus = async () => {
      for (const persona of ["chair", "clerk"]) {
        const frame = (await screen.findByTestId(`W-JG-01.frame.${persona}`)) as HTMLIFrameElement;
        act(() =>
          window.dispatchEvent(
            new MessageEvent("message", {
              origin: window.location.origin,
              source: frame.contentWindow,
              data: { v: 1, t: "fs.focus", screenId: "M-BD-01" },
            }),
          ),
        );
        expect(screen.getByTestId("W-JG-01.tab.member").getAttribute("aria-selected")).toBe("true");
        expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined();
      }
    };
    await sendFocus();
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    await sendFocus();
    act(() => view.world.advance(1));
    await sendFocus();
    act(() => view.world.settle());
    await sendFocus();
  });

  it("lowers a moment when the next step has no persona, and resets scroll only for a pathname", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1366 } });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    act(() => {
      view.world.settle();
      view.world.resolveAll();
      view.world.sign("treasurer");
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("moment"));
    act(() => view.world.cosign());
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined());
    const slug = view.runtime.session.getState().session?.runSlug ?? "";
    await view.navigate(`/runs/${slug}/split`);
    const main = document.getElementById("fsc-main") as HTMLElement;
    main.scrollTop = 400;
    await view.navigate(`/runs/${slug}/approve`);
    expect(main.scrollTop).toBe(0);
    await view.navigate(`/runs/${slug}/split?hold=H1`);
    main.scrollTop = 400;
    await view.navigate(`/runs/${slug}/split?hold=H2`);
    expect(main.scrollTop).toBe(400);
  });

  it("opens on the first view with no session and no calls", async () => {
    const view = await renderConsole({ path: "/judge" });
    const callSpy = vi.spyOn(view.adapter, "call");
    const stage = screen.getByTestId("W-JG-01.stage");
    expect(stage.dataset.state).toBe("ready");
    // The test window is 1470 px wide: the phone has its column, folded to its rail (round 3), and the rail keeps
    // its labels; "Fair Split" leads the bar.
    expect(stage.dataset.layout).toBe("dock");
    expect(stage.dataset.phone).toBe("folded");
    expect(stage.dataset.rail).toBe("full");
    expect(screen.getByTestId("W-JG-01.bar").textContent).toMatch(/^Fair Split/);
    // No ribbon: the first view's seeded history is in the Log, newest first.
    expect(screen.queryByTestId("W-JG-01.ribbon")).toBeNull();
    expect(screen.queryByTestId("W-JG-01.toast")).toBeNull();
    expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("mark-paid");
    expect(screen.getByTestId("W-JG-01.notice").textContent).toBe("Simulated PayPal sandbox");
    // No session yet: the chevron's menu offers no Reset.
    expect(await queryStageMenuItem("W-JG-01.reset")).toBeNull();
    await clickStageMenuItem("W-JG-01.logOpen");
    const log = await screen.findByTestId("W-JG-01.log");
    expect(log.textContent).toMatch(/\d\d:\d\d:\d\d PHT/);
    expect(within(log).getByTestId("W-JG-01.log.paypal").textContent).toMatch(/FS-2026A-r37/);
    // The seeded rows say the seed stand-in in their title and to assistive technology (round 5: no glyph).
    const machine = within(log).getByTestId("W-JG-01.log.machine");
    expect(machine.getAttribute("title")).toContain("Seed stand-in, not a Claude recording");
    expect(machine.querySelector("[data-fs-glyph]")).toBeNull();
    expect(machine.textContent).toMatch(/Seed stand-in, not a Claude recording/);
    expect(screen.queryByTestId("W-JG-01.caption")).toBeNull();
    expect(screen.queryByTestId("W-JG-01.reset")).toBeNull();
    expect(callSpy).not.toHaveBeenCalled();
    expect(view.world.run.state).toBe("INVOICED");
    expect(view.world.events()).toEqual([]);
  });

  it("the first press starts the run; the stream moves the stage, the pill, the toast and the Log", async () => {
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
    // Each new event toasts once, in the bar's status area; the whole timeline is behind the menu's Run log.
    expect(screen.getByTestId("W-JG-01.toast").dataset.state).toBe("in");
    await clickStageMenuItem("W-JG-01.logOpen");
    const log = await screen.findByTestId("W-JG-01.log");
    expect(
      within(log)
        .getAllByTestId("W-JG-01.log.machine")
        .some((row) =>
          /Raised by the engine|Lines computed|In review|Season check/.test(row.textContent ?? ""),
        ),
    ).toBe(true);
    await act(async () => {
      fireEvent.click(within(log).getByTestId("W-JG-01.log.close"));
    });
    expect(await stageMenuItem("W-JG-01.reset")).toBeTruthy();
    await closeStageMenu();
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
    await renderConsole({ path: "/judge", viewport: { width: 1366, height: 768 } });
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
    // An open hold (the session's H1, before anyone decides it): the drawer covers the screen with its scrim.
    const view = await renderConsole({ path: "/runs/2026A-r37/split", viewport: { width, height: 900 } });
    await view.startSession();
    act(() => {
      view.world.markPaid();
      view.world.enterByHand();
    });
    await view.navigate("/runs/2026A-r37/split?hold=H1");
    await waitFor(() => expect(screen.getByTestId("W-TR-06").dataset.state).toBe("open"));
    const drawer = await screen.findByTestId("W-TR-06.drawer");
    expect(drawer.dataset.mode).toBe(mode);
    const main = document.getElementById("fsc-main") as HTMLElement;
    // Tab never lands on a W-TR-05 control the drawer hides (S1.12: drawers never cover the focused element).
    expect(main.hasAttribute("inert")).toBe(inert);
    expect(main.contains(drawer)).toBe(false);
  });

  it("a decided hold's drawer at 1920 px is a compact card with no scrim: the screen beside it stays live", async () => {
    // UI gate round 5: the showcase's H1 is decided, so its drawer hugs the success card and lays no blocking scrim.
    await renderConsole({ path: "/runs/2026A-r37/split?hold=H1", viewport: { width: 1920, height: 900 } });
    const drawer = await screen.findByTestId("W-TR-06.drawer");
    await waitFor(() => expect(drawer.dataset.scrim).toBe("none"));
    expect(drawer.dataset.mode).toBe("overlay");
    expect(drawer.hasAttribute("data-hug")).toBe(true);
    expect(screen.queryByTestId("W-TR-06.drawer.scrim")).toBeNull();
    expect((document.getElementById("fsc-main") as HTMLElement).hasAttribute("inert")).toBe(false);
  });

  it("Reset ends the session and returns the first view", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    await clickStageMenuItem("W-JG-01.reset");
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
    await clickStageMenuItem("W-JG-01.reset");
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
    const log = recordRequests();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions/:sid/renew", async ({ request }) => {
      starts += 1;
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
    const view = await renderConsole({ path: "/judge", world, handlers: [log.handler, elsewhere] });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    // The judge's keyboard is still on the spent press when the session ends.
    const spent = screen.getByTestId("W-JG-01.markPaid.face");
    spent.focus();
    await act(async () => {
      await view.runtime.session.renew();
    });
    expect(starts).toBe(1);
    await waitFor(() => expect(stage.dataset.state).toBe("session-ended"));
    // The notice says the stage is back at the first press: the stage still reads it, and the press works.
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
    // The press at rest is a new slab: focus moved to it, never left on <body>.
    await waitFor(() => expect(spent.isConnected).toBe(false));
    expect(document.activeElement).toBe(screen.getByTestId("W-JG-01.markPaid.face"));
    expect(view.router.state.location.pathname).toBe("/judge");
    await waitFor(() =>
      expect(screen.getByTestId("W-JG-01.markPaid.face").getAttribute("aria-disabled")).not.toBe("true"),
    );
    await press("W-JG-01.markPaid");
    expect(starts).toBe(1);
    await waitFor(() => expect(view.runtime.session.getState().status).toBe("active"));
    expect(log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions")).toHaveLength(2);
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
  });

  it("a Reset in another tab (the console's token answered 401 UNAUTHENTICATED) ends the session and returns to /judge", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    await view.navigate(`/runs/${runSlug}/split`);
    expect(view.router.state.location.pathname).toBe(`/runs/${runSlug}/split`);
    // fs-api revoked the workspace's tokens: the console's next call is refused for its credential.
    view.world.failNext("markPaid", "UNAUTHENTICATED");
    await act(async () => {
      await view.adapter.call("markPaid", { params: { runSlug } }).catch(() => undefined);
    });
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/judge"));
    expect(stage.dataset.state).toBe("session-ended");
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
    expect(await queryStageMenuItem("W-JG-01.reset")).toBeNull();
    await closeStageMenu();
  });

  it("a renewal that lands in another workspace ends the session and takes the stage back to /judge", async () => {
    // Even a malformed renewal answering another workspace cannot move the stage to a new run.
    const world = createTestWorld();
    let starts = 0;
    const elsewhere = http.post("*/v1/judge/sessions/:sid/renew", async ({ request }) => {
      starts += 1;
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
    expect(starts).toBe(1);
    // The notice says the stage is back at the first press, and it is: /judge, with the first view's next step.
    await waitFor(() => expect(view.router.state.location.pathname).toBe("/judge"));
    expect(stage.dataset.state).toBe("session-ended");
    expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("mark-paid"));
    expect(await queryStageMenuItem("W-JG-01.reset")).toBeNull();
    await closeStageMenu();
  });

  it("What's real separates real from simulated PayPal, and holds Try to break it", async () => {
    await renderConsole({ path: "/judge" });
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.whatsRealOpen"));
    });
    const sheet = await screen.findByTestId("W-JG-01.whatsReal");
    expect(sheet.dataset.rail).toBe("simulator");
    // Five rows, each one short sentence; the whole row opens to its details (round 4: no repeated "More").
    const rows = within(sheet).getByTestId("W-JG-01.whatsReal.rows");
    expect(rows.querySelector('[data-section="simulated-paypal"] .fsc-truth__term')?.textContent).toBe(
      "Simulated PayPal sandbox",
    );
    const lines = [...rows.querySelectorAll(".fsc-truth__line")].map((l) => l.textContent ?? "");
    expect(lines).toHaveLength(6);
    for (const line of lines) expect(line, line).not.toMatch(/[.;]\s+\S/);
    expect(within(sheet).queryByText("More")).toBeNull();
    for (const summary of rows.querySelectorAll("summary"))
      expect(developerWords(summary.textContent ?? "")).toEqual([]);
    // A mock-data build says so first (I8); then the five rows.
    expect([...rows.querySelectorAll("[data-section]")].map((r) => r.getAttribute("data-section"))).toEqual([
      "build",
      "real",
      "simulated-paypal",
      "replayed",
      "synthetic",
      "not-built",
    ]);
    expect(rows.querySelectorAll("details")).toHaveLength(6);
    expect(within(sheet).getByTestId("W-JG-01.tryToBreak").textContent).toMatch(/Try to break it/);
    await expectNoAxeViolations(sheet);
    await act(async () => {
      fireEvent.click(within(sheet).getByTestId("W-JG-01.whatsReal.close"));
    });
    await waitFor(() => expect(screen.queryByTestId("W-JG-01.whatsReal")).toBeNull());
  });

  it("keeps sound off until the viewer turns it on (round 4: a checkbox item in the chevron's menu)", async () => {
    await renderConsole({ path: "/judge" });
    const toggle = await stageMenuItem("W-JG-01.sound");
    expect(toggle.getAttribute("role")).toBe("menuitemcheckbox");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle);
    });
    await waitFor(async () =>
      expect((await stageMenuItem("W-JG-01.sound")).getAttribute("aria-checked")).toBe("true"),
    );
    await act(async () => {
      fireEvent.click(await stageMenuItem("W-JG-01.sound"));
    });
    await waitFor(async () =>
      expect((await stageMenuItem("W-JG-01.sound")).getAttribute("aria-checked")).toBe("false"),
    );
  });

  it("raises the phone from its rail and lowers it with Escape (1024–1439 px)", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1366 } });
    const tab = screen.getByTestId("W-JG-01.phoneTab");
    // The folded phone is its 56 px rail at the right: it never covers the screen.
    expect(screen.getByTestId("W-JG-01.phone").contains(tab)).toBe(true);
    expect(screen.getByTestId("W-JG-01.stage").dataset.phone).toBe("folded");
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

  it("the shown frame's avatar on the folded rail opens the phone too (round 3: it opens on click)", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1366 } });
    const tab = screen.getByTestId("W-JG-01.phoneTab");
    const member = screen.getByTestId("W-JG-01.tab.member");
    expect(member.getAttribute("aria-selected")).toBe("true");
    expect(tab.getAttribute("aria-expanded")).toBe("false");
    await act(async () => {
      fireEvent.click(member);
    });
    expect(tab.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("W-JG-01.tab.member").getAttribute("aria-selected")).toBe("true");
  });

  it("under the viewer's scrim the console is inert and focus is in the phone; lowering hands focus back", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1366 } });
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
    const view = await renderConsole({ path: "/judge", viewport: { width: 1366 } });
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
        // Round 3: the phone folds to its rail; its frames go inert, its avatars stay.
        expect(panel.querySelector("#fsc-phone-device")?.hasAttribute("inert")).toBe(true);
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
    const elsewhere = http.post("*/v1/judge/sessions/:sid/renew", async ({ request }) => {
      starts += 1;
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
    expect(starts).toBe(1);
    expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session-ended");
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined();
    expect(refused).toEqual([]);
    expect(console_?.contains(document.activeElement)).toBe(true);
  });

  it("at 1470 px keeps the rail's labels and folds the phone to its rail; the glyph opens it beside the screen", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470, height: 956 } });
    const stage = screen.getByTestId("W-JG-01.stage");
    expect(stage.dataset.layout).toBe("dock");
    expect(stage.dataset.rail).toBe("full");
    expect(stage.dataset.phone).toBe("folded");
    // Folded, the frames stay loaded, only hidden (never a skeleton on the way back), and nothing in them takes a key.
    expect(document.getElementById("fsc-phone-device")?.hasAttribute("inert")).toBe(true);
    const toggle = screen.getByTestId("W-JG-01.phoneTab");
    expect(toggle.textContent).toMatch(/Open phone\. Nang Celing: Gisusi pa/);
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(stage.dataset.phone).toBe("open");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // The glyph folds it again, and the viewer's choice holds on this screen.
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(stage.dataset.phone).toBe("folded");
  });

  it("from 1680 px opens the phone beside the first view, and folds it on the still places (round 3)", async () => {
    const view = await renderConsole({ path: "/judge", viewport: { width: 1920, height: 1080 } });
    const stage = screen.getByTestId("W-JG-01.stage");
    expect(stage.dataset.phone).toBe("open");
    // "Use the phone" sits on the line under the device, outside the frame's screen.
    const scrim = screen.getByTestId("W-JG-01.phoneScrim");
    expect(scrim.textContent).toBe("Use the phone");
    expect(screen.getByTestId("W-JG-01.frame").contains(scrim)).toBe(false);
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(view.world.run.state).toBe("FUNDED"));
    act(() => view.world.settle());
    const slug = view.runtime.session.getState().session?.runSlug ?? "";
    await view.navigate(`/runs/${slug}/split`);
    await waitFor(() => expect(stage.dataset.phone).toBe("folded"));
    // A frame's avatar opens that frame.
    await act(async () => {
      fireEvent.click(screen.getByTestId("W-JG-01.tab.chair"));
    });
    expect(stage.dataset.phone).toBe("open");
    expect(screen.getByTestId("W-JG-01.tab.chair").getAttribute("aria-selected")).toBe("true");
  });

  it("docks the phone from 1680 px, and its button hands it focus", async () => {
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

  it.each([
    [1700, 1000],
    [2560, 1440],
  ])(
    "at %i px 'Use the phone' hands its focus to the frame's tab as it goes, never to <body>",
    async (width, height) => {
      await renderConsole({ path: "/judge", viewport: { width, height } });
      expect(screen.getByTestId("W-JG-01.stage").dataset.layout).toBe("dock");
      const scrim = screen.getByTestId("W-JG-01.phoneScrim");
      scrim.focus();
      const sampled = focusAcrossRemoval("W-JG-01.phoneScrim");
      try {
        // Enter or Space on the button, or a press: its click raises the phone, and the button goes.
        await act(async () => {
          fireEvent.click(scrim);
        });
        await sampled.frame();
      } finally {
        sampled.restore();
      }
      const tab = screen.getByTestId("W-JG-01.tab.member");
      expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("user");
      expect(sampled.removals()).toBe(1);
      // In the commit (right after removeChild), at the first microtask, and on the next frame.
      expect(sampled.samples).toEqual([tab, tab]);
      expect(sampled.settled).toEqual([tab]);
    },
  );

  it.each([
    ["folded to its rail", 1366, 768],
    ["dimmed in the dock", 1920, 1080],
  ])(
    "a frame that focuses itself while the phone is %s hands focus to the screen's control",
    async (_where, width, height) => {
      // The Member app focuses its amount once it loads: focus (and the next Tab) must not stay in a hidden phone.
      await renderConsole({ path: "/judge", viewport: { width, height } });
      expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBeUndefined();
      const frame = await screen.findByTestId("W-JG-01.frame.member");
      // Its document takes focus (the page's focus is on the <iframe>), and the <iframe> hears it (Firefox).
      act(() => {
        frame.focus();
        fireEvent.focus(frame);
      });
      const control = screenControl();
      expect(control).toBeTruthy();
      expect(document.activeElement).toBe(control);
      // Script took focus back, not a key: it stays quiet (no ring) until the viewer presses one (round 3).
      expect(control?.dataset.prefocused).toBe("");
    },
  );

  it("a frame focused from inside (Chromium fires only the page's blur) is handed back to the screen too", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1366, height: 768 } });
    const frame = await screen.findByTestId("W-JG-01.frame.member");
    // Its document takes focus and no focus event reaches the <iframe>: only document.activeElement says so.
    act(() => frame.focus());
    expect(document.activeElement).toBe(frame);
    act(() => {
      window.dispatchEvent(new FocusEvent("blur"));
    });
    await waitFor(() => expect(document.activeElement).toBe(screenControl()));
    expect(document.activeElement).not.toBe(frame);
  });

  // Round 4: Reset is an item in the chevron's menu. Choosing it closes the menu and hands focus back to the chevron
  // (which the first view keeps) or on to the press: focus never falls to <body>.
  it("Reset from the menu after a press PayPal queued (429) keeps focus on a live control, never on <body>", async () => {
    const world = createTestWorld();
    world.failNext("markPaid", "QUEUED");
    world.failNext("markPaid", "QUEUED");
    await renderConsole({ path: "/judge", world });
    await press("W-JG-01.markPaid");
    await screen.findByTestId("W-JG-01.error");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.markPaid").dataset.state).toBe("rest"));
    await clickStageMenuItem("W-JG-01.reset");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("ready"));
    await waitFor(() => expect(screen.queryByTestId("W-JG-01.runPill.menuPopup")).toBeNull());
    // The chevron, or the press the screen hands focus to once the first view is back: a live control either way.
    expect(document.activeElement).not.toBe(document.body);
    expect([
      screen.getByTestId("W-JG-01.runPill.menu"),
      screen.getByTestId("W-JG-01.markPaid.face"),
    ]).toContain(document.activeElement);
  });

  // A retry pressed twice (a double click, Enter twice) after a press PayPal queued: the retry's own answer is
  // held, then refused too. The first press's error must not kick the retry's slab back to rest while it is in
  // flight (a second press would commit that fresh slab and send nothing), and the slab the retry committed is
  // put back at rest by its own failure, by Reset and by a session the server ended.
  it.each([
    { ending: "Reset", code: "QUEUED" },
    { ending: "an ended session (401 UNAUTHENTICATED)", code: "UNAUTHENTICATED" },
  ] as const)(
    "a retry pressed twice after a 429 that fails again leaves the press pressable after $ending",
    async ({ code }) => {
      const world = createTestWorld();
      const log = recordRequests();
      let markPaids = 0;
      let release: () => void = () => undefined;
      const held = http.post("*/v1/runs/:runSlug/mark-paid", async () => {
        markPaids += 1;
        if (markPaids === 3) await new Promise<void>((go) => (release = go));
        return undefined;
      });
      world.failNext("markPaid", "QUEUED");
      world.failNext("markPaid", "QUEUED");
      await renderConsole({ path: "/judge", world, handlers: [log.handler, held] });
      const starts = () =>
        log.sent.filter((r) => r.method === "POST" && r.path === "/v1/judge/sessions").length;
      const stage = screen.getByTestId("W-JG-01.stage");
      const slab = () => screen.getByTestId("W-JG-01.markPaid");
      await press("W-JG-01.markPaid");
      await screen.findByTestId("W-JG-01.error");
      await waitFor(() => expect(slab().dataset.state).toBe("rest"));
      expect(starts()).toBe(1);

      // The retry, pressed twice: the second press lands on whatever slab is drawn then.
      world.failNext("markPaid", code);
      if (code === "QUEUED") world.failNext("markPaid", code);
      await press("W-JG-01.markPaid");
      await press("W-JG-01.markPaid");
      await waitFor(() => expect(markPaids).toBe(3));
      // In flight, the retry's slab stays committed: nothing put it back at rest on the first press's error.
      expect(slab().dataset.state).toBe("committed");
      await act(async () => {
        release();
      });
      if (code === "QUEUED") {
        await screen.findByTestId("W-JG-01.error");
        // Its own failure puts the slab back at rest, pressable, before any Reset.
        await waitFor(() => expect(slab().dataset.state).toBe("rest"));
        expect(screen.getByTestId("W-JG-01.markPaid.face").getAttribute("aria-disabled")).not.toBe("true");
        await clickStageMenuItem("W-JG-01.reset");
        await waitFor(() => expect(stage.dataset.state).toBe("ready"));
      } else {
        await waitFor(() => expect(stage.dataset.state).toBe("session-ended"));
        expect(screen.getByTestId("W-JG-01.notice.state").textContent).toMatch(/back at the first press/);
      }
      await waitFor(() => expect(slab().dataset.state).toBe("rest"));
      expect(screen.getByTestId("W-JG-01.markPaid.face").getAttribute("aria-disabled")).not.toBe("true");
      await press("W-JG-01.markPaid");
      await waitFor(() => expect(starts()).toBe(2));
      await waitFor(() => expect(stage.dataset.state).toBe("session"));
    },
  );

  it("Reset from the menu after a session that failed to start keeps focus on a live control, never on <body>", async () => {
    const world = createTestWorld();
    world.failNext("createJudgeSession", "RATE_LIMITED");
    await renderConsole({ path: "/judge", world });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("start-failed"));
    await clickStageMenuItem("W-JG-01.reset");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).not.toBe("start-failed"));
    await waitFor(() => expect(screen.queryByTestId("W-JG-01.runPill.menuPopup")).toBeNull());
    expect(document.activeElement).not.toBe(document.body);
    expect([
      screen.getByTestId("W-JG-01.runPill.menu"),
      screen.getByTestId("W-JG-01.markPaid.face"),
    ]).toContain(document.activeElement);
  });

  it("while Reset runs, its menu item says so (aria-disabled, aria-busy), and a second choice sends nothing", async () => {
    const view = await renderConsole({ path: "/judge" });
    // fs-api takes its time over the Reset: the request is held until the test lets it go.
    const pending = view.adapter.pending as { resetSession: (sid: string) => Promise<void> };
    const original = pending.resetSession;
    let release: () => void = () => undefined;
    let sent = 0;
    pending.resetSession = (sid) => {
      sent += 1;
      return new Promise<void>((resolve) => {
        release = () => resolve();
      }).then(() => original(sid));
    };
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    await clickStageMenuItem("W-JG-01.reset");
    await waitFor(() => expect(view.runtime.session.getState().status).toBe("resetting"));
    // Opened again while it runs, the item says so and stays focusable (aria-disabled, never disabled).
    const reset = await stageMenuItem("W-JG-01.reset");
    expect(reset.getAttribute("aria-disabled")).toBe("true");
    expect(reset.getAttribute("aria-busy")).toBe("true");
    await act(async () => {
      fireEvent.click(reset);
    });
    expect(sent).toBe(1);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(view.runtime.session.getState().status).not.toBe("resetting"));
    expect(await queryStageMenuItem("W-JG-01.reset")).toBeNull();
    await closeStageMenu();
    expect(sent).toBe(1);
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
