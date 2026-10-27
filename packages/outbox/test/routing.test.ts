/**
 * Per-task executors (review major, index.ts; S3.3 and register deviation 3). createOutbox used to pick one primary
 * executor for every TaskName, so EXECUTOR=workflow sent postPayoutBatch to a cold fs-tasks: an extra OAuth call
 * against the 40/min budget and latency on the on-camera posting beat. Now the dispatcher routes every claimed row:
 * money, webhook, engine and agent tasks always run inline in fs-api; only the live slip read, the rate-card read and
 * cache warming go to Render Workflows (or the worker) when EXECUTOR says so, and a replayed task stays inline.
 * Each row records the executor it was handed to.
 *
 * Review minor (dispatcher.ts): `replay` defaulted to "never", so with EXECUTOR=workflow a Judge Mode read went to
 * Workflows unless the app injected a predicate; the predicate ran inside the claiming transaction while it held up
 * to batchSize*4 row locks; and with no inline capacity, a remote row beyond that window waited behind inline rows.
 * Now the default predicate reads the database (a judge workspace replays, C-06; so does kill_ai_live, per workspace
 * or FS_KILL), every replay check runs before the claim locks anything, and remote-eligible rows are looked up on
 * their own, so they never queue behind inline work.
 */
import { schema as s } from "@fairsplit/db";
import { fixtureWorkspace, openTestDb, type TestDb } from "@fairsplit/db/testing";
import { inArray, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createOutbox,
  defaultRoute,
  type ExecutorKind,
  type ExecutorRoute,
  REMOTE_TASKS,
  replayFromDatabase,
  TASK_NAMES,
  type TaskHandlers,
  type TaskName,
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

/** Every task name runs a handler that counts its runs by outbox id. */
function counting() {
  const calls = new Map<string, number>();
  const handlers: TaskHandlers = Object.fromEntries(
    TASK_NAMES.map((n) => [
      n,
      async (_a: unknown, ctx: { outboxId: string }) => {
        calls.set(ctx.outboxId, (calls.get(ctx.outboxId) ?? 0) + 1);
      },
    ]),
  );
  return { handlers, calls };
}

/** A stand-in for Render Workflows: accepts startTask and runs the task body (runTask) a little later. */
function fakeRender() {
  const started: string[] = [];
  let body: ((id: string) => Promise<unknown>) | null = null;
  const client: WorkflowClient = {
    async startTask(slug, args) {
      started.push(slug);
      setTimeout(() => void body?.(String(args[0])), 10);
      return { id: `trn-${started.length}` };
    },
  };
  return { client, started, bind: (fn: (id: string) => Promise<unknown>) => (body = fn) };
}

const allDone = (ids: string[]) => async () =>
  (await t.app.db.select().from(s.taskOutbox).where(inArray(s.taskOutbox.id, ids))).every(
    (r) => r.state === "done",
  );

function workflowOutbox(
  handlers: TaskHandlers,
  extra: {
    route?: ExecutorRoute;
    replay?: (task: { id: string; name: TaskName; args: unknown }) => boolean | Promise<boolean>;
    concurrency?: number;
  } = {},
) {
  const render = fakeRender();
  const ob = createOutbox({
    db: t.app.db,
    handlers,
    workerId: "fs-api",
    executor: "workflow",
    workflowClient: render.client,
    dispatcher: { pollMs: 25 },
    ...extra,
  });
  render.bind((id) => ob.runTask(id, "workflow"));
  stops.push(() => ob.dispatcher.stop({ drain: true }));
  return { ob, render };
}

describe("the S3.3 route table", () => {
  it("only extract, readRateCard and warmCaches leave fs-api, only when EXECUTOR names a remote executor, and only live", () => {
    expect([...REMOTE_TASKS].sort()).toEqual(["extract", "readRateCard", "warmCaches"]);
    for (const name of TASK_NAMES) {
      const at = (configured: ExecutorKind, replay = false) =>
        defaultRoute(name, { configured, workspaceId: null, replay });
      expect(at("inline"), name).toBe("inline");
      expect(at("workflow"), name).toBe(REMOTE_TASKS.has(name) ? "workflow" : "inline");
      expect(at("worker"), name).toBe(REMOTE_TASKS.has(name) ? "worker" : "inline");
      expect(at("workflow", true), `${name} replayed`).toBe("inline");
    }
  });
});

describe("the dispatcher routes every claimed row (EXECUTOR=workflow)", () => {
  it("postPayoutBatch runs inline in fs-api while extract goes to Render Workflows; each row records its executor", async () => {
    const { handlers, calls } = counting();
    const { ob, render } = workflowOutbox(handlers);
    await ob.dispatcher.start();
    const post = await enqueued(t.app.db, "postPayoutBatch", {
      runId: "r",
      senderBatchId: "2026A-7f3a91c2-r37",
    });
    const read = await enqueued(t.app.db, "extract", { documentIds: ["d"], runId: null });
    await until(allDone([post, read]));
    expect(render.started).toEqual(["fs-tasks/extract"]);
    expect((await rowOf(t.app.db, post)).executor).toBe("inline");
    expect(await rowOf(t.app.db, read)).toMatchObject({ executor: "workflow", workflowRunId: "trn-1" });
    expect([calls.get(post), calls.get(read)]).toEqual([1, 1]);
  });

  it("every money, webhook, engine and agent task stays in fs-api", async () => {
    const { handlers, calls } = counting();
    const { ob, render } = workflowOutbox(handlers);
    await ob.dispatcher.start();
    const inline = TASK_NAMES.filter((n) => !REMOTE_TASKS.has(n));
    const ids = await Promise.all(inline.map((n) => enqueued(t.app.db, n, { id: n })));
    await until(allDone(ids), 10_000);
    expect(render.started).toEqual([]);
    for (const id of ids) {
      expect((await rowOf(t.app.db, id)).executor).toBe("inline");
      expect(calls.get(id)).toBe(1);
    }
  });

  it("a replayed read stays inline: there is nothing for Workflows to do", async () => {
    const { handlers } = counting();
    const { ob, render } = workflowOutbox(handlers, {
      replay: (task) => (task.args as { documentIds?: string[] }).documentIds?.[0] === "slip-0403",
    });
    await ob.dispatcher.start();
    const replayed = await enqueued(t.app.db, "extract", { documentIds: ["slip-0403"], runId: "r37" });
    const live = await enqueued(t.app.db, "extract", { documentIds: ["sample-0449"], runId: null });
    await until(allDone([replayed, live]));
    expect(render.started).toEqual(["fs-tasks/extract"]);
    expect((await rowOf(t.app.db, replayed)).executor).toBe("inline");
    expect((await rowOf(t.app.db, live)).executor).toBe("workflow");
  });

  it("a custom route is honoured, and a route to an executor that is not configured runs inline", async () => {
    const { handlers } = counting();
    const { ob, render } = workflowOutbox(handlers, {
      route: (name, ctx) =>
        name === "computeRun" ? ctx.configured : name === "explain" ? "worker" : "inline",
    });
    await ob.dispatcher.start();
    const compute = await enqueued(t.app.db, "computeRun", { runId: "r", version: 3 });
    const explain = await enqueued(t.app.db, "explain", { lineId: "l", lang: "ceb" });
    await until(allDone([compute, explain]));
    expect(render.started).toEqual(["fs-tasks/computeRun"]);
    expect((await rowOf(t.app.db, explain)).executor).toBe("inline");
  });

  it("inline capacity bounds the inline claims, never the remote ones", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { handlers } = counting();
    const { ob, render } = workflowOutbox({ ...handlers, computeRun: () => gate }, { concurrency: 1 });
    await ob.dispatcher.start();
    const computes = [
      await enqueued(t.app.db, "computeRun", { runId: "a" }),
      await enqueued(t.app.db, "computeRun", { runId: "b" }),
      await enqueued(t.app.db, "computeRun", { runId: "c" }),
    ];
    const read = await enqueued(t.app.db, "extract", { documentIds: ["d"], runId: null });
    // the read is not stuck behind the inline queue …
    await until(allDone([read]));
    expect(render.started).toEqual(["fs-tasks/extract"]);
    // … and fs-api has taken only what it can run: one computeRun runs, the others wait unclaimed in the table
    const states = await Promise.all(computes.map(async (id) => (await rowOf(t.app.db, id)).state));
    expect(states.filter((x) => x === "running")).toHaveLength(1);
    expect(states.filter((x) => x === "queued")).toHaveLength(2);
    open();
    await until(allDone(computes));
  });
});

describe("replay by default: Judge Mode and kill_ai_live stay inline without an injected predicate", () => {
  it("a judge workspace's read stays in fs-api, a real workspace's goes to Workflows, kill_ai_live keeps it home", async () => {
    const judge = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const real = await fixtureWorkspace(t.app.db, { kind: "real" });
    const killed = await fixtureWorkspace(t.app.db, { kind: "real" });
    await t.owner.db
      .insert(s.systemFlags)
      .values({ workspaceId: killed.workspaceId, flag: "kill_ai_live", on: true, setBy: "test" });
    const { handlers } = counting();
    const { ob, render } = workflowOutbox(handlers); // no replay predicate injected
    await ob.dispatcher.start();
    const read = (workspaceId: string, doc: string) =>
      enqueued(t.app.db, "extract", { documentIds: [doc], runId: null }, { workspaceId });
    const j = await read(judge.workspaceId, "judge-0449");
    const r = await read(real.workspaceId, "real-0449");
    const k = await enqueued(
      t.app.db,
      "readRateCard",
      { documentId: "rc" },
      { workspaceId: killed.workspaceId },
    );
    await until(allDone([j, r, k]));
    expect((await rowOf(t.app.db, j)).executor).toBe("inline");
    expect((await rowOf(t.app.db, r)).executor).toBe("workflow");
    expect((await rowOf(t.app.db, k)).executor).toBe("inline");
    expect(render.started).toEqual(["fs-tasks/extract"]);
  });

  it("replayFromDatabase: FS_KILL=ai_live replays every read, system tasks included; an unknown workspace is live", async () => {
    const real = await fixtureWorkspace(t.app.db, { kind: "real" });
    const forced = replayFromDatabase(t.app.db, { env: { FS_KILL: "ai_live" } });
    const normal = replayFromDatabase(t.app.db, { env: {} });
    const task = (workspaceId: string | null) => ({
      id: "00000000-0000-7000-8000-000000000000",
      name: "warmCaches" as TaskName,
      workspaceId,
      args: {},
    });
    expect(await forced(task(null))).toBe(true);
    expect(await forced(task(real.workspaceId))).toBe(true);
    expect(await normal(task(null))).toBe(false);
    expect(await normal(task(real.workspaceId))).toBe(false);
    expect(await normal(task("01a00000-0000-7000-8000-000000000000"))).toBe(false);
  });
});

describe("claiming: the replay check holds no row locks, and remote rows never wait behind inline ones", () => {
  it("the replay predicate runs before the claim locks the row", async () => {
    const seen: string[] = [];
    const { handlers } = counting();
    const { ob } = workflowOutbox(handlers, {
      replay: async (task) => {
        // another connection can take the row's lock at once (NOWAIT) only if the claim does not hold it
        const free = await t.owner.db
          .transaction(async (tx) => {
            await tx.execute(sql`select id from task_outbox where id = ${task.id} for update nowait`);
          })
          .then(
            () => true,
            () => false,
          );
        seen.push(free ? "free" : "locked");
        return false;
      },
    });
    await ob.dispatcher.start();
    const id = await enqueued(t.app.db, "extract", { documentIds: ["nowait"], runId: null });
    await until(allDone([id]));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x === "free")).toBe(true);
    expect((await rowOf(t.app.db, id)).executor).toBe("workflow");
  });

  it("a read queued behind more inline work than any claim window still goes to Workflows at once", async () => {
    let open: () => void = () => {};
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { handlers } = counting();
    const { ob, render } = workflowOutbox({ ...handlers, computeRun: () => gate }, { concurrency: 1 });
    stops.push(async () => open()); // runs before the drain, so a failure here cannot hang the hook
    const computes: string[] = [];
    for (let i = 0; i < 60; i++) computes.push(await enqueued(t.app.db, "computeRun", { runId: `q${i}` }));
    const read = await enqueued(t.app.db, "extract", { documentIds: ["behind-60"], runId: null });
    await ob.dispatcher.start();
    await until(allDone([read]));
    expect(render.started).toEqual(["fs-tasks/extract"]);
    // fs-api still holds only what it can run: one computeRun, the other 59 wait unclaimed
    const states = await t.app.db
      .select({ state: s.taskOutbox.state, n: sql<number>`count(*)::int` })
      .from(s.taskOutbox)
      .where(inArray(s.taskOutbox.id, computes))
      .groupBy(s.taskOutbox.state);
    expect(Object.fromEntries(states.map((x) => [x.state, x.n]))).toEqual({ running: 1, queued: 59 });
    open();
    await until(allDone(computes), 20_000);
  });
});
