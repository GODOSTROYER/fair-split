// The judge-load soak's stack: the e2e stack (e2e/stack/stack.ts: Postgres, fs-api in keyless replay on the
// in-process PayPal simulator, the console, /app and /media from one origin), kept up until SIGINT or SIGTERM.
//
//   corepack pnpm exec tsx tools/soak/stack.ts [--state=.codex-scratch/soak/stack.json] [--dist]
//
// Unlike `corepack pnpm --filter @fairsplit/e2e stack`, it writes what the load run needs to sample the server into a
// state file (owner-only): the origin, fs-api's pid and the stack's own database URL (the local trust-auth cluster's
// admin login on fs_e2e, never printed). Nothing else changes: the same whitelist environment, NODE_ENV=test and the
// e2e hourly cap (FS_TEST_JUDGE_HOURLY_MAX=24); production's three-per-hour default is not touched.
//
// --dist (Linux): once the stack is up, fs-api is restarted the way Render starts it, `node apps/api/dist/index.js`
// from the repository root (build it first: `corepack pnpm turbo run build --filter=@fairsplit/api`), on the same
// port with the same environment (read from /proc/<pid>/environ, passed only to the child, never printed). Memory and
// CPU are then the production build's, not tsx's.
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, startStack } from "../../e2e/stack/stack.js";
import { readBlueprint } from "../lib/blueprint.js";
import { apiStartArgs } from "./launch.js";

const arg = process.argv.find((a) => a.startsWith("--state="))?.slice("--state=".length);
const statePath = path.resolve(arg ?? path.join(REPO_ROOT, ".codex-scratch", "soak", "stack.json"));
const useDist = process.argv.includes("--dist");
const log = (line: string) => process.stdout.write(`[soak-stack] ${line}\n`);

const stack = await startStack({ log });
let pid = stack.pid;
let dist: ChildProcess | null = null;

/** fs-api's environment, as the stack gave it (NUL-separated KEY=value pairs). */
function environOf(p: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const pair of readFileSync(`/proc/${p}/environ`, "utf8").split("\0")) {
    const eq = pair.indexOf("=");
    if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return env;
}

async function healthy(origin: string, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await fetch(`${origin}/readyz`).then(
      (r) => r.status === 200,
      () => false,
    );
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

if (useDist) {
  const entry = path.join(REPO_ROOT, "apps", "api", "dist", "index.js");
  if (!existsSync(entry))
    throw new Error(`no ${entry}: corepack pnpm turbo run build --filter=@fairsplit/api`);
  const env = environOf(stack.pid);
  process.kill(stack.pid, "SIGTERM");
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(stack.pid, 0);
      await new Promise((r) => setTimeout(r, 100));
    } catch {
      break;
    }
  }
  const command = readBlueprint().services?.find((service) => service.name === "fs-api")?.startCommand;
  if (!command) throw new Error("No fs-api start command in the Blueprint");
  dist = spawn(process.execPath, apiStartArgs(command), {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "ignore", "inherit"],
  });
  pid = dist.pid ?? 0;
  if (!(await healthy(stack.origin, 60_000))) throw new Error("the dist fs-api did not become ready");
  log(`fs-api restarted from the dist build (pid ${pid})`);
}

const stopDist = () => {
  if (dist && dist.exitCode === null && dist.signalCode === null) dist.kill("SIGTERM");
};
mkdirSync(path.dirname(statePath), { recursive: true });
writeFileSync(
  statePath,
  JSON.stringify({
    origin: stack.origin,
    pid,
    databaseUrl: stack.databaseUrl,
    build: useDist ? "dist" : "tsx",
    startedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
process.once("exit", () => {
  rmSync(statePath, { force: true });
  stopDist();
  stack.stopSync();
});
log(`ready: ${stack.origin}/judge (fs-api pid ${pid}); state in ${statePath}`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stopDist();
    stack.stop().then(
      () => {
        rmSync(statePath, { force: true });
        log("stopped");
        process.exit(0);
      },
      (err: unknown) => {
        process.stderr.write(`[soak-stack] stop failed: ${String(err)}\n`);
        process.exit(1);
      },
    );
  });
}
