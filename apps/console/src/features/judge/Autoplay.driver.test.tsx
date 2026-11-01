import { act, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { StageApi } from "../../stage/context.js";
import { StageAutoplay } from "./Autoplay.js";

const state = vi.hoisted(() => ({ path: "/judge", setAutoplay: vi.fn(), announce: vi.fn() }));
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
      next: {
        id: "by-hand",
        text: "By hand",
        to: "/season/2026-A/by-hand/0462",
        actor: "person",
        screen: "W-TR-04",
      },
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
