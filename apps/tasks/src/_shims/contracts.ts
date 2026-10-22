// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors decision register §11 IC-01 (the TaskName registry) exactly. Only the names live here:
// the argument schemas and idempotency keys belong to WS-CORE. Workflow tasks receive ids only
// (S3.3: "Args are IDs only, because Workflows caps arguments at 4 MB"), so this package never
// needs the per-task argument shapes. Swap: `import { TASK_NAMES, type TaskName } from "@fairsplit/contracts"`.

/** IC-01 TaskName registry, in register order (PayPal, then AI and engine, then system). */
export const TASK_NAMES = [
  // PayPal
  "ensureInvoice",
  "recordPayment",
  "processWebhook",
  "postPayoutBatch",
  "settleBatch",
  "cancelUnclaimed",
  "reroute",
  // AI and engine
  "extract",
  "readRateCard",
  "computeRun",
  "explain",
  "agentTurn",
  // system
  "pushNotify",
  "reconcile",
  "judgeReset",
  "warmCaches",
] as const;

export type TaskName = (typeof TASK_NAMES)[number];

const NAME_SET: ReadonlySet<string> = new Set(TASK_NAMES);

export function isTaskName(value: unknown): value is TaskName {
  return typeof value === "string" && NAME_SET.has(value);
}

/** IC-04: the executor that ran a task (S3.3 `task_outbox.executor`). */
export type ExecutorKind = "inline" | "workflow" | "worker";
