/**
 * Which executor runs which task (S3.3; register deviation 3). Money, webhook, engine and agent tasks always run
 * inline in fs-api: one warm OAuth cache (no per-instance token calls against the 40/min budget) and money steps
 * under a second, and in Judge Mode the AI output replays anyway. Only three tasks may leave the process, and only
 * when EXECUTOR names a remote executor and the task is live:
 *
 *   extract (the live slip read, which shows its Render run id), readRateCard, warmCaches
 *
 * The dispatcher asks the route for every row it claims and records the answer in `task_outbox.executor`. Apps may
 * inject their own route (`createOutbox({route})`); a route to an executor this process does not have runs inline.
 * Whether a task replays comes from `replayFromDatabase` unless the app injects its own predicate.
 */
import { type DbOrTx, envKills, schema as s } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
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

/** What the replay predicate is asked about: a claimed (or about to be claimed) row. */
export interface ReplayQuestion {
  id: string;
  name: TaskName;
  workspaceId: string | null;
}

/**
 * The default replay predicate (used whenever EXECUTOR names a remote executor and the app injects none): a task
 * replays recorded output, so it has nothing to offload and stays inline, when
 *   - its workspace is a judge workspace: Judge Mode always replays Claude's output (C-06, S3.3 "Judge Mode replays
 *     the AI output"); or
 *   - kill_ai_live is on for its workspace, or forced everywhere by FS_KILL (system tasks have only the latter).
 * Read fresh from the database on every call, never cached (S3.11). An unknown workspace is not a replay.
 */
export function replayFromDatabase(
  db: DbOrTx,
  opts: { env?: Record<string, string | undefined> } = {},
): (task: ReplayQuestion) => Promise<boolean> {
  return async (task) => {
    if (envKills(opts.env ?? process.env).has("kill_ai_live")) return true;
    if (task.workspaceId === null) return false;
    const [row] = await db
      .select({ kind: s.workspaces.kind, killed: s.systemFlags.on })
      .from(s.workspaces)
      .leftJoin(
        s.systemFlags,
        and(eq(s.systemFlags.workspaceId, s.workspaces.id), eq(s.systemFlags.flag, "kill_ai_live")),
      )
      .where(eq(s.workspaces.id, task.workspaceId));
    return row !== undefined && (row.kind === "judge" || row.killed === true);
  };
}
