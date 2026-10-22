import { describe, expect, it, vi } from "vitest";
import { TASK_NAMES, type WorkspaceKind } from "../src/_shims/contracts.js";
import { KillSwitchError, type TaskHandler } from "../src/handlers.js";
import { invokeTask } from "../src/invoke.js";
import {
  aiLane,
  assertBootEnv,
  assertSandbox,
  BootRefusedError,
  envFlags,
  isSandbox,
  type KillFlag,
  NotSandboxError,
  parseFsKill,
  paypalLane,
  refusingFlag,
  TASKS_REFUSED_AT_ENTRY,
  unionFlags,
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
      { readFlags: envFlags(env) },
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
    const rt = testRuntime({ postPayoutBatch: done }, { readFlags: envFlags(env) });
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toEqual({ status: "done" });
    env.FS_KILL = "payouts";
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toMatchObject({
      code: "KILL_SWITCH",
      detail: "Task postPayoutBatch refused: kill switch kill_payouts is on",
    });
    env.FS_KILL = "";
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).resolves.toEqual({ status: "done" });
  });

  it("only kill_payouts refuses at entry; paypal_live and ai_live are left to the handler", () => {
    const flags = parseFsKill("ai_live, paypal_live ,bogus");
    expect(TASK_NAMES.filter((n) => refusingFlag(n, flags))).toEqual([]);
    expect(TASKS_REFUSED_AT_ENTRY).toEqual({
      payouts: ["postPayoutBatch", "cancelUnclaimed", "reroute"],
      paypal_live: [],
      ai_live: [],
    });
    expect([...parseFsKill(" payouts,,nope,ai_live")]).toEqual(["payouts", "ai_live"]);
  });

  it("passes the fresh flag set to every handler", async () => {
    const handler = vi.fn(done);
    const rt = testRuntime({ ensureInvoice: handler }, { readFlags: envFlags({ FS_KILL: "paypal_live" }) });
    await invokeTask(rt, "ensureInvoice", [OUTBOX_ID], ctx);
    expect([...(handler.mock.calls[0]?.[0].flags ?? [])]).toEqual(["paypal_live"]);
  });

  // A PayPal-lane handler as WS-PPMONEY will write it: load the row's workspace, ask paypalLane.
  const ppHandler =
    (kind: WorkspaceKind): TaskHandler =>
    async (inv) => {
      const lane = paypalLane(inv.flags, kind);
      if (lane === "refuse") throw new KillSwitchError(inv.name, "kill_paypal_live");
      return { status: "done", mode: lane === "replay" ? "replay" : "live" };
    };

  it("inv.i8.kill-paypal-live-judge-replays: kill_paypal_live in a judge workspace plays the labelled replay, not a dead row", async () => {
    const readFlags = envFlags({ FS_KILL: "paypal_live" });
    for (const kind of ["judge", "showcase"] as const) {
      const rt = testRuntime(
        { ensureInvoice: ppHandler(kind), recordPayment: ppHandler(kind), postPayoutBatch: ppHandler(kind) },
        { readFlags },
      );
      for (const name of ["ensureInvoice", "recordPayment", "postPayoutBatch"] as const) {
        await expect(invokeTask(rt, name, [OUTBOX_ID], ctx)).resolves.toEqual({
          status: "done",
          mode: "replay",
        });
      }
      expect(rt.failed).toEqual([]);
    }
  });

  it("inv.i8.kill-paypal-live-real-refuses: kill_paypal_live in a real workspace refuses PayPal tasks", async () => {
    const rt = testRuntime(
      { ensureInvoice: ppHandler("real"), recordPayment: ppHandler("real"), settleBatch: ppHandler("real") },
      { readFlags: envFlags({ FS_KILL: "paypal_live" }) },
    );
    for (const name of ["ensureInvoice", "recordPayment", "settleBatch"] as const) {
      await expect(invokeTask(rt, name, [OUTBOX_ID], ctx)).resolves.toMatchObject({ code: "KILL_SWITCH" });
    }
    expect(rt.failed).toHaveLength(3);
  });

  it("paypalLane and aiLane follow S3.11", () => {
    const none = new Set<KillFlag>();
    const pp = new Set<KillFlag>(["paypal_live"]);
    expect(paypalLane(none, "real")).toBe("live");
    expect(paypalLane(pp, "judge")).toBe("replay");
    expect(paypalLane(pp, "showcase")).toBe("replay");
    expect(paypalLane(pp, "real")).toBe("refuse");
    expect(aiLane(none)).toBe("live");
    expect(aiLane(new Set<KillFlag>(["ai_live"]))).toBe("replay");
  });

  it("fails closed: a flag read that throws fails the run without calling the handler", async () => {
    const handler = vi.fn(done);
    const rt = testRuntime(
      { postPayoutBatch: handler },
      {
        readFlags: unionFlags(envFlags({}), async () => {
          throw new Error("system_flags unavailable");
        }),
      },
    );
    await expect(invokeTask(rt, "postPayoutBatch", [OUTBOX_ID], ctx)).rejects.toThrow("system_flags");
    expect(handler).not.toHaveBeenCalled();
  });

  it("unionFlags unites FS_KILL with the workspace's system_flags", async () => {
    const source = unionFlags(envFlags({ FS_KILL: "ai_live" }), (_name, ids) =>
      ids.includes("ws-killed") ? new Set<KillFlag>(["payouts"]) : new Set<KillFlag>(),
    );
    expect([...(await source("reroute", ["ws-killed"]))].sort()).toEqual(["ai_live", "payouts"]);
    expect([...(await source("reroute", ["other"]))]).toEqual(["ai_live"]);
  });
});

describe("boot checks (S3.13)", () => {
  it("accepts only PP_ENV=sandbox; unset is not sandbox", () => {
    expect(() => assertSandbox({ PP_ENV: "sandbox" })).not.toThrow();
    expect(isSandbox({ PP_ENV: "sandbox" })).toBe(true);
    expect(isSandbox({})).toBe(false);
    for (const env of [{}, { PP_ENV: "" }, { PP_ENV: "live" }, { PP_ENV: "Sandbox" }]) {
      expect(() => assertSandbox(env)).toThrow(NotSandboxError);
      expect(() => assertBootEnv(env)).toThrow(BootRefusedError);
    }
  });

  it("refuses PayPal dev mocks on Render, allows them locally", () => {
    expect(() => assertBootEnv({ PP_ENV: "sandbox", PP_DEV_MOCKS: "1" })).not.toThrow();
    expect(() => assertBootEnv({ PP_ENV: "sandbox", RENDER: "true" })).not.toThrow();
    expect(() => assertBootEnv({ PP_ENV: "sandbox", PP_DEV_MOCKS: "1", RENDER: "true" })).toThrow(
      /PP_DEV_MOCKS=1 is not allowed on Render/,
    );
  });
});
