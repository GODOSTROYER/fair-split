// SSE over fetch (S3.7): a bearer token in a header (EventSource cannot send one), Last-Event-ID on every
// reconnect so the server replays what was missed, and a 0.5 to 8 s backoff. Every frame is parsed against
// IC-01's RunEvent; anything else is dropped, never guessed at.

import { RunEvent } from "@fairsplit/contracts";
import { type EventSourceMessage, EventSourceParserStream } from "eventsource-parser/stream";
import type { StreamStatus } from "./adapter.js";

export interface EventStreamOptions {
  readonly url: string;
  readonly token?: () => string | null;
  readonly lastEventId?: string | null;
  readonly fetch?: typeof fetch;
  readonly onEvent: (event: RunEvent) => void;
  readonly onStatus?: (status: StreamStatus) => void;
  /** Reconnect backoff bounds in ms (S3.7: 0.5 to 8 s). */
  readonly backoff?: { readonly minMs: number; readonly maxMs: number };
}

export interface EventStream {
  close(): void;
  lastEventId(): string | null;
  /** Frames that were not a valid RunEvent (dropped). */
  rejected(): number;
}

export const BACKOFF = { minMs: 500, maxMs: 8000 } as const;

/** Delay before reconnect attempt n (1-based): doubling from minMs, capped at maxMs. */
export function backoffDelay(attempt: number, bounds: { minMs: number; maxMs: number } = BACKOFF): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(bounds.maxMs, bounds.minMs * 2 ** (n - 1));
}

class StreamStop extends Error {
  constructor(readonly reason: "unauthorized" | "not-found") {
    super(reason);
  }
}

export function openEventStream(options: EventStreamOptions): EventStream {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const bounds = options.backoff ?? BACKOFF;
  let lastId: string | null = options.lastEventId ?? null;
  let lastAt: string | null = null;
  let attempt = 0;
  let closed = false;
  let rejected = 0;
  let controller: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const status = (s: StreamStatus) => {
    if (!closed || s.kind === "closed") options.onStatus?.(s);
  };

  const handle = (message: EventSourceMessage) => {
    let data: unknown;
    try {
      data = JSON.parse(message.data);
    } catch {
      rejected += 1;
      return;
    }
    const parsed = RunEvent.safeParse(data);
    if (!parsed.success) {
      rejected += 1;
      return;
    }
    lastId = message.id ?? parsed.data.id;
    lastAt = parsed.data.at;
    options.onEvent(parsed.data);
  };

  const connect = async () => {
    if (closed) return;
    controller = new AbortController();
    status({ kind: "connecting" });
    try {
      const headers: Record<string, string> = { accept: "text/event-stream" };
      if (lastId) headers["last-event-id"] = lastId;
      const token = options.token?.();
      if (token) headers.authorization = `Bearer ${token}`;
      const response = await fetchImpl(options.url, {
        headers,
        signal: controller.signal,
        credentials: "same-origin",
        cache: "no-store",
      });
      if (response.status === 401) throw new StreamStop("unauthorized");
      if (response.status === 404) throw new StreamStop("not-found");
      if (!response.ok || !response.body) throw new Error(`stream answered ${response.status}`);
      attempt = 0;
      status({ kind: "open", since: Date.now() });
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done || closed) break;
        handle(value);
      }
    } catch (error) {
      if (closed) return;
      if (error instanceof StreamStop) {
        closed = true;
        options.onStatus?.({ kind: "closed", reason: error.reason });
        return;
      }
    }
    if (closed) return;
    // The server ended the stream (a deploy, Render's request cap) or the network failed: replay from lastId.
    attempt += 1;
    const inMs = backoffDelay(attempt, bounds);
    status({ kind: "reconnecting", attempt, inMs, lastEventId: lastId, lastEventAt: lastAt });
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, inMs);
  };

  void connect();

  return {
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
      options.onStatus?.({ kind: "closed", reason: "unsubscribed" });
    },
    lastEventId: () => lastId,
    rejected: () => rejected,
  };
}

/** One SSE frame as the API writes it; the mock server and tests use it. */
export function sseFrame(event: { readonly id: string }, name = "run-event"): string {
  return `id: ${event.id}\nevent: ${name}\ndata: ${JSON.stringify(event)}\n\n`;
}
