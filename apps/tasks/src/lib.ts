// Public surface of @fairsplit/tasks for fs-api's dispatcher, tools and tests. Importing this module
// does not register workflow tasks; only ./index.ts does.
export { type ExecutorKind, isTaskName, TASK_NAMES, type TaskName } from "./_shims/contracts.js";
export {
  CRON_SCHEDULE,
  type CronJob,
  type CronResult,
  type CronSink,
  hourSlot,
  NIGHTLY_UTC_HOUR,
  planCronRun,
  runCron,
  WARM_EVERY_HOURS,
} from "./cron.js";
export {
  createInlineExecutor,
  createWorkflowExecutor,
  type ExecutorReceipt,
  type FallbackReceipt,
  INLINE_CONCURRENCY,
  type InlineExecutor,
  runWithFallback,
  Semaphore,
  type TaskExecutor,
  type WorkflowsPort,
} from "./executor.js";
export {
  PermanentTaskError,
  type TaskHandler,
  type TaskHandlers,
  type TaskInvocation,
  TaskNotWiredError,
  type TaskOutcome,
  unwiredHandlers,
  withHandlers,
} from "./handlers.js";
export { InvalidTaskInputError, invokeTask, validateIds } from "./invoke.js";
export {
  chooseExecutor,
  parseExecutorKind,
  TASK_POLICY,
  type TaskLane,
  type TaskPolicy,
  tasksInLane,
} from "./policy.js";
export { PING_TASK, registerWorkflowTasks, taskSlug, WORKFLOW_SERVICE } from "./workflow.js";
