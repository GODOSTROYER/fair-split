// Inline-executor entry for local development and CI (EXECUTOR=inline):
//   corepack pnpm --filter @fairsplit/tasks inline <taskName> <outboxId> [<outboxId>...]
//   node apps/tasks/dist/inline.js <taskName> <outboxId>
// Runs the same handlers the workflow entry registers, in this process, two at a time.
import { isTaskName, TASK_NAMES, type TaskName } from "./_shims/contracts.js";
import { loadDotEnv } from "./env.js";
import { createInlineExecutor } from "./executor.js";
import type { TaskHandlers } from "./handlers.js";
import { createLogger, type Logger } from "./log.js";
import { isMain } from "./main.js";
import { loadHandlers } from "./wiring.js";

export function parseInlineArgs(argv: readonly string[]): { name: TaskName; ids: string[] } {
  const [name, ...ids] = argv;
  if (!isTaskName(name)) {
    throw new Error(`usage: inline <taskName> <id> [<id>...]; taskName is one of ${TASK_NAMES.join(", ")}`);
  }
  if (ids.length === 0) throw new Error("inline: give at least one outbox id");
  return { name, ids };
}

/** Exit code: 0 done or skipped, 2 permanent failure; a transient failure rejects (exit 1). */
export async function main(
  argv: readonly string[],
  deps: { handlers?: TaskHandlers; logger?: Logger } = {},
): Promise<number> {
  const { name, ids } = parseInlineArgs(argv);
  const logger = deps.logger ?? createLogger({ entry: "inline" });
  const handlers = deps.handlers ?? (await loadHandlers());
  const receipt = await createInlineExecutor({ handlers, logger }).run(name, ids);
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
