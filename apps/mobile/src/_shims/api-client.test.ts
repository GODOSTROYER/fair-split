import { describe, expect, it } from "vitest";
import { readMemberLink } from "../lib/member-link";
import { base64, contentDigestHeader, SSE_BACKOFF_MS, subscribeSse } from "./api-client";
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

describe("member link /s/:token", () => {
  const b64url = (s: string) =>
    base64(new TextEncoder().encode(s)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const sig = base64(new Uint8Array(64).fill(1)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = new Date("2026-10-30T00:00:00Z");

  it("reads the line and the 30-day expiry", () => {
    const token = `${b64url('{"exp":"2026-11-29T00:00:00Z","lineId":"line_M-014"}')}.${sig}`;
    expect(readMemberLink(token, now)).toEqual({
      ok: true,
      lineId: "line_M-014",
      exp: "2026-11-29T00:00:00Z",
    });
  });

  it("explains an expired or broken link without a round trip", () => {
    const old = `${b64url('{"exp":"2026-10-01T00:00:00Z","lineId":"line_M-014"}')}.${sig}`;
    expect(readMemberLink(old, now)).toEqual({ ok: false, reason: "expired" });
    expect(readMemberLink("nonsense", now)).toEqual({ ok: false, reason: "malformed" });
    expect(readMemberLink(`${b64url("[]")}.${sig}`, now)).toEqual({ ok: false, reason: "malformed" });
    expect(readMemberLink(`${b64url('{"exp":"2026-11-29T00:00:00Z","lineId":"x"}')}.AAAA`, now)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
