import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type HoldChange,
  type MotionPreference,
  Slab,
  UiProvider,
  type WebSlabConfirm,
} from "../src/index.js";

const wrap = (node: ReactNode, motion: MotionPreference = "full") => (
  <UiProvider lang="en" motion={motion}>
    {node}
  </UiProvider>
);

const root = (testId: string) => screen.getByTestId(testId);
const face = (testId: string) => screen.getByTestId(`${testId}.face`);

const CONFIRM: WebSlabConfirm = {
  title: "Approve 8 payouts",
  body: "US$368.39 to 8 members by PayPal. This moves money and cannot be undone.",
};

// Type-level contract (S2 §2.7): a hold slab always carries its dialog route; a press slab has none.
// Never called; `tsc` checks the expectations.
export function contractChecks() {
  return [
    // @ts-expect-error a hold slab without `confirm` does not type-check
    <Slab
      key="a"
      label="Approve"
      srLabel="Approve"
      depth="d3"
      tone="jade"
      hold={1600}
      testId="a"
      onCommit={() => undefined}
    />,
    // @ts-expect-error a press slab has no dialog route: `confirm` without `hold` does not type-check
    <Slab
      key="b"
      label="Count it once"
      srLabel="Count it once"
      depth="d2"
      tone="chalk"
      testId="b"
      onCommit={() => undefined}
      confirm={CONFIRM}
    />,
  ];
}

describe("Slab", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("renders its label, depth, tone and a screen-reader label with the consequence", () => {
    render(
      wrap(
        <Slab
          label="Count it once"
          srLabel="Count it once, changes a line"
          depth="d2"
          tone="chalk"
          testId="h1.count"
          onCommit={() => undefined}
        />,
      ),
    );
    expect(root("h1.count").dataset).toMatchObject({ state: "rest", depth: "d2", tone: "chalk" });
    expect(screen.getByRole("button", { name: "Count it once, changes a line" })).toBeTruthy();
    expect(screen.getByText("Count it once")).toBeTruthy();
  });

  it("commits a d2 press on release and stays flush", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <Slab
          label="Count it once"
          srLabel="Count it once"
          depth="d2"
          tone="chalk"
          testId="s"
          onCommit={onCommit}
        />,
      ),
    );
    fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
    expect(root("s").dataset.state).toBe("pressed");
    fireEvent.pointerUp(face("s"), { button: 0, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(root("s").dataset.state).toBe("committed");
    expect(face("s").getAttribute("aria-disabled")).toBe("true");
  });

  it("a d1 slab springs back after its commit", () => {
    const onCommit = vi.fn();
    render(
      wrap(<Slab label="Listen" srLabel="Listen" depth="d1" tone="chalk" testId="s" onCommit={onCommit} />),
    );
    fireEvent.keyDown(face("s"), { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(root("s").dataset.state).toBe("rest");
  });

  it("an unavailable slab sinks flush, keeps its label and explains why; it never commits", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <Slab
          label="Approve 8 payouts"
          srLabel="Approve 8 payouts"
          depth="d3"
          tone="jade"
          hold={1600}
          confirm={CONFIRM}
          unavailableReason="Resolve 1 hold that changes kilos first"
          testId="s"
          onCommit={onCommit}
        />,
      ),
    );
    expect(root("s").dataset.state).toBe("unavailable");
    expect(screen.getByText("Approve 8 payouts")).toBeTruthy();
    expect(screen.getByTestId("s.reason").textContent).toBe("Resolve 1 hold that changes kilos first");
    expect(face("s").getAttribute("aria-disabled")).toBe("true");
    fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(2000));
    // No route signs an unavailable slab: not the hold, not Enter, not a screen reader's activation.
    fireEvent.keyDown(face("s"), { key: "Enter" });
    fireEvent.click(face("s"), { detail: 0 });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByTestId("s.alt")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a d2 slab commits once: a committed slab never commits again", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <Slab
          label="Count it once"
          srLabel="Count it once"
          depth="d2"
          tone="chalk"
          testId="s"
          onCommit={onCommit}
        />,
      ),
    );
    for (let i = 0; i < 3; i++) {
      fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
      fireEvent.pointerUp(face("s"), { button: 0, pointerId: 1 });
      fireEvent.keyDown(face("s"), { key: "Enter" });
      fireEvent.click(face("s"), { detail: 0 });
    }
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(root("s").dataset.state).toBe("committed");
  });

  it("a d1 slab commits once per Space press, even if the browser follows the key with its own click", () => {
    const onCommit = vi.fn();
    render(
      wrap(<Slab label="Listen" srLabel="Listen" depth="d1" tone="chalk" testId="s" onCommit={onCommit} />),
    );
    fireEvent.keyDown(face("s"), { key: " " });
    fireEvent.keyUp(face("s"), { key: " " });
    fireEvent.click(face("s"), { detail: 0 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(face("s"), { key: "Enter" });
    fireEvent.click(face("s"), { detail: 0 });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("a screen reader's activation (a click with no pointer behind it) commits a press slab once", () => {
    const onCommit = vi.fn();
    render(
      wrap(<Slab label="Listen" srLabel="Listen" depth="d1" tone="chalk" testId="s" onCommit={onCommit} />),
    );
    fireEvent.click(face("s"), { detail: 0 });
    expect(onCommit).toHaveBeenCalledTimes(1);
    // A pointer press is handled on pointerdown and pointerup; the click that follows it is not a second press.
    fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(face("s"), { button: 0, pointerId: 1 });
    fireEvent.click(face("s"), { detail: 1 });
    expect(onCommit).toHaveBeenCalledTimes(2);
  });

  it("a press released outside the face, or interrupted by losing focus, springs back and commits nothing", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <Slab
          label="Count it once"
          srLabel="Count it once"
          depth="d2"
          tone="chalk"
          testId="s"
          onCommit={onCommit}
        />,
      ),
    );
    fireEvent.keyDown(face("s"), { key: " " });
    expect(root("s").dataset.state).toBe("pressed");
    fireEvent.blur(face("s"));
    expect(root("s").dataset.state).toBe("rest");
    fireEvent.keyUp(face("s"), { key: " " });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("a bolted slab refuses with zero travel and never commits", () => {
    const onCommit = vi.fn();
    const onRefuse = vi.fn();
    render(
      wrap(
        <Slab
          label="Add to Schedule A"
          srLabel="Add to Schedule A, bolted"
          depth="d2"
          tone="chalk"
          bolted
          testId="s"
          onCommit={onCommit}
          onRefuse={onRefuse}
        />,
      ),
    );
    expect(root("s").dataset.state).toBe("bolted");
    fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
    expect(root("s").dataset.state).toBe("refusing");
    act(() => vi.advanceTimersByTime(140));
    expect(root("s").dataset.state).toBe("bolted");
    expect(onRefuse).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  describe("hold to commit: arm on hold, act on release inside (S2 §2.7, WCAG 2.5.2)", () => {
    const approve = (
      onCommit: () => void,
      motion: MotionPreference = "full",
      onHoldChange?: (change: HoldChange) => void,
    ) =>
      render(
        wrap(
          <Slab
            label="Approve 8 payouts"
            srLabel="Approve 8 payouts, 368 dollars 39 cents, moves money"
            depth="d3"
            tone="jade"
            hold={1600}
            testId="approve"
            onCommit={onCommit}
            onHoldChange={onHoldChange}
            confirm={{ title: "Approve 8 payouts", body: "US$368.39 to 8 members by PayPal." }}
          />,
          motion,
        ),
      );

    /**
     * jsdom lays nothing out: give the slab's body (the face at rest) a 300 × 64 box so a release can land
     * outside it. The face itself reports a box sunk by 8 px, as it would while held, which must not matter.
     */
    const boxFace = (testId: string) => {
      const body = face(testId).parentElement;
      if (!body) throw new Error("the face sits in the slab body");
      body.getBoundingClientRect = () =>
        ({ x: 0, y: 0, left: 0, top: 0, right: 300, bottom: 64, width: 300, height: 64 }) as DOMRect;
      face(testId).getBoundingClientRect = () =>
        ({ x: 8, y: 8, left: 8, top: 8, right: 308, bottom: 72, width: 300, height: 64 }) as DOMRect;
    };

    it("steps through the quarters, arms at 1,600 ms, and signs only on release inside", () => {
      const onCommit = vi.fn();
      const changes = vi.fn();
      approve(onCommit, "full", changes);
      fireEvent.keyDown(face("approve"), { key: " " });
      expect(root("approve").dataset.state).toBe("holding");
      act(() => vi.advanceTimersByTime(400));
      expect(root("approve").dataset.holdProgress).toBe("25");
      act(() => vi.advanceTimersByTime(800));
      expect(root("approve").dataset.holdProgress).toBe("75");
      act(() => vi.advanceTimersByTime(400));
      // Armed: the face clunks flush and says what releasing does. Nothing is signed yet.
      expect(root("approve").dataset).toMatchObject({ state: "armed", holdProgress: "100" });
      expect(face("approve").textContent).toBe("Release to sign");
      act(() => vi.advanceTimersByTime(5000));
      expect(onCommit).not.toHaveBeenCalled();
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(root("approve").dataset.state).toBe("committed");
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["holding", "armed"]);
    });

    it("a 1,700 ms Space hold sends exactly one commit", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.keyUp(face("approve"), { key: " " });
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("a press still counts when the browser refuses to capture the pointer", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      face("approve").setPointerCapture = () => {
        throw new DOMException("No active pointer with the given id is found.", "NotFoundError");
      };
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 9 });
      act(() => vi.advanceTimersByTime(1700));
      expect(root("approve").dataset.state).toBe("armed");
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 9 });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("a 1,700 ms mouse hold released inside signs; released outside it signs nothing and disarms", () => {
      const onCommit = vi.fn();
      const changes = vi.fn();
      approve(onCommit, "full", changes);
      boxFace("approve");
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 1, clientX: 150, clientY: 30 });
      act(() => vi.advanceTimersByTime(1700));
      expect(root("approve").dataset.state).toBe("armed");
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 1, clientX: 420, clientY: 300 });
      expect(onCommit).not.toHaveBeenCalled();
      expect(root("approve").dataset).toMatchObject({ state: "rest", holdProgress: "0" });
      expect(screen.getByTestId("approve.hint").textContent).toContain("Nothing was signed.");
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["holding", "armed", "disarmed"]);
      // The same hold released inside signs, once.
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 2, clientX: 150, clientY: 30 });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 2, clientX: 160, clientY: 40 });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("judges inside by the slab's footprint, not the sunk face: a press by its top-left corner still signs", () => {
      const onCommit = vi.fn();
      const changes = vi.fn();
      approve(onCommit, "full", changes);
      boxFace("approve");
      // The face has sunk 8 px, so (2, 2) is off the face as drawn, yet it is where the person pressed.
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 1, clientX: 2, clientY: 2 });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.pointerMove(face("approve"), { pointerId: 1, clientX: 3, clientY: 1 });
      expect(root("approve").dataset.state).toBe("armed");
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 1, clientX: 2, clientY: 2 });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["holding", "armed"]);
    });

    it("counts the edges as the slab: a release on the right edge signs, one past it disarms", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      boxFace("approve");
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 1, clientX: 150, clientY: 30 });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 1, clientX: 309, clientY: 30 });
      expect(onCommit).not.toHaveBeenCalled();
      expect(screen.getByTestId("approve.hint").textContent).toContain("Nothing was signed.");
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 2, clientX: 150, clientY: 30 });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 2, clientX: 306, clientY: 70 });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("a scroll elsewhere (a log filling up beside the slab) does not disarm it", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      const log = document.createElement("div");
      document.body.append(log);
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(1650));
      fireEvent.scroll(log);
      expect(root("approve").dataset.state).toBe("armed");
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(onCommit).toHaveBeenCalledTimes(1);
      log.remove();
    });

    it("leaving the slab disarms it, even before the release", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      boxFace("approve");
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 1, clientX: 150, clientY: 30 });
      act(() => vi.advanceTimersByTime(1700));
      fireEvent.pointerMove(face("approve"), { pointerId: 1, clientX: 150, clientY: 140 });
      expect(root("approve").dataset.state).toBe("rest");
      // Coming back and letting go does not sign either: the hold is over.
      fireEvent.pointerMove(face("approve"), { pointerId: 1, clientX: 150, clientY: 30 });
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 1, clientX: 150, clientY: 30 });
      expect(onCommit).not.toHaveBeenCalled();
    });

    it.each([
      ["losing focus", () => fireEvent.blur(face("approve"))],
      ["a cancelled pointer", () => fireEvent.pointerCancel(face("approve"), { pointerId: 1 })],
      ["the window losing focus", () => fireEvent.blur(window)],
      ["the page scrolling", () => fireEvent.scroll(window)],
      [
        "a hidden page",
        () => {
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
          fireEvent(document, new Event("visibilitychange"));
          Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        },
      ],
    ])("%s disarms an armed slab and signs nothing", (_, interrupt) => {
      const onCommit = vi.fn();
      const changes = vi.fn();
      approve(onCommit, "full", changes);
      fireEvent.pointerDown(face("approve"), { button: 0, pointerId: 1 });
      act(() => vi.advanceTimersByTime(1650));
      expect(root("approve").dataset.state).toBe("armed");
      act(() => interrupt());
      expect(root("approve").dataset.state).toBe("rest");
      fireEvent.pointerUp(face("approve"), { button: 0, pointerId: 1 });
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(onCommit).not.toHaveBeenCalled();
      expect(changes).toHaveBeenLastCalledWith("disarmed");
    });

    it("an early release springs back, signs nothing, and says to hold until it clicks", () => {
      const onCommit = vi.fn();
      const changes = vi.fn();
      approve(onCommit, "full", changes);
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(900));
      fireEvent.keyUp(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(2000));
      expect(onCommit).not.toHaveBeenCalled();
      expect(root("approve").dataset.state).toBe("rest");
      expect(screen.getByText(/Hold until it clicks/)).toBeTruthy();
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["holding", "released-early"]);
    });

    it("a long press never opens the browser's context menu", () => {
      approve(() => undefined);
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      face("approve").dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("reduced motion arms with a full stepped bar and no travel", () => {
      const onCommit = vi.fn();
      approve(onCommit, "reduced");
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(1600));
      expect(root("approve").dataset.state).toBe("armed");
      expect(screen.getByTestId("approve.steps").textContent).toContain("100% held");
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("a hold slab that has signed never signs again, by any route", () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      fireEvent.keyDown(screen.getByTestId("approve.dialog.confirm.face"), { key: "Enter" });
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(root("approve").dataset.state).toBe("committed");
      expect(screen.queryByTestId("approve.alt")).toBeNull();
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      fireEvent.click(face("approve"), { detail: 0 });
      fireEvent.keyDown(face("approve"), { key: " " });
      fireEvent.keyUp(face("approve"), { key: " " });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("the dialog shows the seal at 96 px with the first 16 hex digits of the batch", () => {
      vi.useRealTimers();
      const batch = "7f3a91c2deadbeef0123456789abcdef0123456789abcdef0123456789abcdef";
      render(
        wrap(
          <Slab
            label="Pirmahi"
            srLabel="Pirmahi, signs the batch"
            depth="d3"
            tone="jade"
            hold={1200}
            testId="sign"
            onCommit={() => undefined}
            confirm={{ ...CONFIRM, seal: { batchSha256: batch, keys: 1 } }}
          />,
        ),
      );
      fireEvent.click(screen.getByTestId("sign.alt"));
      const seal = screen.getByTestId("sign.dialog.seal");
      expect(seal.getAttribute("width")).toBe("96");
      expect(seal.dataset.state).toBe("keys-1");
      expect(screen.getByTestId("sign.dialog.seal.hash").textContent).toBe("7f3a 91c2 dead beef");
    });

    it("reports the dialog route to the screen (MM-5 confirm phases), and its dismissal", () => {
      vi.useRealTimers();
      const changes = vi.fn();
      approve(() => undefined, "full", changes);
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["dialog"]);
      fireEvent.click(screen.getByTestId("approve.dialog.cancel"));
      expect(changes.mock.calls.map(([c]) => c)).toEqual(["dialog", "dismissed"]);
    });

    it("opens the dialog on Not now, so the Enter that opened it cannot sign by repeating", async () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("approve.dialog.cancel")));
      // A held Enter repeats; the repeat never confirms.
      fireEvent.keyDown(screen.getByTestId("approve.dialog.confirm.face"), { key: "Enter", repeat: true });
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("a click the browser sends straight after a key press is that press, not a second activation", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      // Space let go early: nothing signed, and the trailing click must not open the dialog either.
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(500));
      fireEvent.keyUp(face("approve"), { key: " " });
      fireEvent.click(face("approve"), { detail: 0 });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      // Later, with no key behind it, the same click is a screen reader's activation.
      act(() => vi.advanceTimersByTime(10));
      fireEvent.click(face("approve"), { detail: 0 });
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("Enter opens the dialog route, which commits without timing", () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      const dialog = screen.getByRole("alertdialog");
      expect(dialog.textContent).toContain("US$368.39 to 8 members by PayPal.");
      fireEvent.keyDown(screen.getByTestId("approve.dialog.confirm.face"), { key: "Enter" });
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("offers the visible link for people who can't hold", () => {
      approve(() => undefined);
      expect(screen.getByTestId("approve.alt").textContent).toBe("Can’t hold? Approve another way");
    });

    it("the visible link opens the dialog, which states the consequence, and Not now signs nothing", () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.click(screen.getByTestId("approve.alt"));
      expect(screen.getByRole("alertdialog").textContent).toContain("US$368.39 to 8 members by PayPal.");
      fireEvent.click(screen.getByTestId("approve.dialog.cancel"));
      expect(onCommit).not.toHaveBeenCalled();
      expect(root("approve").dataset.state).toBe("rest");
    });

    it("a screen reader's activation opens the dialog route instead of starting a timed hold", () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.click(face("approve"), { detail: 0 });
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      expect(root("approve").dataset.state).toBe("rest");
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("hiding the caption keeps the dialog link", () => {
      render(
        wrap(
          <Slab
            label="Pirmahi"
            srLabel="Pirmahi, signs the batch"
            depth="d3"
            tone="jade"
            hold={1200}
            hint={false}
            confirm={CONFIRM}
            testId="sign"
            onCommit={() => undefined}
          />,
        ),
      );
      expect(screen.getByTestId("sign.hint").textContent).toBe("Can’t hold? Approve another way");
      expect(screen.getByTestId("sign.alt").tagName).toBe("BUTTON");
    });

    it("a slab that becomes unavailable mid-hold drops the hold and signs nothing", () => {
      const onCommit = vi.fn();
      const slab = (reason?: string) =>
        wrap(
          <Slab
            label="Approve 8 payouts"
            srLabel="Approve 8 payouts"
            depth="d3"
            tone="jade"
            hold={1600}
            confirm={CONFIRM}
            unavailableReason={reason}
            testId="approve"
            onCommit={onCommit}
          />,
        );
      const { rerender } = render(slab());
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(1200));
      rerender(slab("Resolve 1 hold that changes kilos first"));
      act(() => vi.advanceTimersByTime(2000));
      expect(onCommit).not.toHaveBeenCalled();
      expect(root("approve").dataset).toMatchObject({ state: "unavailable", holdProgress: "0" });
    });

    it("an open dialog closes without signing when the slab is bolted under it", async () => {
      vi.useRealTimers();
      const onCommit = vi.fn();
      const slab = (bolted: boolean) =>
        wrap(
          <Slab
            label="Approve 8 payouts"
            srLabel="Approve 8 payouts"
            depth="d3"
            tone="jade"
            hold={1600}
            confirm={CONFIRM}
            bolted={bolted}
            testId="approve"
            onCommit={onCommit}
          />,
        );
      const { rerender } = render(slab(false));
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      const confirmFace = screen.getByTestId("approve.dialog.confirm.face");
      rerender(slab(true));
      expect(root("approve").dataset.state).toBe("bolted");
      // Even a confirm pressed while the dialog is still leaving signs nothing.
      fireEvent.keyDown(confirmFace, { key: "Enter" });
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("a bolted hold slab refuses every route, the dialog included", () => {
      const onCommit = vi.fn();
      const onRefuse = vi.fn();
      render(
        wrap(
          <Slab
            label="Approve 8 payouts"
            srLabel="Approve 8 payouts, payouts paused"
            depth="d3"
            tone="jade"
            hold={1600}
            confirm={CONFIRM}
            bolted
            testId="approve"
            onCommit={onCommit}
            onRefuse={onRefuse}
          />,
        ),
      );
      expect(screen.queryByTestId("approve.alt")).toBeNull();
      fireEvent.keyDown(face("approve"), { key: "Enter" });
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(root("approve").dataset.state).toBe("refusing");
      act(() => vi.advanceTimersByTime(140));
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(2000));
      expect(onRefuse).toHaveBeenCalledTimes(2);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("reduced motion shows a stepped bar with a percentage instead of face travel", () => {
      approve(() => undefined, "reduced");
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByTestId("approve.steps").textContent).toContain("50% held");
      expect(root("approve").dataset.motion).toBe("reduced");
    });
  });

  it("renders a still frame for galleries and motion studies, which never commits", () => {
    const onCommit = vi.fn();
    render(
      wrap(
        <Slab
          label="Approve 8 payouts"
          srLabel="Approve 8 payouts"
          depth="d3"
          tone="jade"
          hold={1600}
          confirm={CONFIRM}
          testId="s"
          onCommit={onCommit}
          frame={{ state: "holding", travel: 4, fill: 0.5 }}
        />,
      ),
    );
    expect(root("s").dataset).toMatchObject({ state: "holding", holdProgress: "50" });
    // The link is drawn as it looks, but a still frame has no control that does nothing.
    expect(screen.getByTestId("s.alt").tagName).toBe("SPAN");
    fireEvent.pointerDown(face("s"), { button: 0, pointerId: 1 });
    fireEvent.keyDown(face("s"), { key: " " });
    fireEvent.keyDown(face("s"), { key: "Enter" });
    fireEvent.click(face("s"), { detail: 0 });
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
    expect(root("s").dataset.state).toBe("holding");
  });
});
