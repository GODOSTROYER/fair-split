/**
 * The purge path cannot be forged (review blocker). 0002 let every guard step aside while the custom setting
 * `fs.purge` was 'on', and any role can set a custom setting with set_config(). The bypass is now an owner-only
 * purge ticket keyed by (workspace, transaction), written only by fs_purge_workspace().
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendEvent } from "../src/events.js";
import { appendLedger } from "../src/ledger.js";
import { ledgerEntries, rateCards, rateRules, runEvents, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf, sqlState, treasurer } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function withHistory(workspaceId: string) {
  await appendEvent(t.app.db, {
    workspaceId,
    type: "presence",
    actor: treasurer,
    provenance: "live",
    payload: { view: "split" },
  });
  await appendLedger(t.app.db, scopeOf(workspaceId), { kind: "ratification", payload: { by: "secretary" } });
}

async function count(table: typeof runEvents | typeof ledgerEntries, workspaceId: string): Promise<number> {
  const [r] = await t.owner.db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.workspaceId, workspaceId));
  return r?.n ?? 0;
}

describe("inv.i2.no-purge-bypass: set_config cannot open the purge path", () => {
  it("inv.i2.no-purge-bypass: set_config('fs.purge') then UPDATE of a ratified card still raises FS409", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    // transaction-local, as the review's proof did …
    const local = await dbError(() =>
      t.app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.update(rateCards).set({ code: "BR 2026-99" }).where(eq(rateCards.id, ws.rateCardId));
      }),
    );
    expect(local.code).toBe("RATE_CARD_RATIFIED");
    expect(local.subject).toBe(ws.rateCardSha256);
    // … and session-wide, on a connection of its own
    const reserved = await t.app.sql.reserve();
    try {
      await reserved`select set_config('fs.purge', 'on', false)`;
      const session = await dbError(
        () => reserved`update rate_cards set code = 'BR 2026-99' where id = ${ws.rateCardId}`,
      );
      expect(session.code).toBe("RATE_CARD_RATIFIED");
    } finally {
      reserved.release();
    }
  });

  it("inv.i2.no-purge-bypass: the setting does not open a ratified card's rules either", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    const e = await dbError(() =>
      t.app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.delete(rateRules).where(eq(rateRules.rateCardId, ws.rateCardId));
      }),
    );
    expect(e.code).toBe("RATE_CARD_RATIFIED");
  });

  it("inv.i2.no-purge-bypass: nor does it let the owner delete a ratified card", async () => {
    const ws = await fixtureWorkspace(t.owner.db);
    const e = await dbError(() =>
      t.owner.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.delete(rateCards).where(eq(rateCards.id, ws.rateCardId));
      }),
    );
    expect(e.code).toBe("RATE_CARD_RATIFIED");
  });
});

describe("append-only history cannot be cascaded away", () => {
  it("the app cannot delete a showcase workspace, with or without the old setting", async () => {
    const ws = await fixtureWorkspace(t.app.db, { kind: "showcase" });
    await withHistory(ws.workspaceId);
    const state = await sqlState(() =>
      t.app.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.delete(workspaces).where(eq(workspaces.id, ws.workspaceId));
      }),
    );
    expect(state).toBe("42501"); // fs_app has no DELETE on workspaces any more
    expect(await count(runEvents, ws.workspaceId)).toBe(1);
    expect(await count(ledgerEntries, ws.workspaceId)).toBe(1);
  });

  it("even the owner deletes a workspace only through fs_purge_workspace()", async () => {
    const ws = await fixtureWorkspace(t.owner.db, { kind: "showcase" });
    await withHistory(ws.workspaceId);
    const e = await dbError(() =>
      t.owner.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.delete(workspaces).where(eq(workspaces.id, ws.workspaceId));
      }),
    );
    expect(e.code).toBe("PURGE_REFUSED");
    expect(await count(runEvents, ws.workspaceId)).toBe(1);
  });

  it("append-only rows refuse DELETE for the owner even with the old setting on", async () => {
    const ws = await fixtureWorkspace(t.owner.db, { kind: "showcase" });
    await withHistory(ws.workspaceId);
    const e = await dbError(() =>
      t.owner.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('fs.purge', 'on', true)`);
        await tx.delete(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId));
      }),
    );
    expect(e.code).toBe("APPEND_ONLY");
  });

  it("a showcase cannot be dressed up as an expired judge workspace and purged", async () => {
    const ws = await fixtureWorkspace(t.app.db, { kind: "showcase" });
    await withHistory(ws.workspaceId);
    const e = await dbError(() =>
      t.app.db
        .update(workspaces)
        .set({ kind: "judge", expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(workspaces.id, ws.workspaceId)),
    );
    expect(e.code).toBe("FROZEN_COLUMN");
    expect(e.subject).toBe("workspaces.kind");
    const refused = await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`);
    expect(refused.code).toBe("PURGE_REFUSED");
    expect(await count(ledgerEntries, ws.workspaceId)).toBe(1);
  });

  it("fs_app can neither read nor write purge tickets, nor call the ticket check", async () => {
    const ws = await fixtureWorkspace(t.owner.db, { kind: "showcase" });
    expect(await sqlState(() => t.app.sql`select * from fs_private.purge_tickets`)).toBe("42501");
    expect(
      await sqlState(
        () =>
          t.app
            .sql`insert into fs_private.purge_tickets (workspace_id, txid) values (${ws.workspaceId}, txid_current())`,
      ),
    ).toBe("42501");
    expect(await sqlState(() => t.app.sql`select fs_purging(${ws.workspaceId})`)).toBe("42501");
  });

  it("a ticket opens only its own transaction: one left behind by another transaction opens nothing", async () => {
    const ws = await fixtureWorkspace(t.owner.db, { kind: "showcase" });
    await withHistory(ws.workspaceId);
    // the owner plants a ticket in one transaction and commits it …
    await t.owner
      .sql`insert into fs_private.purge_tickets (workspace_id, txid) values (${ws.workspaceId}, txid_current())`;
    // … it is useless to every later transaction
    const e = await dbError(() =>
      t.owner.db.delete(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId)),
    );
    expect(e.code).toBe("APPEND_ONLY");
    const e2 = await dbError(() =>
      t.owner.db.update(rateCards).set({ code: "BR 2026-99" }).where(eq(rateCards.id, ws.rateCardId)),
    );
    expect(e2.code).toBe("RATE_CARD_RATIFIED");
  });

  it("fs_purge_workspace still purges an expired judge workspace and leaves no ticket behind", async () => {
    const gone = await fixtureWorkspace(t.owner.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
      withRun: true,
    });
    await withHistory(gone.workspaceId);
    const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${gone.workspaceId}) as ok`;
    expect(res?.ok).toBe(true);
    expect(await count(runEvents, gone.workspaceId)).toBe(0);
    expect(await count(ledgerEntries, gone.workspaceId)).toBe(0);
    const [left] = await t.owner.sql<{ n: number }[]>`
      select count(*)::int as n from fs_private.purge_tickets where workspace_id = ${gone.workspaceId}`;
    expect(left?.n).toBe(0);
  });
});
