/**
 * SECURITY (automated review, MEDIUM, migrations/0003): fs_workspaces_guard froze a workspace's id, kind and
 * created_at but not `expires_at`, and fs_app may call fs_purge_workspace(), which purges any judge workspace whose
 * expires_at has passed. So the app role could set a live judge session's expiry to the past (or clear it and set
 * it again) and purge the session, taking its run_events, ledger_entries and agent_sessions with it.
 *
 * Now (migrations/0009), for every role: once set, `expires_at` never moves earlier and never goes back to NULL, and
 * it is never set to an instant already past. A workspace therefore lives at least until the expiry it was claimed
 * with, and nothing the app can write brings its purge forward. Claiming (NULL → future) and extending stay open.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { appendEvent } from "../src/events.js";
import { appendLedger } from "../src/ledger.js";
import { ledgerEntries, runEvents, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf, treasurer } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

const HOUR = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * HOUR);

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

async function expiryOf(workspaceId: string): Promise<Date | null> {
  const [row] = await t.owner.db
    .select({ expiresAt: workspaces.expiresAt })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  if (!row) throw new Error(`workspace ${workspaceId} is gone`);
  return row.expiresAt;
}

async function historyOf(workspaceId: string): Promise<[number, number]> {
  const n = async (table: typeof runEvents | typeof ledgerEntries) =>
    (
      await t.owner.db
        .select({ n: sql<number>`count(*)::int` })
        .from(table)
        .where(eq(table.workspaceId, workspaceId))
    )[0]?.n ?? 0;
  return [await n(runEvents), await n(ledgerEntries)];
}

const setExpiry = (db: Db, workspaceId: string, expiresAt: Date | null) =>
  db.update(workspaces).set({ expiresAt }).where(eq(workspaces.id, workspaceId));

describe("inv.i5.expiry-forward-only: a workspace's expiry only moves later", () => {
  it("inv.i5.expiry-forward-only: neither fs_app nor the owner can pull a live judge session's expiry earlier, clear it, or set it in the past", async () => {
    const claimed = inHours(20);
    const ws = await fixtureWorkspace(t.app.db, { kind: "judge", expiresAt: claimed });
    for (const role of [t.app, t.owner]) {
      for (const shorter of [new Date(Date.now() - 60_000), inHours(1), null]) {
        const e = await dbError(() => setExpiry(role.db, ws.workspaceId, shorter));
        expect(e.code).toBe("FROZEN_COLUMN");
        expect(e.subject).toBe("workspaces.expires_at");
        expect(e.httpStatus).toBe(409);
      }
      // raw SQL is refused the same way
      const raw = await dbError(
        () =>
          role.sql`update workspaces set expires_at = now() - interval '1 second' where id = ${ws.workspaceId}`,
      );
      expect(raw.subject).toBe("workspaces.expires_at");
    }
    expect(await expiryOf(ws.workspaceId)).toEqual(claimed);
  });

  it("inv.i5.expiry-forward-only: so the app cannot purge a session early: fs_purge_workspace refuses and the history stays", async () => {
    const ws = await fixtureWorkspace(t.app.db, { kind: "judge", expiresAt: inHours(23), withRun: true });
    await withHistory(ws.workspaceId);
    // the attack: expire the session, then purge it, in one transaction of the app role
    const attack = await dbError(() =>
      t.app.db.transaction(async (tx) => {
        await tx
          .update(workspaces)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(workspaces.id, ws.workspaceId));
        await tx.execute(sql`select fs_purge_workspace(${ws.workspaceId})`);
      }),
    );
    expect(attack).toMatchObject({ code: "FROZEN_COLUMN", subject: "workspaces.expires_at" });
    const refused = await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`);
    expect(refused.code).toBe("PURGE_REFUSED");
    expect(await historyOf(ws.workspaceId)).toEqual([1, 1]);
  });

  it("a pooled workspace can be claimed (NULL → future) and extended, never set in the past, and never cleared once set", async () => {
    const pooled = await fixtureWorkspace(t.app.db, { kind: "judge" });
    const backdated = await dbError(() =>
      setExpiry(t.app.db, pooled.workspaceId, new Date(Date.now() - 1000)),
    );
    expect(backdated.subject).toBe("workspaces.expires_at");
    expect(await expiryOf(pooled.workspaceId)).toBeNull();

    const claim = inHours(24);
    await t.app.db
      .update(workspaces)
      .set({ claimedAt: new Date(), expiresAt: claim })
      .where(eq(workspaces.id, pooled.workspaceId));
    expect(await expiryOf(pooled.workspaceId)).toEqual(claim);
    // writing the same instant again is not a change; a later one extends the session
    await setExpiry(t.app.db, pooled.workspaceId, claim);
    const extended = inHours(30);
    await setExpiry(t.app.db, pooled.workspaceId, extended);
    expect(await expiryOf(pooled.workspaceId)).toEqual(extended);
    // other columns stay writable
    await t.app.db.update(workspaces).set({ name: "judge 7" }).where(eq(workspaces.id, pooled.workspaceId));
    for (const shorter of [claim, null]) {
      const e = await dbError(() => setExpiry(t.app.db, pooled.workspaceId, shorter));
      expect(e.subject).toBe("workspaces.expires_at");
    }
  });

  it("a workspace whose expiry has passed is still purged, history and all", async () => {
    const gone = await fixtureWorkspace(t.app.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
      withRun: true,
    });
    await withHistory(gone.workspaceId);
    const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${gone.workspaceId}) as ok`;
    expect(res?.ok).toBe(true);
    expect(await historyOf(gone.workspaceId)).toEqual([0, 0]);
  });
});
