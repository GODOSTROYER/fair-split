import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../lib/clock.js";
import { LANE_DEFAULTS, LiveLane } from "./lane.js";

const ws = (n: number) => `0192f8a0-0000-7000-8000-${String(n).padStart(12, "0")}`;
const burst = (n: number, step = "invoice") => ({ workspaceId: ws(n), step, sessionId: null });

describe("the single-flight live lane", () => {
  it("HD6 r5: tracks a queued burst's original wait across retries and promotion", () => {
    const clock = createFakeClock();
    const lane = new LiveLane(clock);
    lane.acquire(burst(1));
    lane.acquire(burst(2));
    clock.advance(19_999);
    lane.acquire(burst(2));
    expect(lane.waitedMs(burst(2))).toBe(19_999);
    lane.release(burst(1));
    clock.advance(1);
    expect(lane.waitedMs(burst(2))).toBe(20_000);
    lane.release(burst(2));
    expect(lane.waitedMs(burst(2))).toBe(0);
  });
  it("HD6-6: later steps retain the workspace network and cannot bypass its lane cap", () => {
    const lane = new LiveLane(createFakeClock());
    for (let i = 1; i <= 3; i++) {
      lane.join({ ...burst(i), networkKey: "hashed-network" });
      lane.release(burst(i));
    }
    expect(lane.join(burst(1, "post"))).toBe(0);
    expect(lane.join(burst(2, "post"))).toBe(1);
    expect(lane.join(burst(3, "post"))).toBeNull();
    lane.releaseWorkspace(ws(1));
    expect(lane.join(burst(3, "post"))).toBe(1);
  });
  it("grants one burst at a time, in arrival order, and shows everyone else their place", () => {
    const clock = createFakeClock();
    const lane = new LiveLane(clock);
    expect(lane.acquire(burst(1))).toMatchObject({ granted: true, position: 0 });
    expect(lane.acquire(burst(2))).toEqual({ granted: false, position: 1, etaMs: LANE_DEFAULTS.burstMs });
    expect(lane.acquire(burst(3))).toEqual({ granted: false, position: 2, etaMs: 2 * LANE_DEFAULTS.burstMs });
    expect(lane.view()).toMatchObject({ depth: 3, queued: 2, holder: { workspaceId: ws(1), leased: true } });
    lane.release(burst(1));
    expect(lane.position(ws(2))).toBe(0);
    expect(lane.acquire(burst(2))).toMatchObject({ granted: true });
    expect(lane.position(ws(3))).toBe(1);
  });

  it("joining twice keeps the place (idempotent per workspace and step)", () => {
    const lane = new LiveLane(createFakeClock());
    lane.join(burst(1));
    lane.join(burst(2));
    expect(lane.join(burst(2))).toBe(1);
    expect(lane.view().depth).toBe(2);
  });

  it("a head that never asks loses its turn after the reservation; a lease ends unless renewed", () => {
    const clock = createFakeClock();
    const lane = new LiveLane(clock);
    lane.join(burst(1)); // reserved for 60 s
    lane.join(burst(2));
    clock.advance(LANE_DEFAULTS.reserveMs + 1);
    expect(lane.position(ws(1))).toBeNull();
    expect(lane.acquire(burst(2))).toMatchObject({ granted: true });
    clock.advance(LANE_DEFAULTS.leaseMs - 1_000);
    expect(lane.renew(burst(2))).toBe(true);
    clock.advance(LANE_DEFAULTS.leaseMs - 1_000);
    expect(lane.position(ws(2))).toBe(0); // renewed, still holding
    clock.advance(2_000);
    expect(lane.position(ws(2))).toBeNull(); // the lease ran out: a judge who walked away never blocks the lane
    expect(lane.renew(burst(2))).toBe(false);
  });

  it("Reset leaves every burst of the workspace; a full lane refuses (the caller replays)", () => {
    const lane = new LiveLane(createFakeClock(), { maxQueue: 2 });
    lane.join(burst(1, "invoice"));
    lane.join(burst(1, "post"));
    expect(lane.join(burst(2))).toBeNull();
    expect(lane.acquire(burst(2))).toEqual({ granted: false, position: null, full: true });
    lane.releaseWorkspace(ws(1));
    expect(lane.view().depth).toBe(0);
    expect(lane.acquire(burst(2))).toMatchObject({ granted: true });
  });

  it("property: at most one burst ever holds the lane, and positions stay a 0..n-1 sequence", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            op: fc.constantFrom("acquire", "release", "join", "advance", "renew"),
            n: fc.integer({ min: 1, max: 5 }),
            ms: fc.integer({ min: 0, max: 120_000 }),
          }),
          { maxLength: 60 },
        ),
        (ops) => {
          const clock = createFakeClock();
          const lane = new LiveLane(clock);
          for (const o of ops) {
            if (o.op === "advance") clock.advance(o.ms);
            else if (o.op === "acquire") lane.acquire(burst(o.n));
            else if (o.op === "release") lane.release(burst(o.n));
            else if (o.op === "renew") lane.renew(burst(o.n));
            else lane.join(burst(o.n));
            const granted = [1, 2, 3, 4, 5].filter((n) => lane.position(ws(n)) === 0);
            expect(granted.length).toBeLessThanOrEqual(1);
            const positions = [1, 2, 3, 4, 5]
              .map((n) => lane.position(ws(n)))
              .filter((p): p is number => p !== null)
              .sort((a, b) => a - b);
            expect(positions).toEqual(positions.map((_, i) => i));
          }
        },
      ),
    );
  });
});
