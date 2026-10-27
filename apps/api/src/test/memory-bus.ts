// An in-memory stand-in for WS-DATA's LISTEN bus with the same delivery rules: per subscriber, every event
// of its scope with id > afterId, in id order, exactly once; the backlog for afterId is capped (maxReplay).
// `publish()` assigns ids like the bigserial does. Used by the no-database harness and SSE unit tests.
import type { BusScope, StoredRunEvent, SubscribeOptions, Unsubscribe } from "@fairsplit/db";
import type { BusLike } from "../sse/hub.js";

export interface MemoryBus extends BusLike {
  /** Append an event (the id is assigned) and deliver it to matching subscribers. */
  publish(e: Omit<StoredRunEvent, "id" | "at"> & { at?: Date }): StoredRunEvent;
  readonly events: readonly StoredRunEvent[];
  readonly subscribers: number;
}

interface Sub {
  scope: BusScope;
  cb: (e: StoredRunEvent) => void;
  filter: ((e: StoredRunEvent) => boolean) | undefined;
  cursor: number;
  closed: boolean;
}

export function createMemoryBus(): MemoryBus {
  const events: StoredRunEvent[] = [];
  const subs = new Set<Sub>();
  let nextId = 1;

  const matches = (s: Sub, e: StoredRunEvent) =>
    e.workspaceId === s.scope.workspaceId &&
    (s.scope.runId === undefined || s.scope.runId === e.runId) &&
    (s.scope.lineId === undefined || s.scope.lineId === e.lineId) &&
    (s.filter === undefined || s.filter(e));

  /** Everything after the subscriber cursor, in id order (so a live event can never overtake the backlog). */
  const drain = (s: Sub) => {
    for (const e of events) {
      if (s.closed) return;
      if (e.id <= s.cursor) continue;
      s.cursor = e.id;
      if (matches(s, e)) s.cb(e);
    }
  };

  return {
    publish(input) {
      const e: StoredRunEvent = { ...input, id: nextId++, at: input.at ?? new Date() };
      events.push(e);
      for (const s of [...subs]) drain(s);
      return e;
    },
    async subscribe(
      scope: BusScope,
      cb: (e: StoredRunEvent) => void,
      opts: SubscribeOptions = {},
    ): Promise<Unsubscribe> {
      const sub: Sub = { scope, cb, filter: opts.filter, cursor: 0, closed: false };
      if (opts.afterId === undefined) {
        sub.cursor = events.length > 0 ? (events[events.length - 1]?.id ?? 0) : 0;
      } else {
        const scoped = events.filter(
          (e) =>
            e.workspaceId === scope.workspaceId &&
            (scope.runId === undefined || scope.runId === e.runId) &&
            (scope.lineId === undefined || scope.lineId === e.lineId),
        );
        const maxReplay = opts.maxReplay ?? 500;
        const floor = scoped.length > maxReplay ? (scoped[scoped.length - maxReplay]?.id ?? 1) - 1 : 0;
        sub.cursor = Math.max(opts.afterId, floor);
      }
      subs.add(sub);
      // the backlog arrives asynchronously, like the real bus's first pump
      queueMicrotask(() => drain(sub));
      return () => {
        sub.closed = true;
        subs.delete(sub);
      };
    },
    get events() {
      return events;
    },
    get subscribers() {
      return subs.size;
    },
  };
}
