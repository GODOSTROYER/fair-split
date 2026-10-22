import { describe, expect, it } from "vitest";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import { chooseExecutor, parseExecutorKind } from "../src/handoff/dispatcher.js";
import { renderIdempotencyKey } from "../src/handoff/idempotency.js";
import type { KillFlag } from "../src/kill.js";
import {
  NO_RENDER_RETRY,
  RENDER_RETRY,
  runsOnWorkflows,
  SWEEPER_MAX_ATTEMPTS,
  SWEEPER_STUCK_AFTER_MS,
  sweeperStuckAfterMs,
  TASK_POLICY,
  tasksInLane,
} from "../src/policy.js";
import { OUTBOX_ID } from "./helpers.js";

describe("task policy", () => {
  it("covers every TaskName", () => {
    expect(Object.keys(TASK_POLICY).sort()).toEqual([...TASK_NAMES].sort());
  });

  it("puts tasks in the approved S3.3 lanes: everything inline except three AI tasks on Workflows", () => {
    expect(tasksInLane("inline-api")).toEqual([
      "ensureInvoice",
      "recordPayment",
      "processWebhook",
      "postPayoutBatch",
      "settleBatch",
      "cancelUnclaimed",
      "reroute",
      "computeRun",
      "explain",
      "agentTurn",
      "pushNotify",
      "reconcile",
      "judgeReset",
    ]);
    expect(tasksInLane("workflow-live")).toEqual(["extract", "readRateCard"]);
    expect(tasksInLane("workflow-scheduled")).toEqual(["warmCaches"]);
  });

  it.each(TASK_NAMES)("%s has a Render-legal timeout (30..86400 s)", (name) => {
    const p = TASK_POLICY[name];
    expect(p.timeoutSeconds).toBeGreaterThanOrEqual(30);
    expect(p.timeoutSeconds).toBeLessThanOrEqual(86_400);
  });

  // Render retries are attempts of the same taskRunId; they only exist for what fs-tasks registers.
  it.each(TASK_NAMES)("inv.i7.retry-model: %s retries on Render only on a Workflows lane", (name) => {
    expect(TASK_POLICY[name].retry).toEqual(runsOnWorkflows(name) ? RENDER_RETRY : NO_RENDER_RETRY);
  });

  it("Render retries are few and finish well inside one sweeper window", () => {
    expect(RENDER_RETRY.maxRetries).toBe(2);
    expect(RENDER_RETRY.waitDurationMs * (1 + (RENDER_RETRY.backoffScaling ?? 1))).toBeLessThan(60_000);
  });

  it("the sweeper never re-queues a healthy attempt: stuck-after covers each task's timeout", () => {
    for (const name of TASK_NAMES) {
      const stuck = sweeperStuckAfterMs(name);
      expect(stuck, name).toBeGreaterThanOrEqual(SWEEPER_STUCK_AFTER_MS);
      expect(stuck, name).toBeGreaterThan(TASK_POLICY[name].timeoutSeconds * 1_000);
    }
    expect(sweeperStuckAfterMs("processWebhook")).toBe(SWEEPER_STUCK_AFTER_MS);
    expect(sweeperStuckAfterMs("extract")).toBe(900_000 + 10_000 + 60_000);
  });

  it("the sweeper bounds a stuck task to 8 attempts, 5 minutes apart (S3.3)", () => {
    expect(SWEEPER_STUCK_AFTER_MS).toBe(300_000);
    expect(SWEEPER_MAX_ATTEMPTS).toBe(8);
  });

  it("judgeReset fits well inside the hour between ticks", () => {
    expect(TASK_POLICY.judgeReset.timeoutSeconds).toBeLessThan(3_600);
  });
});

describe("renderIdempotencyKey (handoff to WS-DATA)", () => {
  it("is scoped to the dispatch attempt: same attempt, same key; next attempt, new key", () => {
    expect(renderIdempotencyKey([OUTBOX_ID], 1)).toBe(`${OUTBOX_ID}:a1`);
    expect(renderIdempotencyKey([OUTBOX_ID], 1)).toBe(renderIdempotencyKey([OUTBOX_ID], 1));
    expect(renderIdempotencyKey([OUTBOX_ID], 2)).not.toBe(renderIdempotencyKey([OUTBOX_ID], 1));
    expect(renderIdempotencyKey(["a", "b"], 0)).toBe("a+b:a0");
  });

  it("hashes long id lists, and refuses no ids or a bad attempt", () => {
    const ids = Array.from({ length: 64 }, (_, i) => `${OUTBOX_ID}-${i}`);
    const key = renderIdempotencyKey(ids, 3);
    expect(key).toMatch(/^h[0-9a-f]{64}:a3$/);
    expect(renderIdempotencyKey(ids, 3)).toBe(key);
    expect(() => renderIdempotencyKey([], 1)).toThrow();
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => renderIdempotencyKey([OUTBOX_ID], bad)).toThrow();
  });
});

describe("chooseExecutor (handoff to WS-DATA)", () => {
  it("inline and worker deployments run everything their way", () => {
    for (const name of TASK_NAMES) {
      expect(chooseExecutor(name, { configured: "inline", replay: false })).toBe("inline");
      expect(chooseExecutor(name, { configured: "worker", replay: true })).toBe("worker");
    }
  });

  it("a workflow deployment sends only the three Workflows tasks to fs-tasks, and replays inline", () => {
    const onWorkflows = TASK_NAMES.filter(
      (name) => chooseExecutor(name, { configured: "workflow", replay: false }) === "workflow",
    );
    expect(onWorkflows).toEqual(["extract", "readRateCard", "warmCaches"]);
    expect(chooseExecutor("postPayoutBatch", { configured: "workflow", replay: false })).toBe("inline");
    expect(chooseExecutor("judgeReset", { configured: "workflow", replay: false })).toBe("inline");
    expect(chooseExecutor("extract", { configured: "workflow", replay: true })).toBe("inline");
    expect(chooseExecutor("warmCaches", { configured: "workflow", replay: true })).toBe("workflow");
  });

  it("under kill_ai_live every AI lane stays in fs-api, whose flags were read fresh; other flags change nothing", () => {
    const ai = new Set<KillFlag>(["ai_live"]);
    for (const name of TASK_NAMES)
      expect(chooseExecutor(name, { configured: "workflow", replay: false, flags: ai }), name).toBe("inline");
    const others = new Set<KillFlag>(["payouts", "paypal_live"]);
    const onWorkflows = TASK_NAMES.filter(
      (name) => chooseExecutor(name, { configured: "workflow", replay: false, flags: others }) === "workflow",
    );
    expect(onWorkflows).toEqual(["extract", "readRateCard", "warmCaches"]);
    expect(chooseExecutor("extract", { configured: "worker", replay: false, flags: ai })).toBe("worker");
  });

  it("parses EXECUTOR strictly with an inline default", () => {
    expect(parseExecutorKind(undefined)).toBe("inline");
    expect(parseExecutorKind("")).toBe("inline");
    expect(parseExecutorKind("workflow")).toBe("workflow");
    expect(() => parseExecutorKind("Workflow")).toThrow();
  });
});
