// pino JSON logs (S3.15) with `service`, `requestId`, and (once a credential resolves) `ws` and `persona`.
// Redaction: authorization and cookie headers, token-shaped fields, PayPal secrets and raw bodies never
// reach a log line. Requests are logged by path only: query strings are dropped.
import { type Logger, pino } from "pino";
import type { ApiEnv } from "../env.js";

export const REDACT_PATHS = [
  "authorization",
  "cookie",
  "headers.authorization",
  "headers.cookie",
  'headers["set-cookie"]',
  "token",
  "*.token",
  "consoleToken",
  "*.consoleToken",
  "password",
  "*.password",
  "secret",
  "*.secret",
  "clientSecret",
  "*.clientSecret",
  "signature",
  "*.signature",
  "raw",
  "*.raw",
];

export function createLogger(opts: {
  level: ApiEnv["logLevel"];
  service?: string;
  destination?: pino.DestinationStream;
}): Logger {
  const options: pino.LoggerOptions = {
    level: opts.level,
    base: { service: opts.service ?? "fs-api" },
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  };
  return opts.destination ? pino(options, opts.destination) : pino(options);
}

/** A logger that discards everything (tests, tools). */
export function silentLogger(): Logger {
  return pino({ level: "silent" });
}
