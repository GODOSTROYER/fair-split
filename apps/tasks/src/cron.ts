// Retired compatibility entry. The hourly plan lives only in apps/api/src/routes/internal/cron.ts;
// fs-cron calls that API through tools/cron-tick.mjs. Keeping this entry gives old local scripts a clear
// failure instead of silently enqueuing a second, stale schedule with different dedupe keys.
import { createLogger, type Logger } from "./log.js";
import { isMain } from "./main.js";

export async function main(_argv: readonly string[], deps: { logger?: Logger } = {}): Promise<number> {
  const logger = deps.logger ?? createLogger({ entry: "cron" });
  logger.error(
    "The tasks cron planner is retired. The only plan is apps/api/src/routes/internal/cron.ts; trigger it with node tools/cron-tick.mjs.",
  );
  return 1;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
