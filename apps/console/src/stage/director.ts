// The stage director (S1.6): one focal moment plays at a time across the console, the phone frames and the
// Proof chip. `data-state` changes as soon as an event is applied; only the motion waits. A moment that
// would wait more than 1.6 s plays its reduced version instead. Item landings are at least 250 ms apart (the
// payment scale plays at most four notes a second); MM-2 rows at least 180 ms apart.

import type { MomentId } from "@fairsplit/motion";

export type FocalMode = "full" | "reduced";

export interface FocalClaim {
  /** Wait this long before starting (0 when the stage is free). */
  readonly delayMs: number;
  /** Full motion, or the reduced version when the wait would have been too long. */
  readonly mode: FocalMode;
  /** Ends the claim early (the moment finished or was interrupted). */
  release(): void;
}

export const MAX_FOCAL_WAIT_MS = 1600;
export const SPACING_MS = { item: 250, row: 180 } as const;
export type SpacedChannel = keyof typeof SPACING_MS;

export class StageDirector {
  private focalUntil = 0;
  private focal: MomentId | null = null;
  private readonly lastStart: Record<SpacedChannel, number> = { item: -Infinity, row: -Infinity };
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = () => performance.now()) {}

  /** Claims the stage's focus for `durationMs` of full motion. */
  claim(moment: MomentId, durationMs: number): FocalClaim {
    const t = this.now();
    const wait = Math.max(0, this.focalUntil - t);
    if (wait > MAX_FOCAL_WAIT_MS) {
      return { delayMs: 0, mode: "reduced", release: () => undefined };
    }
    const start = t + wait;
    const until = start + Math.max(0, durationMs);
    this.focalUntil = until;
    this.focal = moment;
    this.emit();
    return {
      delayMs: wait,
      mode: "full",
      release: () => {
        if (this.focalUntil === until) {
          this.focalUntil = this.now();
          this.focal = null;
          this.emit();
        }
      },
    };
  }

  /** Delay before the next landing on a spaced channel may start, and books that slot. */
  space(channel: SpacedChannel): number {
    const t = this.now();
    const earliest = this.lastStart[channel] + SPACING_MS[channel];
    const start = Math.max(t, earliest);
    this.lastStart[channel] = start;
    return start - t;
  }

  current(): MomentId | null {
    return this.focalUntil > this.now() ? this.focal : null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
