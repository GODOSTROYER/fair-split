// fs-tasks: the Render Workflows entry (render.yaml startCommand `node apps/tasks/dist/index.js`).
// Importing this module validates the environment, then registers every TaskName synchronously;
// when Render sets RENDER_SDK_SOCKET_PATH the SDK starts its task server on the next tick and either
// registers the tasks (RENDER_SDK_MODE=register) or runs the one requested.
import { contractsDrift } from "./_shims/contracts.js";
import { assertSandbox } from "./kill.js";
import { createLogger } from "./log.js";
import { loadRuntime } from "./wiring.js";
import { registerWorkflowTasks } from "./workflow.js";

// S3.13: fs-tasks holds PayPal credentials, so it refuses to boot outside the sandbox. Throwing
// here exits the process before any task is registered or run.
assertSandbox();

const logger = createLogger({ entry: "workflow" });
const drift = contractsDrift();
if (drift.length > 0) logger.error({ drift }, "TaskName shim differs from @fairsplit/contracts");

export const workflow = registerWorkflowTasks({
  resolveRuntime: () => loadRuntime(logger),
  logger,
});
