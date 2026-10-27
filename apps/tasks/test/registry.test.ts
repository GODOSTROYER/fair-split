import { describe, expect, it, vi } from "vitest";
import { isTaskName, TASK_NAMES, type TaskName } from "../src/_shims/contracts.js";
import { appRoleGate } from "../src/app-role.js";
import type { DbProbeResult } from "../src/db-probe.js";
import { createInlineExecutor } from "../src/executor.js";
import {
  PermanentTaskError,
  type TaskHandler,
  TaskNotWiredError,
  unwiredHandlers,
  withHandlers,
} from "../src/handlers.js";
import { MAX_ID_LENGTH, MAX_IDS, validateIds } from "../src/invoke.js";
import { NO_FLAGS } from "../src/kill.js";
import { silentLogger } from "../src/log.js";
import { runsOnWorkflows, TASK_POLICY, WORKFLOW_TASK_NAMES } from "../src/policy.js";
import { loadRuntime } from "../src/wiring.js";
import {
  DB_PING_TASK,
  PING_TASK,
  registerWorkflowTasks,
  taskSlug,
  WORKFLOW_SERVICE,
} from "../src/workflow.js";
import { captureLogger, taskContext as ctx, OUTBOX_ID, recorder, testRuntime } from "./helpers.js";

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

/** Approved S3.3: "the three Workflow tasks". */
const S3_3_WORKFLOW_TASKS = ["extract", "readRateCard", "warmCaches"];

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

describe("registry wiring: every TaskName has exactly one executor path", () => {
  it("the Workflows lanes are exactly S3.3's three tasks; the other 13 run inline in fs-api", () => {
    expect([...WORKFLOW_TASK_NAMES]).toEqual(S3_3_WORKFLOW_TASKS);
    for (const name of TASK_NAMES) {
      expect(runsOnWorkflows(name), name).toBe(S3_3_WORKFLOW_TASKS.includes(name));
    }
  });

  it.each(TASK_NAMES)(
    "%s runs through the inline executor's wrapper with ids, executor and flags",
    async (name) => {
      const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
      const ex = createInlineExecutor({ runtime: runtimeWith({ [name]: handler }), logger: silentLogger() });
      await expect(ex.run(name, [OUTBOX_ID])).resolves.toEqual({
        executor: "inline",
        outcome: { status: "done" },
      });
      expect(handler.mock.calls[0]?.[0]).toMatchObject({ name, ids: [OUTBOX_ID], executor: "inline" });
      expect(handler.mock.calls[0]?.[0].flags).toBeInstanceOf(Set);
    },
  );
});

describe("registerWorkflowTasks (fs-tasks)", () => {
  it("registers the Workflows-lane tasks once, plus the opsPing and opsDbPing diagnostics, synchronously", () => {
    const { register, calls } = recorder();
    const wf = registerWorkflowTasks({
      resolveRuntime: () => runtimeWith({}),
      logger: silentLogger(),
      register,
    });
    expect(calls.map((c) => c.options.name)).toEqual([...S3_3_WORKFLOW_TASKS, PING_TASK, DB_PING_TASK]);
    expect(Object.keys(wf.tasks)).toEqual(S3_3_WORKFLOW_TASKS);
    expect(wf.ping.name).toBe(PING_TASK);
    expect(wf.dbPing.name).toBe(DB_PING_TASK);
  });

  it("never registers a money or webhook task: fs-tasks holds no PayPal credentials (S3.13)", () => {
    const { register, calls } = recorder();
    registerWorkflowTasks({ resolveRuntime: () => runtimeWith({}), logger: silentLogger(), register });
    const names = calls.map((c) => c.options.name);
    for (const money of [
      "ensureInvoice",
      "recordPayment",
      "processWebhook",
      "postPayoutBatch",
      "settleBatch",
    ])
      expect(names).not.toContain(money);
    for (const n of ["cancelUnclaimed", "reroute", "judgeReset", "reconcile"]) expect(names).not.toContain(n);
  });

  it("registers each task with its policy's timeout and retry, and no plan (tasks default to flex)", () => {
    const { register, calls } = recorder();
    registerWorkflowTasks({ resolveRuntime: () => runtimeWith({}), logger: silentLogger(), register });
    for (const name of WORKFLOW_TASK_NAMES) {
      const call = calls.find((c) => c.options.name === name);
      expect(call?.options.timeoutSeconds).toBe(TASK_POLICY[name].timeoutSeconds);
      expect(call?.options.retry).toEqual(TASK_POLICY[name].retry);
      expect(call?.options.plan).toBeUndefined();
    }
  });

  it("task slugs are fs-tasks/<name>", () => {
    expect(WORKFLOW_SERVICE).toBe("fs-tasks");
    expect(taskSlug("warmCaches")).toBe("fs-tasks/warmCaches");
    expect(taskSlug("extract", "fs-tasks-x1y2")).toBe("fs-tasks-x1y2/extract");
  });

  it.each(WORKFLOW_TASK_NAMES)(
    "%s is a thin wrapper that passes ids, run metadata and the fresh flags to its handler",
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
        flags: NO_FLAGS,
      });
    },
  );

  it("resolves the runtime lazily, once per process, and retries resolution after a failure", async () => {
    const { register, calls } = recorder();
    let attempts = 0;
    const resolveRuntime = vi.fn(async () => {
      attempts++;
      if (attempts === 1) throw new Error("db not ready");
      return runtimeWith({ warmCaches: async () => ({ status: "done" }) });
    });
    registerWorkflowTasks({ resolveRuntime, logger: silentLogger(), register });
    expect(resolveRuntime).not.toHaveBeenCalled();
    const fn = calls.find((c) => c.options.name === "warmCaches")?.func;
    await expect(fn?.(ctx(), OUTBOX_ID)).rejects.toThrow("db not ready");
    await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    expect(resolveRuntime).toHaveBeenCalledTimes(2);
  });

  it("returns a failed outcome for permanent errors and records it in the outbox; rethrows transient ones", async () => {
    const { register, calls } = recorder();
    const rt = runtimeWith({
      readRateCard: async () => {
        throw new PermanentTaskError("QUOTE_MISMATCH", "quote not found in the verified text layer");
      },
      extract: async () => {
        throw new Error("529 overloaded");
      },
    });
    registerWorkflowTasks({ resolveRuntime: () => rt, logger: silentLogger(), register });
    const read = calls.find((c) => c.options.name === "readRateCard")?.func;
    const extract = calls.find((c) => c.options.name === "extract")?.func;
    await expect(read?.(ctx(), OUTBOX_ID)).resolves.toEqual({
      status: "failed",
      code: "QUOTE_MISMATCH",
      detail: "quote not found in the verified text layer",
    });
    expect(rt.failed).toEqual([
      { id: OUTBOX_ID, code: "QUOTE_MISMATCH", detail: "quote not found in the verified text layer" },
    ]);
    // A transient error is rethrown so Render retries it; nothing is recorded against the row.
    await expect(extract?.(ctx(), OUTBOX_ID)).rejects.toThrow("529 overloaded");
    expect(rt.failed).toHaveLength(1);
  });

  it("S3.4: a role that can UPDATE ledger_entries refuses every task before its handler, recorded as BOOT_REFUSED", async () => {
    const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
    const probe = vi.fn(
      async (): Promise<DbProbeResult> => ({
        configured: true,
        reachable: true,
        canCreateRole: true,
        ledgerWritable: true,
      }),
    );
    const rt = runtimeWith({ extract: handler, readRateCard: handler, warmCaches: handler });
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => rt,
      logger: silentLogger(),
      register,
      preflight: appRoleGate(probe),
    });
    for (const name of WORKFLOW_TASK_NAMES) {
      const fn = calls.find((c) => c.options.name === name)?.func;
      // A permanent outcome, not a throw: Render spends no retries on a role it cannot fix.
      await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toMatchObject({ status: "failed", code: "BOOT_REFUSED" });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(rt.failed.map((f) => [f.id, f.code])).toEqual(
      WORKFLOW_TASK_NAMES.map(() => [OUTBOX_ID, "BOOT_REFUSED"]),
    );
    expect(probe).toHaveBeenCalledTimes(1);
    // The diagnostics never run the check: opsPing still answers, so S6 can see the service.
    await expect(
      Promise.resolve(calls.find((c) => c.options.name === PING_TASK)?.func(ctx())),
    ).resolves.toMatchObject({ pong: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("S3.4: a role check that cannot reach the database fails the attempt (Render retries it); fs_app then runs", async () => {
    const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
    let reachable = false;
    const probe = vi.fn(
      async (): Promise<DbProbeResult> =>
        reachable
          ? { configured: true, reachable: true, canCreateRole: false, ledgerWritable: false }
          : {
              configured: true,
              reachable: false,
              canCreateRole: null,
              ledgerWritable: null,
              errorCode: "ETIMEDOUT",
            },
    );
    const rt = runtimeWith({ extract: handler });
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => rt,
      logger: silentLogger(),
      register,
      preflight: appRoleGate(probe),
    });
    const extract = calls.find((c) => c.options.name === "extract")?.func;
    await expect(extract?.(ctx(), OUTBOX_ID)).rejects.toThrow("database role check failed (ETIMEDOUT)");
    expect(rt.failed).toEqual([]);
    reachable = true;
    await expect(extract?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    await expect(extract?.(ctx(), OUTBOX_ID)).resolves.toEqual({ status: "done" });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("unwired tasks fail permanently with NOT_WIRED", async () => {
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => loadRuntime(silentLogger()),
      logger: silentLogger(),
      register,
    });
    for (const name of WORKFLOW_TASK_NAMES) {
      const fn = calls.find((c) => c.options.name === name)?.func;
      await expect(fn?.(ctx(), OUTBOX_ID)).resolves.toMatchObject({ status: "failed", code: "NOT_WIRED" });
    }
  });

  it("refuses payloads: arguments must be ids (Workflows caps input at 4 MB; S3.3)", async () => {
    const handler = vi.fn<TaskHandler>(async () => ({ status: "done" as const }));
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () => runtimeWith({ extract: handler }),
      logger: silentLogger(),
      register,
    });
    const fn = calls.find((c) => c.options.name === "extract")?.func;
    for (const bad of [[], [{ slipId: "x" }], ["has space"], ["x".repeat(MAX_ID_LENGTH + 1)], [42]]) {
      await expect(fn?.(ctx(), ...bad)).resolves.toMatchObject({ status: "failed", code: "INVALID_INPUT" });
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("logs task.run with name, executor, run id and duration but never the handler's secrets", async () => {
    const { logger, lines } = captureLogger();
    const { register, calls } = recorder();
    registerWorkflowTasks({
      resolveRuntime: () =>
        runtimeWith({ warmCaches: async () => ({ status: "skipped", detail: "claim lost" }) }),
      logger,
      register,
    });
    await calls.find((c) => c.options.name === "warmCaches")?.func(ctx("trn-9"), OUTBOX_ID);
    const line = lines.find((l) => l.msg === "task.run");
    expect(line).toMatchObject({
      task: "warmCaches",
      executor: "workflow",
      taskRunId: "trn-9",
      status: "skipped",
    });
    expect(typeof line?.ms).toBe("number");
  });

  it("opsPing answers without touching handlers, and reports this service's FS_KILL flags", async () => {
    const resolveRuntime = vi.fn(() => runtimeWith({}));
    const { register, calls } = recorder();
    const env: NodeJS.ProcessEnv = { FS_KILL: "payouts, ai_live,bogus" };
    registerWorkflowTasks({ resolveRuntime, logger: silentLogger(), register, env });
    const ping = calls.find((c) => c.options.name === PING_TASK);
    if (!ping) throw new Error("opsPing was not registered");
    expect(ping.options.retry?.maxRetries).toBe(0);
    const out = (await ping.func(ctx("trn-p"), "x".repeat(100))) as {
      pong: boolean;
      echo: string;
      taskRunId: string;
      fsKill: string[];
    };
    expect(out.pong).toBe(true);
    expect(out.echo).toHaveLength(64);
    expect(out.taskRunId).toBe("trn-p");
    expect(out.fsKill).toEqual(["ai_live", "payouts"]);
    env.FS_KILL = "";
    expect(((await ping.func(ctx())) as { fsKill: string[] }).fsKill).toEqual([]);
    expect(resolveRuntime).not.toHaveBeenCalled();
  });

  it("opsDbPing returns the injected probe's booleans and timings, without retries", async () => {
    const probe = {
      configured: true,
      reachable: true,
      canCreateRole: false,
      ledgerWritable: false,
      connectMs: 12,
    };
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
    const invocation = { name: "pushNotify", ids: ["a"], executor: "inline", flags: NO_FLAGS } as const;
    await expect(merged.pushNotify(invocation)).resolves.toEqual({ status: "done" });
    await expect(base.pushNotify(invocation)).rejects.toBeInstanceOf(TaskNotWiredError);
    expect(Object.isFrozen(merged)).toBe(true);
  });
});
