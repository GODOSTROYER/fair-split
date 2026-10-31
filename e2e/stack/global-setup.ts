// Playwright's global setup: one private stack for the whole run (stack.ts), torn down by the function it returns,
// which Playwright calls after the last test, on failure and on Ctrl-C alike. A process 'exit' listener stops it
// synchronously if the runner ends any other way. With E2E_BASE_URL already set (a hosted fs-api, DR-0), nothing is
// started and the specs run against that origin.
import { closeWindowProbe, describePeak, peakWindow } from "../lib/paypal-window.js";
import { startStack } from "./stack.js";

export default async function globalSetup(): Promise<() => Promise<void>> {
  const log = (line: string) => process.stdout.write(`[stack] ${line}\n`);
  if (process.env.E2E_BASE_URL) {
    log(`using ${process.env.E2E_BASE_URL} (E2E_BASE_URL); nothing started`);
    return async () => {};
  }
  const stack = await startStack({ log });
  const startedAt = new Date();
  process.env.E2E_BASE_URL = stack.origin;
  process.env.E2E_STACK_CONSOLE_DIR = stack.consoleDir;
  // the specs read PayPal's window from it (lib/paypal-window.ts); never printed
  process.env.E2E_DATABASE_URL = stack.databaseUrl;
  const onExit = () => stack.stopSync();
  process.once("exit", onExit);
  return async () => {
    process.off("exit", onExit);
    // the suite's PayPal traffic against fs-api's limiter (40 calls in any 60 s), read before the database goes
    const peak = await peakWindow(startedAt).catch(() => null);
    if (peak) log(`PayPal's window peaked at ${describePeak(peak)}; the pacing spec's filler left out`);
    await closeWindowProbe().catch(() => undefined);
    await stack.stop();
    log("stopped: fs-api, the database and the cluster");
  };
}
