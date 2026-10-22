import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appendEvent } from "../src/events.js";
import { appendLedger } from "../src/ledger.js";
import {
  agentSessions,
  ledgerEntries,
  ledgerHeads,
  memberLines,
  payoutBatches,
  payoutItems,
  runEvents,
  workspaces,
} from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf, sqlState, treasurer } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function seedAppendOnly(workspaceId: string) {
  const scope = scopeOf(workspaceId);
  await appendEvent(t.app.db, {
    workspaceId,
    type: "presence",
    actor: treasurer,
    provenance: "live",
    payload: { view: "split" },
  });
  await appendLedger(t.app.db, scope, { kind: "ratification", payload: { by: "secretary:theresa" } });
  await t.app.db.insert(agentSessions).values({
    workspaceId,
    sessionId: workspaceId,
    seq: 0,
    role: "assistant",
    rawMessage: { content: [{ type: "text", text: "Drafting the invoice." }] },
    provenance: "replay",
  });
}

describe("the app role cannot rewrite history (register §7)", () => {
  it("fs_app has no UPDATE, DELETE or TRUNCATE on run_events, ledger_entries, agent_sessions", async () => {
    const ws = await fixtureWorkspace(t.app.db);
    await seedAppendOnly(ws.workspaceId);
    for (const table of ["run_events", "ledger_entries", "agent_sessions"]) {
      expect(
        await sqlState(() => t.app.sql.unsafe(`update ${table} set workspace_id = workspace_id`)),
        table,
      ).toBe("42501");
      expect(await sqlState(() => t.app.sql.unsafe(`delete from ${table}`)), table).toBe("42501");
      expect(await sqlState(() => t.app.sql.unsafe(`truncate ${table}`)), table).toBe("42501");
    }
    // …while it can still append
    const [n] = await t.app.db.select({ n: sql<number>`count(*)::int` }).from(runEvents);
    expect(n?.n).toBeGreaterThan(0);
  });

  it("even the owner is refused by the append-only triggers", async () => {
    const ws = await fixtureWorkspace(t.owner.db);
    await seedAppendOnly(ws.workspaceId);
    const e1 = await dbError(() => t.owner.db.update(runEvents).set({ type: "presence" }));
    expect(e1.code).toBe("APPEND_ONLY");
    const e2 = await dbError(() => t.owner.db.delete(ledgerEntries));
    expect(e2.code).toBe("APPEND_ONLY");
    const e3 = await dbError(() => t.owner.db.delete(agentSessions));
    expect(e3.code).toBe("APPEND_ONLY");
    const e4 = await dbError(() => t.owner.sql`truncate run_events`);
    expect(e4.code).toBe("APPEND_ONLY");
  });

  it("ledger heads move only by appending", async () => {
    const ws = await fixtureWorkspace(t.owner.db);
    await appendLedger(t.owner.db, scopeOf(ws.workspaceId), { kind: "hold.raised", payload: { code: "H1" } });
    expect(await sqlState(() => t.app.db.update(ledgerHeads).set({ seq: 99 }))).toBe("42501");
    const e = await dbError(() =>
      t.owner.db.update(ledgerHeads).set({ seq: 99 }).where(eq(ledgerHeads.workspaceId, ws.workspaceId)),
    );
    expect(e.code).toBe("LEDGER_FORK");
  });
});

describe("fs_purge_workspace: the only way out for an expired Judge workspace", () => {
  it("refuses showcase and real workspaces, and judges that have not expired", async () => {
    const show = await fixtureWorkspace(t.owner.db, { kind: "showcase" });
    const live = await fixtureWorkspace(t.owner.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() + 60_000),
    });
    for (const ws of [show, live]) {
      const e = await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`);
      expect(e.code).toBe("PURGE_REFUSED");
    }
  });

  it("refuses while money is in flight", async () => {
    const ws = await fixtureWorkspace(t.owner.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
      withRun: true,
    });
    const [line] = await t.owner.db
      .insert(memberLines)
      .values({
        workspaceId: ws.workspaceId,
        runId: ws.runId ?? "",
        memberId: ws.memberIds[0] ?? "",
        state: "SUBMITTED",
        rail: "ON",
        currency: "USD",
        verifiedG: 1n,
        grade1G: 0n,
        premiumCents: 1n,
        bonusCents: 0n,
        deductionsCents: 0n,
        creditsCents: 0n,
        netCents: 1n,
        deductions: [],
        provenance: "seeded",
      })
      .returning();
    const [batch] = await t.owner.db
      .insert(payoutBatches)
      .values({
        workspaceId: ws.workspaceId,
        runId: ws.runId ?? "",
        senderBatchId: `2026A-test-${ws.workspaceId.slice(0, 8)}`,
        requestId: "c".repeat(64),
        batchSha256: "d".repeat(64),
        kind: "primary",
        itemCount: 1,
        totalCents: 1n,
        currency: "USD",
        provenance: "live",
      })
      .returning();
    await t.owner.db.insert(payoutItems).values({
      workspaceId: ws.workspaceId,
      batchId: batch?.id ?? "",
      lineId: line?.id ?? "",
      senderItemId: `r1-M-001-${ws.workspaceId.slice(0, 8)}`,
      receiver: "member@example.test",
      amountCents: 1n,
      currency: "USD",
      provenance: "live",
    });
    const e = await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`);
    expect(e.code).toBe("PURGE_REFUSED");
  });

  it("purges an expired judge workspace with its append-only rows and ledger, leaving others intact", async () => {
    const keep = await fixtureWorkspace(t.owner.db, { kind: "showcase", withRun: true });
    const gone = await fixtureWorkspace(t.owner.db, {
      kind: "judge",
      expiresAt: new Date(Date.now() - 1000),
      withRun: true,
    });
    await seedAppendOnly(keep.workspaceId);
    await seedAppendOnly(gone.workspaceId);
    const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${gone.workspaceId}) as ok`;
    expect(res?.ok).toBe(true);
    const left = await t.owner.db.select().from(workspaces).where(eq(workspaces.id, gone.workspaceId));
    expect(left).toHaveLength(0);
    const [kept] = await t.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.workspaceId, keep.workspaceId));
    expect(kept?.n).toBe(1);
    const [ev] = await t.owner.db
      .select({ n: sql<number>`count(*)::int` })
      .from(runEvents)
      .where(eq(runEvents.workspaceId, gone.workspaceId));
    expect(ev?.n).toBe(0);
    // the purge's ticket dies with it: nothing is left that could open a guard later
    const [tickets] = await t.owner.sql<
      { n: number }[]
    >`select count(*)::int as n from fs_private.purge_tickets`;
    expect(tickets?.n).toBe(0);
  });
});
