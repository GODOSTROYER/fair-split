// TEMPORARY SHIM: replace with @fairsplit/contracts|domain after WS-CORE merges.
//
// Mirrors decision register §11 IC-01 (the TaskName registry) exactly. Workflow tasks receive ids
// only (S3.3: "Args are IDs only, because Workflows caps arguments at 4 MB"); the argument shapes
// and dedupe keys of the three scheduled tasks are proposed below for WS-CORE to confirm when IC-01
// freezes (24 Oct 18:00). Swap: `import { TASK_NAMES, type TaskName, … } from "@fairsplit/contracts"`.
//
// The namespace import is real on purpose: it keeps a runtime edge to a workspace package in every
// built entry, so the bundle test proves the tsdown config inlines TypeScript-source workspace
// packages before WS-CORE's code lands behind it.
import * as contracts from "@fairsplit/contracts";

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

/** S3.4 `workspaces.kind`. `showcase` and `judge` workspaces run in Judge Mode (register C-06). */
export type WorkspaceKind = "showcase" | "judge" | "real";

/** IC-04: the executor that ran a task (S3.3 `task_outbox.executor`). */
export type ExecutorKind = "inline" | "workflow" | "worker";

/**
 * Differences between this shim's TASK_NAMES and @fairsplit/contracts' once WS-CORE exports one.
 * Empty while contracts has no TASK_NAMES or when they agree. The entry logs any drift at boot.
 */
export function contractsDrift(): string[] {
  // Looked up by entry, not by name: contracts has no TASK_NAMES export yet, and a static member
  // access would make the bundler warn (and compile it to `undefined`).
  const upstream = Object.entries(contracts).find(([key]) => key === "TASK_NAMES")?.[1];
  if (!Array.isArray(upstream)) return [];
  const up = upstream.map(String);
  const extra = up.filter((n) => !NAME_SET.has(n)).map((n) => `+${n}`);
  const missing = TASK_NAMES.filter((n) => !up.includes(n)).map((n) => `-${n}`);
  return [...extra, ...missing];
}
