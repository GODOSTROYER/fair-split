import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { appendLedger } from "../src/ledger.js";
import { memberLines, payoutBatches, payoutItems, workspaces } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { dbError, scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

async function strandedWorkspace(kind: "judge" | "showcase" | "real", stranded: number, batches = 1) {
  const ws = await fixtureWorkspace(t.owner.db, {
    kind,
    withRun: true,
    expiresAt: new Date(Date.now() - 60_000),
  });
  if (!ws.runId) throw new Error("No fixture run");
  for (let i = 0; i < batches; i++) {
    const memberId = ws.memberIds[i];
    if (!memberId) throw new Error("No fixture member");
    const [line] = await t.owner.db
      .insert(memberLines)
      .values({
        workspaceId: ws.workspaceId,
        runId: ws.runId,
        memberId,
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
        runId: ws.runId,
        senderBatchId: `${ws.workspaceId}-${i}`,
        requestId: "c".repeat(64),
        batchSha256: "d".repeat(64),
        kind: "primary",
        itemCount: 1,
        totalCents: 1n,
        currency: "USD",
        provenance: "simulated_rail",
      })
      .returning();
    if (!batch || !line) throw new Error("Missing fixture batch or line");
    await t.owner.db.insert(payoutItems).values({
      workspaceId: ws.workspaceId,
      batchId: batch.id,
      lineId: line.id,
      senderItemId: `${ws.workspaceId}-${i}`,
      receiver: "member@example.test",
      amountCents: 1n,
      currency: "USD",
      provenance: "simulated_rail",
    });
    if (i < stranded) {
      await appendLedger(t.app.db, scopeOf(ws.workspaceId), {
        kind: "payout.stranded",
        payload: { batchId: batch.id, reason: "simulator_restarted" },
      });
    }
  }
  return ws;
}

it("inv.i5.stranded-purge: purges an expired judge only when every open item's batch is stranded", async () => {
  const ws = await strandedWorkspace("judge", 2, 2);
  const [res] = await t.app.sql<{ ok: boolean }[]>`select fs_purge_workspace(${ws.workspaceId}) as ok`;
  expect(res?.ok).toBe(true);
  expect(await t.owner.db.select().from(workspaces).where(eq(workspaces.id, ws.workspaceId))).toHaveLength(0);
});

it("inv.i5.stranded-purge-refusal: one unstranded open batch still refuses purge", async () => {
  const ws = await strandedWorkspace("judge", 1, 2);
  expect((await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`)).code).toBe(
    "PURGE_REFUSED",
  );
});

it("inv.i5.stranded-purge-scope: a stranded batch never permits purging a showcase or real co-op", async () => {
  for (const kind of ["showcase", "real"] as const) {
    const ws = await strandedWorkspace(kind, 1);
    expect((await dbError(() => t.app.sql`select fs_purge_workspace(${ws.workspaceId})`)).code).toBe(
      "PURGE_REFUSED",
    );
  }
});
