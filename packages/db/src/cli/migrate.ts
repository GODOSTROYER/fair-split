/**
 * `pnpm --filter @fairsplit/db migrate` (Render preDeployCommand).
 * Reads DATABASE_URL from the environment, or from the nearest .env upwards when run on a dev machine.
 * Optional FS_RUN_SEQ_FLOOR raises the global run sequence for this environment (never lowers it).
 * Never prints credentials: only the database name is logged.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureRunSeqFloor, runMigrations } from "../migrate.js";

function loadDotEnv(): void {
  if (process.env.DATABASE_URL) return;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const dbName = new URL(url).pathname.replace(/^\//, "") || "(default)";
  await runMigrations(url);
  console.log(`migrations applied to ${dbName}`);
  const floor = process.env.FS_RUN_SEQ_FLOOR;
  if (floor) {
    const next = await ensureRunSeqFloor(url, Number(floor));
    console.log(`fs_run_seq: next run is r${next}`);
  }
}

main().catch((e: unknown) => {
  // the driver's message never includes the password; the URL itself is never printed
  console.error(`migrate failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
