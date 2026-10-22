/**
 * TEMPORARY SHIM: replace with @fairsplit/contracts after WS-CORE merges.
 *
 * The IC-01 TaskName registry, names only (register §11). WS-CORE's registry adds each task's argument schema
 * and idempotency key; the outbox needs only the names and that arguments are ids (JSON, ≤ 8 KB).
 */
export const TASK_NAMES = [
  "ensureInvoice",
  "recordPayment",
  "processWebhook",
  "postPayoutBatch",
  "settleBatch",
  "cancelUnclaimed",
  "reroute",
  "extract",
  "readRateCard",
  "computeRun",
  "explain",
  "agentTurn",
  "pushNotify",
  "reconcile",
  "judgeReset",
  "warmCaches",
] as const;
export type TaskName = (typeof TASK_NAMES)[number];
