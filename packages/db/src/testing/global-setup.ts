/**
 * Vitest globalSetup: one real Postgres per test run, one migrated template, provided to every test file as
 * `inject("fsPg")`. Use it from a package's vitest.config.ts:
 *   test: { globalSetup: ["@fairsplit/db/testing/global-setup"] }   (or a relative path inside this package)
 *
 * A run that cannot finish must fail. At the ws/api trial merge, the template cleanup sent ALTER DATABASE to a
 * database an interrupted DROP had left invalid; Postgres ended the session with a FATAL, the cleanup swallowed
 * the error and sent its DROP DATABASE into the dead connection, and postgres.js never settled that promise: on
 * Windows the server's FATAL reaches the client as ECONNRESET, a socket 'error' that rejects the ALTER but leaves
 * it recorded as in flight, so the DROP, sent before the 'close' event, joins the dead connection's own queue;
 * and a close that follows a socket error (postgres.js 3.4.9) neither rejects that queue nor reconnects for it.
 * Vitest awaits global setup inside its CLI's promise chain, not at a module's top level, so once nothing else
 * held Node's event loop the process simply ended, with exit code 0, having printed only its RUN line and run no
 * test file; turbo counted the task as passed, and the cluster was left running (no teardown ever ran).
 * template.ts no longer does any of that; this file makes sure no other cause can:
 *
 * - From the start of setup until Vitest calls the teardown, an 'exit' listener stands guard: a process that
 *   exits in between did not run its test files to the end, whatever the reason (an unsettled promise here or
 *   in another global setup, an early process.exit). The guard says so, sets exit code 1 and stops the cluster
 *   (synchronously: an 'exit' listener cannot wait). This is also the zero-test-files guard for every Postgres
 *   suite: a run with no test files at all is already failed by Vitest itself ("No test files found"), which
 *   no harness suite overrides with --passWithNoTests, so the only way such a suite could pass having run no
 *   file is to end before its teardown, which the guard turns into a failure.
 * - A setup that throws stops the cluster if it had started, then fails with the step it was on and the error's
 *   messages, in a form Vitest 5.0.5 can print (see `printable`).
 */
import { writeSync } from "node:fs";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { startTestCluster, type TestCluster } from "./cluster.js";
import { prepareTemplate } from "./template.js";

export interface ProvidedPg {
  adminUrl: string;
  template: string;
  suite: string;
}

declare module "vitest" {
  export interface ProvidedContext {
    fsPg: ProvidedPg;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const suite = path.basename(project.config.root);
  let step = "starting the test cluster";
  let cluster: TestCluster | undefined;
  let tornDown = false;

  const guard = () => {
    if (tornDown) return;
    if (!process.exitCode) process.exitCode = 1;
    const why =
      step === "running"
        ? "the process is exiting before Vitest tore down the global setup, so its test files did not run to the end"
        : `the process is exiting while the global setup was still ${step}: Vitest was left waiting on a promise ` +
          "that never settled, and with nothing else to do Node would have exited 0 having run no test";
    writeSync(2, `\n[@fairsplit/db testing] ${suite}: ${why}. Failing the run; stopping the test cluster.\n`);
    cluster?.stopSync();
  };
  process.on("exit", guard);
  const disarm = () => {
    tornDown = true;
    process.off("exit", guard);
  };

  try {
    cluster = await startTestCluster({ cacheDir: path.join(project.config.root, ".cache") });
    step = "preparing the migrated template";
    const template = await prepareTemplate(cluster.adminUrl, suite);
    project.provide("fsPg", { adminUrl: cluster.adminUrl, template, suite });
  } catch (e) {
    disarm();
    await cluster?.stop();
    const log = cluster?.logFile ? ` (Postgres log: ${cluster.logFile})` : "";
    throw printable(
      `[@fairsplit/db testing] ${suite}: global setup failed while ${step}${log}: ${messages(e)}`,
    );
  }
  step = "running";

  const started = cluster;
  return async () => {
    disarm();
    await started.stop();
  };
}

/**
 * The messages of an error and of its causes, outermost first, leaving out a cause whose message an outer one
 * already quotes. Reading `message` never formats a stack.
 */
function messages(e: unknown): string {
  const parts: string[] = [];
  for (let c: unknown = e, depth = 0; c !== undefined && depth < 5; depth++) {
    const message = c instanceof Error ? c.message : String(c);
    if (!parts.some((p) => p.includes(message))) parts.push(message);
    c = c instanceof Error ? c.cause : undefined;
  }
  return parts.join("\n  caused by: ");
}

/**
 * An error Vitest 5.0.5 can print. Its printer formats the stack of an error thrown from global setup through the
 * module runner's source maps, which throws `TypeError: code.charCodeAt is not a function`, and prints that in
 * place of the error (and in place of any `cause`), after a misleading "No test files found". A stack that is
 * already a plain string is printed as it is, so this error carries its whole explanation in its message and
 * stack, and has no `cause`.
 */
function printable(message: string): Error {
  const error = new Error(message);
  error.stack = `Error: ${message}`;
  return error;
}
