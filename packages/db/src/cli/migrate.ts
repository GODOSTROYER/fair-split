/**
 * `pnpm --filter @fairsplit/db migrate` (Render preDeployCommand on fs-api).
 *
 * Runs as the owner: DATABASE_OWNER_URL, or DATABASE_URL off Render (see ./env.ts); on a dev machine the nearest
 * .env upwards is loaded first. With FS_APP_DB_PASSWORD set, fs_app gets LOGIN and that password (sent as a
 * SCRAM verifier, never in clear), and the app should then connect with fs_app's own URL; if the owner may not
 * manage roles, the deploy fails rather than silently keeping the weaker assumed-role mode.
 * Optional FS_RUN_SEQ_FLOOR raises the global run sequence for this environment (never lowers it).
 * Never prints credentials: only the database name and modes are logged.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { ensureRunSeqFloor, runMigrations } from "../migrate.js";
import { enableAppLogin } from "../roles.js";
import { databaseName, resolveMigrateEnv } from "./env.js";

function loadDotEnv(): void {
  if (process.env.DATABASE_OWNER_URL || process.env.DATABASE_URL) return;
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
  const env = resolveMigrateEnv(process.env);
  const db = databaseName(env.ownerUrl);
  await runMigrations(env.ownerUrl);
  console.log(`migrations applied to ${db} (as the owner, from ${env.source})`);
  if (env.appPassword) {
    await enableAppLogin(env.ownerUrl, env.appPassword);
    console.log("fs_app: login enabled; point every service's DATABASE_URL at fs_app's own URL");
  } else {
    console.log(
      "fs_app: no FS_APP_DB_PASSWORD, so services assume fs_app from the owner's login (stops bugs only)",
    );
  }
  const floor = process.env.FS_RUN_SEQ_FLOOR;
  if (floor) {
    const next = await ensureRunSeqFloor(env.ownerUrl, Number(floor));
    console.log(`fs_run_seq: next run is r${next}`);
  }
}

main().catch((e: unknown) => {
  // the driver's message never includes the password; the URL itself is never printed
  console.error(`migrate failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
