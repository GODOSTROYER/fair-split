// SSE over fetch (S3.7): Last-Event-ID on every reconnect, a 0.5 to 8 s backoff, a bearer token in a header,
// and every frame parsed against IC-01's RunEvent: anything else is dropped, never guessed at.

import type { RunEvent } from "@fairsplit/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestWorld } from "../test/world.js";
import type { StreamStatus } from "./adapter.js";
import { BACKOFF, backoffDelay, openEventStream, sseFrame } from "./sse.js";

function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sampleEvents(): RunEvent[] {
  const world = createTestWorld();
  const session = world.createJudgeSession();
  return world.eventsAfter(`run:${session.runSlug}`, null);
}

afterEach(() => vi.useRealTimers());

describe("SSE stream", () => {
  it("backs off from 0.5 s, doubling, to at most 8 s", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => backoffDelay(n))).toEqual([
      500, 1000, 2000, 4000, 8000, 8000, 8000,
    ]);
    expect(BACKOFF).toEqual({ minMs: 500, maxMs: 8000 });
  });

  it("parses RunEvents, drops anything else, and resumes from Last-Event-ID after the server ends the stream", async () => {
    const events = sampleEvents();
    const [first, second, third] = events;
    if (!first || !second || !third) throw new Error("the world emitted too few events");
    const requests: { headers: Headers }[] = [];
    const bodies = [
      [
        ": connected\n\n",
        sseFrame(first),
        "data: {not json}\n\n",
        `data: ${JSON.stringify({ id: "x" })}\n\n`,
        sseFrame(second),
      ],
      [sseFrame(third)],
    ];
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ headers: new Headers(init?.headers) });
      const body = bodies.shift() ?? [];
      return new Response(streamOf(body), { status: 200, headers: { "content-type": "text/event-stream" } });
    });
    const received: string[] = [];
    const statuses: StreamStatus["kind"][] = [];
    const stream = openEventStream({
      url: "http://localhost/v1/runs/x/events",
      token: () => "tok_test_0123456789abcdef",
      fetch: fetchImpl as unknown as typeof fetch,
      onEvent: (e) => received.push(e.id),
      onStatus: (s) => statuses.push(s.kind),
      backoff: { minMs: 1, maxMs: 2 },
    });
    await vi.waitFor(() => expect(received).toEqual([first.id, second.id, third.id]));
    stream.close();
    expect(stream.rejected()).toBe(2);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok_test_0123456789abcdef");
    expect(requests[0]?.headers.get("last-event-id")).toBeNull();
    expect(requests[1]?.headers.get("last-event-id")).toBe(second.id);
    expect(statuses).toContain("reconnecting");
    expect(statuses.at(-1)).toBe("closed");
  });

  it("stops for good on 401 and 404 instead of hammering the server", async () => {
    for (const status of [401, 404] as const) {
      const fetchImpl = vi.fn(async () => new Response(null, { status }));
      const statuses: StreamStatus[] = [];
      openEventStream({
        url: "http://localhost/v1/runs/x/events",
        fetch: fetchImpl as unknown as typeof fetch,
        onEvent: () => undefined,
        onStatus: (s) => statuses.push(s),
        backoff: { minMs: 1, maxMs: 1 },
      });
      await vi.waitFor(() => expect(statuses.at(-1)?.kind).toBe("closed"));
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(statuses.at(-1)).toEqual({
        kind: "closed",
        reason: status === 401 ? "unauthorized" : "not-found",
      });
    }
  });

  it("writes frames the way the API does", () => {
    const [event] = sampleEvents();
    if (!event) throw new Error("no event");
    expect(sseFrame(event)).toBe(`id: ${event.id}\nevent: run-event\ndata: ${JSON.stringify(event)}\n\n`);
  });
});
