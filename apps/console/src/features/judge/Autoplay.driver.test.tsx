import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { StageApi } from "../../stage/context.js";
import { StageAutoplay } from "./Autoplay.js";

const state = vi.hoisted(() => ({
  path: "/judge",
  setAutoplay: vi.fn(),
  announce: vi.fn(),
  next: {
    id: "by-hand",
    text: "By hand",
    to: "/season/2026-A/by-hand/0462",
    actor: "person",
    screen: "W-TR-04",
  } as StageApi["next"],
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: state.path, searchStr: "" } }),
}));
vi.mock("@fairsplit/ui-web", () => ({ Glyph: () => null, useMotionMode: () => "reduced" }));
vi.mock("../../lib/announce.js", () => ({ useAnnounce: () => state.announce }));
vi.mock("../../stage/context.js", () => ({
  useOptionalStage: () =>
    ({
      layout: { phone: "dock" },
      autoplay: "autoplay",
      setAutoplay: state.setAutoplay,
      next: state.next,
    }) satisfies Pick<StageApi, "autoplay" | "setAutoplay" | "next"> & {
      layout: Pick<StageApi["layout"], "phone">;
    },
}));
vi.mock("../../chrome/slots.js", () => ({
  ChromePortal: ({ children }: { children: React.ReactNode }) => children,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  state.path = "/judge";
  state.next = {
    id: "by-hand",
    text: "By hand",
    to: "/season/2026-A/by-hand/0462",
    actor: "person",
    screen: "W-TR-04",
  };
});

it("follows the real reading step before the next four-second action tick without signing a key", async () => {
  vi.useFakeTimers();
  const mutations = vi.fn();
  const navigate = vi.fn();
  const sign = vi.fn();
  let funded = () => {};
  function Host() {
    const [path, setPath] = useState("/judge");
    const [next, setNext] = useState<StageApi["next"]>({
      id: "mark-paid",
      text: "Mark paid",
      to: "/judge",
      actor: "person",
      screen: "W-JG-01",
    });
    state.path = path;
    state.next = next;
    funded = () =>
      setNext({
        id: "reading",
        text: "Reading",
        to: "/season/2026-A/reading",
        actor: "machine",
        screen: "W-TR-03",
      });
    return (
      <>
        <button type="button" data-testid="W-JG-01.markPaid.face" onClick={mutations}>
          Mark paid
        </button>
        <button
          type="button"
          data-testid="W-JG-01.runPill.next"
          onClick={() => {
            navigate();
            setPath("/season/2026-A/reading");
          }}
        >
          Reading
        </button>
        <button type="button" data-testid="W-TR-07.approve.face" onClick={sign}>
          Sign
        </button>
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(mutations).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    funded();
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(state.path).toBe("/season/2026-A/reading");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(mutations).toHaveBeenCalledTimes(1);
  expect(sign).not.toHaveBeenCalled();
});

it("keeps the actual funding arc mounted until funded, then follows reading without another tick", async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  state.next = {
    id: "reading",
    text: "Reading",
    to: "/season/2026-A/reading",
    actor: "machine",
    screen: "W-TR-03",
  };
  let fundingLanded = () => {};
  function Host() {
    const [phase, setPhase] = useState("arc");
    fundingLanded = () => setPhase("funded");
    return (
      <>
        <div data-moment="MM-S" data-moment-phase={phase} />
        <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
          Reading
        </button>
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    fundingLanded();
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});

it("cancels the funding observer when autoplay unmounts before funded", async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  state.next = {
    id: "reading",
    text: "Reading",
    to: "/season/2026-A/reading",
    actor: "machine",
    screen: "W-TR-03",
  };
  const view = render(
    <>
      <div data-moment="MM-S" data-moment-phase="arc" />
      <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
        Reading
      </button>
      <StageAutoplay />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(navigate).not.toHaveBeenCalled();
  const funding = view.container.querySelector('[data-moment="MM-S"]');
  view.unmount();
  await act(async () => {
    funding?.setAttribute("data-moment-phase", "funded");
    await vi.advanceTimersByTimeAsync(4_000);
  });
  expect(navigate).not.toHaveBeenCalled();
});

it("follows a settled route promptly while keeping four seconds between actions", async () => {
  vi.useFakeTimers();
  const actions: number[] = [];
  const navigations = vi.fn();
  function Host() {
    const [path, setPath] = useState("/judge");
    const [used, setUsed] = useState(false);
    state.path = path;
    return (
      <>
        <button
          type="button"
          data-testid="W-JG-01.runPill.next"
          onClick={() => {
            navigations();
            setPath("/season/2026-A/by-hand/0462");
          }}
        >
          Go
        </button>
        {path !== "/judge" && (
          <>
            <button
              type="button"
              data-testid="W-TR-04.useLogbook"
              data-used={used ? "" : undefined}
              onClick={() => {
                actions.push(Date.now());
                setUsed(true);
              }}
            >
              Logbook
            </button>
            <button type="button" data-testid="W-TR-04.commit.face" onClick={() => actions.push(Date.now())}>
              Enter
            </button>
          </>
        )}
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(navigations).toHaveBeenCalledTimes(1);
  expect(actions).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(actions).toHaveLength(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(actions).toHaveLength(2);
  expect((actions[1] ?? 0) - (actions[0] ?? 0)).toBeGreaterThanOrEqual(4000);
});

it("bounds a route that never settles without repeatedly clicking its navigation", async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  render(
    <>
      <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
        Go
      </button>
      <StageAutoplay />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_100);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
  expect(state.setAutoplay).toHaveBeenCalledWith("paused");
});

it("waits for the real duplicate comparison to become ready before Count it once", async () => {
  vi.useFakeTimers();
  const countOnce = vi.fn();
  state.path = "/runs/2026A-r37/split";
  state.next = { id: "holds", text: "Count it once", to: state.path, actor: "person", screen: "W-TR-06" };
  let compareReady = () => {};
  function Host() {
    const [phase, setPhase] = useState("pairs");
    compareReady = () => setPhase("ready");
    return (
      <>
        <section data-testid="W-TR-06">
          <div data-moment="MM-3" data-moment-phase={phase} />
          <button type="button" className="fs-slab__face" onClick={countOnce}>
            Count it once
          </button>
        </section>
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(countOnce).not.toHaveBeenCalled();
  await act(async () => {
    compareReady();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(countOnce).toHaveBeenCalledTimes(1);
});

it("keeps a live reading row mounted through ring until the real landed phase", async () => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  state.path = "/season/2026-A/reading";
  let landed = () => {};
  function Host() {
    const [phase, setPhase] = useState("ring");
    landed = () => setPhase("landed");
    return (
      <>
        <section data-testid="W-TR-03">
          <div data-moment="MM-2" data-moment-phase={phase} />
        </section>
        <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
          By hand
        </button>
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    landed();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});

it.each(["idle", "landed"])("does not hold a historical reading at %s", async (phase) => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  state.path = "/season/2026-A/reading";
  render(
    <>
      <section data-testid="W-TR-03">
        <div data-moment="MM-2" data-moment-phase={phase} />
      </section>
      <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
        By hand
      </button>
      <StageAutoplay />
    </>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});

it.each(["signed-2", "sealed"])("keeps approval mounted at %s until its inked phase", async (initial) => {
  vi.useFakeTimers();
  const navigate = vi.fn();
  state.path = "/runs/2026A-r37/approve";
  state.next = {
    id: "rhea",
    text: "Pay Rhea in cash",
    to: "/runs/2026A-r37/fanout",
    actor: "person",
    screen: "W-TR-08",
  };
  let inked = () => {};
  function Host() {
    const [phase, setPhase] = useState(initial);
    inked = () => setPhase("inked");
    return (
      <>
        <section data-testid="W-TR-07">
          <div data-moment="MM-5" data-moment-phase={phase} />
        </section>
        <button type="button" data-testid="W-JG-01.runPill.next" onClick={navigate}>
          Fanout
        </button>
        <StageAutoplay />
      </>
    );
  }
  render(<Host />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(navigate).not.toHaveBeenCalled();
  await act(async () => {
    inked();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(navigate).toHaveBeenCalledTimes(1);
});
