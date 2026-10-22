import { describe, expect, it, vi } from "vitest";
import { createInlineExecutor, INLINE_CONCURRENCY, Semaphore, type TaskExecutor } from "../src/executor.js";
import type { TaskHandler } from "../src/handlers.js";
import { createWorkflowExecutor, runWithFallback, type WorkflowsPort } from "../src/handoff/dispatcher.js";
import { main as inlineMain, parseInlineArgs } from "../src/inline.js";
import { silentLogger } from "../src/log.js";
import { OUTBOX_ID, testRuntime } from "./helpers.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Semaphore", () => {
  it("admits `limit` holders and releases waiters in FIFO order", async () => {
    const s = new Semaphore(2);
    const order: number[] = [];
    const r1 = await s.acquire();
    const r2 = await s.acquire();
    const p3 = s.acquire().then((r) => {
      order.push(3);
      return r;
    });
    const p4 = s.acquire().then((r) => {
      order.push(4);
      return r;
    });
    await tick();
    expect([s.active, s.waiting]).toEqual([2, 2]);
    r1();
    r1(); // double release is a no-op
    const r3 = await p3;
    expect(order).toEqual([3]);
    r2();
    const r4 = await p4;
    expect(order).toEqual([3, 4]);
    r3();
    r4();
    expect([s.active, s.waiting]).toEqual([0, 0]);
  });
  it("rejects a non-positive limit", () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(1.5)).toThrow();
  });
});

describe("inline executor (EXECUTOR=inline: local and CI)", () => {
  it(`runs at most ${INLINE_CONCURRENCY} tasks at a time (S3.3)`, async () => {
    const gates = [deferred(), deferred(), deferred()];
    let running = 0;
    let peak = 0;
    let n = 0;
    const handler: TaskHandler = async () => {
      const gate = gates[n++] as ReturnType<typeof deferred>;
      running++;
      peak = Math.max(peak, running);
      await gate.promise;
      running--;
      return { status: "done" };
    };
    const ex = createInlineExecutor({
      runtime: testRuntime({ extract: handler }),
      logger: silentLogger(),
    });
    const runs = [ex.run("extract", ["a"]), ex.run("extract", ["b"]), ex.run("extract", ["c"])];
    await tick();
    expect([ex.active, ex.waiting, running]).toEqual([2, 1, 2]);
    for (const g of gates) g.resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(ex.active).toBe(0);
  });

  it("returns the handler outcome and marks the executor as inline", async () => {
    const handler = vi.fn<TaskHandler>(async () => ({ status: "skipped" as const, detail: "claim lost" }));
    const ex = createInlineExecutor({
      runtime: testRuntime({ settleBatch: handler }),
      logger: silentLogger(),
    });
    await expect(ex.run("settleBatch", [OUTBOX_ID])).resolves.toEqual({
      executor: "inline",
      outcome: { status: "skipped", detail: "claim lost" },
    });
    expect(handler.mock.calls[0]?.[0]).toMatchObject({ executor: "inline", ids: [OUTBOX_ID] });
  });

  it("releases its slot when a handler throws", async () => {
    const ex = createInlineExecutor({
      runtime: testRuntime({
        agentTurn: async () => Promise.reject(new Error("boom")),
      }),
      logger: silentLogger(),
      concurrency: 1,
    });
    await expect(ex.run("agentTurn", ["a"])).rejects.toThrow("boom");
    await expect(ex.run("agentTurn", ["b"])).rejects.toThrow("boom");
    expect(ex.active).toBe(0);
  });

  it("CLI parses <taskName> <ids…> and maps outcomes to exit codes", async () => {
    expect(parseInlineArgs(["judgeReset", OUTBOX_ID])).toEqual({ name: "judgeReset", ids: [OUTBOX_ID] });
    expect(() => parseInlineArgs(["opsPing", "x"])).toThrow(/taskName is one of/);
    expect(() => parseInlineArgs(["reconcile"])).toThrow(/at least one/);
    const runtime = testRuntime({ reconcile: async () => ({ status: "done" }) });
    const deps = { runtime, logger: silentLogger(), env: { PP_ENV: "sandbox" } };
    await expect(inlineMain(["reconcile", OUTBOX_ID], deps)).resolves.toBe(0);
    await expect(inlineMain(["warmCaches", OUTBOX_ID], deps)).resolves.toBe(2);
    expect(runtime.failed).toEqual([
      { id: OUTBOX_ID, code: "NOT_WIRED", detail: "Task warmCaches has no handler wired yet" },
    ]);
  });

  it("CLI refuses to run outside the sandbox (S3.13)", async () => {
    const runtime = testRuntime({ reconcile: async () => ({ status: "done" }) });
    for (const env of [{}, { PP_ENV: "live" }]) {
      await expect(
        inlineMain(["reconcile", OUTBOX_ID], { runtime, logger: silentLogger(), env }),
      ).rejects.toThrow(/PP_ENV must be "sandbox"/);
    }
  });
});

function fakeWorkflows(statuses: string[], opts: { startThrows?: boolean } = {}) {
  const startTask = vi.fn(async (slug: string, input: unknown[], options?: unknown) => {
    if (opts.startThrows) throw new Error("401 unauthorized");
    void slug;
    void input;
    void options;
    return { taskRunId: "trn-abc" };
  });
  let i = 0;
  const getTaskRun = vi.fn(async () => ({ status: statuses[Math.min(i++, statuses.length - 1)] }));
  const cancelTaskRun = vi.fn(async () => undefined);
  return { startTask, getTaskRun, cancelTaskRun } as unknown as WorkflowsPort & {
    startTask: typeof startTask;
    getTaskRun: typeof getTaskRun;
    cancelTaskRun: typeof cancelTaskRun;
  };
}

describe("workflow executor", () => {
  it("starts fs-tasks/<name> with ids as positional input and the outbox dedupe key", async () => {
    const wf = fakeWorkflows(["running"]);
    const ex = createWorkflowExecutor({ client: wf });
    await expect(ex.run("extract", [OUTBOX_ID], { idempotencyKey: "extract:doc-1" })).resolves.toEqual({
      executor: "workflow",
      taskRunId: "trn-abc",
    });
    expect(wf.startTask).toHaveBeenCalledWith("fs-tasks/extract", [OUTBOX_ID], {
      idempotencyKey: "extract:doc-1",
    });
  });

  it("uses the slug Render assigned (FS_TASKS_SLUG) when given", async () => {
    const wf = fakeWorkflows(["running"]);
    await createWorkflowExecutor({ client: wf, workflowSlug: "fs-tasks-k3j2" }).run("reconcile", ["a"]);
    expect(wf.startTask.mock.calls[0]?.[0]).toBe("fs-tasks-k3j2/reconcile");
  });

  it("refuses non-id input before calling Render", async () => {
    const wf = fakeWorkflows(["running"]);
    await expect(createWorkflowExecutor({ client: wf }).run("extract", ["not an id"])).rejects.toThrow(
      /not an id/,
    );
    expect(wf.startTask).not.toHaveBeenCalled();
  });
});

describe("runWithFallback (S3.3 step 4)", () => {
  const inlineSpy = (): TaskExecutor & { run: ReturnType<typeof vi.fn> } => ({
    kind: "inline",
    run: vi.fn(async () => ({ executor: "inline" as const, outcome: { status: "done" as const } })),
  });

  function clock() {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  }

  it("stays on Workflows when the run is picked up, and reports pickup latency", async () => {
    const wf = fakeWorkflows(["pending", "pending", "running"]);
    const inline = inlineSpy();
    const c = clock();
    const r = await runWithFallback({ workflow: wf, inline, logger: silentLogger() }, "extract", ["a"], {
      ...c,
      pollEveryMs: 500,
    });
    expect(r).toEqual({ executor: "workflow", taskRunId: "trn-abc", pickupMs: 1000 });
    expect(inline.run).not.toHaveBeenCalled();
  });

  it("runs inline when startTask throws", async () => {
    const wf = fakeWorkflows([], { startThrows: true });
    const inline = inlineSpy();
    const r = await runWithFallback(
      { workflow: wf, inline, logger: silentLogger() },
      "judgeReset",
      ["a"],
      clock(),
    );
    expect(r).toMatchObject({ executor: "inline", fellBack: "start-failed" });
    expect(inline.run).toHaveBeenCalledWith("judgeReset", ["a"], {});
  });

  it("runs inline, after cancelling, when the run is not picked up within 20 s", async () => {
    const wf = fakeWorkflows(["pending"]);
    const inline = inlineSpy();
    const c = clock();
    const r = await runWithFallback({ workflow: wf, inline, logger: silentLogger() }, "reconcile", ["a"], {
      ...c,
      idempotencyKey: "reconcile:catchup:2026-10-23T05",
    });
    expect(r).toMatchObject({ executor: "inline", fellBack: "not-picked-up", taskRunId: "trn-abc" });
    expect(c.now()).toBe(20_000);
    expect(wf.cancelTaskRun).toHaveBeenCalledWith("trn-abc");
    expect(inline.run).toHaveBeenCalledWith("reconcile", ["a"], {
      idempotencyKey: "reconcile:catchup:2026-10-23T05",
    });
  });

  it("treats a failed status read as not-yet-picked-up", async () => {
    const wf = fakeWorkflows(["running"]);
    wf.getTaskRun.mockRejectedValueOnce(new Error("502"));
    const r = await runWithFallback(
      { workflow: wf, inline: inlineSpy(), logger: silentLogger() },
      "explain",
      ["a"],
      clock(),
    );
    expect(r.executor).toBe("workflow");
    expect(wf.getTaskRun).toHaveBeenCalledTimes(2);
  });

  it("accepts an already-finished run as picked up", async () => {
    const r = await runWithFallback(
      { workflow: fakeWorkflows(["succeeded"]), inline: inlineSpy(), logger: silentLogger() },
      "computeRun",
      ["a"],
      clock(),
    );
    expect(r).toMatchObject({ executor: "workflow", pickupMs: 0 });
  });
});
