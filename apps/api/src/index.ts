// fs-api entry (render.yaml: `node apps/api/dist/index.js`). A boot refusal prints the problems (names only,
// never values) and exits 1, so Render shows a failed deploy instead of a half-configured server.
import { BootRefusal } from "./env.js";
import { createLogger } from "./middleware/logger.js";
import { handleSignals, startServer } from "./server.js";

const logger = createLogger({ level: "info" });

startServer()
  .then((running) => handleSignals(running, running.deps.logger))
  .catch((err: unknown) => {
    if (err instanceof BootRefusal) {
      logger.fatal({ problems: err.problems }, "fs-api refuses to boot");
    } else {
      logger.fatal({ err }, "fs-api failed to start");
    }
    process.exit(1);
  });
