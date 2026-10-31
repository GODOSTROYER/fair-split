// Playwright's global setup: one private stack for the whole run (stack.ts), torn down by the function it returns,
// which Playwright calls after the last test, on failure and on Ctrl-C alike. A process 'exit' listener stops it
// synchronously if the runner ends any other way. With E2E_BASE_URL already set (a hosted fs-api, DR-0), nothing is
// started and the specs run against that origin.
import { startStack } from "./stack.js";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);
  if (process.env.E2E_BASE_URL) {
    log(`using ${process.env.E2E_BASE_URL} (E2E_BASE_URL); nothing started`);
    return async () => {};
  }
  const stack = await startStack({ log });
  process.env.E2E_BASE_URL = stack.origin;
  process.env.E2E_STACK_CONSOLE_DIR = stack.consoleDir;
  const onExit = () => stack.stopSync();
  process.once("exit", onExit);
  return async () => {
    process.off("exit", onExit);
    await stack.stop();
    log("stopped: fs-api, the database and the cluster");
  };
}
