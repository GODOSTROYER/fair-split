/**
 * The LISTEN bus (architecture §8, S3.7): one dedicated, non-pooled LISTEN connection per process feeding an
 * in-memory fan-out. `subscribe(scope, cb, { afterId })` delivers every committed run_event of the scope with
 * id > afterId, in id order, exactly once per subscriber:
 *
 * - NOTIFY carries ids only ("<ws>:<id>"); the bus reads rows with `id > cursor` for that workspace, so a lost
 *   or coalesced notification can never create a gap, and one read serves every subscriber of the workspace.
 * - Event ids within a workspace are assigned in commit order (see events.ts), so cursor reads are gap-free.
 * - postgres.js re-establishes the LISTEN connection after a drop; on every (re)listen the bus re-reads each
 *   subscribed workspace from its cursors, so notifications missed while disconnected are caught up.
 * - With afterId (SSE Last-Event-ID) the subscriber first receives the backlog, at most `maxReplay` events.
 */
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import postgres, { type Sql } from "postgres";
import type { Db } from "./client.js";
import type { StoredRunEvent } from "./events.js";
import { runEvents } from "./schema/index.js";

export const RUN_EVENTS_CHANNEL = "run_events";
const PING_CHANNEL = "fs_bus_ping";

export interface BusScope {
  workspaceId: string;
  runId?: string;
  lineId?: string;
}

export interface SubscribeOptions {
  /** deliver events with id > afterId (SSE Last-Event-ID); omitted: only events committed from now on */
  afterId?: number;
  /** cap on the backlog replayed for afterId (default 500) */
  maxReplay?: number;
  /** extra predicate, e.g. the public Proof stream's redaction filter */
  filter?: (e: StoredRunEvent) => boolean;
}

export type Unsubscribe = () => void;

export interface Bus {
  start(): Promise<void>;
  subscribe(scope: BusScope, cb: (e: StoredRunEvent) => void, opts?: SubscribeOptions): Promise<Unsubscribe>;
  /** LISTEN round-trip in ms (for /readyz: < 2 s, checked every 30 s) */
  ping(timeoutMs?: number): Promise<number>;
  readonly listening: boolean;
  /** number of (re)listens so far: 1 after start, +1 per reconnect */
  readonly listenCount: number;
  close(): Promise<void>;
}

interface Sub {
  scope: BusScope;
  cb: (e: StoredRunEvent) => void;
  filter?: (e: StoredRunEvent) => boolean;
  cursor: number;
  closed: boolean;
}

interface WsState {
  subs: Set<Sub>;
  pumping: boolean;
  again: boolean;
}

const BATCH = 500;

export interface BusOptions {
  /** connection string for the dedicated LISTEN connection */
  url: string;
  /** pooled Drizzle handle used to read events */
  db: Db;
  onError?: (e: unknown) => void;
}

export function createBus(opts: BusOptions): Bus {
  const listenSql: Sql = postgres(opts.url, { max: 1, onnotice: () => {}, idle_timeout: 0 });
  const workspaces = new Map<string, WsState>();
  const pings = new Map<string, () => void>();
  let listening = false;
  let listenCount = 0;
  let closed = false;
  let unlisten: Array<() => Promise<void>> = [];
  const onError = opts.onError ?? (() => {});

  const matches = (s: Sub, e: StoredRunEvent) =>
    (s.scope.runId === undefined || s.scope.runId === e.runId) &&
    (s.scope.lineId === undefined || s.scope.lineId === e.lineId) &&
    (s.filter === undefined || s.filter(e));

  async function pump(ws: string): Promise<void> {
    const st = workspaces.get(ws);
    if (!st) return;
    if (st.pumping) {
      st.again = true;
      return;
    }
    st.pumping = true;
    try {
      do {
        st.again = false;
        for (;;) {
          const live = [...st.subs].filter((s) => !s.closed);
          if (live.length === 0) break;
          const from = Math.min(...live.map((s) => s.cursor));
          const rows = (await opts.db
            .select()
            .from(runEvents)
            .where(and(eq(runEvents.workspaceId, ws), gt(runEvents.id, from)))
            .orderBy(asc(runEvents.id))
            .limit(BATCH)) as StoredRunEvent[];
          for (const e of rows) {
            for (const s of live) {
              if (s.closed || e.id <= s.cursor) continue;
              s.cursor = e.id;
              if (!matches(s, e)) continue;
              try {
                s.cb(e);
              } catch (err) {
                onError(err);
              }
            }
          }
          if (rows.length < BATCH) break;
        }
      } while (st.again);
    } catch (err) {
      onError(err);
      // a failed read (pool hiccup) is retried from the same cursors, so nothing is skipped
      if (!closed) setTimeout(() => void pump(ws), 1000).unref?.();
    } finally {
      st.pumping = false;
      if (st.subs.size === 0) workspaces.delete(ws);
    }
  }

  const onNotify = (payload: string) => {
    const ws = payload.slice(0, payload.indexOf(":"));
    if (workspaces.has(ws)) void pump(ws);
  };

  const onListen = () => {
    listening = true;
    listenCount++;
    // after a reconnect, anything committed while we were deaf is read from the cursors
    for (const ws of workspaces.keys()) void pump(ws);
  };

  async function start(): Promise<void> {
    if (unlisten.length > 0) return;
    const a = await listenSql.listen(RUN_EVENTS_CHANNEL, onNotify, onListen);
    const b = await listenSql.listen(PING_CHANNEL, (nonce) => pings.get(nonce)?.());
    unlisten = [a.unlisten, b.unlisten];
  }

  async function subscribe(
    scope: BusScope,
    cb: (e: StoredRunEvent) => void,
    o: SubscribeOptions = {},
  ): Promise<Unsubscribe> {
    if (closed) throw new Error("bus is closed");
    const maxReplay = o.maxReplay ?? BATCH;
    let cursor: number;
    if (o.afterId === undefined) {
      const [last] = await opts.db
        .select({ id: runEvents.id })
        .from(runEvents)
        .where(eq(runEvents.workspaceId, scope.workspaceId))
        .orderBy(desc(runEvents.id))
        .limit(1);
      cursor = last?.id ?? 0;
    } else {
      // bound the backlog: start no earlier than the maxReplay-th newest event of this scope
      const floorRows = await opts.db
        .select({ id: runEvents.id })
        .from(runEvents)
        .where(
          and(
            eq(runEvents.workspaceId, scope.workspaceId),
            scope.runId ? eq(runEvents.runId, scope.runId) : sql`true`,
            scope.lineId ? eq(runEvents.lineId, scope.lineId) : sql`true`,
          ),
        )
        .orderBy(desc(runEvents.id))
        .limit(1)
        .offset(Math.max(0, maxReplay - 1));
      const floor = floorRows[0] ? floorRows[0].id - 1 : 0;
      cursor = Math.max(o.afterId, floor);
    }
    const sub: Sub = { scope, cb, filter: o.filter, cursor, closed: false };
    let st = workspaces.get(scope.workspaceId);
    if (!st) {
      st = { subs: new Set(), pumping: false, again: false };
      workspaces.set(scope.workspaceId, st);
    }
    st.subs.add(sub);
    void pump(scope.workspaceId);
    return () => {
      sub.closed = true;
      const s = workspaces.get(scope.workspaceId);
      if (!s) return;
      s.subs.delete(sub);
      if (s.subs.size === 0 && !s.pumping) workspaces.delete(scope.workspaceId);
    };
  }

  async function ping(timeoutMs = 2000): Promise<number> {
    const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const t0 = performance.now();
    const heard = new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        pings.delete(nonce);
        reject(new Error(`bus ping timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      pings.set(nonce, () => {
        clearTimeout(timer);
        pings.delete(nonce);
        resolve(performance.now() - t0);
      });
    });
    await opts.db.execute(sql`select pg_notify(${PING_CHANNEL}, ${nonce})`);
    return heard;
  }

  async function close(): Promise<void> {
    closed = true;
    for (const st of workspaces.values()) for (const s of st.subs) s.closed = true;
    workspaces.clear();
    await Promise.allSettled(unlisten.map((u) => u()));
    unlisten = [];
    listening = false;
    await listenSql.end({ timeout: 5 });
  }

  return {
    start,
    subscribe,
    ping,
    close,
    get listening() {
      return listening;
    },
    get listenCount() {
      return listenCount;
    },
  };
}
