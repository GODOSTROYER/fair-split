import { repos, schema as s, workspaceScope } from "@fairsplit/db";
import { fixtureWorkspace, openTestDb, type TestDb } from "@fairsplit/db/testing";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueue, type RunnerDeps, runTask, type TaskHandlers } from "../src/index.js";
import { enqueued, key, rowOf, sleep, until } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 10 });
});
afterAll(async () => {
  await t?.close();
});

const deps = (handlers: TaskHandlers, extra: Partial<RunnerDeps> = {}): RunnerDeps => ({
  db: t.app.db,
  handlers,
  workerId: "runner-test",
  ...extra,
});

describe("failure handling", () => {
  it("a failing task goes back to queued with exponential backoff and its error, then dead after max attempts", async () => {
    let calls = 0;
    const handlers: TaskHandlers = {
      reconcile: async () => {
        calls++;
        throw new Error("PayPal 503");
      },
    };
    const id = await enqueued(t.app.db, "reconcile", { kind: "hot" }, { maxAttempts: 3 });
    const d = deps(handlers, { backoffMs: (n) => n * 1000 });

    const first = await runTask(d, id, "inline");
    expect(first).toMatchObject({ outcome: "retry", error: "Error: PayPal 503" });
    let row = await rowOf(t.app.db, id);
    expect(row).toMatchObject({
      state: "queued",
      attempts: 1,
      lastError: "Error: PayPal 503",
      claimedBy: null,
    });
    expect(row.runAfter.getTime() - Date.now()).toBeGreaterThan(500);
    // not due yet: a runner may not take it early
    expect((await runTask(d, id, "inline")).outcome).toBe("skipped");

    for (const n of [2, 3]) {
      await t.owner.db.update(s.taskOutbox).set({ runAfter: sql`now()` }).where(eq(s.taskOutbox.id, id));
      const r = await runTask(d, id, "inline");
      expect(r.outcome).toBe(n < 3 ? "retry" : "dead");
    }
    row = await rowOf(t.app.db, id);
    expect(row).toMatchObject({ state: "dead", attempts: 3 });
    expect(row.finishedAt).toBeInstanceOf(Date);
    expect(calls).toBe(3);
  });

  it("a task with no registered handler is retried, not lost", async () => {
    const id = await enqueued(t.app.db, "warmCaches", {});
    const r = await runTask(deps({}), id, "inline");
    expect(r).toMatchObject({ outcome: "retry" });
    expect((await rowOf(t.app.db, id)).lastError).toMatch(/no handler registered for task warmCaches/);
  });
});

describe("idempotent execution contract", () => {
  it("ctx.complete(tx) marks the task done atomically with the handler's own writes", async () => {
    const ws = await fixtureWorkspace(t.app.db, { withRun: true });
    const runId = ws.runId ?? "";
    const scope = workspaceScope({
      workspaceId: ws.workspaceId,
      actor: { kind: "engine", id: "engine" },
      via: "system",
    });
    const handlers: TaskHandlers = {
      computeRun: async (args, ctx) => {
        await t.app.db.transaction(async (tx) => {
          const res = await repos(scope).runs.transition(tx, {
            id: String(args.runId),
            from: "DRAFT",
            to: "QUOTED",
            cause: { task: ctx.outboxId },
            provenance: "live",
          });
          if (!res.ok) return; // already moved: nothing to do
          await ctx.complete(tx);
        });
      },
    };
    const id = await enqueued(t.app.db, "computeRun", { runId });
    expect((await runTask(deps(handlers), id, "inline")).outcome).toBe("done");
    expect((await rowOf(t.app.db, id)).state).toBe("done");
    const [run] = await t.app.db.select().from(s.payRuns).where(eq(s.payRuns.id, runId));
    expect(run?.state).toBe("QUOTED");
  });

  it("a rerun after a crash between the handler's commit and `done` changes nothing (optimistic transitions)", async () => {
    const ws = await fixtureWorkspace(t.app.db, { withRun: true });
    const runId = ws.runId ?? "";
    const scope = workspaceScope({
      workspaceId: ws.workspaceId,
      actor: { kind: "engine", id: "engine" },
      via: "system",
    });
    let crash = true;
    const effects: string[] = [];
    const handlers: TaskHandlers = {
      computeRun: async (args) => {
        const res = await repos(scope).runs.transition(t.app.db, {
          id: String(args.runId),
          from: "DRAFT",
          to: "QUOTED",
          cause: "quote",
          provenance: "live",
        });
        if (res.ok) effects.push("moved");
        if (crash) {
          crash = false;
          throw new Error("process killed after commit");
        }
      },
    };
    const id = await t.app.db.transaction(
      async (tx) =>
        (await enqueue(tx, "computeRun", { runId }, key("quote"), { workspaceId: ws.workspaceId })).id,
    );
    expect((await runTask(deps(handlers, { backoffMs: () => 0 }), id, "inline")).outcome).toBe("retry");
    await sleep(5);
    expect((await runTask(deps(handlers), id, "inline")).outcome).toBe("done");
    expect(effects).toEqual(["moved"]);
    const events = await t.app.db.select().from(s.runEvents).where(eq(s.runEvents.runId, runId));
    expect(events.filter((e) => e.type === "run.state")).toHaveLength(1);
  });

  it("a run that loses its claim (swept as stuck) is told through its AbortSignal", async () => {
    let aborted = false;
    const handlers: TaskHandlers = {
      agentTurn: async (_a, ctx) => {
        // simulate the sweeper re-queueing this row while the handler is still busy
        await t.owner.db
          .update(s.taskOutbox)
          .set({ state: "queued", claimedBy: null })
          .where(eq(s.taskOutbox.id, ctx.outboxId));
        await until(() => ctx.signal.aborted, 3000);
        aborted = true;
      },
    };
    const id = await enqueued(t.app.db, "agentTurn", { sessionId: "s" });
    const r = await runTask(deps(handlers, { heartbeatMs: 50 }), id, "inline");
    expect(aborted).toBe(true);
    // the finished handler did not overwrite the row it no longer owns, and says so
    expect(r).toEqual({ outcome: "skipped", id, state: "queued" });
    expect((await rowOf(t.app.db, id)).state).toBe("queued");
  });
});
