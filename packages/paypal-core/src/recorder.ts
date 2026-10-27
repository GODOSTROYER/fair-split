// One `paypal_calls` row per HTTP attempt (architecture §3, S3.15): purpose, priority, status,
// debug_id, request_id and latency. WS-DATA's recorder writes the row, which doubles as the
// limiter window; this package only defines the shape and never lets a recorder failure break a call.

import type { CallPriority, CallPurpose, LoggerLike } from "./types.js";

export type CallOutcome = "ok" | "http_error" | "timeout" | "network_error";

export interface PayPalCallRecord {
  at: Date;
  purpose: CallPurpose;
  priority: CallPriority;
  method: string;
  /** URL path only. Query strings are dropped so nothing user-specific lands in the log table. */
  path: string;
  /** HTTP status, or 0 when PayPal sent no response (timeout, network error). */
  status: number;
  outcome: CallOutcome;
  debugId: string | null;
  requestId: string | null;
  /** Latency of this attempt. */
  ms: number;
  /** 1-based attempt number within one `request()` (retries and the 401 refresh add attempts). */
  attempt: number;
  /** Echo of the limiter's ticket, when it handed one out. */
  ticket: string | null;
}

export interface PayPalCallRecorder {
  record(call: PayPalCallRecord): void | Promise<void>;
}

/** Record a call; swallow and log recorder failures so observability never fails a payment. */
export async function recordSafely(
  recorder: PayPalCallRecorder | undefined,
  call: PayPalCallRecord,
  logger: LoggerLike | undefined,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.record(call);
  } catch (err) {
    logger?.warn?.(
      { purpose: call.purpose, status: call.status, error: err instanceof Error ? err.message : String(err) },
      "paypal call recorder failed",
    );
  }
}
