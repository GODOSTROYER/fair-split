import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MotionPreference, Slab, UiProvider, type WebSlabConfirm } from "../src/index.js";

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

  describe("hold to commit", () => {
    const approve = (onCommit: () => void, motion: MotionPreference = "full") =>
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
            confirm={{ title: "Approve 8 payouts", body: "US$368.39 to 8 members by PayPal." }}
          />,
          motion,
        ),
      );

    it("steps through the quarters and commits at 1,600 ms", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: " " });
      expect(root("approve").dataset.state).toBe("holding");
      act(() => vi.advanceTimersByTime(400));
      expect(root("approve").dataset.holdProgress).toBe("25");
      act(() => vi.advanceTimersByTime(800));
      expect(root("approve").dataset.holdProgress).toBe("75");
      expect(onCommit).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(400));
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(root("approve").dataset.state).toBe("committed");
      expect(root("approve").dataset.holdProgress).toBe("100");
    });

    it("an early release springs back, signs nothing, and says to hold until it clicks", () => {
      const onCommit = vi.fn();
      approve(onCommit);
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(900));
      fireEvent.keyUp(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(2000));
      expect(onCommit).not.toHaveBeenCalled();
      expect(root("approve").dataset.state).toBe("rest");
      expect(screen.getByText(/Hold until it clicks/)).toBeTruthy();
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
