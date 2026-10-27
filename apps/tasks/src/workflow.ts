// Registers the Workflows-lane tasks with Render Workflows as thin wrappers around injected handlers.
// Which tasks run there is decided by TASK_POLICY (approved S3.3: extract, readRateCard, warmCaches);
// every other TaskName runs inline in fs-api and is deliberately NOT registered, so a stray
// `startTask` for it fails with "not found" and the dispatcher falls back inline.
// Registration is synchronous at import time (the SDK auto-starts its task server on the next tick
// once RENDER_SDK_SOCKET_PATH is set); the runtime (handlers, outbox port, flag source) is resolved
// lazily inside the first run, and the entry's preflight (the S3.4 role check) runs inside every one.
import { task as sdkTask, type TaskContext, type TaskDefinition } from "@renderinc/sdk/workflows";
import type { TaskName } from "./_shims/contracts.js";
import { type DbProbeResult, probeDatabase } from "./db-probe.js";
import type { TaskOutcome } from "./handlers.js";
import { invokeTask, type TaskRuntime } from "./invoke.js";
import { type KillFlag, parseFsKill } from "./kill.js";
import type { Logger } from "./log.js";
import { NO_RENDER_RETRY, TASK_POLICY, WORKFLOW_TASK_NAMES } from "./policy.js";

/** The workflow service name in render.yaml; task slugs are `fs-tasks/<name>`. */
export const WORKFLOW_SERVICE = "fs-tasks";

/** Side-effect-free diagnostic used by spike S6 to measure startTask latency. Not a TaskName. */
export const PING_TASK = "opsPing";
/** Spike S6 database probe (private-network reach, CREATE ROLE, app-role privileges). Not a TaskName. */
export const DB_PING_TASK = "opsDbPing";

export type RegisterFn = typeof sdkTask;
export type WorkflowTask = TaskDefinition<string[], TaskOutcome>;

export interface PingResult {
  readonly pong: true;
  readonly at: string;
  readonly taskRunId?: string | undefined;
  readonly echo?: string | undefined;
  /**
   * The kill flags fs-tasks' own `FS_KILL` forces on. FS_KILL must equal fs-api's (render.yaml);
   * this lets an operator or spike S6 see this service's value without dashboard access.
   */
  readonly fsKill: readonly KillFlag[];
}

export interface RegisterOptions {
  /** Resolved once, on the first run in this process; retried if it fails. */
  readonly resolveRuntime: () => TaskRuntime | Promise<TaskRuntime>;
  readonly logger: Logger;
  /** Defaults to the SDK's `task`; tests inject a recorder. */
  readonly register?: RegisterFn;
  /** Defaults to probing `DATABASE_URL`; tests inject a fake. */
  readonly probeDb?: () => Promise<DbProbeResult>;
  /**
   * Runs before every Workflows-lane task, inside the wrapper (InvokeContext.preflight). The entry
   * passes the S3.4 role check (`appRoleGate`); the diagnostics never run it.
   */
  readonly preflight?: () => Promise<void>;
  /** Defaults to `process.env`; read on every ping, never cached. */
  readonly env?: NodeJS.ProcessEnv;
}

export interface RegisteredWorkflow {
  /** Only the Workflows-lane tasks (WORKFLOW_TASK_NAMES). */
  readonly tasks: Readonly<Partial<Record<TaskName, WorkflowTask>>>;
  readonly ping: TaskDefinition<[string?], PingResult>;
  readonly dbPing: TaskDefinition<[], DbProbeResult>;
}

export function taskSlug(name: string, workflowSlug: string = WORKFLOW_SERVICE): string {
  return `${workflowSlug}/${name}`;
}

export function registerWorkflowTasks(options: RegisterOptions): RegisteredWorkflow {
  const register = options.register ?? sdkTask;
  const env = options.env ?? process.env;
  let runtime: Promise<TaskRuntime> | undefined;
  const getRuntime = (): Promise<TaskRuntime> => {
    runtime ??= Promise.resolve()
      .then(options.resolveRuntime)
      .catch((err: unknown) => {
        runtime = undefined;
        throw err;
      });
    return runtime;
  };

  const tasks: Partial<Record<TaskName, WorkflowTask>> = {};
  for (const name of WORKFLOW_TASK_NAMES) {
    const policy = TASK_POLICY[name];
    tasks[name] = register(
      { name, timeoutSeconds: policy.timeoutSeconds, retry: policy.retry },
      async (ctx: TaskContext, ...ids: string[]): Promise<TaskOutcome> =>
        invokeTask(await getRuntime(), name, ids, {
          executor: "workflow",
          taskRunId: ctx.metadata.taskRunId,
          logger: options.logger,
          preflight: options.preflight,
        }),
    );
  }

  const ping = register(
    { name: PING_TASK, timeoutSeconds: 30, retry: NO_RENDER_RETRY },
    (ctx: TaskContext, echo?: string): PingResult => ({
      pong: true,
      at: new Date().toISOString(),
      taskRunId: ctx.metadata.taskRunId,
      echo: typeof echo === "string" ? echo.slice(0, 64) : undefined,
      fsKill: [...parseFsKill(env.FS_KILL)].sort(),
    }),
  );

  const probeDb = options.probeDb ?? (() => probeDatabase(env.DATABASE_URL));
  const dbPing = register(
    { name: DB_PING_TASK, timeoutSeconds: 60, retry: NO_RENDER_RETRY },
    async (): Promise<DbProbeResult> => probeDb(),
  );

  return { tasks: Object.freeze(tasks), ping, dbPing };
}
