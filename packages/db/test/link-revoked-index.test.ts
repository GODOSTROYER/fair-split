import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendLedger } from "../src/ledger.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

describe("HD6-11a link revocation lookup", () => {
  it("uses the partial jti index rather than scanning every workspace's ledger", async () => {
    const { workspaceId } = await fixtureWorkspace(t.app.db);
    await appendLedger(t.app.db, scopeOf(workspaceId), {
      kind: "link.revoked",
      payload: { jti: "hd6-link" },
    });
    const plan = await t.owner.sql.begin(async (sql) => {
      await sql`set local enable_seqscan = off`;
      return sql`explain select 1 from ledger_entries where kind = 'link.revoked' and payload->>'jti' = 'hd6-link' limit 1`;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("ledger_entries_link_revoked_jti");
  });
});
