import { Writable } from "node:stream";
import { TASK_NAMES, type TaskName } from "../src/_shims/contracts.js";
import { type TaskHandler, unwiredHandlers, withHandlers } from "../src/handlers.js";
import type { OutboxPort, TaskRuntime } from "../src/invoke.js";
import type { FlagCheck } from "../src/kill.js";
import { createLogger, type Logger } from "../src/log.js";

/** A logger that captures parsed JSON lines, for asserting on log output. */
export function captureLogger(): { logger: Logger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString("utf8").split("\n"))
        if (l.trim()) lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { logger: createLogger({}, { level: "debug", destination }), lines };
}

export const OUTBOX_ID = "0192f0a8-6c1e-7a3b-9d2e-4f5a6b7c8d9e";

/** A TaskRuntime over the NOT_WIRED placeholders, with a recording outbox and no kill flags. */
export function testRuntime(
  overrides: Partial<Record<TaskName, TaskHandler>> = {},
  opts: { checkFlags?: FlagCheck; markFailed?: OutboxPort["markFailed"] } = {},
): TaskRuntime & { failed: { id: string; code: string; detail: string }[] } {
  const failed: { id: string; code: string; detail: string }[] = [];
  return {
    failed,
    handlers: withHandlers(unwiredHandlers(TASK_NAMES), overrides),
    outbox: {
      markFailed:
        opts.markFailed ??
        (async (id, code, detail) => {
          failed.push({ id, code, detail });
        }),
    },
    checkFlags: opts.checkFlags ?? (() => undefined),
  };
}
