// The Judge stage end to end against the mock world: the first view makes no calls; the first press starts a
// session and the run's SSE stream drives every state after it (motion is evidence: nothing moves on a timer);
// the run pill names the next step; What's real, sound, the phone and Reset behave; each S1.6 layout holds.

import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../test/axe.js";
import { renderConsole } from "../test/render.js";
import { resizeTo } from "../test/viewport.js";

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
    expect(screen.getByTestId("W-JG-01.notice").textContent).toMatch(/simulated PayPal sandbox/);
    expect(screen.getByTestId("W-JG-01.ribbon.paypal").textContent).toMatch(/FS-2026A-r37/);
    expect(screen.getByTestId("W-JG-01.caption").textContent).toMatch(
      /Slip reading replays a recorded Claude run/,
    );
    expect(screen.queryByTestId("W-JG-01.reset")).toBeNull();
    expect(callSpy).not.toHaveBeenCalled();
    expect(view.world.sessionForRun("2026A-r4170001")).toBeNull();
  });

  it("the first press starts the run; the stream moves the stage, the pill and the ribbon", async () => {
    const view = await renderConsole({ path: "/judge" });
    await press("W-JG-01.markPaid");
    const stage = screen.getByTestId("W-JG-01.stage");
    await waitFor(() => expect(stage.dataset.state).toBe("session"));
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("by-hand"));
    expect(screen.getByTestId("W-JG-01.runPill.state").textContent).toBe("In review");
    expect(screen.getByTestId("W-JG-01.ribbon.machine").textContent).toMatch(
      /Raised by the engine|Lines computed|In review/,
    );
    expect(screen.getByTestId("W-JG-01.reset")).toBeTruthy();
    // The rest of the loop arrives the same way: by events, never by timers.
    const runSlug = view.runtime.session.getState().session?.runSlug ?? "";
    act(() => {
      view.world.enterField(view.world.byHandFieldId(runSlug) ?? "", { value: "64.80" });
    });
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("holds"));
    expect(screen.getByTestId("W-JG-01.runPill.next").getAttribute("href")).toBe(
      `/runs/${runSlug}/split?hold=H1`,
    );
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
    expect(view.world.sessionForRun(runSlug)).toBeNull();
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

  it("raises the phone from its tab and lowers it with Escape (1024–1679 px)", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1470 } });
    const tab = screen.getByTestId("W-JG-01.phoneTab");
    expect(tab.getAttribute("aria-expanded")).toBe("false");
    expect(tab.textContent).toMatch(/Gisusi pa/);
    await act(async () => {
      fireEvent.click(tab);
    });
    expect(tab.getAttribute("aria-expanded")).toBe("true");
    await act(async () => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(tab.getAttribute("aria-expanded")).toBe("false");
  });

  it("docks the phone under a scrim from 1680 px, and the scrim hands it focus", async () => {
    await renderConsole({ path: "/judge", viewport: { width: 1920, height: 1080 } });
    expect(screen.getByTestId("W-JG-01.stage").dataset.layout).toBe("dock");
    const scrim = screen.getByTestId("W-JG-01.phoneScrim");
    await act(async () => {
      fireEvent.click(scrim);
    });
    expect(screen.queryByTestId("W-JG-01.phoneScrim")).toBeNull();
    expect(screen.getByTestId("W-JG-01.stage").dataset.raised).toBe("");
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

  it("has no axe violations in the first view or in a session", async () => {
    const view = await renderConsole({ path: "/judge" });
    await expectNoAxeViolations(view.container);
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.stage").dataset.state).toBe("session"));
    await expectNoAxeViolations(view.container);
  });

  it("reduced motion keeps every state: the stage still moves on events", async () => {
    await renderConsole({ path: "/judge", motion: "reduced" });
    await press("W-JG-01.markPaid");
    await waitFor(() => expect(screen.getByTestId("W-JG-01.runPill").dataset.step).toBe("by-hand"));
  });
});
