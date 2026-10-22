import { describe, expect, it, vi } from "vitest";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import type { TaskHandler } from "../src/handlers.js";
import { invokeTask } from "../src/invoke.js";
import {
  anyFlag,
  assertSandbox,
  envFlagCheck,
  NotSandboxError,
  parseFsKill,
  TASKS_REFUSED_BY_FLAG,
} from "../src/kill.js";
import { silentLogger } from "../src/log.js";
import { OUTBOX_ID, testRuntime } from "./helpers.js";

const ctx = { executor: "workflow" as const, logger: silentLogger() };
const done: TaskHandler = async () => ({ status: "done" });

describe("invokeTask: permanent failures reach the outbox", () => {
  it("records NOT_WIRED for every id of the run, so the sweeper does not re-dispatch it", async () => {
    const rt = testRuntime();
    await expect(invokeTask(rt, "judgeReset", [OUTBOX_ID, "ob-2"], ctx)).resolves.toMatchObject({
      status: "failed",
      code: "NOT_WIRED",
    });
    expect(rt.failed.map((f) => [f.id, f.code])).toEqual([
      [OUTBOX_ID, "NOT_WIRED"],
      ["ob-2", "NOT_WIRED"],
    ]);
  });

  it("records INVALID_INPUT against the ids that are well-formed, never against payloads", async () => {
    const rt = testRuntime({ explain: done });
    await invokeTask(rt, "explain", [OUTBOX_ID, { lineId: "x" }, "has space"], ctx);
    expect(rt.failed).toEqual([{ id: OUTBOX_ID, code: "INVALID_INPUT", detail: "argument 1 is not an id" }]);
  });

  it("fails the run (rethrows) when the outbox write itself fails, instead of reporting success", async () => {
    const rt = testRuntime(
      {},
      {
        markFailed: async () => {
          throw new Error("connection reset");
        },
      },
    );
    await expect(invokeTask(rt, "reconcile", [OUTBOX_ID], ctx)).rejects.toThrow("connection reset");
  });

  it("leaves transient failures to the sweeper: nothing is recorded", async () => {
    const rt = testRuntime({
      extract: async () => {
        throw new Error("529");
      },
    });
    await expect(invokeTask(rt, "extract", [OUTBOX_ID], ctx)).rejects.toThrow("529");
    expect(rt.failed).toEqual([]);
  });
});

describe("invokeTask: kill switch at every task entry (architecture §11)", () => {
  it("inv.i8.kill-at-entry: FS_KILL=payouts refuses posting, cancel and re-route before the handler", async () => {
    const env: NodeJS.ProcessEnv = { FS_KILL: "payouts" };
    const handler = vi.fn(done);
    const rt = testRuntime(
      { postPayoutBatch: handler, cancelUnclaimed: handler, reroute: handler, settleBatch: handler },
      { checkFlags: envFlagCheck(env) },
    );
    for (const name of ["postPayoutBatch", "cancelUnclaimed", "reroute"] as const) {
      await expect(invokeTask(rt, name, [OUTBOX_ID], ctx)).resolves.toMatchObject({
        status: "failed",
        code: "KILL_SWITCH",
      });
    }
    expect(handler).not.toHaveBeenCalled();
    expect(rt.failed.map((f) => f.code)).toEqual(["KILL_SWITCH", "KILL_SWITCH", "KILL_SWITCH"]);
    // Posted batches keep settling (S3.11).
    await expect(invokeTask(rt, "settleBatch", [OUTBOX_ID], ctx)).resolves.toEqual({ status: "done" });
  });

  it("reads FS_KILL fresh on every entry, never cached", async () => {
    const env: NodeJS.ProcessEnv = {};
    const rt = testRuntime({ postPayoutBatch: done }, { checkFlags: envFlagCheck(env) });
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toEqual({ status: "done" });
    env.FS_KILL = "payouts";
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toMatchObject({
      code: "KILL_SWITCH",
      detail: "Task postPayoutBatch refused: kill switch FS_KILL:payouts is on",
    });
    env.FS_KILL = "";
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toEqual({ status: "done" });
  });

  it("paypal_live also refuses invoices; ai_live refuses nothing at entry (gateway replays)", () => {
    const check = envFlagCheck({ FS_KILL: "ai_live, paypal_live ,bogus" });
    const refused = TASK_NAMES.filter((n) => check(n));
    expect(refused).toEqual(["ensureInvoice", "postPayoutBatch", "cancelUnclaimed", "reroute"]);
    expect(TASKS_REFUSED_BY_FLAG.ai_live).toEqual([]);
    expect([...parseFsKill(" payouts,,nope,ai_live")]).toEqual(["payouts", "ai_live"]);
  });

  it("fails closed: a flag read that throws fails the run without calling the handler", async () => {
    const handler = vi.fn(done);
    const rt = testRuntime(
      { postPayoutBatch: handler },
      {
        checkFlags: anyFlag(envFlagCheck({}), async () => {
          throw new Error("system_flags unavailable");
        }),
      },
    );
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).rejects.toThrow("system_flags");
    expect(handler).not.toHaveBeenCalled();
  });

  it("anyFlag returns the first refusing flag", async () => {
    const check = anyFlag(
      () => undefined,
      () => "system_flags:kill_payouts",
      () => "later",
    );
    await expect(check("reroute")).resolves.toBe("system_flags:kill_payouts");
  });
});

describe("assertSandbox (S3.13 boot check)", () => {
  it("accepts only PP_ENV=sandbox", () => {
    expect(() => assertSandbox({ PP_ENV: "sandbox" })).not.toThrow();
    for (const env of [{}, { PP_ENV: "" }, { PP_ENV: "live" }, { PP_ENV: "Sandbox" }]) {
      expect(() => assertSandbox(env)).toThrow(NotSandboxError);
    }
  });
});
