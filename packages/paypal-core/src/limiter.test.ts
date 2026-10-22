import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createMemoryLimiter, LIMITER_DEFAULTS, unlimitedLimiter } from "./limiter.js";
import { manualClock } from "./test-support.js";

const live = { purpose: "payouts.get", priority: "live" } as const;
const background = { purpose: "reporting.search", priority: "background" } as const;

describe("in-memory limiter (reference semantics for the Postgres limiter)", () => {
  it("uses the register's numbers: 40/min, 20 background, 6-minute circuit", () => {
    expect(LIMITER_DEFAULTS).toEqual({
      perMinute: 40,
      backgroundPerMinute: 20,
      windowMs: 60_000,
      circuitMs: 360_000,
    });
  });

  it("allows 40 calls in a window and tells the 41st when to come back", async () => {
    const clock = manualClock();
    const limiter = createMemoryLimiter({ now: clock.now });
    for (let i = 0; i < 40; i++) {
      expect((await limiter.take(live)).ok).toBe(true);
      clock.advance(500);
    }
    const denied = await limiter.take(live);
    expect(denied).toEqual({ ok: false, reason: "WINDOW_FULL", retryAfterMs: 40_000 });
    clock.advance(40_000);
    expect((await limiter.take(live)).ok).toBe(true);
  });

  it("caps background work at 20 so live calls always keep 20", async () => {
    const clock = manualClock();
    const limiter = createMemoryLimiter({ now: clock.now });
    for (let i = 0; i < 20; i++) expect((await limiter.take(background)).ok).toBe(true);
    expect(await limiter.take(background)).toMatchObject({ ok: false, reason: "BACKGROUND_SHARE_FULL" });
    for (let i = 0; i < 20; i++) expect((await limiter.take(live)).ok).toBe(true);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "WINDOW_FULL" });
    expect(limiter.snapshot()).toMatchObject({
      inWindow: 40,
      backgroundInWindow: 20,
      circuitOpenUntil: null,
    });
  });

  it("refuses everything for 6 minutes after a 429", async () => {
    const clock = manualClock();
    const limiter = createMemoryLimiter({ now: clock.now });
    limiter.reportRateLimited(new Date(clock.now()));
    expect(await limiter.take(live)).toEqual({ ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: 360_000 });
    clock.advance(359_999);
    expect(await limiter.take(live)).toEqual({ ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: 1 });
    clock.advance(1);
    expect((await limiter.take(live)).ok).toBe(true);
  });

  it("never admits more than 40 calls in any 60 s window, whatever the arrival pattern", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ gap: fc.integer({ min: 0, max: 4_000 }), bg: fc.boolean() }), {
          maxLength: 300,
        }),
        async (arrivals) => {
          const clock = manualClock();
          const limiter = createMemoryLimiter({ now: clock.now });
          const admitted: { at: number; bg: boolean }[] = [];
          for (const a of arrivals) {
            clock.advance(a.gap);
            if ((await limiter.take(a.bg ? background : live)).ok)
              admitted.push({ at: clock.now(), bg: a.bg });
          }
          for (const first of admitted) {
            const inWindow = admitted.filter((x) => x.at >= first.at && x.at < first.at + 60_000);
            expect(inWindow.length).toBeLessThanOrEqual(40);
            expect(inWindow.filter((x) => x.bg).length).toBeLessThanOrEqual(20);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("unlimitedLimiter always allows", async () => {
    expect(await unlimitedLimiter.take(live)).toEqual({ ok: true });
  });
});
