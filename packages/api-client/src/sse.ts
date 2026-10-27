// Server-sent events over `fetch` (S3.7): works with a bearer token (EventSource cannot send one), on
// `expo/fetch` in the app, and through msw in tests. Each connection sends the last seen event id as
// `Last-Event-ID`, so the server replays what was missed (deploys, Render's request cap, a phone that slept):
// no gap, no duplicate. Reconnects back off from 0.5 s to 8 s with jitter; the server's `retry:` hint raises the
// floor; a stream silent past `staleMs` (the server pings every 15 s) is dropped and reopened. A 401, 403 or
// 404 is final (the credential or the run is gone): the subscription closes and reports it.
import { RunEvent, type SseScope } from "@fairsplit/contracts";
import { createParser, type EventSourceMessage } from "eventsource-parser";
import { type ClientFailure, ContractError, failureFromBody, NetworkError } from "./errors.js";
import { type CredentialsMode, HEADER, railOf, SSE_BACKOFF, SSE_STALE_MS, ssePath } from "./http.js";

export type SseState = "connecting" | "open" | "reconnecting" | "closed";

export interface SseRawMessage {
  id: string | undefined;
  event: string | undefined;
  /** The `data:` field, JSON-parsed when it is JSON. */
  data: unknown;
}

export interface SseHandlers {
  /** Every IC-01 RunEvent, in id order (run, workspace and line streams). */
  onEvent?(event: RunEvent): void;
  /** Messages that are not RunEvents: the public Proof stream's aggregates, or a payload that failed validation. */
  onMessage?(message: SseRawMessage): void;
  onState?(state: SseState, info: { attempt: number; lastEventId: string | null }): void;
  /** `willRetry` false means the subscription has closed for good (credential refused, scope not found). */
  onError?(failure: ClientFailure, willRetry: boolean): void;
}

export interface SseOptions {
  /** Resume after this id (e.g. the last event a cached screen already applied). */
  lastEventId?: string | null;
  /** Validate each message against the IC-01 RunEvent union (default true). */
  validate?: boolean;
  backoff?: { minMs?: number; maxMs?: number };
  /** Reopen a stream that sent nothing (not even a ping) for this long (default 45 s). */
  staleMs?: number;
  /** Jitter source in [0, 1) (tests pass a constant). */
  random?: () => number;
  timers?: {
    setTimeout(fn: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
}

export interface SubscribeTransport {
  baseUrl: string;
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  token: () => Promise<string | null>;
  credentials: CredentialsMode;
}

export interface Subscription {
  close(): void;
  readonly state: SseState;
  readonly lastEventId: string | null;
  /** Resolves once the subscription has stopped (closed by you or by a final error). */
  readonly done: Promise<void>;
}

const FINAL_STATUSES = new Set([401, 403, 404, 410]);

export function subscribe(
  scope: SseScope,
  handlers: SseHandlers,
  o: SseOptions & SubscribeTransport,
): Subscription {
  const path = ssePath(scope);
  const url = `${o.baseUrl}${path}`;
  const name = `SSE ${path}`;
  const minMs = o.backoff?.minMs ?? SSE_BACKOFF.minMs;
  const maxMs = o.backoff?.maxMs ?? SSE_BACKOFF.maxMs;
  const staleMs = o.staleMs ?? SSE_STALE_MS;
  const random = o.random ?? Math.random;
  const timers = o.timers ?? {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (h: unknown) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const validate = o.validate ?? true;
  const aggregates = scope.kind === "proof";

  let state: SseState | null = null;
  let lastEventId: string | null = o.lastEventId ?? null;
  let closed = false;
  let attempt = 0;
  let serverRetryMs: number | null = null;
  let controller: AbortController | null = null;
  let wake: (() => void) | null = null;

  const setState = (next: SseState) => {
    if (state === next) return;
    state = next;
    safe(() => handlers.onState?.(next, { attempt, lastEventId }));
  };
  const fail = (failure: ClientFailure, willRetry: boolean) =>
    safe(() => handlers.onError?.(failure, willRetry));

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const handle = timers.setTimeout(() => {
        wake = null;
        resolve();
      }, ms);
      wake = () => {
        timers.clearTimeout(handle);
        wake = null;
        resolve();
      };
    });

  const backoffMs = (n: number) => {
    const floor = Math.max(minMs, serverRetryMs ?? 0);
    const base = Math.min(maxMs, floor * 2 ** n);
    return Math.round(base / 2 + random() * (base / 2));
  };

  const dispatch = (m: EventSourceMessage) => {
    if (m.id !== undefined && m.id !== "") lastEventId = m.id;
    let data: unknown = m.data;
    try {
      data = JSON.parse(m.data);
    } catch {
      // not JSON: hand it over as text
    }
    if (aggregates || !handlers.onEvent) {
      safe(() => handlers.onMessage?.({ id: m.id, event: m.event, data }));
      return;
    }
    if (!validate) {
      safe(() => handlers.onEvent?.(data as RunEvent));
      return;
    }
    const parsed = RunEvent.safeParse(data);
    if (parsed.success) {
      safe(() => handlers.onEvent?.(parsed.data));
    } else {
      fail(
        new ContractError(
          name,
          200,
          `event ${m.id ?? "?"} is not an IC-01 RunEvent`,
          parsed.error.issues.slice(0, 5).map((i) => ({ path: i.path.join("."), message: i.message })),
        ),
        true,
      );
      safe(() => handlers.onMessage?.({ id: m.id, event: m.event, data }));
    }
  };

  async function connectOnce(): Promise<"ended" | "final"> {
    controller = new AbortController();
    const headers = new Headers({ accept: "text/event-stream", "cache-control": "no-cache" });
    const token = await o.token();
    if (token && !aggregates) headers.set("authorization", `Bearer ${token}`);
    if (lastEventId) headers.set(HEADER.lastEventId, lastEventId);
    let res: Response;
    try {
      res = await o.fetch(url, {
        method: "GET",
        headers,
        credentials: o.credentials,
        signal: controller.signal,
      });
    } catch (err) {
      if (!closed) fail(new NetworkError(name, err, false), true);
      return "ended";
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const failure = failureFromBody(res.status, text, {
        command: name,
        rail: railOf(res.headers.get(HEADER.rail)),
        requestId: res.headers.get(HEADER.requestId),
      });
      if (FINAL_STATUSES.has(res.status)) {
        fail(failure, false);
        return "final";
      }
      fail(failure, true);
      const retryAfter = "retryAfterMs" in failure ? failure.retryAfterMs : null;
      if (retryAfter) serverRetryMs = Math.min(maxMs, Math.max(serverRetryMs ?? 0, retryAfter));
      return "ended";
    }
    if (!res.body) {
      fail(new ContractError(name, res.status, "the event stream has no body"), true);
      return "ended";
    }

    setState("open");
    let received = false;
    const parser = createParser({
      onEvent: (m) => {
        received = true;
        dispatch(m);
      },
      onRetry: (ms) => {
        serverRetryMs = ms;
      },
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let stale: unknown = null;
    const armStale = () => {
      if (stale !== null) timers.clearTimeout(stale);
      stale = timers.setTimeout(() => controller?.abort(), staleMs);
    };
    armStale();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armStale();
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      if (!closed) fail(new NetworkError(name, err, false), true);
    } finally {
      if (stale !== null) timers.clearTimeout(stale);
      reader.cancel().catch(() => undefined);
    }
    if (received) attempt = 0;
    return "ended";
  }

  const done = (async () => {
    // Let the caller keep the returned handle before the first connection starts.
    await Promise.resolve();
    let first = true;
    while (!closed) {
      setState(first ? "connecting" : "reconnecting");
      first = false;
      const outcome = await connectOnce();
      if (outcome === "final" || closed) break;
      setState("reconnecting");
      await sleep(backoffMs(attempt));
      attempt++;
    }
    closed = true;
    setState("closed");
  })();

  return {
    close() {
      if (closed) return;
      closed = true;
      controller?.abort();
      wake?.();
    },
    get state(): SseState {
      return state ?? "connecting";
    },
    get lastEventId() {
      return lastEventId;
    },
    done,
  };
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // a handler's bug must not kill the stream
  }
}
