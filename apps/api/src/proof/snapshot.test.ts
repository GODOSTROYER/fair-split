// A Proof is read from one consistent snapshot: whatever commits while it is being assembled (a verified webhook
// applying its ledger entry, item status and line state together) is wholly outside it.
import { appendLedger, systemScope } from "@fairsplit/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readWorkspaceLedger } from "../ledger/chain.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { readSnapshot } from "./bundle.js";

let t: TestApp;
let ws: string;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
  ws = (await t.fixture()).workspaceId;
  await appendLedger(t.deps.db, systemScope(ws), { kind: "test.genesis", payload: { n: 0 } });
});
afterAll(async () => t.close());

describe("readSnapshot", () => {
  it("is REPEATABLE READ and read-only", async () => {
    const rows = await readSnapshot(t.deps.db, (tx) =>
      tx.execute(
        sql`select current_setting('transaction_isolation') as iso, current_setting('transaction_read_only') as ro`,
      ),
    );
    expect([...rows][0]).toEqual({ iso: "repeatable read", ro: "on" });
  });

  it("does not see an entry another transaction commits while it reads", async () => {
    await readSnapshot(t.deps.db, async (tx) => {
      const before = await readWorkspaceLedger(tx, ws);
      await appendLedger(t.deps.db, systemScope(ws), { kind: "test.concurrent", payload: { n: 1 } });
      const after = await readWorkspaceLedger(tx, ws);
      expect(after).toEqual(before);
    });
    const now = await readWorkspaceLedger(t.deps.db, ws);
    expect(now.at(-1)?.kind).toBe("test.concurrent");
  });
});
