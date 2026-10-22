// Inline-executor entry for local development and CI (EXECUTOR=inline):
//   corepack pnpm --filter @fairsplit/tasks inline <taskName> <outboxId> [<outboxId>...]
//   node apps/tasks/dist/inline.js <taskName> <outboxId>
// Runs the same handlers the workflow entry registers, in this process, two at a time.
import { isTaskName, TASK_NAMES, type TaskName } from "./_shims/contracts.js";
import { loadDotEnv } from "./env.js";
import { createInlineExecutor } from "./executor.js";
import type { TaskRuntime } from "./invoke.js";
import { assertSandbox } from "./kill.js";
import { createLogger, type Logger } from "./log.js";
import { isMain } from "./main.js";
import { loadRuntime } from "./wiring.js";

export function parseInlineArgs(argv: readonly string[]): { name: TaskName; ids: string[] } {
  const [name, ...ids] = argv;
  if (!isTaskName(name)) {
    throw new Error(`usage: inline <taskName> <id> [<id>...]; taskName is one of ${TASK_NAMES.join(", ")}`);
  }
  if (ids.length === 0) throw new Error("inline: give at least one outbox id");
  return { name, ids };
}

/**
 * Exit code: 0 done or skipped, 2 permanent failure; a transient failure rejects (exit 1).
 * Refuses to run outside the sandbox (S3.13), like the workflow entry.
 */
export async function main(
  argv: readonly string[],
  deps: { runtime?: TaskRuntime; logger?: Logger; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  assertSandbox(deps.env ?? process.env);
  const { name, ids } = parseInlineArgs(argv);
  const logger = deps.logger ?? createLogger({ entry: "inline" });
  const runtime = deps.runtime ?? (await loadRuntime(logger));
  const receipt = await createInlineExecutor({ runtime, logger }).run(name, ids);
  return receipt.outcome?.status === "failed" ? 2 : 0;
}

if (isMain(import.meta.url)) {
  loadDotEnv();
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    },
  );
}
