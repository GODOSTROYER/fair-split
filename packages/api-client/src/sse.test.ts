// The SSE client: Last-Event-ID resume across reconnects, backoff, final refusals and public aggregates.
import type { RunEvent } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { HEADER } from "./http.js";
import { subscribe } from "./sse.js";

const WS = "0192f8a0-0000-7000-8000-00000000f5a1";
const RUN = "0192f8a0-0000-7000-8000-000000000010";

function event(id: number): RunEvent {
  return {
    id: String(id),
    ws: WS,
    runId: RUN,
    at: "2026-10-28T02:00:00.000Z",
    actor: { kind: "engine", id: "engine", impersonatedBy: null },
    provenance: "seeded",
    type: "run.state",
    payload: {
      runId: RUN,
      from: "IN_REVIEW",
      to: "TREASURER_APPROVED",
      cause: { code: "TREASURER_SIGNED", ref: null },
    },
  };
}

function sseBody(chunks: string[]): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(enc.encode(chunk));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

const frame = (id: number) => `id: ${id}\nevent: run.state\ndata: ${JSON.stringify(event(id))}\n\n`;

/** Timers that run immediately (backoff is recorded, not waited for). */
function instantTimers(delays: number[]) {
  return {
    setTimeout: (fn: () => void, ms: number) => {
      delays.push(ms);
      queueMicrotask(fn);
      return 0;
    },
    clearTimeout: () => undefined,
  };
}

describe("SSE client", () => {
  it("delivers RunEvents in order and resumes from the last id after the stream ends", async () => {
    const seenIds: (string | null)[] = [];
    const answers = [sseBody(["retry: 1000\n: hi\n\n", frame(1), frame(2)]), sseBody([frame(3)])];
    const got: string[] = [];
    const delays: number[] = [];
    let sub: ReturnType<typeof subscribe> | null = null;
    sub = subscribe(
      { kind: "run", runSlug: "2026A-r37" },
      {
        onEvent: (e) => {
          got.push(e.id);
          if (got.length === 3) sub?.close();
        },
      },
      {
        baseUrl: "",
        token: async () => "fst_tok",
        credentials: "same-origin",
        fetch: async (_url, init) => {
          seenIds.push(new Headers(init?.headers).get(HEADER.lastEventId));
          return answers.shift() ?? sseBody([]);
        },
        random: () => 0.5,
        timers: instantTimers(delays),
        staleMs: 60_000,
      },
    );
    await sub.done;
    expect(got).toEqual(["1", "2", "3"]);
    expect(seenIds).toEqual([null, "2"]);
    expect(sub.lastEventId).toBe("3");
    expect(sub.state).toBe("closed");
    // the server's retry hint (1 s) raised the backoff floor above 0.5 s
    expect(delays[0]).toBeGreaterThanOrEqual(750);
  });

  it("a 401 or 404 is final: no reconnect, the failure is reported once", async () => {
    let calls = 0;
    const errors: { code: string; retry: boolean }[] = [];
    const sub = subscribe(
      { kind: "workspace", ws: WS },
      { onError: (f, retry) => errors.push({ code: "code" in f ? String(f.code) : f.name, retry }) },
      {
        baseUrl: "",
        token: async () => null,
        credentials: "same-origin",
        fetch: async () => {
          calls++;
          return new Response(JSON.stringify({ code: "UNAUTHENTICATED", status: 401, message: "no" }), {
            status: 401,
          });
        },
        timers: instantTimers([]),
      },
    );
    await sub.done;
    expect(calls).toBe(1);
    expect(errors).toEqual([{ code: "UNAUTHENTICATED", retry: false }]);
  });

  it("a 429 backs off by the server's retryAfterMs and tries again", async () => {
    const delays: number[] = [];
    let calls = 0;
    let sub: ReturnType<typeof subscribe> | null = null;
    sub = subscribe(
      { kind: "line", lineId: RUN },
      { onEvent: () => sub?.close() },
      {
        baseUrl: "",
        token: async () => "fst_tok",
        credentials: "same-origin",
        fetch: async () => {
          calls++;
          if (calls === 1) {
            return new Response(
              JSON.stringify({ code: "RATE_LIMITED", status: 429, message: "busy", retryAfterMs: 5_000 }),
              { status: 429 },
            );
          }
          return sseBody([frame(9)]);
        },
        random: () => 0,
        timers: instantTimers(delays),
      },
    );
    await sub.done;
    expect(calls).toBe(2);
    expect(delays[0]).toBeGreaterThanOrEqual(2_500);
  });

  it("the public Proof stream hands aggregates to onMessage and never sends a token", async () => {
    const messages: unknown[] = [];
    let auth: string | null = "unset";
    let sub: ReturnType<typeof subscribe> | null = null;
    sub = subscribe(
      { kind: "proof", runSlug: "2026A-r37" },
      {
        onMessage: (m) => {
          messages.push(m.data);
          sub?.close();
        },
      },
      {
        baseUrl: "",
        token: async () => "fst_tok",
        credentials: "same-origin",
        fetch: async (url, init) => {
          expect(url).toBe("/v1/proof/2026A-r37/events");
          auth = new Headers(init?.headers).get("authorization");
          return sseBody([`id: 4\nevent: aggregate\ndata: {"confirmed":3,"of":8}\n\n`]);
        },
        timers: instantTimers([]),
      },
    );
    await sub.done;
    expect(auth).toBeNull();
    expect(messages).toEqual([{ confirmed: 3, of: 8 }]);
  });

  it("an event that is not an IC-01 RunEvent is reported, not delivered as one", async () => {
    const errors: string[] = [];
    const raw: unknown[] = [];
    let sub: ReturnType<typeof subscribe> | null = null;
    sub = subscribe(
      { kind: "run", runSlug: "2026A-r37" },
      {
        onEvent: () => errors.push("delivered"),
        onMessage: (m) => {
          raw.push(m.data);
          sub?.close();
        },
        onError: (f) => errors.push(f.name),
      },
      {
        baseUrl: "",
        token: async () => "fst_tok",
        credentials: "same-origin",
        fetch: async () => sseBody([`id: 5\nevent: run.state\ndata: {"type":"run.state"}\n\n`]),
        timers: instantTimers([]),
      },
    );
    await sub.done;
    expect(errors).toEqual(["ContractError"]);
    expect(raw).toEqual([{ type: "run.state" }]);
  });
});
