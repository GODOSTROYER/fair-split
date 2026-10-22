// pino JSON logger with the S3.15 redaction list. Tests pass `level: "silent"` or a custom destination.
import { type DestinationStream, type Logger, pino } from "pino";

export type { Logger };

export const REDACT_PATHS = [
  "authorization",
  "*.authorization",
  "headers.authorization",
  "token",
  "*.token",
  "access_token",
  "*.access_token",
  "secret",
  "*.secret",
  "apiKey",
  "*.apiKey",
];

export function createLogger(
  bindings: Record<string, string> = {},
  options: { level?: string; destination?: DestinationStream } = {},
): Logger {
  const level = options.level ?? process.env.LOG_LEVEL ?? "info";
  const base = { service: process.env.RENDER_SERVICE_NAME ?? "fs-tasks", ...bindings };
  const opts = { level, base, redact: { paths: REDACT_PATHS, censor: "REDACTED" } };
  return options.destination ? pino(opts, options.destination) : pino(opts);
}

export function silentLogger(): Logger {
  return pino({ level: "silent" });
}
