import { describe, expect, it } from "vitest";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import { chooseExecutor, parseExecutorKind, TASK_POLICY, tasksInLane } from "../src/policy.js";

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

  it.each(TASK_NAMES)("%s has a Render-legal timeout (30..86400 s) and sane retries", (name) => {
    const p = TASK_POLICY[name];
    expect(p.timeoutSeconds).toBeGreaterThanOrEqual(30);
    expect(p.timeoutSeconds).toBeLessThanOrEqual(86_400);
    expect(Number.isInteger(p.retry.maxRetries)).toBe(true);
    expect(p.retry.maxRetries).toBeGreaterThanOrEqual(0);
    expect(p.retry.maxRetries).toBeLessThanOrEqual(3);
    expect(p.retry.waitDurationMs).toBeGreaterThanOrEqual(1_000);
  });

  it("money tasks retry slowly: at most 2 Render retries, at least 5 s apart", () => {
    for (const name of tasksInLane("inline-api")) {
      expect(TASK_POLICY[name].retry.maxRetries).toBeLessThanOrEqual(2);
      expect(TASK_POLICY[name].retry.waitDurationMs).toBeGreaterThanOrEqual(5_000);
    }
  });

  it("judgeReset fits well inside the hour between cron passes", () => {
    const p = TASK_POLICY.judgeReset;
    const worst = p.timeoutSeconds * (p.retry.maxRetries + 1) + p.retry.waitDurationMs / 1000;
    expect(worst).toBeLessThan(3_600);
  });
});

describe("chooseExecutor", () => {
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
