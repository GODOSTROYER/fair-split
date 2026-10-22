// Runs the real fs-tasks entry (src/index.ts, through tsx) under a fake Render workflow host that
// speaks @renderinc/sdk 1.3.0's socket protocol: the same bytes Render exchanges with the process.
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";
import { runUnderFakeHost } from "../../../tools/lib/fake-workflow-host.js";
import { TASK_NAMES } from "../src/_shims/contracts.js";
import { DB_PING_TASK, PING_TASK } from "../src/workflow.js";
import { OUTBOX_ID } from "./helpers.js";

const entry = "apps/tasks/src/index.ts";
const base = { entry, cwd: REPO_ROOT, nodeArgs: ["--import", "tsx"], env: { PP_ENV: "sandbox" } } as const;

describe("fs-tasks entry under the Workflows socket protocol", () => {
  it("register mode: announces every TaskName plus the diagnostics, all without Render retries", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "register" });
    expect(r.exitCode).toBe(0);
    expect(r.registered?.map((t) => t.name)).toEqual([...TASK_NAMES, PING_TASK, DB_PING_TASK]);
    const extract = r.registered?.find((t) => t.name === "extract");
    expect(extract?.options).toMatchObject({
      retry: { max_retries: 0, wait_duration_ms: 1_000 },
      timeout_seconds: 900,
    });
    for (const t of r.registered ?? []) expect(t.options?.retry?.max_retries, t.name).toBe(0);
  });

  it("run mode: opsPing completes with the run id Render supplied", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: PING_TASK, input: ["s6"] });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({ pong: true, echo: "s6", taskRunId: "trn-fake-0001" });
  });

  it("run mode: opsDbPing reports booleans only, and skips without DATABASE_URL", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { ...base.env, DATABASE_URL: "" },
      mode: "run",
      taskName: DB_PING_TASK,
      input: [],
    });
    expect(r.exitCode).toBe(0);
    expect(r.result).toEqual({ configured: false, reachable: false, canCreateRole: null });
  });

  it("run mode: an unwired TaskName completes with a NOT_WIRED outcome", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: "judgeReset", input: [OUTBOX_ID] });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({ status: "failed", code: "NOT_WIRED" });
  });

  it("run mode: FS_KILL=payouts refuses postPayoutBatch at task entry", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { ...base.env, FS_KILL: "payouts" },
      mode: "run",
      taskName: "postPayoutBatch",
      input: [OUTBOX_ID],
    });
    expect(r.result).toMatchObject({ status: "failed", code: "KILL_SWITCH" });
  });

  it("run mode: an unknown task is reported to Render as an error", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: "transferFunds", input: [OUTBOX_ID] });
    expect(r.callback).toEqual({ error: { details: "Task 'transferFunds' not found in registry" } });
    expect(r.exitCode).not.toBe(0);
  });

  it("boot refuses anything but PP_ENV=sandbox (S3.13): nothing is registered", async () => {
    const r = await runUnderFakeHost({ ...base, env: { PP_ENV: "live" }, mode: "register" });
    expect(r.exitCode).not.toBe(0);
    expect(r.registered).toBeUndefined();
    expect(r.stderr).toMatch(/PP_ENV must be "sandbox"/);
  });
});
