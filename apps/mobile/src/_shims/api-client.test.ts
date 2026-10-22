import { describe, expect, it } from "vitest";
import { base64, contentDigestHeader, SSE_BACKOFF_MS, scopePath, subscribeSse } from "./api-client";
import type { RunEvent } from "./contracts";

describe("Content-Digest (RFC 9530)", () => {
  it("encodes the raw sha256 in base64 between colons", () => {
    // sha256("") = e3b0c442…b855
    expect(contentDigestHeader("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")).toBe(
      "sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:",
    );
    expect(base64(new TextEncoder().encode("Fair Split"))).toBe("RmFpciBTcGxpdA==");
    expect(() => contentDigestHeader("XYZ")).toThrow(RangeError);
  });
});

function stream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function event(id: string, type: RunEvent["type"]): string {
  const e: RunEvent = {
    id,
    ws: "ws_showcase",
    runId: "run_2026A_r37",
    type,
    at: "2026-10-30T01:12:00Z",
    actor: { kind: "paypal", id: "paypal" },
    provenance: "live",
    payload: {},
  };
  return `id: ${id}\ndata: ${JSON.stringify(e)}\n\n`;
}

describe("subscribe over SSE (S7: fetch streaming, Last-Event-ID replay)", () => {
  it("delivers events split across chunks, then reconnects with Last-Event-ID and the bearer", async () => {
    const calls: Record<string, string>[] = [];
    const received: string[] = [];
    const statuses: boolean[] = [];
    const sleeps: number[] = [];
    let stop: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      const fakeFetch = (async (_url: string, init?: RequestInit) => {
        calls.push({ ...(init?.headers as Record<string, string>) });
        if (calls.length === 1) {
          const two = event("41", "item.updated") + event("42", "approval.signed");
          return new Response(stream([": ping\n\n", two.slice(0, 50), two.slice(50)]), { status: 200 });
        }
        if (calls.length === 2) return new Response(stream([event("43", "item.updated")]), { status: 200 });
        stop();
        resolve();
        return new Response(null, { status: 503 });
      }) as unknown as typeof fetch;
      stop = subscribeSse({
        url: "https://fs-api.test/v1/runs/2026A-r37/events",
        fetch: fakeFetch,
        getBearer: () => "fst_frame_token_for_tests",
        onEvent: (e) => received.push(`${e.id}:${e.type}`),
        onStatus: (s) => statuses.push(s),
        lastEventId: "40",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      });
    });
    await done;
    expect(received).toEqual(["41:item.updated", "42:approval.signed", "43:item.updated"]);
    expect(calls[0]).toMatchObject({
      Accept: "text/event-stream",
      Authorization: "Bearer fst_frame_token_for_tests",
      "Last-Event-ID": "40",
    });
    expect(calls[1]?.["Last-Event-ID"]).toBe("42");
    expect(calls[2]?.["Last-Event-ID"]).toBe("43");
    expect(statuses.slice(0, 3)).toEqual([true, false, true]);
    expect(sleeps[0]).toBe(SSE_BACKOFF_MS[0]);
  });
});

describe("subscribe over a real loopback stream (spike S7, the fetch-streaming path)", () => {
  it("receives events as they are flushed and resumes from Last-Event-ID after the server drops", async () => {
    const { createServer } = await import("node:http");
    const seenIds: (string | undefined)[] = [];
    const server = createServer((req, res) => {
      const last = req.headers["last-event-id"] as string | undefined;
      seenIds.push(last);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const start = last ? Number(last) + 1 : 1;
      let n = start;
      const timer = setInterval(() => {
        res.write(event(String(n), "item.updated"));
        n++;
        if (n - start === 2) {
          clearInterval(timer);
          res.end(); // a deploy or Render's request cap drops the stream
        }
      }, 15);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const { port } = server.address() as { port: number };
    const got: { id: string; at: number }[] = [];
    const t0 = Date.now();
    let stop: () => void = () => {};
    await new Promise<void>((resolve) => {
      stop = subscribeSse({
        url: `http://127.0.0.1:${port}/v1/runs/2026A-r37/events`,
        fetch: globalThis.fetch,
        getBearer: () => null,
        sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 20))),
        onEvent: (e) => {
          got.push({ id: e.id, at: Date.now() - t0 });
          if (got.length === 4) resolve();
        },
      });
    });
    stop();
    server.close();
    expect(got.map((g) => g.id)).toEqual(["1", "2", "3", "4"]);
    expect(seenIds.slice(0, 2)).toEqual([undefined, "2"]);
    // Events arrive while the stream is open, not when it closes (no buffering of the whole response).
    expect((got[1]?.at ?? 0) - (got[0]?.at ?? 0)).toBeLessThan(200);
  });
});

describe("SSE scopes (S3.7)", () => {
  it("maps officer, clerk, member and public scopes to their streams", () => {
    expect(scopePath("run:2026A-r37")).toBe("/v1/runs/2026A-r37/events");
    expect(scopePath("ws:ws_showcase")).toBe("/v1/workspaces/ws_showcase/events");
    expect(scopePath("line:line_2026A_r37_M-014")).toBe("/v1/lines/line_2026A_r37_M-014/events");
    expect(scopePath("proof:run_2026A_r37")).toBe("/v1/proof/run_2026A_r37/events");
    expect(scopePath("line:a/b")).toBe("/v1/lines/a%2Fb/events");
    expect(() => scopePath("member:M-014")).toThrow(RangeError);
    expect(() => scopePath("run:")).toThrow(RangeError);
  });
});
