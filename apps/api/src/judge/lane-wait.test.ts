import { afterEach, expect, it, vi } from "vitest";
import { createFakeClock } from "../lib/clock.js";
import type { AppDeps } from "../lib/context.js";
import { beginLiveStep, LIVE_LANE_WAIT_MS, NO_JUDGE_QUOTA } from "./live-step.js";
import { liveDecision } from "./quota.js";

vi.mock("./quota.js", async (original) => ({
  ...(await original<object>()),
  isJudgeWorkspace: async () => true,
  judgeRail: async () => liveDecision("sandbox", NO_JUDGE_QUOTA),
}));
afterEach(() => vi.restoreAllMocks());

function fixture(locked: boolean) {
  const clock = createFakeClock();
  const reserved = Object.assign(async () => [{ locked }], { release: vi.fn() });
  return {
    clock,
    deps: {
      clock,
      db: {},
      sql: { reserve: async () => reserved },
      paypal: { label: "sandbox" },
      env: {},
      logger: { warn: vi.fn() },
    } as unknown as AppDeps,
  };
}

it("HD6 r5: another process cannot keep a fresh step queued longer than 20 s", async () => {
  const { deps, clock } = fixture(false);
  const step = { workspaceId: "elsewhere", sessionId: null, step: "invoice" as const };
  expect(await beginLiveStep(deps, step)).toMatchObject({ kind: "queued", position: null });
  clock.advance(LIVE_LANE_WAIT_MS - 1);
  expect(await beginLiveStep(deps, step)).toMatchObject({ kind: "queued", retryAfterMs: 1 });
  clock.advance(1);
  expect(await beginLiveStep(deps, step)).toMatchObject({
    kind: "replay",
    decision: { mode: "replay", reason: "lane_full", label: expect.stringMatching(/^Replay:/) },
  });
});

it("HD6 r5: a written live post still waits after 20 s, so an existing payment is never replayed", async () => {
  const { deps, clock } = fixture(false);
  const step = { workspaceId: "written", sessionId: null, step: "post" as const, runId: "run", resume: true };
  expect(await beginLiveStep(deps, step)).toMatchObject({ kind: "queued" });
  clock.advance(LIVE_LANE_WAIT_MS);
  expect(await beginLiveStep(deps, step)).toMatchObject({ kind: "queued", position: null });
});

it("HD6 r5: a short visible queue still becomes live when the preceding burst ends", async () => {
  const { deps, clock } = fixture(true);
  const held = await beginLiveStep(deps, { workspaceId: "first", sessionId: null, step: "invoice" });
  if (held.kind !== "live") throw new Error("expected held lane");
  try {
    const next = { workspaceId: "next", sessionId: null, step: "invoice" as const };
    expect(await beginLiveStep(deps, next)).toMatchObject({
      kind: "queued",
      position: 1,
      retryAfterMs: 20_000,
    });
    clock.advance(19_999);
    await held.end();
    const live = await beginLiveStep(deps, next);
    expect(live).toMatchObject({ kind: "live" });
    if (live.kind === "live") await live.end();
  } finally {
    await held.end();
  }
});
