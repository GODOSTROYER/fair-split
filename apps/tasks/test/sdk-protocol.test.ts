// Runs the real fs-tasks entry (src/index.ts, through tsx) under a fake Render workflow host that
// speaks @renderinc/sdk 1.3.0's socket protocol: the same bytes Render exchanges with the process.
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";
import { runUnderFakeHost } from "../../../tools/lib/fake-workflow-host.js";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import { TASK_POLICY } from "../src/policy.js";
import { PING_TASK } from "../src/workflow.js";
import { OUTBOX_ID } from "./helpers.js";

const entry = "apps/tasks/src/index.ts";
const base = { entry, cwd: REPO_ROOT, nodeArgs: ["--import", "tsx"] } as const;

describe("fs-tasks entry under the Workflows socket protocol", () => {
  it("register mode: announces every TaskName plus opsPing with Render's option names", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "register" });
    expect(r.exitCode).toBe(0);
    expect(r.registered?.map((t) => t.name)).toEqual([...TASK_NAMES, PING_TASK]);
    const extract = r.registered?.find((t) => t.name === "extract");
    expect(extract?.options).toEqual({
      retry: {
        max_retries: TASK_POLICY.extract.retry.maxRetries,
        wait_duration_ms: TASK_POLICY.extract.retry.waitDurationMs,
        factor: TASK_POLICY.extract.retry.backoffScaling,
      },
      timeout_seconds: TASK_POLICY.extract.timeoutSeconds,
    });
  });

  it("run mode: opsPing completes with the run id Render supplied", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: PING_TASK, input: ["s6"] });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({ pong: true, echo: "s6", taskRunId: "trn-fake-0001" });
  });

  it("run mode: an unwired TaskName completes with a NOT_WIRED outcome instead of burning retries", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: "judgeReset", input: [OUTBOX_ID] });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({ status: "failed", code: "NOT_WIRED" });
  });

  it("run mode: an unknown task is reported to Render as an error", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: "transferFunds", input: [OUTBOX_ID] });
    expect(r.callback).toEqual({ error: { details: "Task 'transferFunds' not found in registry" } });
    expect(r.exitCode).not.toBe(0);
  });
});
