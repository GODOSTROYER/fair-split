// Simulator clock and scheduler. Business deadlines (token expiry, AUTO_CANCEL dates, the 30-day unclaimed
// window, idempotency and sender_batch_id retention) run on the clock, which tests can move forward.
// Processing delays (batch PENDING → PROCESSING → SUCCESS, webhook retries) run on the scheduler, whose real
// delay is `seconds × speed`: SIM_SPEED=1 is real-ish, SIM_SPEED=0 runs everything on the next tick.

export interface Clock {
  now(): number;
  advance(ms: number): void;
  set(epochMs: number): void;
}

export function createClock(base: () => number = Date.now): Clock {
  let offset = 0;
  return {
    now: () => base() + offset,
    advance: (ms) => {
      offset += ms;
    },
    set: (epochMs) => {
      offset = epochMs - base();
    },
  };
}

/** `2026-10-22T10:11:12Z` (PayPal's usual second-precision timestamps). */
export function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `2026-10-22T10:11:12.345Z` (webhook event create_time carries milliseconds). */
export function isoMillis(ms: number): string {
  return new Date(ms).toISOString();
}

const ptFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The merchant's calendar date (US sandbox accounts invoice in Pacific time), `yyyy-mm-dd`. */
export function ptDate(ms: number): string {
  return ptFormat.format(new Date(ms));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

type Task = () => unknown;

export class Scheduler {
  private pending = 0;
  private generation = 0;
  private readonly waiters = new Set<() => void>();
  private readonly timers = new Set<ReturnType<typeof setTimeout> | ReturnType<typeof setImmediate>>();
  private readonly idleHooks: Task[] = [];

  constructor(
    public speed: number,
    private readonly onError: (err: unknown) => void,
  ) {}

  /** Runs `fn` after `seconds × speed` real seconds (next tick when the product is 0). */
  schedule(seconds: number, fn: Task): void {
    const ms = Math.max(0, seconds * 1000 * this.speed);
    const gen = this.generation;
    this.pending++;
    const run = async () => {
      this.timers.delete(handle);
      try {
        if (gen === this.generation) await fn();
      } catch (err) {
        this.onError(err);
      } finally {
        if (gen === this.generation) this.done();
      }
    };
    const handle: ReturnType<typeof setTimeout> | ReturnType<typeof setImmediate> =
      ms === 0 ? setImmediate(run) : setTimeout(run, ms);
    this.timers.add(handle);
  }

  /** Registers work that runs whenever the queue drains (used to release held out-of-order deliveries). */
  onIdle(fn: Task): void {
    this.idleHooks.push(fn);
  }

  private done(): void {
    this.pending--;
    if (this.pending > 0) return;
    for (const hook of this.idleHooks) {
      try {
        hook();
      } catch (err) {
        this.onError(err);
      }
    }
    if (this.pending > 0) return;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }

  get size(): number {
    return this.pending;
  }

  /** Resolves once no scheduled work remains (including work scheduled by work). */
  async idle(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.pending > 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0)
        throw new Error(`simulator did not go idle within ${timeoutMs} ms (${this.pending} tasks)`);
      let release: () => void = () => {};
      const drained = new Promise<void>((resolve) => {
        release = resolve;
        this.waiters.add(resolve);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, remaining);
      });
      await Promise.race([drained, timeout]);
      clearTimeout(timer);
      this.waiters.delete(release);
      await new Promise((r) => setImmediate(r));
    }
  }

  /** Drops every pending task (reset and close). */
  cancelAll(): void {
    this.generation++;
    for (const t of this.timers) {
      clearTimeout(t as ReturnType<typeof setTimeout>);
      clearImmediate(t as ReturnType<typeof setImmediate>);
    }
    this.timers.clear();
    this.pending = 0;
    for (const w of this.waiters) w();
    this.waiters.clear();
  }
}
