import { createDb, schema as s } from "@fairsplit/db";
import { openTestDb, type TestDb } from "@fairsplit/db/testing";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDispatcher,
  createOutbox,
  type Dispatcher,
  inlineExecutor,
  runTask,
  type TaskHandlers,
} from "../src/index.js";
import { enqueued, rowOf, sleep, until } from "./helpers.js";

let t: TestDb;
const stops: Array<() => Promise<void>> = [];
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
beforeEach(async () => {
  // isolate tests that share this database: no task of an earlier test is left for a later dispatcher
  await t.owner.db.delete(s.taskOutbox);
});
afterEach(async () => {
  while (stops.length) await stops.pop()?.();
});
afterAll(async () => {
  await t?.close();
});

function counting(): { handlers: TaskHandlers; calls: Map<string, number> } {
  const calls = new Map<string, number>();
  const bump = async (_args: unknown, ctx: { outboxId: string }) => {
    calls.set(ctx.outboxId, (calls.get(ctx.outboxId) ?? 0) + 1);
  };
  return { handlers: { computeRun: bump, settleBatch: bump, processWebhook: bump }, calls };
}

function started(d: Dispatcher, drain = true) {
  stops.push(() => d.stop({ drain }));
  return d;
}

describe("dispatcher with the inline executor (CI and local)", () => {
  it("runs a committed task once and marks it done", async () => {
    const { handlers, calls } = counting();
    const ob = createOutbox({ db: t.app.db, handlers, workerId: "api-1", listenUrl: t.url });
    await started(ob.dispatcher).start();
    const id = await enqueued(t.app.db);
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(calls.get(id)).toBe(1);
    const row = await rowOf(t.app.db, id);
    expect(row).toMatchObject({ attempts: 1, executor: "inline" });
    expect(row.claimedBy?.startsWith("api-1/")).toBe(true);
  });

  it("wakes on NOTIFY fs_outbox instead of waiting for the poll", async () => {
    const { handlers } = counting();
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api-1",
      listenUrl: t.url,
      dispatcher: { pollMs: 60_000 },
    });
    await started(ob.dispatcher).start();
    await sleep(100);
    const t0 = Date.now();
    const id = await enqueued(t.app.db);
    await until(async () => (await rowOf(t.app.db, id)).state === "done", 5000);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("does not run a delayed task before its run_after", async () => {
    const { handlers, calls } = counting();
    const ob = createOutbox({ db: t.app.db, handlers, workerId: "api-1", dispatcher: { pollMs: 50 } });
    await started(ob.dispatcher).start();
    const id = await enqueued(t.app.db, "settleBatch", { batchId: "b" }, { delayMs: 600 });
    await sleep(300);
    expect(calls.get(id)).toBeUndefined();
    await until(async () => (await rowOf(t.app.db, id)).state === "done", 5000);
    expect(calls.get(id)).toBe(1);
  });
});

describe("inv.i7.crash-between-commit-and-dispatch", () => {
  it("a task committed while no dispatcher runs is executed when one starts", async () => {
    const { handlers, calls } = counting();
    const id = await enqueued(t.app.db); // committed; the process "crashes" before any dispatch
    expect((await rowOf(t.app.db, id)).state).toBe("queued");
    const ob = createOutbox({ db: t.app.db, handlers, workerId: "api-2" });
    await started(ob.dispatcher).start();
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(calls.get(id)).toBe(1);
  });

  it("a task claimed by a dispatcher that then died is swept back after 5 minutes and run", async () => {
    const { handlers, calls } = counting();
    const id = await enqueued(t.app.db);
    // the dead process had claimed it 6 minutes ago and never handed it over
    await t.owner.db
      .update(s.taskOutbox)
      .set({ state: "dispatched", claimedBy: "api-dead", dispatchedAt: sql`now() - interval '6 minutes'` })
      .where(eq(s.taskOutbox.id, id));
    const ob = createOutbox({ db: t.app.db, handlers, workerId: "api-3", dispatcher: { pollMs: 50 } });
    await started(ob.dispatcher).start();
    await sleep(300);
    expect(calls.get(id)).toBeUndefined(); // not yet: it is someone else's claim
    expect(await ob.dispatcher.sweep()).toEqual({ redispatched: 1, recovered: 0, dead: 0 });
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(calls.get(id)).toBe(1);
  });

  it("a task whose runner died mid-run is recovered from its silent heartbeat, or dead once attempts are spent", async () => {
    const a = await enqueued(t.app.db);
    const b = await enqueued(t.app.db, "computeRun", { runId: "r" }, { maxAttempts: 1 });
    await t.owner.db
      .update(s.taskOutbox)
      .set({ state: "running", attempts: 1, heartbeatAt: sql`now() - interval '6 minutes'` })
      .where(inArray(s.taskOutbox.id, [a, b]));
    const d = createDispatcher({
      db: t.app.db,
      workerId: "sweeper",
      executor: inlineExecutor(async () => {}),
    });
    expect(await d.sweep()).toEqual({ redispatched: 0, recovered: 1, dead: 1 });
    expect((await rowOf(t.app.db, a)).state).toBe("queued");
    const dead = await rowOf(t.app.db, b);
    expect(dead.state).toBe("dead");
    expect(dead.lastError).toMatch(/heartbeat lost/);
  });
});

describe("FOR UPDATE SKIP LOCKED", () => {
  it("three dispatchers on separate connections run each of 60 tasks exactly once", async () => {
    const { handlers, calls } = counting();
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) ids.push(await enqueued(t.app.db));
    const pools = Array.from({ length: 3 }, () => createDb(t.url, { role: "fs_app", max: 3 }));
    stops.push(async () => {
      await Promise.all(pools.map((p) => p.close()));
    });
    const claimedBy = new Map<string, string>();
    pools.forEach((p, i) => {
      const ob = createOutbox({
        db: p.db,
        handlers,
        workerId: `api-${i}`,
        concurrency: 4,
        dispatcher: { pollMs: 20, batchSize: 4 },
        onEvent: (e) => {
          if (e.type === "claimed") claimedBy.set(e.id, `api-${i}`);
        },
      });
      void started(ob.dispatcher).start();
    });
    await until(async () => {
      const [r] = await t.app.db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.taskOutbox)
        .where(sql`${s.taskOutbox.state} = 'done' and ${inArray(s.taskOutbox.id, ids)}`);
      return r?.n === 60;
    }, 20_000);
    expect(ids.every((id) => calls.get(id) === 1)).toBe(true);
    expect(new Set(claimedBy.values()).size).toBeGreaterThan(1);
  });
});

describe("the runner's claim is the idempotency guard", () => {
  it("two deliveries of the same task run the handler once", async () => {
    const { handlers, calls } = counting();
    const id = await enqueued(t.app.db);
    const deps = { db: t.app.db, handlers, workerId: "w" };
    const [a, b] = await Promise.all([runTask(deps, id, "workflow"), runTask(deps, id, "inline")]);
    expect([a.outcome, b.outcome].sort()).toEqual(["done", "skipped"]);
    expect(calls.get(id)).toBe(1);
    expect((await runTask(deps, id, "inline")).outcome).toBe("skipped");
  });
});
