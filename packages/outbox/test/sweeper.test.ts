/**
 * The sweeper survives a restart (review minor, dispatcher.ts). The 20 s fallback watchdog lived only in memory: after
 * an fs-api restart, a row handed to Render Workflows that never started waited for the 5-minute sweep, which put it
 * back in the queue for the same remote executor and counted nothing, so a startTask that is accepted but never run
 * cycled every 5 minutes forever. Now every hand-off is counted (task_outbox.dispatches), the sweep runs a remote
 * hand-off that missed its start timeout inline, and a row dispatched max_attempts times without finishing goes dead.
 */
import { schema as s } from "@fairsplit/db";
import { openTestDb, type TestDb } from "@fairsplit/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDispatcher,
  createOutbox,
  type DispatcherEvent,
  inlineExecutor,
  type TaskHandlers,
  type WorkflowClient,
} from "../src/index.js";
import { enqueued, rowOf, until } from "./helpers.js";

let t: TestDb;
const stops: Array<() => Promise<void>> = [];
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
beforeEach(async () => {
  await t.owner.db.delete(s.taskOutbox);
});
afterEach(async () => {
  while (stops.length) await stops.pop()?.();
});
afterAll(async () => {
  await t?.close();
});

function counting() {
  const calls = new Map<string, number>();
  const bump = async (_a: unknown, ctx: { outboxId: string }) => {
    calls.set(ctx.outboxId, (calls.get(ctx.outboxId) ?? 0) + 1);
  };
  const handlers: TaskHandlers = { extract: bump, computeRun: bump };
  return { handlers, calls };
}

/** Render Workflows that accepts every startTask and never runs any of them. */
function blackHole() {
  const started: string[] = [];
  const client: WorkflowClient = {
    async startTask(slug) {
      started.push(slug);
      return { id: `trn-${started.length}` };
    },
  };
  return { client, started };
}

/** What a process that died mid-flight leaves behind. */
async function leftBehind(id: string, set: Record<string, unknown>) {
  await t.owner.db
    .update(s.taskOutbox)
    .set({ state: "dispatched", claimedBy: "fs-api:dead", ...set })
    .where(eq(s.taskOutbox.id, id));
}

describe("every hand-off is counted", () => {
  it("a task run once was dispatched once", async () => {
    const { handlers } = counting();
    const ob = createOutbox({ db: t.app.db, handlers, workerId: "fs-api", dispatcher: { pollMs: 25 } });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db);
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(await rowOf(t.app.db, id)).toMatchObject({ dispatches: 1, attempts: 1 });
  });
});

describe("a remote hand-off that never starts", () => {
  it("is run inline by the sweep once its start timeout has passed, even when the watchdog died with the process", async () => {
    const { handlers, calls } = counting();
    const render = blackHole();
    const events: DispatcherEvent[] = [];
    const id = await enqueued(t.app.db, "extract", { documentIds: ["d"], runId: null });
    // the previous fs-api handed it to Workflows 30 s ago, then restarted: no watchdog remembers it
    await leftBehind(id, {
      executor: "workflow",
      dispatches: 1,
      dispatchedAt: sql`now() - interval '30 seconds'`,
      workflowRunId: "trn-lost",
    });
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "fs-api:new",
      executor: "workflow",
      workflowClient: render.client,
      dispatcher: { pollMs: 25, onEvent: (e) => events.push(e) },
    });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    expect(await ob.dispatcher.sweep()).toMatchObject({ rescued: 1, redispatched: 0, dead: 0 });
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(render.started).toEqual([]); // not sent back to the executor that lost it
    expect(await rowOf(t.app.db, id)).toMatchObject({ executor: "inline", attempts: 1 });
    expect(calls.get(id)).toBe(1);
    expect(events.some((e) => e.type === "fallback_inline" && e.id === id)).toBe(true);
  });

  it("is left alone while it is still inside its start timeout", async () => {
    const { handlers } = counting();
    const id = await enqueued(t.app.db, "extract", { documentIds: ["d"], runId: null });
    await leftBehind(id, {
      executor: "workflow",
      dispatches: 1,
      dispatchedAt: sql`now() - interval '5 seconds'`,
    });
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "fs-api",
      executor: "workflow",
      workflowClient: blackHole().client,
    });
    expect(await ob.dispatcher.sweep()).toMatchObject({ rescued: 0 });
    expect((await rowOf(t.app.db, id)).state).toBe("dispatched");
  });
});

describe("a row that keeps being dispatched without finishing", () => {
  it("goes dead after max_attempts hand-offs instead of cycling every 5 minutes", async () => {
    const stuck = await enqueued(t.app.db, "computeRun", { runId: "a" });
    const again = await enqueued(t.app.db, "computeRun", { runId: "b" });
    const old = sql`now() - interval '6 minutes'`;
    await leftBehind(stuck, { executor: "inline", dispatches: 8, dispatchedAt: old });
    await leftBehind(again, { executor: "inline", dispatches: 2, dispatchedAt: old });
    const d = createDispatcher({
      db: t.app.db,
      workerId: "sweeper",
      executor: inlineExecutor(async () => {}),
    });
    expect(await d.sweep()).toEqual({ rescued: 0, redispatched: 1, recovered: 0, dead: 1 });
    const dead = await rowOf(t.app.db, stuck);
    expect(dead.state).toBe("dead");
    expect(dead.lastError).toMatch(/dispatched 8 times/);
    expect(dead.finishedAt).toBeInstanceOf(Date);
    expect(await rowOf(t.app.db, again)).toMatchObject({ state: "queued", executor: null, claimedBy: null });
  });
});
