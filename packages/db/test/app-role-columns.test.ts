/**
 * Security audit T1, finding S2: the boot check (S3.4, `assertAppRole`) must refuse a connection that could rewrite
 * history in ANY way the grants allow. `has_table_privilege(…, 'UPDATE')` answers only for table-level grants, so a
 * column-level grant (`GRANT UPDATE (payload) ON run_events TO fs_app`, one stray migration line) was invisible to
 * it: the app booted "append-only" while the role could UPDATE the column, and only the trigger stood in the way.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppRoleError, assertAppRole, HISTORY_TABLES, inspectAppRole } from "../src/roles.js";
import { openTestDb, type TestDb } from "../src/testing/index.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe("the boot check sees column-level grants on history tables", () => {
  for (const table of HISTORY_TABLES) {
    it(`refuses fs_app holding UPDATE on one column of ${table}`, async () => {
      await t.owner.sql.unsafe(`grant update (workspace_id) on ${table} to fs_app`);
      try {
        const report = await inspectAppRole(t.app.db);
        expect(report.writableHistory).toContain(`${table}:UPDATE`);
        await expect(assertAppRole(t.app.db)).rejects.toBeInstanceOf(AppRoleError);
      } finally {
        await t.owner.sql.unsafe(`revoke update (workspace_id) on ${table} from fs_app`);
      }
      await expect(assertAppRole(t.app.db)).resolves.toMatchObject({ writableHistory: [] });
    });
  }
});
