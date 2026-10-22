// fs-tasks: the Render Workflows entry (render.yaml startCommand `node apps/tasks/dist/index.js`).
// Importing this module runs the boot checks, then registers the Workflows-lane tasks synchronously;
// when Render sets RENDER_SDK_SOCKET_PATH the SDK starts its task server on the next tick and either
// registers the tasks (RENDER_SDK_MODE=register) or runs the one requested.
import { contractsDrift } from "./_shims/contracts.js";
import { useAppDatabaseUrl } from "./db-env.js";
import { assertBootEnv } from "./kill.js";
import { createLogger } from "./log.js";
import { WORKFLOW_TASK_NAMES } from "./policy.js";
import { loadRuntime } from "./wiring.js";
import { registerWorkflowTasks } from "./workflow.js";

// S3.13: refuse to boot outside the sandbox, or with dev mocks on Render. Then S3.4: connect as
// fs_app only (render.yaml never gives fs-tasks the owner's credentials; a half-configured database
// environment refuses too). Throwing here exits before any task is registered or run.
assertBootEnv();
const dbUrlSource = useAppDatabaseUrl();

const logger = createLogger({ entry: "workflow" });
logger.debug({ tasks: WORKFLOW_TASK_NAMES, dbUrlSource }, "fs-tasks boot");
const drift = contractsDrift();
if (drift.length > 0) logger.error({ drift }, "TaskName shim differs from @fairsplit/contracts");

export const workflow = registerWorkflowTasks({
  resolveRuntime: () => loadRuntime(logger),
  logger,
});
