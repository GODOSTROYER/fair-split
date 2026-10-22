import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MotionPreference, Slab, UiProvider } from "../src/index.js";

const wrap = (node: ReactNode, motion: MotionPreference = "full") => (
  <UiProvider lang="en" motion={motion}>
    {node}
  </UiProvider>
);

const root = (testId: string) => screen.getByTestId(testId);
const face = (testId: string) => screen.getByTestId(`${testId}.face`);

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

    it("reduced motion shows a stepped bar with a percentage instead of face travel", () => {
      approve(() => undefined, "reduced");
      fireEvent.keyDown(face("approve"), { key: " " });
      act(() => vi.advanceTimersByTime(800));
      expect(screen.getByTestId("approve.steps").textContent).toContain("50% held");
      expect(root("approve").dataset.motion).toBe("reduced");
    });
  });

  it("renders a still frame for galleries and motion studies", () => {
    render(
      wrap(
        <Slab
          label="Approve 8 payouts"
          srLabel="Approve 8 payouts"
          depth="d3"
          tone="jade"
          hold={1600}
          testId="s"
          onCommit={() => undefined}
          frame={{ state: "holding", travel: 4, fill: 0.5 }}
        />,
      ),
    );
    expect(root("s").dataset).toMatchObject({ state: "holding", holdProgress: "50" });
  });
});
