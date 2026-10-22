import { Writable } from "node:stream";
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
