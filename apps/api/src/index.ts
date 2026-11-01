// fs-api entry (render.yaml: `node apps/api/dist/index.js`). A boot refusal prints the problems (names only,
// never values) and exits 1, so Render shows a failed deploy instead of a half-configured server.
//
// First step, before anything reads DATABASE_URL (ADR-0005): on Render fs-api gets only the owner's
// DATABASE_OWNER_URL and FS_APP_DB_PASSWORD, so `useAppDatabaseUrl` builds fs_app's DATABASE_URL from them and
// deletes both from process.env. Locally a plain DATABASE_URL is left as it is.
import { DbEnvError, useAppDatabaseUrl } from "@fairsplit/db";
import { BootRefusal } from "./env.js";
import { createLogger } from "./middleware/logger.js";
import { handleSignals, startServer } from "./server.js";

const logger = createLogger({ level: "info" });

/** fs_app's DATABASE_URL into process.env; a half-set database environment is a boot refusal, by name. */
function useAppRole(): void {
  try {
    const source = useAppDatabaseUrl(process.env);
    if (source === "from-owner") logger.info("DATABASE_URL built for fs_app from DATABASE_OWNER_URL");
  } catch (err) {
    if (err instanceof DbEnvError) throw new BootRefusal([err.message]);
    throw err;
  }
}

Promise.resolve()
  .then(useAppRole)
  .then(() => startServer())
  .then((running) => handleSignals(running, running.deps.logger))
  .catch((err: unknown) => {
    if (err instanceof BootRefusal) {
      logger.fatal({ problems: err.problems }, "fs-api refuses to boot");
    } else {
      logger.fatal({ err }, "fs-api failed to start");
    }
    process.exit(1);
  });
