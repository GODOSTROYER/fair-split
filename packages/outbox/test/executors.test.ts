import { schema as s } from "@fairsplit/db";
import { openTestDb, type TestDb } from "@fairsplit/db/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOutbox,
  createWorker,
  type DispatcherEvent,
  executorKindFromEnv,
  type TaskHandlers,
  type WorkflowClient,
} from "../src/index.js";
import { enqueued, rowOf, sleep, until } from "./helpers.js";

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
  const handlers: TaskHandlers = {
    extract: async (_a, ctx) => {
      calls.set(ctx.outboxId, (calls.get(ctx.outboxId) ?? 0) + 1);
    },
  };
  return { handlers, calls };
}

/** A stand-in for Render Workflows: accepts startTask and runs the task body (runTask) a little later. */
function fakeRender(opts: { delayMs?: number; fail?: boolean; never?: boolean } = {}) {
  const started: Array<{ slug: string; args: unknown[] }> = [];
  let body: ((id: string) => Promise<unknown>) | null = null;
  const client: WorkflowClient = {
    async startTask(slug, args) {
      started.push({ slug, args });
      if (opts.fail) throw new Error("Render API 503");
      if (!opts.never) setTimeout(() => void body?.(String(args[0])), opts.delayMs ?? 10);
      return { id: `trn-${started.length}` };
    },
  };
  return { client, started, bind: (fn: (id: string) => Promise<unknown>) => (body = fn) };
}

describe("workflow executor (Render Workflows, injected startTask)", () => {
  it("starts fs-tasks/<name> with [outboxId], records the task-run id, and the workflow runs it", async () => {
    const { handlers, calls } = counting();
    const render = fakeRender();
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "workflow",
      workflowClient: render.client,
      dispatcher: { pollMs: 30 },
    });
    render.bind((id) => ob.runTask(id, "workflow"));
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentId: "d" });
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(render.started[0]).toEqual({ slug: "fs-tasks/extract", args: [id] });
    const row = await rowOf(t.app.db, id);
    expect(row).toMatchObject({ executor: "workflow", workflowRunId: "trn-1" });
    expect(calls.get(id)).toBe(1);
  });

  it("falls back to inline at once when startTask throws", async () => {
    const { handlers, calls } = counting();
    const render = fakeRender({ fail: true });
    const events: DispatcherEvent[] = [];
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "workflow",
      workflowClient: render.client,
      dispatcher: { pollMs: 30, onEvent: (e) => events.push(e) },
    });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentId: "d" });
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect((await rowOf(t.app.db, id)).executor).toBe("inline");
    expect(events.some((e) => e.type === "dispatch_failed" && e.error === "Render API 503")).toBe(true);
    expect(calls.get(id)).toBe(1);
  });

  it("falls back to inline when the workflow has not reported running within the start timeout", async () => {
    const { handlers, calls } = counting();
    const render = fakeRender({ never: true });
    const events: DispatcherEvent[] = [];
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "workflow",
      workflowClient: render.client,
      dispatcher: { pollMs: 30, startTimeoutMs: 300, onEvent: (e) => events.push(e) },
    });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentId: "d" });
    await sleep(150);
    expect((await rowOf(t.app.db, id)).state).toBe("dispatched");
    await until(async () => (await rowOf(t.app.db, id)).state === "done", 5000);
    expect(events.map((e) => e.type)).toContain("fallback_inline");
    expect(calls.get(id)).toBe(1);
  });

  it("a workflow that starts late, racing the inline fallback, still runs the task once", async () => {
    const { handlers, calls } = counting();
    const render = fakeRender({ delayMs: 320 });
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "workflow",
      workflowClient: render.client,
      dispatcher: { pollMs: 30, startTimeoutMs: 300 },
    });
    render.bind((id) => ob.runTask(id, "workflow"));
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const ids = await Promise.all(
      Array.from({ length: 5 }, () => enqueued(t.app.db, "extract", { documentId: "d" })),
    );
    await until(async () => {
      const rows = await Promise.all(ids.map((id) => rowOf(t.app.db, id)));
      return rows.every((r) => r.state === "done");
    }, 8000);
    await sleep(400);
    expect(ids.map((id) => calls.get(id))).toEqual([1, 1, 1, 1, 1]);
  });
});

describe("worker executor (EXECUTOR=worker, the S6 fallback)", () => {
  it("hands tasks to the background worker over NOTIFY, which runs them", async () => {
    const { handlers, calls } = counting();
    const worker = createWorker({
      db: t.app.db,
      handlers,
      workerId: "worker-1",
      listenUrl: t.url,
      scanMs: 60_000,
    });
    await worker.start();
    stops.push(() => worker.stop());
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "worker",
      dispatcher: { pollMs: 30 },
    });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentId: "d" });
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect((await rowOf(t.app.db, id)).executor).toBe("worker");
    expect(calls.get(id)).toBe(1);
  });

  it("a worker that was down picks up dispatched rows by scanning", async () => {
    const { handlers, calls } = counting();
    const ob = createOutbox({
      db: t.app.db,
      handlers,
      workerId: "api",
      executor: "worker",
      dispatcher: { pollMs: 30, startTimeoutMs: 60_000 },
    });
    stops.push(() => ob.dispatcher.stop({ drain: true }));
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentId: "d" });
    await until(async () => (await rowOf(t.app.db, id)).state === "dispatched");
    await sleep(1100);
    const worker = createWorker({
      db: t.app.db,
      handlers,
      workerId: "worker-2",
      listenUrl: t.url,
      scanMs: 100,
    });
    await worker.start();
    stops.push(() => worker.stop());
    await until(async () => (await rowOf(t.app.db, id)).state === "done");
    expect(calls.get(id)).toBe(1);
  });
});

describe("EXECUTOR", () => {
  it("defaults to inline and accepts workflow and worker", () => {
    expect(executorKindFromEnv({})).toBe("inline");
    expect(executorKindFromEnv({ EXECUTOR: "Workflow" })).toBe("workflow");
    expect(executorKindFromEnv({ EXECUTOR: "worker" })).toBe("worker");
    expect(() => executorKindFromEnv({ EXECUTOR: "lambda" })).toThrow(/inline, workflow or worker/);
  });

  it("a remote executor without a fallback is refused at construction", async () => {
    const { createDispatcher, workflowExecutor } = await import("../src/index.js");
    expect(() =>
      createDispatcher({
        db: t.app.db,
        workerId: "x",
        executor: workflowExecutor({ startTask: async () => ({}) }),
      }),
    ).toThrow(/fallback/);
  });
});
