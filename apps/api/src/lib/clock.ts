// Time is injected, never read from `Date.now()` inside a handler: credentials expire, quotas roll and
// approvals carry `exp` against this clock, so tests (and the Judge Mode replay) can move it.

export interface Clock {
  /** The current instant. */
  now(): Date;
  /** The current instant in epoch milliseconds. */
  nowMs(): number;
}

export const systemClock: Clock = {
  now: () => new Date(),
  nowMs: () => Date.now(),
};

/** A clock that only moves when told to. `createTestApp()` hands one to every handler. */
export interface FakeClock extends Clock {
  /** Move forward by `ms` (negative values are refused: time never runs backwards here either). */
  advance(ms: number): Date;
  /** Jump to an instant at or after the current one. */
  set(at: Date | string | number): Date;
}

export function createFakeClock(start: Date | string | number = "2026-10-28T02:00:00.000Z"): FakeClock {
  let t = toMs(start);
  return {
    now: () => new Date(t),
    nowMs: () => t,
    advance(ms) {
      if (!Number.isFinite(ms) || ms < 0) throw new RangeError("a fake clock only moves forward");
      t += ms;
      return new Date(t);
    },
    set(at) {
      const next = toMs(at);
      if (next < t) throw new RangeError("a fake clock only moves forward");
      t = next;
      return new Date(t);
    },
  };
}

function toMs(v: Date | string | number): number {
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  if (!Number.isFinite(ms)) throw new RangeError(`not an instant: ${String(v)}`);
  return ms;
}
