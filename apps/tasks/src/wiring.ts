// Composition root. This is the only file that changes when another workstream's implementation
// lands: import its handlers and pass them to `withHandlers`, and replace the outbox port and flag
// source with WS-DATA's. Until then every TaskName is wired to a placeholder that fails with
// NOT_WIRED, and the permanent failure goes to the outbox port (a logging stub until WS-DATA).
//
// The fs-tasks entry runs only the Workflows lanes (extract, readRateCard, warmCaches); the inline
// CLI runs any TaskName. fs-api's own dispatcher wires the inline lanes in apps/api (WS-API).
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
//   WS-DATA    (packages/outbox):                         OutboxPort.markFailed, the system_flags source
import { TASK_NAMES } from "./_shims/contracts.js";
import type { CronSink } from "./cron.js";
import { unwiredHandlers, withHandlers } from "./handlers.js";
import type { OutboxPort, TaskRuntime } from "./invoke.js";
import { envFlags } from "./kill.js";
import type { Logger } from "./log.js";

/** Stand-in until WS-DATA's port lands: logs the failure it cannot yet record. */
export function unwiredOutbox(logger: Logger): OutboxPort {
  return {
    async markFailed(id, code) {
      logger.warn({ id, code }, "outbox.markFailed not wired (WS-DATA); row state not updated");
    },
  };
}

export async function loadRuntime(logger: Logger): Promise<TaskRuntime> {
  return {
    handlers: withHandlers(unwiredHandlers(TASK_NAMES), {}),
    outbox: unwiredOutbox(logger),
    // Later: unionFlags(envFlags(), systemFlags(db)), WS-DATA's per-workspace source. system_flags
    // is the runtime authority (flipped from /ops, read fresh); FS_KILL is the deploy-wide override.
    readFlags: envFlags(),
  };
}

/** The cron planner's outbox port. Returns undefined until WS-DATA's `enqueue(tx, …)` is wired. */
export async function loadCronSink(): Promise<CronSink | undefined> {
  return undefined;
}
