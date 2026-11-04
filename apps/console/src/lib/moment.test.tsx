// useMoment: every moment runs @fairsplit/motion's timeline, writes data-moment-phase, traces {m, phase, t} in
// test builds, and refuses to start without the event that caused it (motion is evidence). Reduced motion keeps
// every phase; only what is drawn between them changes.

import { MOMENTS } from "@fairsplit/motion";
import { feedback, UiProvider } from "@fairsplit/ui-web";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type MomentScript, useMomentScript } from "../features/split/shared/script.js";
import { clearMomentTrace, momentPhase, phasesAreCatalogued, tracedPhases } from "../test/moments.js";
import { type MomentController, useMoment } from "./moment.js";

let controller: MomentController<"MM-4"> | null = null;
let pinkCopy: MomentController<"MM-3"> | null = null;
let pinkScript: MomentScript<"MM-3"> | null = null;

function PinkCopy({ first = true }: { readonly first?: boolean }) {
  const moment = useMoment("MM-3");
  pinkCopy = moment;
  pinkScript = useMomentScript(moment);
  return (
    <>
      {first && <section key="first" {...moment.rootProps} data-testid="first" />}
      <section key="second" {...moment.rootProps} data-testid="second" />
    </>
  );
}

function Bolted() {
  const moment = useMoment("MM-4");
  controller = moment;
  return <section {...moment.rootProps} data-testid="bolted" />;
}

function renderBolted(motion: "full" | "reduced") {
  return render(
    <UiProvider lang="en" motion={motion}>
      <Bolted />
    </UiProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  clearMomentTrace();
});

afterEach(() => {
  vi.useRealTimers();
  controller = null;
  pinkCopy = null;
  pinkScript = null;
});

describe("useMoment", () => {
  it.each(["full", "reduced"] as const)(
    "exposes every real MM-3 count-once phase to DOM observers during a React batch (%s)",
    (mode) => {
      const view = render(
        <UiProvider lang="en" motion={mode}>
          <PinkCopy />
        </UiProvider>,
      );
      const root = view.getByTestId("first");
      const observer = new MutationObserver(() => {});
      observer.observe(root, {
        attributes: true,
        attributeOldValue: true,
        attributeFilter: ["data-moment-phase"],
      });
      expect(pinkScript?.at("count-once", "needle")).toBe(60);
      expect(pinkScript?.at("count-once", "wave")).toBe(200);
      act(() => {
        pinkScript?.run("count-once", { eventId: "real-hold-resolved", kind: "sse" });
      });
      act(() => {
        vi.advanceTimersByTime(220);
      });
      const values = [
        ...observer.takeRecords().map((record) => record.oldValue),
        root.getAttribute("data-moment-phase"),
      ];
      const phases = values.filter((phase, index) => index === 0 || phase !== values[index - 1]);
      observer.disconnect();
      expect(phases).toEqual(["closed", "pressed", "needle", "wave"]);
      expect(view.getByTestId("second").getAttribute("data-moment-phase")).toBe("wave");
    },
  );

  it("unregisters only the removed moment root and stops touching it after unmount", () => {
    const view = render(
      <UiProvider lang="en" motion="reduced">
        <PinkCopy />
      </UiProvider>,
    );
    const detached = view.getByTestId("first");
    view.rerender(
      <UiProvider lang="en" motion="reduced">
        <PinkCopy first={false} />
      </UiProvider>,
    );
    act(() => {
      pinkScript?.run("count-once", { eventId: "resolved-after-first-root-left", kind: "sse" });
      vi.advanceTimersByTime(220);
    });
    expect(detached.getAttribute("data-moment-phase")).toBe("closed");
    const remaining = view.getByTestId("second");
    expect(remaining.getAttribute("data-moment-phase")).toBe("wave");
    const departed = pinkCopy;
    view.unmount();
    act(() => {
      departed?.enter("resolved");
    });
    expect(remaining.getAttribute("data-moment-phase")).toBe("wave");
  });

  it.each(["full", "reduced"] as const)(
    "plays MM-4 on a 409 in %s motion, through the catalogue's phases",
    (mode) => {
      const view = renderBolted(mode);
      expect(momentPhase(view.container, "MM-4")).toBe("idle");
      act(() => {
        expect(controller?.play("refuse", { eventId: "req_01J", kind: "http" })).toBe(true);
      });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(momentPhase(view.container, "MM-4")).toBe("done");
      const phases = tracedPhases("MM-4");
      expect(phases).toEqual(["refuse", "plate", "done"]);
      expect(phasesAreCatalogued("MM-4", phases)).toBe(true);
      expect(MOMENTS["MM-4"]).toContain("plate");
    },
  );

  it("refuses to start without evidence, and plays the same evidence once", () => {
    renderBolted("full");
    act(() => {
      expect(controller?.play("refuse", { eventId: "" })).toBe(false);
      expect(controller?.play("refuse", { eventId: "evt-1" })).toBe(true);
    });
    act(() => {
      vi.advanceTimersByTime(400);
      expect(controller?.play("refuse", { eventId: "evt-1" })).toBe(false);
      expect(controller?.play("no-such-act", { eventId: "evt-2" })).toBe(false);
    });
  });

  it("skips feedback the person's own press already made, and names the scale note it plays", () => {
    const played = vi.spyOn(feedback, "play").mockImplementation(() => undefined);
    renderBolted("full");
    act(() => {
      controller?.play("refuse", { eventId: "evt-a", kind: "press" }, { skipFeedback: ["bolted.refuse"] });
      vi.advanceTimersByTime(400);
    });
    expect(played).not.toHaveBeenCalled();
    act(() => {
      controller?.play("refuse", { eventId: "evt-b", kind: "http" }, { feedbackIndex: 3 });
      vi.advanceTimersByTime(400);
    });
    expect(played).toHaveBeenCalledWith("bolted.refuse", { index: 3 });
    act(() => {
      controller?.play("refuse", { eventId: "evt-c", kind: "http" });
      vi.advanceTimersByTime(400);
    });
    expect(played).toHaveBeenLastCalledWith("bolted.refuse", {});
    played.mockRestore();
  });

  it("resets to its first phase", () => {
    const view = renderBolted("full");
    act(() => {
      controller?.play("refuse", { eventId: "evt-1" });
      vi.advanceTimersByTime(400);
    });
    act(() => controller?.reset());
    expect(momentPhase(view.container, "MM-4")).toBe("idle");
  });
});
