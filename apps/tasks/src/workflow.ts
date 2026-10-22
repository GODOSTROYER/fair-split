// Registers every TaskName with Render Workflows as a thin wrapper around an injected handler.
// Registration is synchronous at import time (the SDK auto-starts its task server on the next tick
// once RENDER_SDK_SOCKET_PATH is set); handlers are resolved lazily inside each run.
import { task as sdkTask, type TaskContext, type TaskDefinition } from "@renderinc/sdk/workflows";
import { TASK_NAMES, type TaskName } from "./_shims/contracts.js";
import type { TaskHandlers, TaskOutcome } from "./handlers.js";
import { invokeTask } from "./invoke.js";
import type { Logger } from "./log.js";
import { TASK_POLICY } from "./policy.js";

/** The workflow service name in render.yaml; task slugs are `fs-tasks/<name>`. */
export const WORKFLOW_SERVICE = "fs-tasks";

/** A side-effect-free diagnostic task used by spike S6 to measure startTask latency. Not a TaskName. */
export const PING_TASK = "opsPing";

export type RegisterFn = typeof sdkTask;
export type WorkflowTask = TaskDefinition<string[], TaskOutcome>;

export interface PingResult {
  readonly pong: true;
  readonly at: string;
  readonly taskRunId?: string | undefined;
  readonly echo?: string | undefined;
}

export interface RegisterOptions {
  /** Resolved once, on the first run in this process. */
  readonly resolveHandlers: () => TaskHandlers | Promise<TaskHandlers>;
  readonly logger: Logger;
  /** Defaults to the SDK's `task`; tests inject a recorder. */
  readonly register?: RegisterFn;
}

export interface RegisteredWorkflow {
  readonly tasks: Readonly<Record<TaskName, WorkflowTask>>;
  readonly ping: TaskDefinition<[string?], PingResult>;
}

export function taskSlug(name: string, workflowSlug: string = WORKFLOW_SERVICE): string {
  return `${workflowSlug}/${name}`;
}

export function registerWorkflowTasks(options: RegisterOptions): RegisteredWorkflow {
  const register = options.register ?? sdkTask;
  let handlers: Promise<TaskHandlers> | undefined;
  const getHandlers = (): Promise<TaskHandlers> => {
    handlers ??= Promise.resolve()
      .then(options.resolveHandlers)
      .catch((err: unknown) => {
        handlers = undefined;
        throw err;
      });
    return handlers;
  };

  const tasks = {} as Record<TaskName, WorkflowTask>;
  for (const name of TASK_NAMES) {
    const policy = TASK_POLICY[name];
    tasks[name] = register(
      { name, timeoutSeconds: policy.timeoutSeconds, retry: policy.retry },
      async (ctx: TaskContext, ...ids: string[]): Promise<TaskOutcome> =>
        invokeTask(await getHandlers(), name, ids, {
          executor: "workflow",
          taskRunId: ctx.metadata.taskRunId,
          logger: options.logger,
        }),
    );
  }

  const ping = register(
    { name: PING_TASK, timeoutSeconds: 30, retry: { maxRetries: 0, waitDurationMs: 1_000 } },
    (ctx: TaskContext, echo?: string): PingResult => ({
      pong: true,
      at: new Date().toISOString(),
      taskRunId: ctx.metadata.taskRunId,
      echo: typeof echo === "string" ? echo.slice(0, 64) : undefined,
    }),
  );

  return { tasks: Object.freeze(tasks), ping };
}
