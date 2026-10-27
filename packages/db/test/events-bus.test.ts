import { asc, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type Bus, createBus } from "../src/bus.js";
import { createDb } from "../src/client.js";
import { appendEvent, type StoredRunEvent, toEnvelope } from "../src/events.js";
import { toJsonValue } from "../src/json.js";
import { runEvents } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught, sleep, treasurer, until } from "./helpers.js";

let t: TestDb;
const cleanups: Array<() => Promise<void>> = [];
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
});
afterAll(async () => {
  await t?.close();
});

function ev(workspaceId: string, payload: Record<string, unknown> = {}, runId?: string | null) {
  return {
    workspaceId,
    runId,
    type: "presence" as const,
    actor: treasurer,
    provenance: "live" as const,
    payload,
  };
}

async function startBus(): Promise<Bus> {
  const bus = createBus({ url: t.url, db: t.app.db });
  await bus.start();
  cleanups.push(() => bus.close());
  return bus;
}

describe("appendEvent (IC-04): NOTIFY is delivered on commit, never before", () => {
  it("delivers '<ws>:<id>' only after the transaction commits, and nothing for a rollback", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const listener = postgres(t.url, { max: 1, onnotice: () => {} });
    cleanups.push(() => listener.end({ timeout: 5 }));
    const heard: string[] = [];
    await listener.listen("run_events", (p) => heard.push(p));

    let id = 0;
    await t.app.db.transaction(async (tx) => {
      id = (await appendEvent(tx, ev(ws.workspaceId, { n: 1 }))).id;
      await sleep(150);
      expect(heard).toHaveLength(0); // still inside the transaction
    });
    await until(() => heard.length === 1);
    expect(heard[0]).toBe(`${ws.workspaceId}:${id}`);

    await t.app.db
      .transaction(async (tx) => {
        await appendEvent(tx, ev(ws.workspaceId, { n: 2 }));
        tx.rollback();
      })
      .catch(() => {});
    await sleep(200);
    expect(heard).toHaveLength(1);
    const rows = await t.app.db.select().from(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId));
    expect(rows).toHaveLength(1);
  });

  it("refuses unknown event types and non-JSON payloads", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    expect(
      String(await caught(() => appendEvent(t.app.db, { ...ev(ws.workspaceId), type: "nope" as never }))),
    ).toMatch(/unknown RunEvent type/);
    expect(String(await caught(() => appendEvent(t.app.db, ev(ws.workspaceId, { x: Number.NaN }))))).toMatch(
      /not representable/,
    );
  });

  it("orders a workspace's ids by commit: concurrent writers interleave but never commit out of order", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const pools = Array.from({ length: 4 }, () => createDb(t.url, { role: "fs_app", max: 1 }));
    cleanups.push(async () => {
      await Promise.all(pools.map((p) => p.close()));
    });
    const commitOrder: number[] = [];
    await Promise.all(
      pools.map((p, w) =>
        (async () => {
          for (let i = 0; i < 5; i++) {
            await p.db.transaction(async (tx) => {
              const e = await appendEvent(tx, ev(ws.workspaceId, { w, i }));
              await sleep(Math.random() * 10);
              commitOrder.push(e.id); // last statement before COMMIT, still under the workspace lock
            });
          }
        })(),
      ),
    );
    const sorted = [...commitOrder].sort((a, b) => a - b);
    expect(commitOrder).toEqual(sorted);
  });

  it("renders the S3.7 SSE envelope", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const e = await appendEvent(t.app.db, ev(ws.workspaceId, { view: "hold 2" }));
    expect(toEnvelope(e)).toEqual({
      id: e.id,
      ws: ws.workspaceId,
      runId: null,
      lineId: null,
      type: "presence",
      at: e.at.toISOString(),
      actor: { kind: "human", id: "treasurer:analyn", impersonatedBy: "judge_session:test" },
      provenance: "live",
      payload: toJsonValue({ view: "hold 2" }),
    });
  });
});

describe("bus.subscribe(scope, cb) over LISTEN", () => {
  it("delivers committed events of the scope, in order, and nothing from other workspaces", async () => {
    const a = await fixtureWorkspace(t.app.db);
    const b = await fixtureWorkspace(t.app.db);
    const bus = await startBus();
    const got: StoredRunEvent[] = [];
    const unsub = await bus.subscribe({ workspaceId: a.workspaceId }, (e) => got.push(e));
    cleanups.push(async () => unsub());
    for (let i = 0; i < 5; i++) {
      await appendEvent(t.app.db, ev(a.workspaceId, { i }));
      await appendEvent(t.app.db, ev(b.workspaceId, { i }));
    }
    await until(() => got.length === 5);
    expect(got.map((e) => e.payload.i)).toEqual([0, 1, 2, 3, 4]);
    expect(got.every((e) => e.workspaceId === a.workspaceId)).toBe(true);
  });

  it("filters a run-scoped subscription and replays from Last-Event-ID (bounded)", async () => {
    const ws = await fixtureWorkspace(t.app.db, { withRun: true });
    const runId = ws.runId ?? "";
    const first = await appendEvent(t.app.db, ev(ws.workspaceId, { i: 0 }, runId));
    for (let i = 1; i < 8; i++) await appendEvent(t.app.db, ev(ws.workspaceId, { i }, i % 2 ? runId : null));
    const bus = await startBus();
    const got: StoredRunEvent[] = [];
    const unsub = await bus.subscribe({ workspaceId: ws.workspaceId, runId }, (e) => got.push(e), {
      afterId: first.id,
    });
    cleanups.push(async () => unsub());
    await until(() => got.length === 4); // backlog after i=0: the run's events i = 1, 3, 5, 7
    await appendEvent(t.app.db, ev(ws.workspaceId, { i: 9 }, runId));
    await until(() => got.length === 5);
    expect(got.map((e) => e.payload.i)).toEqual([1, 3, 5, 7, 9]);

    const capped: StoredRunEvent[] = [];
    const unsub2 = await bus.subscribe({ workspaceId: ws.workspaceId }, (e) => capped.push(e), {
      afterId: 0,
      maxReplay: 3,
    });
    cleanups.push(async () => unsub2());
    await until(() => capped.length === 3);
    await sleep(100);
    expect(capped.map((e) => e.payload.i)).toEqual([6, 7, 9]);
  });

  it("catches up after the LISTEN connection is killed: no gap, no duplicate", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const bus = await startBus();
    const got: number[] = [];
    const unsub = await bus.subscribe({ workspaceId: ws.workspaceId }, (e) =>
      got.push(e.payload.i as number),
    );
    cleanups.push(async () => unsub());
    await appendEvent(t.app.db, ev(ws.workspaceId, { i: 0 }));
    await until(() => got.length === 1);
    const listensBefore = bus.listenCount;

    // kill every other backend's LISTEN session for this database (the bus's dedicated connection)
    await t.owner.sql`
      select pg_terminate_backend(pid) from pg_stat_activity
       where datname = current_database() and pid <> pg_backend_pid() and query ilike 'listen%'`;
    // events committed while the bus is deaf
    for (let i = 1; i <= 3; i++) await appendEvent(t.app.db, ev(ws.workspaceId, { i }));
    await until(() => bus.listenCount > listensBefore, 15_000);
    await appendEvent(t.app.db, ev(ws.workspaceId, { i: 4 }));
    await until(() => got.length === 5, 10_000);
    await sleep(150);
    expect(got).toEqual([0, 1, 2, 3, 4]);
  });

  it("answers a LISTEN round-trip ping for /readyz", async () => {
    const bus = await startBus();
    const ms = await bus.ping(2000);
    expect(ms).toBeLessThan(2000);
  });

  it("a subscriber without afterId only sees events committed after it subscribed", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    await appendEvent(t.app.db, ev(ws.workspaceId, { i: "old" }));
    const bus = await startBus();
    const got: unknown[] = [];
    const unsub = await bus.subscribe({ workspaceId: ws.workspaceId }, (e) => got.push(e.payload.i));
    cleanups.push(async () => unsub());
    await appendEvent(t.app.db, ev(ws.workspaceId, { i: "new" }));
    await until(() => got.length === 1);
    await sleep(100);
    expect(got).toEqual(["new"]);
    const all = await t.app.db
      .select({ id: runEvents.id })
      .from(runEvents)
      .where(eq(runEvents.workspaceId, ws.workspaceId))
      .orderBy(asc(runEvents.id));
    expect(all).toHaveLength(2);
    const [{ n } = { n: 0 }] = await t.app.db.select({ n: sql<number>`count(*)::int` }).from(runEvents);
    expect(n).toBeGreaterThan(0);
  });
});
