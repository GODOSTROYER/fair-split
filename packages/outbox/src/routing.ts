/**
 * Which executor runs which task (S3.3; register deviation 3). Money, webhook, engine and agent tasks always run
 * inline in fs-api: one warm OAuth cache (no per-instance token calls against the 40/min budget) and money steps
 * under a second, and in Judge Mode the AI output replays anyway. Only three tasks may leave the process, and only
 * when EXECUTOR names a remote executor and the task is live:
 *
 *   extract (the live slip read, which shows its Render run id), readRateCard, warmCaches
 *
 * The dispatcher asks the route for every claimed row and records the answer in `task_outbox.executor`. Apps may
 * inject their own route (`createOutbox({route})`); a route to an executor this process does not have runs inline.
 */
import type { TaskName } from "./_shims/contracts.js";
import type { ExecutorKind } from "./runner.js";

export interface RouteContext {
  /** the deployment's EXECUTOR: inline (CI, local), workflow (Render Workflows) or worker (the S6 fallback) */
  configured: ExecutorKind;
  workspaceId: string | null;
  /** the task will replay recorded output (Judge Mode, kill_ai_live): there is nothing to offload */
  replay: boolean;
}

export type ExecutorRoute = (name: TaskName, ctx: RouteContext) => ExecutorKind;

/** S3.3: the only tasks that run outside fs-api, when EXECUTOR says so and they run live. */
export const REMOTE_TASKS: ReadonlySet<TaskName> = new Set<TaskName>([
  "extract",
  "readRateCard",
  "warmCaches",
]);

/** The S3.3 table: REMOTE_TASKS go to the configured remote executor unless they replay; everything else inline. */
export const defaultRoute: ExecutorRoute = (name, ctx) =>
  ctx.configured !== "inline" && !ctx.replay && REMOTE_TASKS.has(name) ? ctx.configured : "inline";
