import { describe, expect, it } from "vitest";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import { chooseExecutor, parseExecutorKind } from "../src/handoff/dispatcher.js";
import {
  NO_RENDER_RETRY,
  SWEEPER_MAX_ATTEMPTS,
  SWEEPER_STUCK_AFTER_MS,
  TASK_POLICY,
  tasksInLane,
} from "../src/policy.js";

describe("task policy", () => {
  it("covers every TaskName", () => {
    expect(Object.keys(TASK_POLICY).sort()).toEqual([...TASK_NAMES].sort());
  });

  it("puts tasks in the S3.3 executor lanes", () => {
    expect(tasksInLane("inline-api")).toEqual([
      "ensureInvoice",
      "recordPayment",
      "processWebhook",
      "postPayoutBatch",
      "settleBatch",
      "cancelUnclaimed",
      "reroute",
      "pushNotify",
    ]);
    expect(tasksInLane("workflow-live")).toEqual([
      "extract",
      "readRateCard",
      "computeRun",
      "explain",
      "agentTurn",
    ]);
    expect(tasksInLane("workflow-scheduled")).toEqual(["reconcile", "judgeReset", "warmCaches"]);
  });

  it.each(TASK_NAMES)("%s has a Render-legal timeout (30..86400 s)", (name) => {
    const p = TASK_POLICY[name];
    expect(p.timeoutSeconds).toBeGreaterThanOrEqual(30);
    expect(p.timeoutSeconds).toBeLessThanOrEqual(86_400);
  });

  // The claim moves the row to `running` before any I/O, so a Render retry of the same run would
  // only ever see `skipped`. One retry owner: the outbox sweeper (S3.3 step 4).
  it.each(TASK_NAMES)("inv.i7.single-retry-owner: %s registers with no Render retries", (name) => {
    expect(TASK_POLICY[name].retry).toEqual(NO_RENDER_RETRY);
    expect(TASK_POLICY[name].retry.maxRetries).toBe(0);
  });

  it("the sweeper bounds a stuck task to 8 attempts, 5 minutes apart (S3.3)", () => {
    expect(SWEEPER_STUCK_AFTER_MS).toBe(300_000);
    expect(SWEEPER_MAX_ATTEMPTS).toBe(8);
  });

  it("judgeReset fits well inside the hour between cron passes", () => {
    expect(TASK_POLICY.judgeReset.timeoutSeconds).toBeLessThan(3_600);
  });
});

describe("chooseExecutor (handoff to WS-DATA)", () => {
  it("inline and worker deployments run everything their way", () => {
    for (const name of TASK_NAMES) {
      expect(chooseExecutor(name, { configured: "inline", replay: false })).toBe("inline");
      expect(chooseExecutor(name, { configured: "worker", replay: true })).toBe("worker");
    }
  });
  it("a workflow deployment keeps money inline, AI on Workflows when live, and replays inline", () => {
    expect(chooseExecutor("postPayoutBatch", { configured: "workflow", replay: false })).toBe("inline");
    expect(chooseExecutor("extract", { configured: "workflow", replay: false })).toBe("workflow");
    expect(chooseExecutor("extract", { configured: "workflow", replay: true })).toBe("inline");
    expect(chooseExecutor("judgeReset", { configured: "workflow", replay: true })).toBe("workflow");
  });
  it("parses EXECUTOR strictly with an inline default", () => {
    expect(parseExecutorKind(undefined)).toBe("inline");
    expect(parseExecutorKind("")).toBe("inline");
    expect(parseExecutorKind("workflow")).toBe("workflow");
    expect(() => parseExecutorKind("Workflow")).toThrow();
  });
});
