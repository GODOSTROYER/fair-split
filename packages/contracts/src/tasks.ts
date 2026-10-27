// The TaskName registry (IC-01, frozen with the contracts). Each task takes IDs only (Workflows
// caps arguments) and has a dedupe key: enqueueing the same key twice is a no-op, and handlers
// transition optimistically, so running a task twice changes nothing (I7).
import { z } from "zod";
import type { Executor } from "./enums.js";
import { Lang } from "./primitives.js";

const id = z.string().min(1);

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
export const TaskName = z.enum(TASK_NAMES);
export type TaskName = z.infer<typeof TaskName>;

export const TaskLane = z.enum(["paypal", "ai_engine", "system"]);
export type TaskLane = z.infer<typeof TaskLane>;

export const TaskArgs = {
  /** SENT: create, send, AUTO_CANCEL rule (checkpointed). FUNDED: one GET per PAID or the 60 s fallback. */
  ensureInvoice: z.discriminatedUnion("target", [
    z.strictObject({ target: z.literal("SENT"), runId: id }),
    z.strictObject({ target: z.literal("FUNDED"), runId: id, invoiceId: id, n: z.int().positive() }),
  ]),
  recordPayment: z.strictObject({ runId: id, invoiceId: id }),
  processWebhook: z.strictObject({ webhookEventId: id, paypalEventId: id }),
  postPayoutBatch: z.strictObject({ runId: id, senderBatchId: id }),
  settleBatch: z.strictObject({ batchId: id, n: z.int().positive() }),
  cancelUnclaimed: z.strictObject({ payoutItemId: id, afterCancel: z.enum(["cash", "reroute"]) }),
  reroute: z.strictObject({ lineId: id, n: z.int().positive() }),
  extract: z.strictObject({ documentIds: z.array(id).min(1), runId: id.nullable() }),
  readRateCard: z.strictObject({ documentId: id }),
  computeRun: z.strictObject({ runId: id, version: z.int().nonnegative() }),
  explain: z.strictObject({ lineId: id, lang: Lang }),
  agentTurn: z.strictObject({
    runId: id,
    purpose: z.enum(["DRAFT_INVOICE", "INVESTIGATE_HOLD", "REQUEST_BATCH"]),
    holdId: id.nullable(),
    turn: z.int().nonnegative(),
  }),
  pushNotify: z.strictObject({
    kind: z.enum(["cosign", "bayad_na", "batch_progress"]),
    targetId: id,
    eventId: id,
  }),
  reconcile: z.strictObject({
    mode: z.enum(["hot", "catchup", "nightly", "health"]),
    windowStart: z.iso.datetime(),
  }),
  judgeReset: z.strictObject({
    trigger: z.enum(["cron", "button"]),
    workspaceId: id.nullable(),
    /** Hour stamp (cron) or a button nonce, so a retry of the same pass is a no-op. */
    slot: id,
  }),
  warmCaches: z.strictObject({ slot: id }),
} as const satisfies Record<TaskName, z.ZodType>;

export type TaskArgsOf<T extends TaskName> = z.infer<(typeof TaskArgs)[T]>;

export interface TaskDef<T extends TaskName> {
  readonly name: T;
  readonly lane: TaskLane;
  /** Where it runs by default (S3.3): money and webhook tasks inline; live AI on Workflows. */
  readonly executor: Executor;
  readonly args: (typeof TaskArgs)[T];
  readonly dedupeKey: (args: TaskArgsOf<T>) => string;
}

function def<T extends TaskName>(
  name: T,
  lane: TaskLane,
  executor: Executor,
  dedupeKey: (args: TaskArgsOf<T>) => string,
): TaskDef<T> {
  return { name, lane, executor, args: TaskArgs[name], dedupeKey };
}

export const TASKS: { readonly [T in TaskName]: TaskDef<T> } = {
  ensureInvoice: def("ensureInvoice", "paypal", "inline", (a) =>
    a.target === "SENT" ? `inv:${a.runId}:sent` : `fund:${a.invoiceId}:${a.n}`,
  ),
  recordPayment: def("recordPayment", "paypal", "inline", (a) => `pay:${a.invoiceId}`),
  processWebhook: def("processWebhook", "paypal", "inline", (a) => `wh:${a.paypalEventId}`),
  postPayoutBatch: def("postPayoutBatch", "paypal", "inline", (a) => `post:${a.senderBatchId}`),
  settleBatch: def("settleBatch", "paypal", "inline", (a) => `settle:${a.batchId}:${a.n}`),
  cancelUnclaimed: def("cancelUnclaimed", "paypal", "inline", (a) => `cancel:${a.payoutItemId}`),
  reroute: def("reroute", "paypal", "inline", (a) => `reroute:${a.lineId}:x${a.n}`),
  extract: def("extract", "ai_engine", "workflow", (a) => `extract:${[...a.documentIds].sort().join("+")}`),
  readRateCard: def("readRateCard", "ai_engine", "workflow", (a) => `ratecard:${a.documentId}`),
  computeRun: def("computeRun", "ai_engine", "workflow", (a) => `compute:${a.runId}:v${a.version}`),
  explain: def("explain", "ai_engine", "workflow", (a) => `explain:${a.lineId}:${a.lang}`),
  agentTurn: def(
    "agentTurn",
    "ai_engine",
    "workflow",
    (a) => `agent:${a.runId}:${a.purpose}:${a.holdId ?? "-"}:${a.turn}`,
  ),
  pushNotify: def("pushNotify", "paypal", "inline", (a) => `push:${a.kind}:${a.targetId}:${a.eventId}`),
  reconcile: def("reconcile", "system", "workflow", (a) => `reconcile:${a.mode}:${a.windowStart}`),
  judgeReset: def("judgeReset", "system", "workflow", (a) => `reset:${a.workspaceId ?? "pool"}:${a.slot}`),
  warmCaches: def("warmCaches", "system", "workflow", (a) => `warm:${a.slot}`),
};

/** Validates arguments and returns the dedupe key; throws a ZodError on bad arguments. */
export function taskDedupeKey<T extends TaskName>(name: T, args: unknown): string {
  const task = TASKS[name];
  const parsed = task.args.parse(args) as TaskArgsOf<T>;
  return task.dedupeKey(parsed);
}
