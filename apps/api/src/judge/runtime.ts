// Per-process judge state, one per `AppDeps` (so every test app gets its own): the live lane, the presence
// throttle, the background pool refill and the on-demand clone gate. fs-api runs one instance (register §6);
// everything durable (sessions, quotas, codes, tamper arming) lives in Postgres, so a restart loses only
// queue positions and presence, which clients re-establish within seconds.
import type { AppDeps } from "../lib/context.js";
import type { RateRule } from "../lib/rate-limit.js";
import { LiveLane } from "./lane.js";
import { POOL_TARGET, refillPool } from "./pool.js";

/** The judge slice's own throttles (the shell's RATE_RULES cover presence, claims and session starts). */
export const JUDGE_RATE_RULES = {
  /** Stage frames re-mint 5 minutes before expiry; 30 in 10 minutes is far above a real stage. */
  frames: { name: "judgeFrames", limit: 30, windowMs: 600_000 },
  /** A resumed session mints a fresh console token. */
  resume: { name: "judgeResume", limit: 60, windowMs: 3_600_000 },
  pairingCreate: { name: "pairingCreate", limit: 20, windowMs: 600_000 },
  /** Every 6-digit claim attempt, all clients together: guessing a live code stays hopeless. */
  pairingCode6Global: { name: "pairingCode6Global", limit: 60, windowMs: 60_000 },
  /** The real guard against guessing: 5 a minute per hashed IP (a scrypt check each). */
  opsLoginPerIp: { name: "opsLoginPerIp", limit: 5, windowMs: 60_000 },
  /**
   * Only a backstop on scrypt work (about 5 checks a second at most): far above what a crowd of guessers
   * at 5 a minute each can use up quickly, so they cannot lock the operator out of /ops.
   */
  opsLoginGlobal: { name: "opsLoginGlobal", limit: 300, windowMs: 60_000 },
  /**
   * Judge-code guesses. The per-IP rule keys on the trusted hop's address (src/lib/client-ip.ts); the session
   * rule holds however many networks one session uses; the global rule bounds every session and network together
   * (a judge types the code once or twice, so guessing stays hopeless while a lockout lasts a minute at most).
   */
  judgeCodePerIp: { name: "judgeCodePerIp", limit: 5, windowMs: 60_000 },
  judgeCodePerSession: { name: "judgeCodePerSession", limit: 5, windowMs: 600_000 },
  judgeCodeGlobal: { name: "judgeCodeGlobal", limit: 30, windowMs: 60_000 },
  tamper: { name: "judgeTamper", limit: 10, windowMs: 600_000 },
  links: { name: "linkIssue", limit: 60, windowMs: 600_000 },
  /** Brand links are the operator's: a handful per brand conversation. */
  brandLinks: { name: "brandLinkIssue", limit: 20, windowMs: 600_000 },
  /** The operator pairing officers' phones outside Judge Mode. */
  opsPairing: { name: "opsPairing", limit: 20, windowMs: 600_000 },
  keys: { name: "judgeKeys", limit: 10, windowMs: 600_000 },
  flags: { name: "judgeFlags", limit: 10, windowMs: 60_000 },
  /** The public "What's real" view: per hashed IP (the view itself is cached for 2 s). */
  publicLane: { name: "judgeLaneView", limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateRule>;

/** S3.7: presence events at most one per 5 s per persona, expiring after 25 s. */
export const PRESENCE = { minGapMs: 5_000, refreshAfterMs: 20_000, ttlMs: 25_000 } as const;

export class PresenceTracker {
  readonly #last = new Map<string, { at: number; view: string; holdId: string | null }>();

  /**
   * Emit when there is nothing recent, when the view changed and 5 s have passed, or when the same view is
   * about to expire (refreshed every 20 s, inside the 25 s lifetime). Never more than one per 5 s.
   */
  shouldEmit(key: string, view: string, holdId: string | null, now: number): boolean {
    const last = this.#last.get(key);
    const changed = !last || last.view !== view || last.holdId !== holdId;
    const gap = last ? now - last.at : Number.POSITIVE_INFINITY;
    const emit = gap >= PRESENCE.minGapMs && (changed || gap >= PRESENCE.refreshAfterMs);
    if (emit) {
      if (this.#last.size > 10_000) this.#sweep(now);
      this.#last.set(key, { at: now, view, holdId });
    }
    return emit;
  }

  forgetWorkspace(workspaceId: string): void {
    for (const k of this.#last.keys()) if (k.startsWith(`${workspaceId}|`)) this.#last.delete(k);
  }

  #sweep(now: number): void {
    for (const [k, v] of this.#last) if (now - v.at > PRESENCE.ttlMs) this.#last.delete(k);
  }
}

/** How long the public "What's real" view is served from memory (money decisions always read fresh). */
export const PUBLIC_VIEW_TTL_MS = 2_000;
const PUBLIC_VIEW_MAX_KEYS = 1_000;

export interface JudgeRuntime {
  readonly lane: LiveLane;
  readonly presence: PresenceTracker;
  /**
   * A public, read-only view computed at most once per `PUBLIC_VIEW_TTL_MS` per key (concurrent callers
   * share one computation). Never for a decision: `judgeRail` and `beginLiveStep` always read fresh.
   */
  cachedView<T>(key: string, nowMs: number, compute: () => Promise<T>): Promise<T>;
  /** Starts a pool refill in the background unless one is running (errors are logged, never thrown). */
  refillSoon(target?: number): void;
  /** Resolves when no background refill is running (tests, shutdown). */
  idle(): Promise<void>;
  /** On-demand clones (empty pool) run at most two at a time; a third judge is told to retry (QUEUED). */
  tryEnterClone(): boolean;
  leaveClone(): void;
}

export const MAX_CONCURRENT_CLONES = 2;

const runtimes = new WeakMap<AppDeps, JudgeRuntime>();

export function judgeRuntime(deps: AppDeps): JudgeRuntime {
  let rt = runtimes.get(deps);
  if (rt) return rt;
  let refilling: Promise<void> | null = null;
  let clones = 0;
  const views = new Map<string, { at: number; value: Promise<unknown> }>();
  rt = {
    lane: new LiveLane(deps.clock),
    presence: new PresenceTracker(),
    cachedView<T>(key: string, nowMs: number, compute: () => Promise<T>): Promise<T> {
      const hit = views.get(key);
      if (hit && nowMs - hit.at < PUBLIC_VIEW_TTL_MS && nowMs >= hit.at) return hit.value as Promise<T>;
      if (views.size >= PUBLIC_VIEW_MAX_KEYS) views.clear();
      const value = compute();
      views.set(key, { at: nowMs, value });
      value.catch(() => {
        if (views.get(key)?.value === value) views.delete(key);
      });
      return value;
    },
    refillSoon(target = POOL_TARGET) {
      if (refilling) return;
      refilling = (async () => {
        try {
          const created = await refillPool(deps.db, target);
          if (created > 0) deps.logger.info({ created }, "judge pool refilled");
        } catch (err) {
          deps.logger.warn({ err }, "judge pool refill failed");
        } finally {
          refilling = null;
        }
      })();
    },
    async idle() {
      while (refilling) await refilling;
    },
    tryEnterClone() {
      if (clones >= MAX_CONCURRENT_CLONES) return false;
      clones++;
      return true;
    },
    leaveClone() {
      clones = Math.max(0, clones - 1);
    },
  };
  runtimes.set(deps, rt);
  return rt;
}
