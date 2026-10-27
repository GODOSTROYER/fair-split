// The retry model end to end (review blocker: "a task that fails on Workflows is never re-executed").
// A fake Render that behaves like @renderinc/sdk 1.3.0 documents it (a repeated idempotency key
// within 24 h returns the FIRST run; a thrown attempt is retried within the same taskRunId up to the
// registered maxRetries) runs the real fs-tasks wrappers from registerWorkflowTasks, dispatched by
// the real runWithFallback, against an in-memory outbox row.
import { describe, expect, it } from "vitest";
import type { TaskName } from "../src/_shims/contracts.js";
import type { ExecutorReceipt, TaskExecutor } from "../src/executor.js";
import type { TaskHandler, TaskOutcome } from "../src/handlers.js";
import { createWorkflowExecutor, runWithFallback, type WorkflowsPort } from "../src/handoff/dispatcher.js";
import type { TaskRuntime } from "../src/invoke.js";
import { silentLogger } from "../src/log.js";
import { RENDER_RETRY, TASK_POLICY } from "../src/policy.js";
import { registerWorkflowTasks } from "../src/workflow.js";
import { OUTBOX_ID, OutboxRow, recorder, taskContext, testRuntime } from "./helpers.js";

type RunStatus = "pending" | "running" | "succeeded" | "failed";

interface FakeRun {
  readonly id: string;
  status: RunStatus;
  attempts: number;
  outcome?: unknown;
  done: Promise<void>;
}

/** Render Workflows, as far as the dispatcher can observe it. */
class FakeRender {
  readonly runs = new Map<string, FakeRun>();
  readonly keys = new Map<string, string>();
  readonly starts: { slug: string; key: string | undefined; reused: boolean }[] = [];
  #seq = 0;

  constructor(
    private readonly tasks: Map<string, { maxRetries: number; func: (...a: unknown[]) => unknown }>,
  ) {}

  port(): WorkflowsPort {
    return {
      startTask: async (slug: string, input: unknown, options?: unknown) => {
        const key = (options as { idempotencyKey?: string } | undefined)?.idempotencyKey;
        const existing = key ? this.keys.get(key) : undefined;
        this.starts.push({ slug, key, reused: existing !== undefined });
        if (existing) return { taskRunId: existing };
        const name = slug.split("/")[1] ?? "";
        const task = this.tasks.get(name);
        if (!task) throw new Error(`Task '${name}' not found`);
        const id = `trn-${++this.#seq}`;
        if (key) this.keys.set(key, id);
        const run: FakeRun = { id, status: "running", attempts: 0, done: Promise.resolve() };
        run.done = this.#execute(run, task, input as unknown[]);
        this.runs.set(id, run);
        return { taskRunId: id };
      },
      getTaskRun: async (id: string) => ({ status: this.runs.get(id)?.status ?? "pending" }),
    } as unknown as WorkflowsPort;
  }

  async #execute(
    run: FakeRun,
    task: { maxRetries: number; func: (...a: unknown[]) => unknown },
    input: unknown[],
  ) {
    await Promise.resolve();
    for (;;) {
      run.attempts++;
      try {
        run.outcome = await task.func(taskContext(run.id), ...input);
        run.status = "succeeded";
        return;
      } catch {
        if (run.attempts > task.maxRetries) {
          run.status = "failed";
          return;
        }
      }
    }
  }
}

interface Scenario {
  /** The outbox claim lets the same Render run take its row back. */
  reentrantClaim?: boolean;
  /** The runner gives the row back when the handler throws (WS-DATA's runner). */
  releaseOnFailure?: boolean;
  /** How many executions of the handler throw a transient error first. */
  transientFailures: number;
  /** How many times resolving the runtime fails first (a failure before the claim). */
  bootFailures?: number;
}

function harness(s: Scenario) {
  const row = new OutboxRow({ reentrant: s.reentrantClaim ?? false });
  let executions = 0;
  let failuresLeft = s.transientFailures;
  const extract: TaskHandler = async (inv) => {
    const claimant = inv.taskRunId ?? "inline";
    if (!row.claim(claimant)) return { status: "skipped", detail: "claim lost" };
    executions++;
    if (failuresLeft > 0) {
      failuresLeft--;
      if (s.releaseOnFailure) row.release(claimant);
      throw new Error("529 overloaded");
    }
    row.finish(claimant);
    return { status: "done" };
  };
  const runtime: TaskRuntime = testRuntime({ extract });
  let bootFailuresLeft = s.bootFailures ?? 0;
  const { register, calls } = recorder();
  registerWorkflowTasks({
    resolveRuntime: () => {
      if (bootFailuresLeft > 0) {
        bootFailuresLeft--;
        throw new Error("connect ECONNREFUSED");
      }
      return runtime;
    },
    logger: silentLogger(),
    register,
  });
  const tasks = new Map(
    calls.map((c) => [
      c.options.name,
      { maxRetries: c.options.retry?.maxRetries ?? 0, func: c.func as (...a: unknown[]) => unknown },
    ]),
  );
  const render = new FakeRender(tasks);
  const inline: TaskExecutor & { runs: number } = {
    kind: "inline",
    runs: 0,
    async run(name: TaskName, ids: readonly string[]): Promise<ExecutorReceipt> {
      inline.runs++;
      const outcome: TaskOutcome = await (runtime.handlers[name] as TaskHandler)({
        name,
        ids,
        executor: "inline",
        flags: new Set(),
      }).catch(() => ({ status: "failed" as const }));
      return { executor: "inline", outcome };
    },
  };
  const clock = () => {
    let t = 0;
    return {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
  };

  /** One dispatch of the row as fs-api's dispatcher would do it, then wait for Render to settle. */
  async function dispatch(opts: { attempt?: number } = {}) {
    const attempt = opts.attempt ?? row.dispatch();
    const receipt = await runWithFallback(
      { workflow: render.port(), inline, logger: silentLogger() },
      "extract",
      [OUTBOX_ID],
      { ...clock(), attempt },
    );
    if (receipt.taskRunId) await render.runs.get(receipt.taskRunId)?.done;
    return receipt;
  }

  return { row, render, inline, dispatch, executions: () => executions };
}

describe("retry model: Render retries within a run, attempt-scoped keys across runs", () => {
  it("extract, readRateCard and warmCaches register with Render retries; the dispatcher's keys are per attempt", () => {
    for (const name of ["extract", "readRateCard", "warmCaches"] as const) {
      expect(TASK_POLICY[name].retry).toEqual(RENDER_RETRY);
    }
    expect(RENDER_RETRY.maxRetries).toBeGreaterThan(0);
  });

  it.each([
    { label: "the runner releases the row on failure", releaseOnFailure: true },
    { label: "the claim is re-entrant for the same run", reentrantClaim: true },
  ])(
    "inv.i7.render-retry-reruns: a transient throw is retried inside the same run when $label",
    async (s) => {
      const h = harness({ ...s, transientFailures: 1 });
      const receipt = await h.dispatch();
      expect(receipt).toMatchObject({ executor: "workflow", taskRunId: "trn-1" });
      const run = h.render.runs.get("trn-1");
      expect(run).toMatchObject({ status: "succeeded", attempts: 2, outcome: { status: "done" } });
      expect(h.executions()).toBe(2);
      expect(h.row.state).toBe("done");
      expect(h.inline.runs).toBe(0);
    },
  );

  it("inv.i7.retry-redispatch-runs-again: with S3.3's plain claim, the sweeper's re-dispatch starts a new run and the handler runs again", async () => {
    const h = harness({ transientFailures: 1 });
    await h.dispatch();
    // Attempt 0 claimed the row and threw; Render's retries found it claimed and exited `skipped`.
    expect(h.render.runs.get("trn-1")).toMatchObject({ attempts: 2, outcome: { status: "skipped" } });
    expect(h.executions()).toBe(1);
    expect(h.row.state).toBe("running");

    h.row.sweep(); // 5 minutes later
    const second = await h.dispatch();
    expect(second).toMatchObject({ executor: "workflow", taskRunId: "trn-2" });
    expect(h.render.starts.map((st) => st.key)).toEqual([`${OUTBOX_ID}:a1`, `${OUTBOX_ID}:a2`]);
    expect(h.render.starts.every((st) => !st.reused)).toBe(true);
    expect(h.executions()).toBe(2);
    expect(h.row.state).toBe("done");
  });

  it("negative control: a key that repeats across attempts gets the first run back, so nothing ever runs again", async () => {
    const h = harness({ transientFailures: 1 });
    const wf = createWorkflowExecutor({ client: h.render.port() });
    for (let i = 0; i < 8 && h.row.state !== "dead"; i++) {
      if (i > 0) h.row.sweep();
      if (h.row.state !== "queued") break;
      h.row.dispatch();
      const { taskRunId } = await wf.run("extract", [OUTBOX_ID], { idempotencyKey: `extract:${OUTBOX_ID}` });
      await h.render.runs.get(taskRunId ?? "")?.done;
    }
    h.row.sweep();
    expect(h.render.runs.size).toBe(1);
    expect(h.render.starts.slice(1).every((st) => st.reused)).toBe(true);
    expect(h.executions()).toBe(1);
    expect(h.row.state).toBe("dead");
  });

  it("a failure before the claim on every Render attempt leaves the row dispatched; a re-dispatch under a reused attempt gets the failed run back and falls back inline", async () => {
    const h = harness({ transientFailures: 0, bootFailures: RENDER_RETRY.maxRetries + 1 });
    await h.dispatch();
    expect(h.render.runs.get("trn-1")).toMatchObject({ status: "failed", attempts: 3 });
    expect(h.row.state).toBe("dispatched");
    expect(h.executions()).toBe(0);

    // A runner-incremented counter never moved (nothing claimed), so the attempt repeats.
    h.row.sweep();
    h.row.dispatch();
    const again = await h.dispatch({ attempt: 1 });
    expect(again).toMatchObject({
      executor: "inline",
      fellBack: "terminal-before-pickup",
      taskRunId: "trn-1",
    });
    expect(h.render.starts.at(-1)?.reused).toBe(true);
    expect(h.executions()).toBe(1);
    expect(h.row.state).toBe("done");
  });
});
