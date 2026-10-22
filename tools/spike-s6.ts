// Spike S6 (register §12): "Blueprint deploys; startTask p50 is 10 s or less. If it fails: executor=worker."
//
//   corepack pnpm exec tsx tools/spike-s6.ts                 offline: Blueprint schema + policy, and the
//                                                            fs-tasks entry's cold start under a fake host
//   corepack pnpm exec tsx tools/spike-s6.ts --live [--n=5]  live: startTask fs-tasks/opsPing n times
//                                                            (needs RENDER_API_KEY and FS_TASKS_SLUG)
//   corepack pnpm exec tsx tools/spike-s6.ts --refresh-schema  re-download Render's Blueprint schema
//
// Prints only timings, counts and pass/fail. Never prints the API key.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Render } from "@renderinc/sdk";
import { loadDotEnv } from "../apps/tasks/src/env.js";
import { isMain } from "../apps/tasks/src/main.js";
import { PING_TASK, taskSlug } from "../apps/tasks/src/workflow.js";
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

async function offline(n: number): Promise<boolean> {
  const bp = readBlueprint();
  const schemaErrors = validateAgainstSchema(bp);
  const policy = checkPolicy(bp);
  console.log(`blueprint schema   ${schemaErrors.length === 0 ? "PASS" : `FAIL ${schemaErrors.join("; ")}`}`);
  console.log(`blueprint policy   ${policy.length === 0 ? "PASS" : `FAIL ${policy.join("; ")}`}`);

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
    const r = await runUnderFakeHost({ ...base, mode: "register" });
    if (r.doneMs !== undefined) register.push(r.doneMs);
    registered = r.registered?.length ?? 0;
    const p = await runUnderFakeHost({ ...base, mode: "run", taskName: PING_TASK, input: ["s6"] });
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
  return pass;
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
