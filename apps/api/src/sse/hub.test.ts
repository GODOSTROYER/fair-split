import { randomUUID } from "node:crypto";
import { ApiError, RunEvent } from "@fairsplit/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import type { MemoryBus } from "../test/memory-bus.js";
import { parseLastEventId, toRunEventEnvelope } from "./envelope.js";
import { publicCaps } from "./routes.js";

let t: TestApp;
afterEach(async () => t?.close());

function publish(
  bus: MemoryBus,
  ws: string,
  o: { runId?: string | null; lineId?: string | null; on?: boolean } = {},
) {
  return bus.publish({
    workspaceId: ws,
    runId: o.runId ?? null,
    lineId: o.lineId ?? null,
    type: "flag.changed",
    actorKind: "human",
    actorId: "treasurer:analyn",
    impersonatedBy: "judge_session:s1",
    provenance: "live",
    payload: { flag: "kill_payouts", on: o.on ?? true, by: "treasurer:analyn" },
  });
}

async function setup() {
  t = await createTestApp();
  const ws = t.credentials.workspace();
  const token = await t.credentials.frameToken({ workspaceId: ws, sessionId: randomUUID() });
  return { ws, token, bus: t.bus as MemoryBus };
}

describe("SSE envelope", () => {
  it("is exactly the IC-01 RunEvent (id as a decimal string, actor.impersonatedBy always present)", () => {
    const e = toRunEventEnvelope({
      id: 42,
      workspaceId: randomUUID(),
      runId: null,
      lineId: randomUUID(),
      type: "flag.changed",
      at: new Date("2026-10-28T02:00:00Z"),
      actorKind: "system",
      actorId: "system:cron",
      impersonatedBy: null,
      provenance: "live",
      payload: { flag: "kill_ai_live", on: false, by: "system:cron" },
    });
    expect(RunEvent.parse(e)).toEqual(e);
    expect(e.id).toBe("42");
    expect(e.actor.impersonatedBy).toBeNull();
  });

  it("parses Last-Event-ID strictly", () => {
    expect(parseLastEventId("17")).toBe(17);
    expect(parseLastEventId(undefined, "9")).toBe(9);
    expect(parseLastEventId("17; drop table")).toBeUndefined();
    expect(parseLastEventId("-1")).toBeUndefined();
    expect(parseLastEventId("99999999999999999999")).toBeUndefined();
  });
});

describe("SSE hub and the workspace stream", () => {
  it("HD6-4 counts the three anonymous network slots separately from credentialed streams", async () => {
    const { ws } = await setup();
    t.app.app.get("/test-public-mixed", (c) =>
      t.deps.sse.open(c, {
        scope: { workspaceId: ws },
        caps: publicCaps(c),
        label: "proof",
      }),
    );
    const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws }));
    const opened: Awaited<ReturnType<TestApp["sse"]>>[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        const stream = await t.sse(`/v1/workspaces/${ws}/events`, { as });
        expect(stream.response.status).toBe(200);
        opened.push(stream);
      }
      for (let i = 0; i < 3; i++) {
        const stream = await t.sse("/test-public-mixed");
        expect(stream.response.status).toBe(200);
        opened.push(stream);
      }
      expect((await t.request("/test-public-mixed")).status).toBe(429);
    } finally {
      for (const stream of opened) await stream.reader.close();
    }
  });
  it("HD6-4 public streams still open when eight judges fill their network's 40 credentialed slots", async () => {
    const { ws } = await setup();
    t.app.app.get("/test-public-at-cap", (c) =>
      t.deps.sse.open(c, {
        scope: { workspaceId: ws },
        caps: publicCaps(c),
        label: "proof",
      }),
    );
    const opened: Awaited<ReturnType<TestApp["sse"]>>[] = [];
    try {
      for (let judge = 0; judge < 8; judge++) {
        const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws }));
        for (let i = 0; i < 5; i++) {
          const stream = await t.sse(`/v1/workspaces/${ws}/events`, { as });
          expect(stream.response.status).toBe(200);
          opened.push(stream);
        }
      }
      for (let i = 0; i < 3; i++) {
        const stream = await t.sse("/test-public-at-cap");
        expect(stream.response.status).toBe(200);
        opened.push(stream);
      }
      expect((await t.request("/test-public-at-cap")).status).toBe(429);
    } finally {
      for (const stream of opened) await stream.reader.close();
    }
  });

  it("HD6-4 hub-refused retries refund the open budget so a freed slot is immediately usable", async () => {
    const { ws, token } = await setup();
    const as = t.credentials.bearer(token);
    const a = await t.sse(`/v1/workspaces/${ws}/events`, { as });
    const b = await t.sse(`/v1/workspaces/${ws}/events`, { as });
    expect([a.response.status, b.response.status]).toEqual([200, 200]);
    try {
      for (let i = 0; i < 35; i++) {
        expect((await t.request(`/v1/workspaces/${ws}/events`, { as })).status).toBe(429);
      }
      await a.reader.close();
      const resumed = await t.sse(`/v1/workspaces/${ws}/events`, { as });
      expect(resumed.response.status).toBe(200);
      await resumed.reader.close();
    } finally {
      await a.reader.close();
      await b.reader.close();
    }
  });

  it("HD6-4 caps one network at 40 streams across six judge sessions", async () => {
    const { ws } = await setup();
    const opened: Awaited<ReturnType<TestApp["sse"]>>[] = [];
    try {
      for (let session = 0; session < 6; session++) {
        const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws }));
        for (let stream = 0; stream < (session === 5 ? 1 : 8); stream++) {
          const response = await t.sse(`/v1/workspaces/${ws}/events`, { as });
          if (session === 5) expect(response.response.status).toBe(429);
          else {
            expect(response.response.status).toBe(200);
            opened.push(response);
          }
        }
      }
    } finally {
      for (const stream of opened) await stream.reader.close();
    }
  });

  it("HD6-4 reserves instance slots after 100 anonymous public streams", async () => {
    const { ws, token } = await setup();
    t.app.app.get("/test-public-stream", (c) =>
      t.deps.sse.open(c, {
        scope: { workspaceId: ws },
        caps: publicCaps(c),
        label: "proof",
      }),
    );
    const opened: Awaited<ReturnType<TestApp["sse"]>>[] = [];
    try {
      for (let i = 0; i < 100; i++) {
        const stream = await t.sse("/test-public-stream", {
          headers: { "cf-connecting-ip": `192.0.2.${i + 1}` },
        });
        expect(stream.response.status).toBe(200);
        opened.push(stream);
      }
      expect(
        (await t.request("/test-public-stream", { headers: { "cf-connecting-ip": "198.51.100.1" } })).status,
      ).toBe(429);
      const judge = await t.sse(`/v1/workspaces/${ws}/events`, { as: t.credentials.bearer(token) });
      expect(judge.response.status).toBe(200);
      opened.push(judge);
    } finally {
      for (const stream of opened) await stream.reader.close();
    }
  });

  it("HD6-4 ends a stream after 30 minutes and resumes missed events", async () => {
    t = await createTestApp({ sse: { pingMs: 20 } });
    const ws = t.credentials.workspace();
    const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws }));
    const first = publish(t.bus as MemoryBus, ws);
    const stream = await t.sse(`/v1/workspaces/${ws}/events`, { as, headers: { "last-event-id": "0" } });
    expect((await stream.reader.next()).id).toBe(String(first.id));
    t.clock.advance(30 * 60_000);
    await expect(stream.reader.next(500)).rejects.toThrow(/stream ended/);
    const missed = publish(t.bus as MemoryBus, ws);
    const resumed = await t.sse(`/v1/workspaces/${ws}/events`, {
      as,
      headers: { "last-event-id": String(first.id) },
    });
    expect((await resumed.reader.next()).id).toBe(String(missed.id));
    await resumed.reader.close();
  });

  it("HD6-4 refuses the 31st stream open per credential in one minute", async () => {
    const { ws } = await setup();
    const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws }));
    for (let i = 0; i < 30; i++) {
      const stream = await t.sse(`/v1/workspaces/${ws}/events`, { as });
      expect(stream.response.status).toBe(200);
      publish(t.bus as MemoryBus, ws);
      await stream.reader.next();
      await stream.reader.close();
    }
    expect((await t.request(`/v1/workspaces/${ws}/events`, { as })).status).toBe(429);
  });
  it("streams committed events as IC-01 envelopes with `id:` and `event:`", async () => {
    const { ws, token, bus } = await setup();
    const { response, reader } = await t.sse(`/v1/workspaces/${ws}/events`, {
      as: t.credentials.bearer(token),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(response.headers.get("x-fs-rail")).toBe("simulated");
    const pending = reader.next();
    await new Promise((r) => setTimeout(r, 10));
    const e = publish(bus, ws);
    const m = await pending;
    expect(m.id).toBe(String(e.id));
    expect(m.event).toBe("flag.changed");
    expect(RunEvent.parse(JSON.parse(m.data))).toMatchObject({ id: String(e.id), ws, type: "flag.changed" });
    expect(reader.comments).toContain("connected");
    await reader.close();
  });

  it("replays everything after Last-Event-ID, then streams live, without gaps or repeats", async () => {
    const { ws, token, bus } = await setup();
    const first = publish(bus, ws);
    publish(bus, ws, { on: false });
    publish(bus, randomUUID()); // another workspace: never delivered
    publish(bus, ws);
    const { reader } = await t.sse(`/v1/workspaces/${ws}/events`, {
      as: t.credentials.bearer(token),
      headers: { "last-event-id": String(first.id) },
    });
    const replay = await reader.take(2);
    expect(replay.map((m) => Number(m.id))).toEqual([first.id + 1, first.id + 3]);
    const live = publish(bus, ws);
    expect(Number((await reader.next()).id)).toBe(live.id);
    await reader.close();
  });

  it("the workspace comes from the credential: another workspace's stream is 404", async () => {
    const { token } = await setup();
    const r = await t.json<ApiError>(`/v1/workspaces/${randomUUID()}/events`, {
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(404);
    expect(ApiError.parse(r.body).code).toBe("NOT_FOUND");
    expect(
      (await t.json(`/v1/workspaces/not-a-uuid/events`, { as: t.credentials.bearer(token) })).status,
    ).toBe(404);
  });

  it("refuses anonymous and read-only credentials", async () => {
    const { ws } = await setup();
    expect((await t.json(`/v1/workspaces/${ws}/events`)).status).toBe(401);
    const link = t.credentials.memberLink({ workspaceId: ws, lineId: randomUUID() });
    expect((await t.json(`/v1/workspaces/${ws}/events`, { as: t.credentials.bearer(link) })).status).toBe(
      403,
    );
  });

  it("caps streams per credential (2) and frees the slot when a client disconnects", async () => {
    const { ws, token } = await setup();
    const as = t.credentials.bearer(token);
    const a = await t.sse(`/v1/workspaces/${ws}/events`, { as });
    const b = await t.sse(`/v1/workspaces/${ws}/events`, { as });
    expect([a.response.status, b.response.status]).toEqual([200, 200]);
    // the preamble is written once the client reads, which is when the slot counts as live
    await Promise.race([a.reader.next(50).catch(() => undefined), b.reader.next(50).catch(() => undefined)]);
    const c = await t.json<ApiError>(`/v1/workspaces/${ws}/events`, { as });
    expect(c.status).toBe(429);
    expect(ApiError.parse(c.body).code).toBe("RATE_LIMITED");
    expect(t.deps.sse.stats().open).toBe(2);
    await a.reader.close();
    await new Promise((r) => setTimeout(r, 20));
    expect(t.deps.sse.stats().open).toBe(1);
    const d = await t.sse(`/v1/workspaces/${ws}/events`, { as });
    expect(d.response.status).toBe(200);
    await b.reader.close();
    await d.reader.close();
  });

  it("all tokens of one judge session share 8 streams", async () => {
    const { ws } = await setup();
    const sid = randomUUID();
    const tokens = await Promise.all(
      Array.from({ length: 5 }, () => t.credentials.frameToken({ workspaceId: ws, sessionId: sid })),
    );
    const open: Awaited<ReturnType<TestApp["sse"]>>[] = [];
    for (let i = 0; i < 8; i++) {
      const s = await t.sse(`/v1/workspaces/${ws}/events`, {
        as: t.credentials.bearer(tokens[i % 5] as string),
      });
      expect(s.response.status).toBe(200);
      open.push(s);
    }
    const ninth = await t.json(`/v1/workspaces/${ws}/events`, {
      as: t.credentials.bearer(tokens[4] as string),
    });
    expect(ninth.status).toBe(429);
    for (const s of open) await s.reader.close();
  });

  it("close() ends every stream so clients reconnect and replay", async () => {
    const { ws, token } = await setup();
    const { reader } = await t.sse(`/v1/workspaces/${ws}/events`, { as: t.credentials.bearer(token) });
    await t.deps.sse.close();
    await expect(reader.next(1000)).rejects.toThrow(/ended/);
    const r = await t.json(`/v1/workspaces/${ws}/events`, { as: t.credentials.bearer(token) });
    expect(r.status).toBe(500);
  });
});
