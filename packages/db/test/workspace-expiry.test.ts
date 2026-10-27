/**
 * SECURITY (automated review, MEDIUM, migrations/0003): fs_workspaces_guard froze a workspace's id, kind and
 * created_at but not `expires_at`, and fs_app may call fs_purge_workspace(), which purges any judge workspace whose
 * expires_at has passed. So the app role could set a live judge session's expiry to the past (or clear it and set
 * it again) and purge the session, taking its run_events, ledger_entries and agent_sessions with it.
 *
 * Now (migrations/0009), for every role: once set, `expires_at` never moves earlier and never goes back to NULL, and
 * it is never set to an instant already past. A workspace therefore lives at least until the expiry it was claimed
 * with, and nothing the app can write brings its purge forward. Claiming (NULL → future) and extending stay open.
 *
 * SECURITY (automated commit review, 2 MEDIUM, migrations/0009) closed the two gaps that rule left (migrations/0013):
 *   1. the boundary: an expiry equal to now() passed "not already past" and was purgeable in the same transaction.
 *      Every change must now leave the expiry more than a minute ahead of the database's wall clock, and the purge
 *      takes only an expiry strictly before its now();
 *   2. the first expiry had no minimum: NULL → a few seconds ahead claimed a pooled workspace that could be purged
 *      moments later. A claim (NULL → value) must now last the judge session's 24 h, by the database clock;
 *      `claimJudgeWorkspace` writes exactly that.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/client.js";
import { appendEvent } from "../src/events.js";
import { claimJudgeWorkspace, JUDGE_SESSION_TTL_MS } from "../src/judge-pool.js";
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

    const claimed = await claimJudgeWorkspace(t.app.db, { workspaceId: pooled.workspaceId });
    const claim = claimed?.expiresAt ?? new Date(0);
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

describe("inv.i5.expiry-claim-ttl: a claim lasts the judge session, and no expiry sits on the purge boundary", () => {
  /** the database's own clock, so the comparisons below do not depend on the app's */
  async function dbNow(): Promise<number> {
    const [row] = await t.owner.sql<
      { ms: string }[]
    >`select (extract(epoch from now()) * 1000)::bigint::text as ms`;
    return Number(row?.ms ?? 0);
  }
  const rawExpiry = (db: TestDb["app"], workspaceId: string, expr: string) =>
    db.sql.unsafe(`update workspaces set expires_at = ${expr} where id = $1`, [workspaceId]);

  it("inv.i5.expiry-claim-ttl: fs_app and the owner cannot give a pooled workspace a first expiry shorter than 24 h", async () => {
    for (const role of [t.app, t.owner]) {
      const pooled = await fixtureWorkspace(role.db, { kind: "judge" });
      for (const expr of [
        "now() + interval '5 seconds'",
        "clock_timestamp() + interval '2 minutes'",
        "now() + interval '23 hours 59 minutes'",
      ]) {
        const e = await dbError(() => rawExpiry(role, pooled.workspaceId, expr));
        expect(e, expr).toMatchObject({ code: "FROZEN_COLUMN", subject: "workspaces.expires_at" });
        expect(e.detail, expr).toContain("24 hours");
      }
      // the app's clock is no help either: a whole day by Date.now() is still short of now() + 24 h
      const appDay = await dbError(() =>
        setExpiry(role.db, pooled.workspaceId, new Date(Date.now() + JUDGE_SESSION_TTL_MS - 1000)),
      );
      expect(appDay.subject).toBe("workspaces.expires_at");
      expect(await expiryOf(pooled.workspaceId)).toBeNull();
      // a full session by the database clock is a claim
      await rawExpiry(role, pooled.workspaceId, "now() + interval '24 hours'");
      expect(await expiryOf(pooled.workspaceId)).not.toBeNull();
    }
  });

  it("inv.i5.expiry-claim-ttl: an expiry of now() is refused, so the boundary is never purgeable in the same transaction", async () => {
    // a pooled workspace: NULL → now(), then purge, in one transaction of the app role
    const pooled = await fixtureWorkspace(t.app.db, { kind: "judge", withRun: true });
    await withHistory(pooled.workspaceId);
    for (const expr of ["now()", "clock_timestamp()", "now() - interval '1 microsecond'"]) {
      const attack = await dbError(() =>
        t.app.db.transaction(async (tx) => {
          await tx.execute(
            sql.raw(`update workspaces set expires_at = ${expr} where id = '${pooled.workspaceId}'`),
          );
          await tx.execute(sql`select fs_purge_workspace(${pooled.workspaceId})`);
        }),
      );
      expect(attack, expr).toMatchObject({ code: "FROZEN_COLUMN", subject: "workspaces.expires_at" });
    }
    expect(await historyOf(pooled.workspaceId)).toEqual([1, 1]);

    // an expired workspace may be extended, but only more than a minute ahead of the wall clock
    const lapsed = await fixtureWorkspace(t.app.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
    });
    for (const expr of ["now()", "clock_timestamp()", "clock_timestamp() + interval '59 seconds'"]) {
      const e = await dbError(() => rawExpiry(t.app, lapsed.workspaceId, expr));
      expect(e, expr).toMatchObject({ code: "FROZEN_COLUMN", subject: "workspaces.expires_at" });
    }
    await rawExpiry(t.app, lapsed.workspaceId, "clock_timestamp() + interval '2 minutes'");
    const refused = await dbError(() => t.app.sql`select fs_purge_workspace(${lapsed.workspaceId})`);
    expect(refused.code).toBe("PURGE_REFUSED");
  });

  it("inv.i5.expiry-claim-ttl: the purge takes only an expiry strictly before its now()", async () => {
    // a workspace born with expires_at = the transaction's now(): at that instant it has not expired yet
    for (const role of [t.app, t.owner]) {
      const e = await dbError(() =>
        role.db.transaction(async (tx) => {
          const rows = (await tx.execute(
            sql`insert into workspaces (kind, name, expires_at) values ('judge', 'boundary', now()) returning id`,
          )) as unknown as { id: string }[];
          await tx.execute(sql`select fs_purge_workspace(${rows[0]?.id ?? ""})`);
        }),
      );
      expect(e.code).toBe("PURGE_REFUSED");
    }
  });

  it("inv.i5.expiry-claim-ttl: a workspace claimed less than 24 h ago cannot be purged, whatever fs_app writes", async () => {
    const pooled = await fixtureWorkspace(t.app.db, { kind: "judge", withRun: true });
    const before = await dbNow();
    const claimed = await claimJudgeWorkspace(t.app.db, { workspaceId: pooled.workspaceId });
    expect(claimed?.workspaceId).toBe(pooled.workspaceId);
    const lifetime = (claimed?.expiresAt.getTime() ?? 0) - (claimed?.claimedAt.getTime() ?? 0);
    expect(lifetime).toBe(JUDGE_SESSION_TTL_MS);
    expect(claimed?.claimedAt.getTime()).toBeGreaterThanOrEqual(before);
    await withHistory(pooled.workspaceId);
    for (const shorter of [new Date(Date.now() - 1000), new Date(Date.now() + 60_000), null]) {
      const e = await dbError(() => setExpiry(t.app.db, pooled.workspaceId, shorter));
      expect(e.subject).toBe("workspaces.expires_at");
    }
    const refused = await dbError(() => t.app.sql`select fs_purge_workspace(${pooled.workspaceId})`);
    expect(refused.code).toBe("PURGE_REFUSED");
    expect(await historyOf(pooled.workspaceId)).toEqual([1, 1]);
  });

  it("claimJudgeWorkspace takes the oldest pooled judge workspace, never twice, and returns null when the pool is empty", async () => {
    const own = await openTestDb({ max: 8 });
    try {
      const pool = [];
      for (let i = 0; i < 3; i++)
        pool.push(await fixtureWorkspace(own.app.db, { kind: "judge", name: `pool ${i}` }));
      // a showcase, a real workspace and a claimed judge workspace are never in the pool
      await fixtureWorkspace(own.app.db, { kind: "showcase" });
      await fixtureWorkspace(own.app.db, { kind: "real" });
      await fixtureWorkspace(own.app.db, { kind: "judge", expiresAt: new Date(Date.now() + 3_600_000) });
      const claims = await Promise.all(Array.from({ length: 5 }, () => claimJudgeWorkspace(own.app.db)));
      const ids = claims.flatMap((c) => (c ? [c.workspaceId] : []));
      expect(ids.sort()).toEqual(pool.map((p) => p.workspaceId).sort());
      expect(claims.filter((c) => c === null)).toHaveLength(2);
      expect(await claimJudgeWorkspace(own.app.db)).toBeNull();
      // a specific workspace is claimed once
      const fresh = await fixtureWorkspace(own.app.db, { kind: "judge" });
      expect(await claimJudgeWorkspace(own.app.db, { workspaceId: fresh.workspaceId })).not.toBeNull();
      expect(await claimJudgeWorkspace(own.app.db, { workspaceId: fresh.workspaceId })).toBeNull();
      const show = await fixtureWorkspace(own.app.db, { kind: "showcase" });
      expect(await claimJudgeWorkspace(own.app.db, { workspaceId: show.workspaceId })).toBeNull();
    } finally {
      await own.close();
    }
  });
});
