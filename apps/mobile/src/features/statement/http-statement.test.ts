import { describe, expect, it } from "vitest";
import { createHttpApi } from "../../_shims/api-client";
import { EMPTY_TRACK, reduceItemEvent } from "../../lib/item-status";
import { statementSentences } from "../../lib/statement";
import { buildDemoStatement } from "../../services/demo-fixtures";
import { memberEvent } from "./live";

describe("live Member statement read", () => {
  it("looks up only the member line, reads all language views and audio together, and uses server figures", async () => {
    const mobile = buildDemoStatement({ stage: "sent", now: "2026-11-01T00:00:00Z" });
    const calls: string[] = [];
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => "test-frame-token",
      fetch: (async (input, init) => {
        const path = new URL(String(input));
        calls.push(path.pathname);
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-frame-token");
        if (path.pathname === "/v1/members/me/statement-line")
          return Response.json({ lineId: mobile.lineId });
        const lang = path.searchParams.get("lang") ?? "ceb";
        if (path.pathname.includes("/media/audio/"))
          return Response.json({
            lineId: mobile.lineId,
            memberNo: "M-014",
            lang,
            source: "device",
            label: "Device voice",
            deviceLabel: "Device voice",
            sentences: [],
          });
        return Response.json(
          {
            lineId: mobile.lineId,
            lang,
            mobile,
            provenance: "seeded",
            plan: { sentences: [{ slot: "BONUS", variant: "default", mentions: [] }] },
            display: [{ slot: "BONUS", variant: "default", text: "Server amount US$21.85", mentions: [] }],
            spoken: [{ slot: "BONUS", variant: "default", text: "Server spoken bonus", mentions: [] }],
          },
          { headers: { "X-FS-Rail": "simulator" } },
        );
      }) as typeof fetch,
    });
    const result = await api.getStatement();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.paypalRail).toBe("simulator");
    expect(result.value.amounts).toEqual(mobile.amounts);
    expect(statementSentences(result.value, "ceb").sentences[0]?.spoken).toBe("Server spoken bonus");
    expect(calls.filter((p) => p === `/v1/statements/${mobile.lineId}`)).toHaveLength(3);
    expect(calls.filter((p) => p === `/v1/media/audio/${mobile.lineId}`)).toHaveLength(3);
    expect(calls).not.toContain("/v1/runs/2026A-r37/lines");
  });
  it("does not expose demo data when member lookup is refused", async () => {
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: (async () => Response.json({ code: "FORBIDDEN" }, { status: 403 })) as typeof fetch,
    });
    expect(await api.getStatement()).toMatchObject({ ok: false, status: 403 });
  });
  it("keeps every server-rendered credit even when a credit has no slip reference", () => {
    const base = buildDemoStatement({ stage: "sent", now: "2026-11-01T00:00:00Z" });
    const statement = {
      ...base,
      served: true as const,
      sentences: {
        ...base.sentences,
        ceb: [
          { id: "CREDIT.plain.0", slot: "CREDIT" as const, variant: "plain", text: "" },
          { id: "CREDIT.plain.1", slot: "CREDIT" as const, variant: "plain", text: "" },
        ],
      },
      rendered: {
        ceb: [
          {
            id: "CREDIT.plain.0",
            slot: "CREDIT" as const,
            variant: "plain",
            display: "Credit US$1.00",
            spoken: "One dollar",
            mentions: [],
            textSha256: "a".repeat(64),
          },
          {
            id: "CREDIT.plain.1",
            slot: "CREDIT" as const,
            variant: "plain",
            display: "Credit US$2.00",
            spoken: "Two dollars",
            mentions: [],
            textSha256: "b".repeat(64),
          },
        ],
      },
    };
    expect(statementSentences(statement, "ceb").sentences.map((s) => s.spoken)).toEqual([
      "One dollar",
      "Two dollars",
    ]);
  });
  it("inv.i5.member-stream: the served line SSE drives paid once without polling", async () => {
    let stop = () => {};
    const event = {
      id: "event-1",
      ws: "workspace",
      runId: "run",
      type: "item.updated",
      at: "2026-11-01T00:01:00Z",
      actor: { kind: "paypal", id: "simulator" },
      provenance: "simulated_rail",
      payload: {
        senderItemId: "item",
        memberNo: "M-014",
        from: "PENDING",
        to: "SUCCESS",
        source: "webhook",
        eventId: "verified-sim-event",
      },
    };
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => "test-token",
      streamingFetch: (async (input) => {
        expect(String(input)).toBe("http://localhost/v1/lines/line-1/events");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(`id: event-1\ndata: ${JSON.stringify(event)}\n\n`));
            },
          }),
        );
      }) as typeof fetch,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        stop = api.subscribe("line:line-1", (e) => {
          try {
            const adapted = memberEvent(e);
            expect(adapted).not.toBeNull();
            if (!adapted) throw new Error("Expected a verified item event");
            expect(reduceItemEvent(EMPTY_TRACK, adapted, "item").track.status).toBe("SUCCESS");
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
    } finally {
      stop();
    }
  });
});
