// The single-flight live lane (S3.9, plan "Limits"): live judge PayPal steps run one burst at a time, in
// arrival order, and every judge can see where they stand ("You're next, about 40 s"). fs-api runs one
// instance (register §6), so the lane is in-process; the shared Postgres limiter still bounds every call.
//
// A burst is one step of one workspace (the first press's six invoice calls, the batch POST, a cancel…).
// The head of the queue holds the lane:
//   - when an entry reaches the head it is RESERVED for `reserveMs` (its task has not asked yet);
//   - `acquire()` by the head turns the reservation into a LEASE of `leaseMs`, renewable;
//   - `release()` frees it at once; an expired reservation or lease frees it lazily (no timers: every call
//     sweeps with the injected clock), so a judge who walks away can never block the next one.
// Callers never wait inside the lane: a step that is not at the head is told its position and retries
// (the outbox re-queues it), so no request or task holds a promise open on someone else's burst.
import type { Clock } from "../lib/clock.js";

export interface LaneEntryInput {
  workspaceId: string;
  /** e.g. "invoice", "post", "cancel", "resend". */
  step: string;
  sessionId: string | null;
}

interface Entry extends LaneEntryInput {
  key: string;
  joinedAt: number;
  /** When it reached the head (null while queued). */
  headSince: number | null;
  /** Reservation or lease end (head only). */
  until: number | null;
  leased: boolean;
}

export interface LaneOptions {
  /** How long a granted burst may hold the lane without renewing (default 90 s). */
  leaseMs: number;
  /** How long the head keeps its turn before it asks (default 60 s). */
  reserveMs: number;
  /** Typical burst, for the ETA copy (default 40 s). */
  burstMs: number;
  /** Longest queue (default 50); joining a full lane is refused, and the caller replays. */
  maxQueue: number;
}

export const LANE_DEFAULTS: LaneOptions = {
  leaseMs: 90_000,
  reserveMs: 60_000,
  burstMs: 40_000,
  maxQueue: 50,
};

export type LaneGrant =
  | { granted: true; position: 0; leaseUntil: Date }
  | { granted: false; position: number; etaMs: number }
  | { granted: false; position: null; full: true };

export interface LaneView {
  holder: {
    workspaceId: string;
    step: string;
    sessionId: string | null;
    leased: boolean;
    until: Date;
  } | null;
  queued: number;
  depth: number;
}

export function laneKey(e: Pick<LaneEntryInput, "workspaceId" | "step">): string {
  return `${e.workspaceId}:${e.step}`;
}

export class LiveLane {
  readonly #clock: Clock;
  readonly #o: LaneOptions;
  #entries: Entry[] = [];

  constructor(clock: Clock, opts: Partial<LaneOptions> = {}) {
    this.#clock = clock;
    this.#o = { ...LANE_DEFAULTS, ...opts };
  }

  get options(): Readonly<LaneOptions> {
    return this.#o;
  }

  /** Drops an expired head (reservation or lease) and starts the next one's reservation. */
  #sweep(now: number): void {
    for (;;) {
      const head = this.#entries[0];
      if (!head) return;
      if (head.headSince === null) {
        head.headSince = now;
        head.until = now + this.#o.reserveMs;
        return;
      }
      if ((head.until ?? 0) > now) return;
      this.#entries.shift();
    }
  }

  #index(key: string): number {
    return this.#entries.findIndex((e) => e.key === key);
  }

  #eta(position: number): number {
    return position * this.#o.burstMs;
  }

  /** Joins the queue (idempotent per workspace and step). Returns the position (0 = its turn), or null if full. */
  join(e: LaneEntryInput): number | null {
    const now = this.#clock.nowMs();
    this.#sweep(now);
    const key = laneKey(e);
    const at = this.#index(key);
    if (at >= 0) return at;
    if (this.#entries.length >= this.#o.maxQueue) return null;
    this.#entries.push({ ...e, key, joinedAt: now, headSince: null, until: null, leased: false });
    this.#sweep(now);
    return this.#index(key);
  }

  /** Takes the lane if it is this burst's turn (joining first if needed); otherwise reports the position. */
  acquire(e: LaneEntryInput): LaneGrant {
    const position = this.join(e);
    if (position === null) return { granted: false, position: null, full: true };
    if (position > 0) return { granted: false, position, etaMs: this.#eta(position) };
    const head = this.#entries[0] as Entry;
    const now = this.#clock.nowMs();
    head.leased = true;
    head.until = now + this.#o.leaseMs;
    return { granted: true, position: 0, leaseUntil: new Date(head.until) };
  }

  /** Extends a held lease (a long burst reporting progress). False when it no longer holds the lane. */
  renew(e: Pick<LaneEntryInput, "workspaceId" | "step">): boolean {
    const now = this.#clock.nowMs();
    this.#sweep(now);
    const head = this.#entries[0];
    if (!head || head.key !== laneKey(e) || !head.leased) return false;
    head.until = now + this.#o.leaseMs;
    return true;
  }

  /** Leaves the lane (held or queued). Idempotent. */
  release(e: Pick<LaneEntryInput, "workspaceId" | "step">): void {
    const at = this.#index(laneKey(e));
    if (at >= 0) this.#entries.splice(at, 1);
    this.#sweep(this.#clock.nowMs());
  }

  /** Leaves every burst of a workspace (judge Reset). */
  releaseWorkspace(workspaceId: string): void {
    this.#entries = this.#entries.filter((e) => e.workspaceId !== workspaceId);
    this.#sweep(this.#clock.nowMs());
  }

  /** The first position any burst of this workspace holds (0 = its turn), or null when it is not in the lane. */
  position(workspaceId: string): number | null {
    this.#sweep(this.#clock.nowMs());
    const at = this.#entries.findIndex((x) => x.workspaceId === workspaceId);
    return at >= 0 ? at : null;
  }

  etaMs(position: number): number {
    return this.#eta(position);
  }

  view(): LaneView {
    this.#sweep(this.#clock.nowMs());
    const head = this.#entries[0];
    return {
      holder: head
        ? {
            workspaceId: head.workspaceId,
            step: head.step,
            sessionId: head.sessionId,
            leased: head.leased,
            until: new Date(head.until ?? 0),
          }
        : null,
      queued: Math.max(0, this.#entries.length - 1),
      depth: this.#entries.length,
    };
  }
}
