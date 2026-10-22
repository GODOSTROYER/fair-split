// Composition root. This is the only file that changes when another workstream's implementation
// lands: import its handlers and pass them to `withHandlers`. Until then every TaskName is wired to
// a placeholder that fails with NOT_WIRED, which the outbox records as a permanent failure.
//
// Planned wiring (owner → tasks):
//   WS-PPMONEY (packages/paypal-toolkit, paypal-payouts): ensureInvoice, recordPayment, postPayoutBatch,
//                                                         settleBatch, cancelUnclaimed, reroute
//   WS-PPCORE  (packages/paypal-core):                    processWebhook
//   WS-READ    (packages/ai read/ratecard/gateway):       extract, readRateCard, warmCaches
//   WS-CORE    (packages/domain via outbox):              computeRun
//   WS-AGENT   (packages/ai agent/explain):               explain, agentTurn
//   WS-API / WS-APP:                                      pushNotify
//   WS-DATA + WS-OPS (packages/outbox, db):               reconcile, judgeReset
import { TASK_NAMES } from "./_shims/contracts.js";
import { type TaskHandlers, unwiredHandlers, withHandlers } from "./handlers.js";

export async function loadHandlers(): Promise<TaskHandlers> {
  return withHandlers(unwiredHandlers(TASK_NAMES), {});
}

/** The cron's outbox port. Returns undefined until WS-DATA's `enqueue(tx, …)` is wired. */
export async function loadCronSink(): Promise<import("./cron.js").CronSink | undefined> {
  return undefined;
}
