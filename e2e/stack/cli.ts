// `corepack pnpm --filter @fairsplit/e2e stack`: brings the e2e stack up on its own (to drive it by hand, or to
// watch a browser spec against it) and keeps it up until Ctrl-C, then stops everything it started.
import { startStack } from "./stack.js";

const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);
const stack = await startStack({ log });
process.once("exit", () => stack.stopSync());
log(`ready: ${stack.origin}/judge (Ctrl-C stops fs-api, the database and the cluster)`);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    stack.stop().then(
      () => {
        log("stopped");
        process.exit(0);
      },
      (err: unknown) => {
        process.stderr.write(`[stack] stop failed: ${String(err)}\n`);
        process.exit(1);
      },
    );
  });
}
