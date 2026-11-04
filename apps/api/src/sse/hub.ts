// The SSE hub (S3.7): one LISTEN connection (WS-DATA's bus) fans committed `run_events` out to streams
// scoped by workspace, run, line or public Proof. Each stream first replays everything after
// `Last-Event-ID` (scoped, at most 500 events), then streams live, with a `: ping` comment every 15 s.
//
// Caps (S3.7): 2 streams per credential, 8 per judge session (the stage opens five), 3 public streams per
// hashed network, 40 credentialed streams per network, 100 public and 300 total per instance.
// Every stream ends after 30 minutes so clients resume with Last-Event-ID. Over a cap → 429 before opening.
// A slow client never blocks the bus: its queue is bounded, and on overflow the stream ends so the client
// reconnects and replays from its Last-Event-ID (no gap, no duplicate). A credentialed stream re-checks its
// credential at every ping (`revalidate`): once it is revoked, expired or its workspace has ended, the stream
// ends and the reconnect meets the credential check.
import type { BusScope, StoredRunEvent, SubscribeOptions, Unsubscribe } from "@fairsplit/db";
import { streamSSE } from "hono/streaming";
import type { Logger } from "pino";
import { type Clock, systemClock } from "../lib/clock.js";
import type { AppContext } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { toRunEventEnvelope } from "./envelope.js";

/** What the hub needs from the LISTEN bus (`createBus()` in @fairsplit/db; an in-memory fake in tests). */
export interface BusLike {
  subscribe(scope: BusScope, cb: (e: StoredRunEvent) => void, opts?: SubscribeOptions): Promise<Unsubscribe>;
}

export interface SseLimits {
  perCredential: number;
  perJudgeSession: number;
  publicPerIp: number;
  perNetwork: number;
  publicPerInstance: number;
  perInstance: number;
}

export const SSE_LIMITS: Readonly<SseLimits> = {
  perCredential: 2,
  perJudgeSession: 8,
  publicPerIp: 3,
  perNetwork: 40,
  publicPerInstance: 100,
  perInstance: 300,
};

export const SSE_PING_MS = 15_000;
export const SSE_MAX_AGE_MS = 30 * 60_000;
/** Client reconnect hint sent once per stream (the api-client backs off 0.5–8 s on its own). */
export const SSE_RETRY_MS = 1_000;
const MAX_QUEUE = 2_000;

/** One SSE message; `data` is JSON-encoded. */
export interface SseOut {
  id: string;
  event: string;
  data: unknown;
}

export interface SseStreamRequest {
  /** Bus scope: always the credential's workspace, optionally narrowed to a run or a line. */
  scope: BusScope;
  /** Counting keys and their limits (see `capsFor*` in ./routes.ts). */
  caps: readonly { key: string; limit: number }[];
  lastEventId?: number | undefined;
  /** Extra predicate on stored events (e.g. only aggregate-safe types for public Proof). */
  filter?: (e: StoredRunEvent) => boolean;
  /** Map a stored event to what is sent; null skips it. Default: the IC-01 RunEvent envelope. */
  project?: (e: StoredRunEvent) => SseOut | null;
  maxReplay?: number;
  /** For logs and stats: "run" | "workspace" | "line" | "proof". */
  label: string;
  /**
   * Asked again at every ping: false (or a failed check) ends the stream, and the client's reconnect meets the
   * credential check. The shell's credentialed streams pass `credentialStillValid(c)` (./routes.ts), so a token
   * or link that is revoked, expires or loses its workspace stops streaming within one ping.
   */
  revalidate?: () => Promise<boolean>;
}

export interface SseStats {
  open: number;
  byLabel: Record<string, number>;
}

export interface SseHub {
  readonly limits: Readonly<SseLimits>;
  /** Opens a stream (throws ApiProblem 429 when a cap is reached). */
  open(c: AppContext, req: SseStreamRequest): Response;
  stats(): SseStats;
  /** Ends every stream (graceful shutdown: clients reconnect with Last-Event-ID). */
  close(): Promise<void>;
}

export interface SseHubOptions {
  bus: BusLike;
  logger: Logger;
  limits?: Partial<SseLimits>;
  pingMs?: number;
  clock?: Clock;
}

export function defaultProjection(e: StoredRunEvent): SseOut {
  return { id: String(e.id), event: e.type, data: toRunEventEnvelope(e) };
}

export function createSseHub(o: SseHubOptions): SseHub {
  const limits: SseLimits = { ...SSE_LIMITS, ...(o.limits ?? {}) };
  const pingMs = o.pingMs ?? SSE_PING_MS;
  const clock = o.clock ?? systemClock;
  const counts = new Map<string, number>();
  const labels = new Map<string, number>();
  const closers = new Set<() => void>();
  let open = 0;
  let closed = false;

  const bump = (m: Map<string, number>, k: string, d: number) => {
    const n = (m.get(k) ?? 0) + d;
    if (n <= 0) m.delete(k);
    else m.set(k, n);
  };

  return {
    limits,
    open(c, req) {
      if (closed) throw problem.internal("The event stream is shutting down; reconnect shortly.");
      if (open >= limits.perInstance)
        throw problem.rateLimited(5_000, "Too many live streams on this server.");
      for (const cap of req.caps) {
        if ((counts.get(cap.key) ?? 0) >= cap.limit) {
          throw problem.rateLimited(5_000, "Too many live streams for this credential. Close one and retry.");
        }
      }
      open++;
      const openedAt = clock.nowMs();
      bump(labels, req.label, 1);
      for (const cap of req.caps) bump(counts, cap.key, 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        open--;
        bump(labels, req.label, -1);
        for (const cap of req.caps) bump(counts, cap.key, -1);
      };
      const log = c.get("log") ?? o.logger;
      const project = req.project ?? defaultProjection;

      return streamSSE(c, async (stream) => {
        let unsubscribe: Unsubscribe | null = null;
        let ping: ReturnType<typeof setInterval> | null = null;
        let finish!: () => void;
        const done = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const queue: SseOut[] = [];
        let pumping = false;
        // Subscribe before the preamble is written (a client that has not read yet must not lose events);
        // nothing is written until the preamble is out.
        let ready = false;

        const end = () => finish();
        closers.add(end);
        stream.onAbort(end);

        const pump = async () => {
          if (pumping || !ready) return;
          pumping = true;
          try {
            while (queue.length > 0 && !stream.aborted && !stream.closed) {
              const m = queue.shift() as SseOut;
              await stream.writeSSE({ id: m.id, event: m.event, data: JSON.stringify(m.data) });
            }
          } catch {
            end();
          } finally {
            pumping = false;
          }
        };

        try {
          unsubscribe = await o.bus.subscribe(
            req.scope,
            (e) => {
              const m = project(e);
              if (!m) return;
              if (queue.length >= MAX_QUEUE) {
                log.warn({ label: req.label }, "sse client too slow; ending stream so it replays");
                end();
                return;
              }
              queue.push(m);
              void pump();
            },
            {
              ...(req.lastEventId !== undefined ? { afterId: req.lastEventId } : {}),
              ...(req.maxReplay !== undefined ? { maxReplay: req.maxReplay } : {}),
              ...(req.filter ? { filter: req.filter } : {}),
            },
          );
          await stream.write(`retry: ${SSE_RETRY_MS}\n: connected\n\n`);
          ready = true;
          void pump();
          let checking = false;
          ping = setInterval(() => {
            if (stream.aborted || stream.closed) return;
            if (clock.nowMs() - openedAt >= SSE_MAX_AGE_MS) {
              // Clean EOF is intentional: api-client reconnects and resumes its Last-Event-ID.
              void stream.write(`retry: ${SSE_RETRY_MS}\n\n`).then(end, end);
              return;
            }
            if (req.revalidate && !checking) {
              checking = true;
              req
                .revalidate()
                .then(
                  (valid) => {
                    if (valid) return;
                    log.debug({ label: req.label }, "sse credential no longer valid; ending stream");
                    end();
                  },
                  (err: unknown) => {
                    log.warn({ err, label: req.label }, "sse credential re-check failed; ending stream");
                    end();
                  },
                )
                .finally(() => {
                  checking = false;
                });
            }
            void stream.write(": ping\n\n").catch(end);
          }, pingMs);
          ping.unref?.();
          await done;
        } finally {
          closers.delete(end);
          if (ping) clearInterval(ping);
          unsubscribe?.();
          release();
        }
      });
    },
    stats() {
      return { open, byLabel: Object.fromEntries(labels) };
    },
    async close() {
      closed = true;
      for (const end of [...closers]) end();
    },
  };
}
