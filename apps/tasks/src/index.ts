// fs-tasks: the Render Workflows entry (render.yaml startCommand `node apps/tasks/dist/index.js`).
// Importing this module registers every TaskName synchronously; when Render sets
// RENDER_SDK_SOCKET_PATH the SDK starts its task server on the next tick and either registers the
// tasks (RENDER_SDK_MODE=register) or runs the one requested.
import { createLogger } from "./log.js";
import { loadHandlers } from "./wiring.js";
import { registerWorkflowTasks } from "./workflow.js";

export const workflow = registerWorkflowTasks({
  resolveHandlers: loadHandlers,
  logger: createLogger({ entry: "workflow" }),
});
