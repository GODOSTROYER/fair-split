// Spike S6 (register §12): "Blueprint deploys; startTask p50 is 10 s or less. If it fails: executor=worker."
// S3.14 also hands it two database questions: can a workflow reach fs-db over the private network,
// and can Render's database user CREATE ROLE (the owner/fs_app split, S3.4)? The live run answers
// both through the `opsDbPing` task. fs-tasks connects only as fs_app, which exists with LOGIN only if
// fs-api's migrate could create it, so a successful connection answers the second question too; the
// probe then checks that fs_app can neither create roles nor UPDATE ledger_entries (register §7).
//
//   corepack pnpm exec tsx tools/spike-s6.ts                 offline: Blueprint schema + policy, and the
//                                                            fs-tasks entry's cold start under a fake host
//   corepack pnpm exec tsx tools/spike-s6.ts --live [--n=5]  live: startTask fs-tasks/opsPing n times,
//                                                            then fs-tasks/opsDbPing once
//                                                            (needs RENDER_API_KEY and FS_TASKS_SLUG)
//   corepack pnpm exec tsx tools/spike-s6.ts --refresh-schema  re-download Render's Blueprint schema
//
// Prints only timings, counts and pass/fail. Never prints the API key.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Render } from "@renderinc/sdk";
import type { DbProbeResult } from "../apps/tasks/src/db-probe.js";
import { loadDotEnv } from "../apps/tasks/src/env.js";
import { isMain } from "../apps/tasks/src/main.js";
import { DB_PING_TASK, PING_TASK, taskSlug } from "../apps/tasks/src/workflow.js";
import {
  checkPolicy,
  REPO_ROOT,
  readBlueprint,
  SCHEMA_PATH,
  SCHEMA_URL,
  validateAgainstSchema,
} from "./lib/blueprint.js";
import { runUnderFakeHost } from "./lib/fake-workflow-host.js";

export const STARTTASK_P50_BUDGET_MS = 10_000;

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] as number;
}

const fmt = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

export interface DeployReadiness {
  /** Whole Blueprint can deploy: fs-api builds and its preDeployCommand has a script to run. */
  readonly full: boolean;
  readonly missing: string[];
}

/**
 * Whether "Blueprint deploys" can be tested in full yet. fs-api's build needs `@fairsplit/api` with
 * a build script, and its preDeployCommand needs `@fairsplit/db` with a `migrate` script. Until
 * WS-API and WS-DATA land those, the S6 verdict covers fs-tasks (and fs-cron, fs-db) only.
 */
export function deployReadiness(root: string = REPO_ROOT): DeployReadiness {
  const scriptOf = (dir: string, script: string): boolean => {
    const file = join(root, dir, "package.json");
    if (!existsSync(file)) return false;
    const json = JSON.parse(readFileSync(file, "utf8")) as { scripts?: Record<string, string> };
    return typeof json.scripts?.[script] === "string";
  };
  const missing = [
    ...(scriptOf("apps/api", "build") ? [] : ["@fairsplit/api build script (WS-API)"]),
    ...(scriptOf("packages/db", "migrate") ? [] : ["@fairsplit/db migrate script (WS-DATA)"]),
  ];
  return { full: missing.length === 0, missing };
}

/** What a failed connection as fs_app most likely means, by driver or SQLSTATE code. */
export function reachHint(code: string | undefined): string {
  switch (code) {
    case "28P01":
      return "fs_app's password differs from fs-api's FS_APP_DB_PASSWORD: copy it to fs-tasks, then redeploy fs-api";
    case "28000":
      return "fs_app cannot log in: migrate ran without FS_APP_DB_PASSWORD, or the owner cannot CREATE ROLE (S3.4 fallback)";
    case "3D000":
      return "FS_DB_NAME names no database";
    case "ENOTFOUND":
    case "ECONNREFUSED":
    case "ETIMEDOUT":
    case "CONNECT_TIMEOUT":
      return "no private-network route: use fs-db's external host with FS_DB_SSLMODE=require";
    default:
      return "see the fs-tasks run log";
  }
}

/** One-line verdicts for the S3.14 database questions, from inside the workflow (as fs_app). */
export function dbVerdicts(r: DbProbeResult): string[] {
  if (!r.configured)
    return [
      "fs-db reach: SKIP (fs-tasks has no FS_DB_HOST, FS_DB_NAME and FS_APP_DB_PASSWORD)",
      "CREATE ROLE: SKIP",
    ];
  if (!r.reachable)
    return [
      `fs-db reach from workflow as fs_app: FAIL (${r.errorCode ?? "error"}) → ${reachHint(r.errorCode)}`,
      "CREATE ROLE: UNKNOWN (not connected)",
    ];
  const timing = `connect ${r.connectMs ?? "?"} ms, query ${r.queryMs ?? "?"} ms`;
  const createRole =
    r.canCreateRole === false
      ? "PASS (fs_app cannot create roles)"
      : r.canCreateRole === true
        ? "FAIL (fs-tasks runs as a role that can create roles: is it the owner?)"
        : "UNKNOWN (role query failed)";
  const ledger =
    r.ledgerWritable === false
      ? "PASS (fs_app cannot UPDATE ledger_entries)"
      : r.ledgerWritable === true
        ? "FAIL (fs-tasks' role can UPDATE ledger_entries; register §7)"
        : "UNKNOWN (no ledger_entries yet: have the migrations run?)";
  return [
    `fs-db reach from workflow as fs_app: PASS (${timing})`,
    "CREATE ROLE for the owner: YES (migrate created fs_app with LOGIN, S3.4)",
    `fs_app privileges: ${createRole}`,
    `append-only for the app role: ${ledger}`,
  ];
}

/** The S6 database verdict: reachable as a role that can neither create roles nor rewrite the ledger. */
export function dbOk(r: DbProbeResult | undefined): boolean {
  return r?.reachable === true && r.canCreateRole === false && r.ledgerWritable === false;
}

async function offline(n: number): Promise<boolean> {
  const bp = readBlueprint();
  const schemaErrors = validateAgainstSchema(bp);
  const policy = checkPolicy(bp);
  console.log(`blueprint schema   ${schemaErrors.length === 0 ? "PASS" : `FAIL ${schemaErrors.join("; ")}`}`);
  console.log(`blueprint policy   ${policy.length === 0 ? "PASS" : `FAIL ${policy.join("; ")}`}`);
  const ready = deployReadiness();
  console.log(
    `blueprint deploy   ${ready.full ? "full Blueprint deployable" : `fs-tasks only: missing ${ready.missing.join(", ")}`}`,
  );

  // Prefer the compiled entry Render runs (build first: corepack pnpm --filter @fairsplit/tasks build).
  const dist = existsSync(join(REPO_ROOT, "apps/tasks/dist/index.js"));
  const base = dist
    ? { entry: "apps/tasks/dist/index.js", cwd: REPO_ROOT }
    : { entry: "apps/tasks/src/index.ts", cwd: REPO_ROOT, nodeArgs: ["--import", "tsx"] };
  const how = dist ? "dist" : "tsx";
  const register: number[] = [];
  const ping: number[] = [];
  let registered = 0;
  for (let i = 0; i < n; i++) {
    const r = await runUnderFakeHost({ ...base, env: { PP_ENV: "sandbox" }, mode: "register" });
    if (r.doneMs !== undefined) register.push(r.doneMs);
    registered = r.registered?.length ?? 0;
    const p = await runUnderFakeHost({
      ...base,
      env: { PP_ENV: "sandbox" },
      mode: "run",
      taskName: PING_TASK,
      input: ["s6"],
    });
    if (p.doneMs !== undefined && (p.result as { pong?: boolean } | undefined)?.pong) ping.push(p.doneMs);
  }
  console.log(`entry registers    ${registered} tasks`);
  console.log(
    `cold start → register   p50 ${fmt(percentile(register, 50))}  max ${fmt(Math.max(...register))}  (n=${register.length}, ${how})`,
  );
  console.log(
    `cold start → opsPing    p50 ${fmt(percentile(ping, 50))}  max ${fmt(Math.max(...ping))}  (n=${ping.length}, ${how})`,
  );
  return schemaErrors.length === 0 && policy.length === 0 && ping.length === n;
}

async function live(n: number): Promise<boolean> {
  const slug = process.env.FS_TASKS_SLUG;
  if (!process.env.RENDER_API_KEY || !slug) {
    console.log("live: SKIP (RENDER_API_KEY and FS_TASKS_SLUG are needed; run after the Blueprint deploys)");
    return true;
  }
  const workflows = new Render().workflows;
  const pickup: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const run = await workflows.startTask(taskSlug(PING_TASK, slug), [`s6-${i}`]);
    let picked: number | undefined;
    for (;;) {
      const details = await workflows.getTaskRun(run.taskRunId);
      const status = String(details.status);
      if (picked === undefined && status !== "pending") picked = performance.now() - t0;
      if (["succeeded", "completed", "failed", "canceled"].includes(status)) {
        total.push(performance.now() - t0);
        break;
      }
      if (performance.now() - t0 > 120_000) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    if (picked !== undefined) pickup.push(picked);
  }
  const p50 = percentile(pickup, 50);
  console.log(
    `startTask → running     p50 ${fmt(p50)}  max ${fmt(Math.max(...pickup))}  (n=${pickup.length})`,
  );
  console.log(`startTask → succeeded   p50 ${fmt(percentile(total, 50))}  (n=${total.length})`);
  const pass = pickup.length === n && p50 <= STARTTASK_P50_BUDGET_MS;
  console.log(`S6 startTask p50 ≤ 10 s: ${pass ? "PASS" : "FAIL → set EXECUTOR=worker (register §12)"}`);

  // The S3.14 database questions, asked from inside the workflow.
  const dbRun = await workflows.startTask(taskSlug(DB_PING_TASK, slug), []);
  let probe: DbProbeResult | undefined;
  const t0 = performance.now();
  while (performance.now() - t0 < 120_000) {
    const details = await workflows.getTaskRun(dbRun.taskRunId);
    const status = String(details.status);
    if (["succeeded", "completed"].includes(status)) {
      probe = (details as { results?: unknown[] }).results?.[0] as DbProbeResult | undefined;
      break;
    }
    if (["failed", "canceled"].includes(status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  for (const line of probe ? dbVerdicts(probe) : ["opsDbPing: no result (run failed or timed out)"])
    console.log(line);
  const ready = deployReadiness();
  console.log(
    `S6 verdict scope: ${ready.full ? "full Blueprint" : `fs-tasks only (missing ${ready.missing.join(", ")})`}`,
  );
  return pass && dbOk(probe);
}

async function refreshSchema(): Promise<boolean> {
  const res = await fetch(SCHEMA_URL);
  if (!res.ok) {
    console.log(`schema download failed: HTTP ${res.status}`);
    return false;
  }
  const fresh = `${JSON.stringify(await res.json(), null, 2)}\n`;
  const current = readFileSync(SCHEMA_PATH, "utf8");
  const changed = JSON.stringify(JSON.parse(current)) !== JSON.stringify(JSON.parse(fresh));
  if (changed) writeFileSync(SCHEMA_PATH, fresh);
  console.log(
    `schema ${changed ? "updated" : "unchanged"} (Last-Modified ${res.headers.get("last-modified") ?? "?"})`,
  );
  return true;
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const n = Number(argv.find((a) => a.startsWith("--n="))?.slice(4) ?? 5);
  const job = argv.includes("--refresh-schema")
    ? refreshSchema()
    : argv.includes("--live")
      ? live(n)
      : offline(n);
  job.then(
    (ok) => {
      process.exitCode = ok ? 0 : 1;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : "error");
      process.exitCode = 1;
    },
  );
}
