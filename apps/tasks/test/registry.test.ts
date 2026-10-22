import type { RegisterTaskOptions, TaskContext, TaskFunction } from "@renderinc/sdk/workflows";
import { describe, expect, it, vi } from "vitest";
import { isTaskName, TASK_NAMES, type TaskName } from "../src/_shims/contracts.js";
import {
  PermanentTaskError,
  type TaskHandler,
  TaskNotWiredError,
  unwiredHandlers,
  withHandlers,
} from "../src/handlers.js";
import { MAX_ID_LENGTH, MAX_IDS, validateIds } from "../src/invoke.js";
import { silentLogger } from "../src/log.js";
import { TASK_POLICY } from "../src/policy.js";
import { loadRuntime } from "../src/wiring.js";
import {
  DB_PING_TASK,
  PING_TASK,
  type RegisterFn,
  registerWorkflowTasks,
  taskSlug,
  WORKFLOW_SERVICE,
} from "../src/workflow.js";
import { captureLogger, OUTBOX_ID, testRuntime } from "./helpers.js";

/** The register's IC-01 list, typed out independently of the shim so a drift fails here. */
const REGISTER_IC01 = [
  "ensureInvoice",
  "recordPayment",
  "processWebhook",
  "postPayoutBatch",
  "settleBatch",
  "cancelUnclaimed",
  "reroute",
  "extract",
  "readRateCard",
  "computeRun",
  "explain",
  "agentTurn",
  "pushNotify",
  "reconcile",
  "judgeReset",
  "warmCaches",
];

interface Recorded {
  options: RegisterTaskOptions;
  func: TaskFunction<unknown[], unknown>;
}

function recorder(): { register: RegisterFn; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const register = ((options: RegisterTaskOptions, func: TaskFunction<unknown[], unknown>) => {
    calls.push({ options, func });
    return { name: options.name, func };
  }) as unknown as RegisterFn;
  return { register, calls };
}

const ctx = (taskRunId = "trn-test-1"): TaskContext => ({
  metadata: { taskRunId },
  run: async () => {
    throw new Error("subtasks are not used by fs-tasks");
  },
});

const runtimeWith = (overrides: Partial<Record<TaskName, TaskHandler>>) => testRuntime(overrides);

describe("TaskName registry shim (IC-01)", () => {
  it("lists exactly the register's 16 task names, in order, without duplicates", () => {
    expect([...TASK_NAMES]).toEqual(REGISTER_IC01);
    expect(new Set(TASK_NAMES).size).toBe(16);
  });

  it("isTaskName accepts registry names only", () => {
    for (const n of TASK_NAMES) expect(isTaskName(n)).toBe(true);
    for (const n of ["opsPing", "", "EXTRACT", "extract ", 42, undefined, null])
      expect(isTaskName(n)).toBe(false);
  });
});

describe("registerWorkflowTasks", () => {
  it("registers every TaskName once, plus the opsPing and opsDbPing diagnostics, synchronously", () => {
    const { register, calls } = recorder();
    const wf = registerWorkflowTasks({
      resolveRuntime: () => runtimeWith({}),
      logger: silentLogger(),
      register,
    });
    expect(calls.map((c) => c.options.name)).toEqual([...TASK_NAMES, PING_TASK, DB_PING_TASK]);
    expect(Object.keys(wf.tasks)).toEqual([...TASK_NAMES]);
    expect(wf.ping.name).toBe(PING_TASK);
    expect(wf.dbPing.name).toBe(DB_PING_TASK);
  });

  it("registers each task with its policy's timeout and retry", () => {
    const { register, calls } = recorder();
    registerWorkflowTasks({ resolveRuntime: () => runtimeWith({}), logger: silentLogger(), register });
    for (const name of TASK_NAMES) {
      const call = calls.find((c) => c.options.name === name);
      expect(call?.options.timeoutSeconds).toBe(TASK_POLICY[name].timeoutSeconds);
      expect(call?.options.retry).toEqual(TASK_POLICY[name].retry);
      expect(call?.options.plan).toBeUndefined(); // tasks default to `flex` (S3.3)
    }
  });

  it("task slugs are fs-tasks/<name>", () => {
    expect(WORKFLOW_SERVICE).toBe("fs-tasks");
    expect(taskSlug("judgeReset")).toBe("fs-tasks/judgeReset");
    expect(taskSlug("extract", "fs-tasks-x1y2")).toBe("fs-tasks-x1y2/extract");
  });

  it.each(TASK_NAMES)(
    "%s is a thin wrapper that passes ids and run metadata to its handler",
    async (name) => {
      const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
      const { register, calls } = recorder();
      registerWorkflowTasks({
        resolveRuntime: () => runtimeWith({ [name]: handler }),
        logger: silentLogger(),
        register,
      });
      const fn = calls.find((c) => c.options.name === name)?.func;
      const out = await fn?.(ctx("trn-42"), OUTBOX_ID);
      expect(out).toEqual({ status: "done" });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0]?.[0]).toMatchObject({
        name,
        ids: [OUTBOX_ID],
        executor: "workflow",
        taskRunId: "trn-42",
      });
    },
  );

  it("resolves the runtime lazily, once per process, and retries resolution after a failure", async () => {
    const { register, calls } = recorder();
    let attempts = 0;
    const resolveRuntime = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("db not ready");
      return runtimeWith({ judgeReset: async () => ({ status: "done" }) });
    });
    registerWorkflowTasks({ resolveRuntime, logger: silentLogger(), register });
    expect(resolveRuntime).not.toHaveBeenCalled();
    const fn = calls.find((c) => c.options.name === "judgeReset")?.func;
    await expect(fn?.(ctx(), OUTBOX_ID)).rejects.toThrow("db not ready");
    await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    expect(resolveRuntime).toHaveBeenCalledTimes(2);
  });

  it("returns a failed outcome for permanent errors and records it in the outbox; rethrows transient ones", async () => {
    const { register, calls } = recorder();
    const rt = runtimeWith({
      postPayoutBatch: async () => {
        throw new PermanentTaskError("DIGEST_MISMATCH", "approved digest differs from lines");
      },
      extract: async () => {
        throw new Error("529 overloaded");
      },
    });
    registerWorkflowTasks({ resolveRuntime: () => rt, logger: silentLogger(), register });
    const post = calls.find((c) => c.options.name === "postPayoutBatch")?.func;
    const extract = calls.find((c) => c.options.name === "extract")?.func;
    await expect(post?.(ctx(), OUTBOX_ID)).resolves.toEqual({
      status: "failed",
      code: "DIGEST_MISMATCH",
      detail: "approved digest differs from lines",
    });
    expect(rt.failed).toEqual([
      { id: OUTBOX_ID, code: "DIGEST_MISMATCH", detail: "approved digest differs from lines" },
    ]);
    await expect(extract?.(ctx(), OUTBOX_ID)).rejects.toThrow("529 overloaded");
    expect(rt.failed).toHaveLength(1); // a transient error leaves the row to the sweeper
  });

  it("unwired tasks fail permanently with NOT_WIRED", async () => {
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => loadRuntime(silentLogger()),
      logger: silentLogger(),
      register,
    });
    for (const name of TASK_NAMES) {
      const fn = calls.find((c) => c.options.name === name)?.func;
      await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toMatchObject({ status: "failed", code: "NOT_WIRED" });
    }
  });

  it("refuses payloads: arguments must be ids (Workflows caps input at 4 MB; S3.3)", async () => {
    const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => runtimeWith({ explain: handler }),
      logger: silentLogger(),
      register,
    });
    const fn = calls.find((c) => c.options.name === "explain")?.func;
    for (const bad of [[], [{ lineId: "x" }], ["has space"], ["x".repeat(MAX_ID_LENGTH + 1)], [42]]) {
      await expect(fn?.(ctx(), ...bad)).resolves.toMatchObject({ status: "failed", code: "INVALID_INPUT" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("logs task.run with name, executor, run id and duration but never the handler's secrets", async () => {
    const { logger, lines } = captureLogger();
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () =>
        runtimeWith({ reconcile: async () => ({ status: "skipped", detail: "claim lost" }) }),
      logger,
      register,
    });
    await calls.find((c) => c.options.name === "reconcile")?.func(ctx("trn-9"), OUTBOX_ID);
    const line = lines.find((l) => l.msg === "task.run");
    expect(line).toMatchObject({
      task: "reconcile",
      executor: "workflow",
      taskRunId: "trn-9",
      status: "skipped",
    });
    expect(typeof line?.ms).toBe("number");
  });

  it("opsPing answers without touching handlers", async () => {
    const resolveRuntime = vi.fn(() => runtimeWith({}));
    const { register, calls } = recorder();
    registerWorkflowTasks({ resolveRuntime, logger: silentLogger(), register });
    const ping = calls.find((c) => c.options.name === PING_TASK);
    expect(ping?.options.retry?.maxRetries).toBe(0);
    const out = (await ping?.func(ctx("trn-p"), "x".repeat(100))) as {
      pong: boolean;
      echo: string;
      taskRunId: string;
    };
    expect(out.pong).toBe(true);
    expect(out.echo).toHaveLength(64);
    expect(out.taskRunId).toBe("trn-p");
    expect(resolveRuntime).not.toHaveBeenCalled();
  });

  it("opsDbPing returns the injected probe's booleans and timings, without retries", async () => {
    const probe = { configured: true, reachable: true, canCreateRole: false, connectMs: 12, queryMs: 3 };
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => runtimeWith({}),
      logger: silentLogger(),
      register,
      probeDb: async () => probe,
    });
    const db = calls.find((c) => c.options.name === DB_PING_TASK);
    expect(db?.options.retry?.maxRetries).toBe(0);
    await expect(db?.func(ctx())).resolves.toEqual(probe);
  });
});

describe("validateIds", () => {
  it("accepts UUIDv7 and prefixed ids", () => {
    expect(validateIds([OUTBOX_ID, "wh_8PT597110X687430LKGECATA", "r37-M-014"])).toHaveLength(3);
  });
  it(`allows at most ${MAX_IDS} ids`, () => {
    expect(() => validateIds(Array.from({ length: MAX_IDS + 1 }, (_, i) => `id${i}`))).toThrow(/at most/);
  });
});

describe("handler helpers", () => {
  it("TaskNotWiredError is a PermanentTaskError naming the task", () => {
    const err = new TaskNotWiredError("warmCaches");
    expect(err).toBeInstanceOf(PermanentTaskError);
    expect(err.code).toBe("NOT_WIRED");
    expect(err.message).toContain("warmCaches");
  });
  it("withHandlers overlays without mutating the base", async () => {
    const base = unwiredHandlers(TASK_NAMES);
    const merged = withHandlers(base, { pushNotify: async () => ({ status: "done" }) });
    await expect(merged.pushNotify({ name: "pushNotify", ids: ["a"], executor: "inline" })).resolves.toEqual({
      status: "done",
    });
    await expect(
      base.pushNotify({ name: "pushNotify", ids: ["a"], executor: "inline" }),
    ).rejects.toBeInstanceOf(TaskNotWiredError);
    expect(Object.isFrozen(merged)).toBe(true);
  });
});
