// Runs the real fs-tasks entry (src/index.ts, through tsx) under a fake Render workflow host that
// speaks @renderinc/sdk 1.3.0's socket protocol: the same bytes Render exchanges with the process.
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../tools/lib/blueprint.js";
import { runUnderFakeHost } from "../../../tools/lib/fake-workflow-host.js";
import { TASK_POLICY, WORKFLOW_TASK_NAMES } from "../src/policy.js";
import { DB_PING_TASK, PING_TASK } from "../src/workflow.js";
import { OUTBOX_ID } from "./helpers.js";

const entry = "apps/tasks/src/index.ts";
// DATABASE_URL is set (empty: no database) so a developer's own value never reaches the entry.
const base = {
  entry,
  cwd: REPO_ROOT,
  nodeArgs: ["--import", "tsx"],
  env: { PP_ENV: "sandbox", DATABASE_URL: "" },
} as const;

describe("fs-tasks entry under the Workflows socket protocol", () => {
  it("register mode: announces the three Workflows tasks with Render retries, plus the diagnostics without", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "register" });
    expect(r.exitCode).toBe(0);
    expect(r.registered?.map((t) => t.name)).toEqual([...WORKFLOW_TASK_NAMES, PING_TASK, DB_PING_TASK]);
    expect(r.registered?.find((t) => t.name === "extract")?.options).toMatchObject({
      retry: { max_retries: 2, wait_duration_ms: 5_000, factor: 2 },
      timeout_seconds: TASK_POLICY.extract.timeoutSeconds,
    });
    for (const t of r.registered ?? []) {
      const expected = (WORKFLOW_TASK_NAMES as readonly string[]).includes(t.name) ? 2 : 0;
      expect(t.options?.retry?.max_retries, t.name).toBe(expected);
    }
  });

  it("run mode: opsPing completes with the run id Render supplied and this service's FS_KILL", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { ...base.env, FS_KILL: "ai_live" },
      mode: "run",
      taskName: PING_TASK,
      input: ["s6"],
    });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({
      pong: true,
      echo: "s6",
      taskRunId: "trn-fake-0001",
      fsKill: ["ai_live"],
    });
  });

  it("run mode: opsDbPing reports booleans only, and skips without a database", async () => {
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

  it("run mode: an unwired Workflows task completes with a NOT_WIRED outcome", async () => {
    const r = await runUnderFakeHost({ ...base, mode: "run", taskName: "warmCaches", input: [OUTBOX_ID] });
    expect(r.exitCode).toBe(0);
    expect(r.result).toMatchObject({ status: "failed", code: "NOT_WIRED" });
  });

  it("run mode: the S3.4 role check runs before the handler; a database it cannot reach fails the attempt so Render retries it", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { ...base.env, DATABASE_URL: "postgres://probe@127.0.0.1:1/x" },
      mode: "run",
      taskName: "warmCaches",
      input: [OUTBOX_ID],
    });
    expect(r.callback).toEqual({
      error: { details: expect.stringMatching(/database role check failed \(ECONNREFUSED\)/) },
    });
    expect(r.exitCode).not.toBe(0);
  });

  it.each(["postPayoutBatch", "judgeReset", "transferFunds"])(
    "run mode: %s is not registered on fs-tasks, so Render reports an error (the dispatcher then runs inline)",
    async (taskName) => {
      const r = await runUnderFakeHost({ ...base, mode: "run", taskName, input: [OUTBOX_ID] });
      expect(r.callback).toEqual({ error: { details: `Task '${taskName}' not found in registry` } });
      expect(r.exitCode).not.toBe(0);
    },
  );

  it("boot refuses anything but PP_ENV=sandbox (S3.13): nothing is registered", async () => {
    const r = await runUnderFakeHost({ ...base, env: { PP_ENV: "live" }, mode: "register" });
    expect(r.exitCode).not.toBe(0);
    expect(r.registered).toBeUndefined();
    expect(r.stderr).toMatch(/PP_ENV must be "sandbox"/);
  });

  it("boot refuses PayPal dev mocks on Render (S3.13)", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { PP_ENV: "sandbox", PP_DEV_MOCKS: "1", RENDER: "true" },
      mode: "register",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.registered).toBeUndefined();
    expect(r.stderr).toMatch(/PP_DEV_MOCKS=1 is not allowed on Render/);
  });

  it("boot refuses a database host without fs_app's password: it never falls back to another role (S3.4)", async () => {
    const r = await runUnderFakeHost({
      ...base,
      env: { PP_ENV: "sandbox", FS_DB_HOST: "dpg-test-a", FS_DB_NAME: "fairsplit", FS_APP_DB_PASSWORD: "" },
      mode: "register",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.registered).toBeUndefined();
    expect(r.stderr).toMatch(/FS_APP_DB_PASSWORD is not/);
  });
});
