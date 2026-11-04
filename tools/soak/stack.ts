// The judge-load soak's stack: the e2e stack (e2e/stack/stack.ts: embedded Postgres, fs-api in keyless replay on the
// in-process PayPal simulator, the console, /app and /media from one origin), kept up until SIGINT or SIGTERM.
//
//   corepack pnpm exec tsx tools/soak/stack.ts [--state=.codex-scratch/soak/stack.json]
//
// Unlike `corepack pnpm --filter @fairsplit/e2e stack`, it writes what the load run needs to sample the server into a
// state file (owner-only): the origin, fs-api's pid and the stack's own database URL (the local trust-auth cluster's
// admin login on fs_e2e, never printed). Nothing else changes: the same whitelist environment, NODE_ENV=test and the
// e2e hourly cap (FS_TEST_JUDGE_HOURLY_MAX=24); production's three-per-hour default is not touched.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, startStack } from "../../e2e/stack/stack.js";

const arg = process.argv.find((a) => a.startsWith("--state="))?.slice("--state=".length);
const statePath = path.resolve(arg ?? path.join(REPO_ROOT, ".codex-scratch", "soak", "stack.json"));
const log = (line: string) => process.stdout.write(`[soak-stack] ${line}\n`);

const stack = await startStack({ log });
mkdirSync(path.dirname(statePath), { recursive: true });
writeFileSync(
  statePath,
  JSON.stringify({
    origin: stack.origin,
    pid: stack.pid,
    databaseUrl: stack.databaseUrl,
    startedAt: new Date().toISOString(),
  }),
  { mode: 0o600 },
);
process.once("exit", () => {
  rmSync(statePath, { force: true });
  stack.stopSync();
});
log(`ready: ${stack.origin}/judge (fs-api pid ${stack.pid}); state in ${statePath}`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
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
