/**
 * inv.i5.no-delete (review minor, migrations/0006). The I5 backstop guarded UPDATE only, while fs_app kept 0002's
 * blanket DELETE on pay_runs, member_lines, holds, payout_items and approvals. So a signed approval could be deleted
 * (freeing its live slot with no void and no ledger row), a payout item deleted and re-inserted at a lower status, a
 * line or run without events deleted and re-inserted in any state, and deleting the non-terminal items of an expired
 * judge workspace defeated fs_purge_workspace's "money in flight" refusal.
 *
 * Now (migrations/0015) fs_app has no DELETE or TRUNCATE on those tables, and BEFORE DELETE / TRUNCATE triggers refuse
 * every role (FS409 DELETE_REFUSED:<table>) unless fs_purge_workspace() is removing the row's workspace. Rows move
 * forward instead: a run or line to its exit state, a hold to its resolution, an approval to void.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvals, holds, memberLines, payoutBatches, payoutItems, payRuns } from "../src/schema/index.js";
import { type FixtureWorkspace, fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, sqlState } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
});
afterAll(async () => {
  await t?.close();
});

const GUARDED = ["pay_runs", "member_lines", "holds", "payout_items", "approvals"] as const;
type Guarded = (typeof GUARDED)[number];

interface Rows {
  ws: FixtureWorkspace;
  ids: Record<Guarded, string>;
  batchId: string;
}

/** A run with one line, one hold, one signed approval and one payout item in `itemStatus`. */
async function rows(opts: { expired?: boolean; itemStatus?: "UNCLAIMED" | "SUCCESS" } = {}): Promise<Rows> {
  const ws = await fixtureWorkspace(t.owner.db, {
    kind: "judge",
    withRun: true,
    runState: "COMPUTED",
    expiresAt: opts.expired ? new Date(Date.now() - 1000) : new Date(Date.now() + 3_600_000),
  });
  const runId = ws.runId ?? "";
  const one = async <R>(q: Promise<R[]>) => (await q)[0] as R;
  const line = await one(
    t.owner.db
      .insert(memberLines)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        memberId: ws.memberIds[0] ?? "",
        state: "SUBMITTED",
        rail: "ON",
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 0n,
        premiumCents: 100n,
        bonusCents: 0n,
        deductionsCents: 0n,
        creditsCents: 0n,
        netCents: 100n,
        deductions: [],
        provenance: "seeded",
      })
      .returning({ id: memberLines.id }),
  );
  const hold = await one(
    t.owner.db
      .insert(holds)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        code: "H1",
        kind: "DUPLICATE_SLIP",
        gate: "BLOCKS_APPROVAL",
        raisedBy: "engine",
        provenance: "seeded",
      })
      .returning({ id: holds.id }),
  );
  const approval = await one(
    t.owner.db
      .insert(approvals)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        role: "treasurer",
        decision: "SIGNED",
        approverId: "treasurer:analyn",
        keyId: "fs-analyn-w1",
        payloadJcs: '{"v":1}',
        signature: "c2lnbmF0dXJl",
        batchSha256: "b".repeat(64),
        nonce: randomUUID(),
        exp: new Date(Date.now() + 30 * 60_000),
        provenance: "live",
      })
      .returning({ id: approvals.id }),
  );
  const batch = await one(
    t.owner.db
      .insert(payoutBatches)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        senderBatchId: `2026A-nodel-${randomUUID()}`,
        requestId: "e".repeat(64),
        batchSha256: "f".repeat(64),
        kind: "primary",
        itemCount: 1,
        totalCents: 100n,
        currency: "USD",
        provenance: "live",
      })
      .returning({ id: payoutBatches.id }),
  );
  const status = opts.itemStatus ?? "UNCLAIMED";
  const item = await one(
    t.owner.db
      .insert(payoutItems)
      .values({
        workspaceId: ws.workspaceId,
        batchId: batch.id,
        lineId: line.id,
        senderItemId: `r${randomUUID().slice(0, 8)}-M-001`,
        receiver: "member@example.test",
        amountCents: 100n,
        currency: "USD",
        status,
        statusRank: status === "UNCLAIMED" ? 30 : 60,
        provenance: "live",
      })
      .returning({ id: payoutItems.id }),
  );
  return {
    ws,
    batchId: batch.id,
    ids: {
      pay_runs: runId,
      member_lines: line.id,
      holds: hold.id,
      payout_items: item.id,
      approvals: approval.id,
    },
  };
}

async function exists(table: Guarded, id: string): Promise<boolean> {
  const [row] = await t.owner.sql<{ n: number }[]>`
    select count(*)::int as n from ${t.owner.sql(table)} where id = ${id}`;
  return (row?.n ?? 0) === 1;
}

describe("inv.i5.no-delete: state rows leave only with their workspace", () => {
  it("inv.i5.no-delete: fs_app holds no DELETE or TRUNCATE on runs, lines, holds, payout items or approvals", async () => {
    const r = await rows();
    for (const table of GUARDED) {
      for (const priv of ["DELETE", "TRUNCATE"]) {
        const [g] = await t.app.sql<{ ok: boolean }[]>`select has_table_privilege(${table}, ${priv}) as ok`;
        expect(g?.ok, `${table} ${priv}`).toBe(false);
      }
      expect(
        await sqlState(() => t.app.sql.unsafe(`delete from ${table} where id = $1`, [r.ids[table]])),
      ).toBe("42501");
      expect(await sqlState(() => t.app.sql.unsafe(`truncate ${table} cascade`))).toBe("42501");
      expect(await exists(table, r.ids[table]), table).toBe(true);
    }
  });

  it("inv.i5.no-delete: the owner is refused too, row by row and by TRUNCATE (DELETE_REFUSED)", async () => {
    const r = await rows();
    // children before parents, so the foreign keys are not what refuses
    for (const table of ["approvals", "holds", "payout_items", "member_lines", "pay_runs"] as const) {
      const e = await dbError(() => t.owner.sql.unsafe(`delete from ${table} where id = $1`, [r.ids[table]]));
      expect(e, table).toMatchObject({ code: "DELETE_REFUSED", subject: table, httpStatus: 409 });
      const tr = await dbError(() => t.owner.sql.unsafe(`truncate ${table} cascade`));
      expect(tr.code, `truncate ${table}`).toBe("DELETE_REFUSED");
      expect(await exists(table, r.ids[table]), table).toBe(true);
    }
  });

  it("inv.i5.no-delete: a signed approval cannot be deleted to free its live slot", async () => {
    const r = await rows();
    for (const role of [t.app, t.owner]) {
      await expect(role.db.delete(approvals).where(eq(approvals.id, r.ids.approvals))).rejects.toThrow();
    }
    // the slot is still taken: a second live treasurer signature for the run is refused
    const again = await sqlState(() =>
      t.app.db.insert(approvals).values({
        workspaceId: r.ws.workspaceId,
        runId: r.ids.pay_runs,
        role: "treasurer",
        decision: "SIGNED",
        approverId: "treasurer:analyn",
        keyId: "fs-analyn-w1",
        payloadJcs: '{"v":1}',
        signature: "Zm9yZ2Vk",
        batchSha256: "c".repeat(64),
        nonce: randomUUID(),
        exp: new Date(Date.now() + 30 * 60_000),
        provenance: "live",
      }),
    );
    expect(again).toBe("23505");
  });

  it("inv.i5.no-delete: a payout item cannot be deleted and re-inserted lower, so money in flight still blocks the purge", async () => {
    const r = await rows({ expired: true, itemStatus: "UNCLAIMED" });
    expect(
      await sqlState(() => t.app.db.delete(payoutItems).where(eq(payoutItems.id, r.ids.payout_items))),
    ).toBe("42501");
    const owner = await dbError(() =>
      t.owner.db.delete(payoutItems).where(eq(payoutItems.batchId, r.batchId)),
    );
    expect(owner.code).toBe("DELETE_REFUSED");
    const refused = await dbError(() => t.app.sql`select fs_purge_workspace(${r.ws.workspaceId})`);
    expect(refused).toMatchObject({ code: "PURGE_REFUSED" });
    expect(refused.detail).toContain("Money is in flight");
    expect(await exists("payout_items", r.ids.payout_items)).toBe(true);
  });

  it("the purge still takes every one of them with their expired judge workspace", async () => {
    const r = await rows({ expired: true, itemStatus: "SUCCESS" });
    const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${r.ws.workspaceId}) as ok`;
    expect(res?.ok).toBe(true);
    for (const table of GUARDED) expect(await exists(table, r.ids[table]), table).toBe(false);
    const [left] = await t.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(payRuns)
      .where(eq(payRuns.workspaceId, r.ws.workspaceId));
    expect(left?.n).toBe(0);
  });
});
