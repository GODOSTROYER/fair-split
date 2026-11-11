import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "../src/ids/uuidv7.js";
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
      // Match isLinkRevoked's Drizzle query: the workspace, kind and jti are all bound parameters.
      return sql.unsafe(
        "explain select id from ledger_entries where workspace_id = $1 and kind = $2 and payload->>'jti' = $3 limit 1",
        [workspaceId, "link.revoked", "hd6-link"],
      );
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("ledger_entries_link_revoked_jti");
  });

  it("uses the revocation index for liveLinksOfLine's workspace-correlated anti-exists lookup", async () => {
    const { workspaceId } = await fixtureWorkspace(t.app.db);
    const lineId = uuidv7();
    const now = new Date();
    const exp = new Date(now.getTime() + 60_000).toISOString();
    await appendLedger(t.app.db, scopeOf(workspaceId), {
      kind: "link.issued",
      payload: { kind: "member", jti: "hd6-issued-link", lineId, exp },
    });
    await appendLedger(t.app.db, scopeOf(workspaceId), {
      kind: "link.revoked",
      payload: { jti: "hd6-issued-link" },
    });
    const plan = await t.owner.sql.begin(async (sql) => {
      await sql`set local enable_seqscan = off`;
      return sql`explain
        select distinct on (i.payload->>'jti') i.payload->>'jti' as jti, i.seq
          from ledger_entries i
         where i.workspace_id = ${workspaceId} and i.kind = 'link.issued'
           and i.payload->>'kind' = 'member'
           and lower(i.payload->>'lineId') = ${lineId.toLowerCase()}
           and (i.payload->>'exp')::timestamptz > ${now.toISOString()}::timestamptz
           and not exists (
             select 1 from ledger_entries r
              where r.workspace_id = i.workspace_id and r.kind = 'link.revoked'
                and r.payload->>'jti' = i.payload->>'jti')
         order by i.payload->>'jti', i.seq`;
    });
    expect(plan.map((row) => row["QUERY PLAN"]).join("\n")).toContain("ledger_entries_link_revoked_jti");
  });
});
