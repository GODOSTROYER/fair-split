/**
 * Test helpers for packages that need a real Postgres (db, outbox, api, tasks).
 *   import { openTestDb, fixtureWorkspace } from "@fairsplit/db/testing";
 * Requires the global setup in ./global-setup.ts to have provided `fsPg`.
 */
import { inject } from "vitest";
import { createDb, type Database } from "../client.js";
import { createTestDatabase } from "./template.js";

export { startTestCluster, type TestCluster } from "./cluster.js";
export {
  FIXTURE_RATIFIED_AT,
  type FixtureOptions,
  type FixtureWorkspace,
  fixtureWorkspace,
} from "./fixtures.js";
export { createTestDatabase, migrationsHash, prepareTemplate, withDatabase } from "./template.js";

export interface TestDb {
  url: string;
  /** connected as the owner (the role migrations ran as) */
  owner: Database;
  /** connected as the restricted application role fs_app */
  app: Database;
  /** closes both pools and drops the database */
  close(): Promise<void>;
}

export async function openTestDb(opts: { max?: number } = {}): Promise<TestDb> {
  const { adminUrl, template, suite } = inject("fsPg");
  const t = await createTestDatabase(adminUrl, template, suite);
  const owner = createDb(t.url, { max: opts.max ?? 6, applicationName: "fs-test-owner" });
  const app = createDb(t.url, { max: opts.max ?? 6, role: "fs_app", applicationName: "fs-test-app" });
  return {
    url: t.url,
    owner,
    app,
    close: async () => {
      await Promise.allSettled([app.close(), owner.close()]);
      await t.drop();
    },
  };
}
