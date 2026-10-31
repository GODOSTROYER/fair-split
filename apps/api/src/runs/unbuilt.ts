// Outbox tasks this build has no worker for. IC-01 names them and other code may enqueue them (apps/tasks' cron
// enqueues reconcile and warmCaches; a cosign push would be pushNotify), but nothing behind them is built: no
// rate-card photo is read (the ratified Schedule A comes with the seed), no cache is warmed, no reconciliation
// runs and no push is sent. Without a handler such a row would fail eight times and die; each of these instead
// completes at once with a labelled "not built in this build" outcome (a log line and the task's report), so
// /ops never shows a dead row for work that was never meant to run, and nothing claims the work was done.
import type { TaskName } from "@fairsplit/contracts";
import type { TaskHandler, TaskHandlers } from "@fairsplit/outbox";
import type { AppDeps } from "../lib/context.js";
import { report } from "./now.js";

export const NOT_BUILT = {
  readRateCard:
    "Reading a rate-card photo is not built in this build: the ratified Schedule A comes with the seed.",
  warmCaches: "Cache warming is not built in this build.",
  reconcile: "Reconciliation is not built in this build: no nightly reconciliation runs.",
  pushNotify: "Push notifications are not built in this build: nothing is sent.",
} as const satisfies Partial<Record<TaskName, string>>;

export type UnbuiltTask = keyof typeof NOT_BUILT;

function unbuilt(deps: Pick<AppDeps, "logger">, name: UnbuiltTask): TaskHandler {
  return async (_args, ctx) => {
    const label = NOT_BUILT[name];
    deps.logger.info(
      { task: name, outboxId: ctx.outboxId, workspaceId: ctx.workspaceId, outcome: "not_built" },
      label,
    );
    report(ctx.outboxId, { ok: true, detail: { outcome: "not_built", label } });
  };
}

/** Labelled no-op handlers for the named tasks (each route folder registers its own). */
export function unbuiltTasks(deps: Pick<AppDeps, "logger">, names: readonly UnbuiltTask[]): TaskHandlers {
  return Object.fromEntries(names.map((name) => [name, unbuilt(deps, name)])) as TaskHandlers;
}
