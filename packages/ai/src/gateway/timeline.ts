import type { TimelineEntry } from "./types.js";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/** Collects a live stream's text deltas into a `replay_timeline`. */
export class TimelineRecorder {
  readonly entries: TimelineEntry[] = [];
  private text = "";
  private firstDelta: number | null = null;

  constructor(private readonly t0: number = performance.now()) {}

  delta(d: string): string {
    const ms = Math.round(performance.now() - this.t0);
    if (this.firstDelta === null) this.firstDelta = ms;
    this.entries.push({ ms, d });
    this.text += d;
    return this.text;
  }

  reset(): void {
    this.entries.push({ ms: Math.round(performance.now() - this.t0), reset: true });
    this.text = "";
  }

  get firstDeltaMs(): number | null {
    return this.firstDelta;
  }
}

export interface ReplayHandlers {
  onSnapshot?: (jsonSoFar: string) => void;
  onReset?: () => void;
}

/**
 * Re-emits recorded deltas at their recorded offsets divided by `speed` (S4.1 step 2).
 * `speed` Infinity (the default) emits every snapshot without waiting.
 */
export async function replayTimeline(
  timeline: readonly TimelineEntry[],
  handlers: ReplayHandlers,
  options: { speed?: number; sleep?: Sleep; signal?: AbortSignal } = {},
): Promise<void> {
  const speed = options.speed ?? Number.POSITIVE_INFINITY;
  if (!(speed > 0)) throw new RangeError("replay speed must be > 0");
  const sleep = options.sleep ?? realSleep;
  let text = "";
  let elapsed = 0;
  for (const entry of timeline) {
    options.signal?.throwIfAborted();
    if (Number.isFinite(speed)) {
      const due = entry.ms / speed;
      if (due > elapsed) {
        await sleep(due - elapsed, options.signal);
        elapsed = due;
      }
    }
    if (entry.reset) {
      text = "";
      handlers.onReset?.();
      handlers.onSnapshot?.("");
      continue;
    }
    if (entry.d !== undefined) {
      text += entry.d;
      handlers.onSnapshot?.(text);
    }
  }
}
