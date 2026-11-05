/**
 * Lock order (review minor): every write that appends to the event log or the ledger serialises on one advisory
 * lock per workspace, and every repository write takes that lock BEFORE its first row lock. Two transactions
 * can then never hold a row lock and the workspace lock in opposite orders, so they never deadlock.
 */
import { and, eq, sql } from "drizzle-orm";
import { PgTransaction } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgError } from "../src/errors.js";
import { appendEvent } from "../src/events.js";
import { repos } from "../src/repos/index.js";
import { memberLines, payRuns, runEvents, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { isTransaction, withWorkspaceTx } from "../src/tx.js";
import { scopeOf, sleep } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
afterAll(async () => {
  await t?.close();
});

describe("isTransaction", () => {
  it("recognises a transaction from another installed copy of drizzle-orm, where instanceof fails", () => {
    const kind = Symbol.for("drizzle:entityKind");
    // what a second copy's classes look like: same entity kinds, different constructors, a transaction's methods
    class ForeignPgTransaction {
      static readonly [kind]: string = "PgTransaction";
      rollback(): never {
        throw new Error("Rollback");
      }
    }
    class ForeignPostgresJsTransaction extends ForeignPgTransaction {
      static override readonly [kind]: string = "PostgresJsTransaction";
    }
    const foreign = new ForeignPostgresJsTransaction();
    expect(foreign instanceof PgTransaction).toBe(false);
    expect(isTransaction(foreign)).toBe(true);
    expect(isTransaction(t.app.db)).toBe(false);
    expect(isTransaction(null)).toBe(false);
    expect(isTransaction({ rollback: () => {} })).toBe(false);
  });

  it("is true inside db.transaction and false for the pool", async () => {
    await t.app.db.transaction(async (tx) => {
      expect(isTransaction(tx)).toBe(true);
    });
  });
});

async function approvedRun() {
  const ws = await fixtureWorkspace(t.app.db, { withRun: true, runState: "APPROVED" });
  const runId = ws.runId ?? "";
  return { ws, runId, r: repos(scopeOf(ws.workspaceId)) };
}

const isDeadlock = (e: unknown) => pgError(e)?.code === "40P01";

describe("lock order: the workspace lock before any row lock", () => {
  it("the kill-switch handler (flag + HALT in one transaction) racing a POSTING transition never deadlocks", async () => {
    for (let i = 0; i < 4; i++) {
      const { runId, r } = await approvedRun();
      // T1 flips kill_payouts, then (while still open) halts the run: S3.11's handler shape
      let holding = () => {};
      const locked = new Promise<void>((resolve) => {
        holding = resolve;
      });
      const t1 = withWorkspaceTx(t.app.db, r.scope, async (tx) => {
        await r.flags.set(tx, "kill_payouts", true, { reason: "test", provenance: "live" });
        holding();
        await sleep(150);
        return r.runs.transition(tx, {
          id: runId,
          from: "APPROVED",
          to: "HALTED",
          cause: "kill switch",
          provenance: "live",
        });
      });
      // T2 starts once T1 holds the workspace lock (a fixed 40 ms wait lost that race at load 33 on 4 cores, DR-4)
      // and tries to post the same run
      await locked;
      const t2 = r.runs.transition(t.app.db, {
        id: runId,
        from: "APPROVED",
        to: "POSTING",
        cause: "post",
        provenance: "live",
        patch: { batchSha256: "a".repeat(64), senderBatchId: `2026A-lock-${runId}` },
      });
      const [a, b] = await Promise.allSettled([t1, t2]);
      for (const s of [a, b]) {
        if (s.status === "rejected") expect(isDeadlock(s.reason), String(s.reason)).toBe(false);
        expect(s.status).toBe("fulfilled");
      }
      // T1 won the workspace lock first, so the run is HALTED and T2 found it stale
      expect(a.status === "fulfilled" && a.value.ok).toBe(true);
      expect(b.status === "fulfilled" && b.value).toEqual({ ok: false, reason: "STALE", current: "HALTED" });
      const [run] = await t.app.db.select().from(payRuns).where(eq(payRuns.id, runId));
      expect(run?.state).toBe("HALTED");
    }
  });

  it("a row write then a transition, racing the reverse order, cannot deadlock either", async () => {
    const { ws, runId, r } = await approvedRun();
    const [line] = await t.app.db
      .insert(memberLines)
      .values({
        workspaceId: ws.workspaceId,
        runId,
        memberId: ws.memberIds[0] ?? "",
        rail: "OFF",
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
      .returning();
    const lineId = line?.id ?? "";
    // A: scoped run write, pause, then a line transition. B: line transition, pause, then a scoped run write.
    const a = t.app.db.transaction(async (tx) => {
      await r.payRuns.update(tx, runId, { haltedReason: "a" });
      await sleep(120);
      await r.lines.transition(tx, {
        id: lineId,
        from: "COMPUTED",
        to: "HELD",
        cause: "a",
        provenance: "live",
      });
    });
    const b = t.app.db.transaction(async (tx) => {
      await sleep(30);
      await r.lines.transition(tx, {
        id: lineId,
        from: "COMPUTED",
        to: "READY",
        cause: "b",
        provenance: "live",
      });
      await sleep(120);
      await r.payRuns.update(tx, runId, { haltedReason: "b" });
    });
    const results = await Promise.allSettled([a, b]);
    for (const s of results) {
      if (s.status === "rejected") expect(isDeadlock(s.reason), String(s.reason)).toBe(false);
    }
    expect(results.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);
  });
});

describe("lock order: fs_purge_workspace takes the workspace lock before the workspace row", () => {
  /** backends of this database waiting on a lock right now */
  async function waiting(): Promise<number> {
    const [row] = await t.owner.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'`;
    return row?.n ?? 0;
  }

  it("a purge racing a transition of the same workspace waits for it instead of deadlocking", async () => {
    for (let i = 0; i < 3; i++) {
      const ws = await fixtureWorkspace(t.app.db, {
        kind: "judge",
        expiresAt: new Date(Date.now() - 1000),
        withRun: true,
      });
      const runId = ws.runId ?? "";
      const scope = scopeOf(ws.workspaceId);
      let purge: Promise<unknown> = Promise.resolve();
      // A: a run transition in its usual shape (workspace lock, the run's row lock, then the run.state event, whose
      // foreign key share-locks the workspace row), paused between its row lock and its event while B starts
      const a = withWorkspaceTx(t.app.db, scope, async (tx) => {
        await tx
          .update(payRuns)
          .set({ state: "QUOTED", version: sql`${payRuns.version} + 1` })
          .where(and(eq(payRuns.id, runId), eq(payRuns.state, "DRAFT")));
        // B: the hourly judgeReset purges the expired workspace
        purge = t.app.sql`select fs_purge_workspace(${ws.workspaceId}) as ok`;
        purge.catch(() => {}); // observed below
        const deadline = Date.now() + 3000;
        while ((await waiting()) === 0 && Date.now() < deadline) await sleep(10);
        await sleep(50);
        await appendEvent(tx, {
          workspaceId: ws.workspaceId,
          runId,
          type: "run.state",
          actor: scope.actor,
          provenance: "live",
          payload: { id: runId, from: "DRAFT", to: "QUOTED", cause: "race", version: 1 },
        });
      });
      // A first: `purge` is assigned inside A's transaction
      const [ra] = await Promise.allSettled([a]);
      const [rb] = await Promise.allSettled([purge]);
      for (const s of [ra, rb]) {
        if (s.status === "rejected") expect(isDeadlock(s.reason), String(s.reason)).toBe(false);
        expect(s.status).toBe("fulfilled");
      }
      // the purge waited for the transition, then took the workspace with the event it wrote
      expect(rb.status === "fulfilled" && (rb.value as { ok: boolean }[])[0]?.ok).toBe(true);
      expect(
        await t.owner.db.select().from(workspaces).where(eq(workspaces.id, ws.workspaceId)),
      ).toHaveLength(0);
      expect(
        await t.owner.db.select().from(runEvents).where(eq(runEvents.workspaceId, ws.workspaceId)),
      ).toHaveLength(0);
    }
  });
});
