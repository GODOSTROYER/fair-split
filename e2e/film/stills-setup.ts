// The stills take's global setup: the e2e stack's own (stack/global-setup.ts), with a longer wait for fs-api to
// boot. The take is often run while other worktrees hold the processors (renders, test suites), and fs-api's
// first answer can then take minutes. Torn down by the function it returns, on failure and on Ctrl-C alike.
import { closeWindowProbe } from "../lib/paypal-window.js";
import { startStack } from "../stack/stack.js";

export default async function stillsSetup(): Promise<() => Promise<void>> {
  const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);
  if (process.env.E2E_BASE_URL) {
    log(`using ${process.env.E2E_BASE_URL} (E2E_BASE_URL); nothing started`);
    return async () => {};
  }
  const stack = await startStack({ log, bootTimeoutMs: 360_000 });
  process.env.E2E_BASE_URL = stack.origin;
  process.env.E2E_STACK_CONSOLE_DIR = stack.consoleDir;
  // the take reads PayPal's window from it (lib/paypal-window.ts); never printed
  process.env.E2E_DATABASE_URL = stack.databaseUrl;
  const onExit = () => stack.stopSync();
  process.once("exit", onExit);
  return async () => {
    process.off("exit", onExit);
    await closeWindowProbe().catch(() => undefined);
    await stack.stop();
    log("stopped: fs-api, the database and the cluster");
  };
}
