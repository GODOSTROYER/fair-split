import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpApi } from "../../_shims/api-client";
import { heroFigures, lineConservation, receiptRows, shareFigures } from "../../lib/figures";
import { EMPTY_TRACK, reduceItemEvent } from "../../lib/item-status";
import { statementSentences } from "../../lib/statement";
import { buildDemoStatement } from "../../services/demo-fixtures";
import { memberEvent } from "./live";

describe("live Member statement read", () => {
  afterEach(() => vi.useRealTimers());
  it.each(["PAYPAL_PENDING", "HELD", "COMPUTED", "READY", "EXCLUDED"] as const)(
    "reads the typed %s projection and audio together, preserving server figure visibility",
    async (lineState) => {
      const visible = lineState === "PAYPAL_PENDING";
      const slot = visible ? "BONUS" : "PAY";
      const variant = visible ? "default" : lineState === "EXCLUDED" ? "excluded" : "checking";
      const spoken = visible ? "Server spoken bonus" : "Server withheld amount";
      const base = buildDemoStatement({ stage: "sent", now: "2026-11-01T00:00:00Z" });
      const lineId = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";
      const mobile = {
        ...base,
        lineState,
        amounts: visible ? base.amounts : null,
        lineId,
        runId: lineId,
        season: { ...base.season, id: lineId },
        rateCard: { ...base.rateCard, id: lineId },
        item: null,
        spokenHashes: [],
        formatted: {
          hero: visible
            ? { paypal: heroFigures(base, "ceb", "paypal"), cash: heroFigures(base, "ceb", "cash") }
            : null,
          receiptRows: visible ? receiptRows(base) : [],
          share: shareFigures(base),
          conservation: visible ? lineConservation(base) : null,
        },
      };
      const calls: string[] = [];
      // Judge frames mount before computation has created their member line.
      if (lineState === "READY") vi.useFakeTimers();
      let discoveryReads = 0;
      const api = createHttpApi({
        judgeFrame: lineState === "READY",
        origin: "http://localhost",
        getBearer: () => "test-frame-token",
        fetch: (async (input, init) => {
          const path = new URL(String(input));
          calls.push(path.pathname);
          expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-frame-token");
          if (path.pathname === "/v1/members/me/statement-line") {
            if (lineState === "READY" && discoveryReads++ < 2)
              return Response.json(
                { code: "NOT_FOUND", status: 404, message: "No statement line for this member." },
                { status: 404 },
              );
            return Response.json({ lineId: mobile.lineId });
          }
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
              memberNo: mobile.member.memberNo,
              registryLang: "ceb",
              langs: ["ceb", "fil", "en"],
              state: lineState,
              pay: visible ? "paypal" : lineState === "EXCLUDED" ? "excluded" : "checking",
              statusWords: "Sent",
              reviewChip: null,
              amount: null,
              mobile,
              provenance: "seeded",
              source: "template",
              sms: { text: "Preview", gsm7Length: 7, fits: true, label: "Preview, not sent" },
              plan: {
                lineId,
                lang,
                templateV: "test",
                sentences: [{ slot, variant, facts: {}, mentions: [] }],
                sms: { variant: "sent", facts: {} },
              },
              display: [
                { slot, variant, text: visible ? "Server amount US$21.85" : "Still checking", mentions: [] },
              ],
              spoken: [{ slot, variant, text: spoken, mentions: [] }],
            },
            { headers: { "X-FS-Rail": "simulated" } },
          );
        }) as typeof fetch,
      });
      const reading = api.getStatement();
      if (lineState === "READY") await vi.advanceTimersByTimeAsync(3_000);
      const result = await reading;
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.paypalRail).toBe("simulated");
      expect(result.value.amounts).toEqual(mobile.amounts);
      expect(result.value.formatted?.hero).toEqual(mobile.formatted.hero);
      expect(statementSentences(result.value, "ceb").sentences[0]?.spoken).toBe(spoken);
      expect(calls.filter((p) => p === `/v1/statements/${mobile.lineId}`)).toHaveLength(3);
      expect(calls.filter((p) => p === `/v1/media/audio/${mobile.lineId}`)).toHaveLength(3);
      expect(calls).not.toContain("/v1/runs/2026A-r37/lines");
      if (lineState === "READY") expect(discoveryReads).toBe(3);
    },
  );
  it("does not expose demo data when member lookup is refused", async () => {
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: (async () => Response.json({ code: "FORBIDDEN" }, { status: 403 })) as typeof fetch,
    });
    expect(await api.getStatement()).toMatchObject({ ok: false, status: 403 });
  });
  it("does not retry a missing statement body after discovery succeeds", async () => {
    vi.useFakeTimers();
    const lineId = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";
    const paths: string[] = [];
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: (async (input) => {
        const path = new URL(String(input)).pathname;
        paths.push(path);
        return path.endsWith("/statement-line")
          ? Response.json({ lineId })
          : Response.json({ code: "NOT_FOUND", status: 404, message: "No such statement." }, { status: 404 });
      }) as typeof fetch,
    });
    expect(await api.getStatement()).toMatchObject({ ok: false, status: 404 });
    expect(paths.filter((path) => path.endsWith("/statement-line"))).toHaveLength(1);
    expect(paths.filter((path) => path === `/v1/statements/${lineId}`)).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("passes the screen's cancellation through discovery without leaving a retry timer", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn(async (_input, init) => {
      expect(init?.signal).toBe(controller.signal);
      return Response.json(
        { code: "NOT_FOUND", status: 404, message: "No member line yet." },
        { status: 404 },
      );
    });
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: request,
      judgeFrame: true,
    });
    const reading = api.getStatement({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort();
    expect(await reading).toMatchObject({ ok: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not defer an ordinary phone's missing-line response", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async () =>
      Response.json({ code: "NOT_FOUND", status: 404, message: "No member line yet." }, { status: 404 }),
    );
    const api = createHttpApi({ origin: "http://localhost", getBearer: () => null, fetch: request });
    expect(await api.getStatement()).toMatchObject({ ok: false, status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("rejects a statement response that drifts from the typed server projection", async () => {
    const lineId = "0190f3c2-6c1e-7c3a-8d2b-1a2b3c4d5e6f";
    const api = createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: (async (input) =>
        String(input).endsWith("/statement-line")
          ? Response.json({ lineId })
          : Response.json({ lineId, mobile: { amounts: "unvalidated money" } })) as typeof fetch,
    });
    expect(await api.getStatement()).toMatchObject({ ok: false, code: "NETWORK" });
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
