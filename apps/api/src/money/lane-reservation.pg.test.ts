import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { recordBalanceReading } from "../judge/quota.js";
import { judgeRuntime } from "../judge/runtime.js";
import { MAX_ATTEMPT_ROWS } from "../runs/now.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns({ paypal: paypalScript().handlers });
});
afterAll(async () => h?.close());

it("HD6-8: scheduled retries catch the head reservation before approvals expire after a 28 minute queue", async () => {
  await resolveAll(h);
  await signBoth(h);
  const lane = judgeRuntime(h.t.deps).lane;
  const heads = [0, 1].map(() => ({ workspaceId: randomUUID(), sessionId: null, step: "post" }));
  const first = heads[0];
  if (!first) throw new Error("head");
  lane.acquire(first);
  for (const next of heads.slice(1)) lane.join(next);
  const start = h.t.clock.nowMs();
  let databaseNow = Date.now();
  const dateNow = vi.spyOn(Date, "now").mockImplementation(() => databaseNow);
  let becameHeadAt: number | null = null;
  let askedAt: number | null = null;
  try {
    for (let attempt = 0; attempt < 65; attempt++) {
      const [row] = await h.t.deps.db
        .select()
        .from(schema.taskOutbox)
        .where(
          and(
            eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
            eq(schema.taskOutbox.name, "postPayoutBatch"),
            eq(schema.taskOutbox.state, "queued"),
          ),
        );
      if (!row) break;
      const delay = Math.max(0, row.runAfter.getTime() - databaseNow);
      const next = h.t.clock.nowMs() + delay;
      const releaseAt = start + 28 * 60_000;
      if (becameHeadAt === null && next >= releaseAt) {
        h.t.clock.advance(releaseAt - h.t.clock.nowMs());
        for (const head of heads) lane.releaseWorkspace(head.workspaceId);
        becameHeadAt = h.t.clock.nowMs();
        expect(lane.position(h.world.workspaceId)).toBe(0);
      }
      h.t.clock.advance(next - h.t.clock.nowMs());
      databaseNow += delay;
      if (becameHeadAt === null) {
        // The predecessor keeps its lease while doing its long-running burst.
        lane.renew(first);
      } else {
        askedAt = h.t.clock.nowMs();
      }
      await recordBalanceReading(h.t.deps.db, {
        rail: "sandbox",
        availableCents: 100_000_000,
        asOf: h.t.clock.now(),
        source: "searchBalances",
      });
      // Simulate the dispatcher claiming the scheduled row when the database clock reaches runAfter.
      // Preserve runAfter: the schedule itself, rather than an arbitrary early execution, drives both clocks.
      await h.t.pg?.owner.db
        .update(schema.taskOutbox)
        .set({ state: "dispatched" })
        .where(eq(schema.taskOutbox.id, row.id));
      await h.t.deps.outbox?.runTask(row.id);
      if (askedAt !== null) break;
    }
  } finally {
    dateNow.mockRestore();
  }
  expect(becameHeadAt).not.toBeNull();
  expect(askedAt).not.toBeNull();
  expect((askedAt ?? Infinity) - (becameHeadAt ?? 0)).toBeLessThan(lane.options.reserveMs);
  expect((askedAt ?? Infinity) - start).toBeLessThan(30 * 60_000);
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  expect(run?.state).toBe("POSTED");
  const approvals = await h.t.deps.db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.runId, h.world.runId));
  expect(approvals).toHaveLength(2);
  expect(approvals.every((a) => a.voidedAt === null)).toBe(true);
  const voids = await h.t.deps.db
    .select()
    .from(schema.ledgerEntries)
    .where(
      and(eq(schema.ledgerEntries.runId, h.world.runId), eq(schema.ledgerEntries.kind, "approval.voided")),
    );
  expect(voids).toHaveLength(0);
}, 120_000);

it("HD6-8: a fifty-deep wait writes 67 attempt rows, below the outbox ceiling", async () => {
  const g = await startRuns({ paypal: paypalScript().handlers });
  try {
    await resolveAll(g);
    await signBoth(g);
    const lane = judgeRuntime(g.t.deps).lane;
    const heads = Array.from({ length: 49 }, () => ({
      workspaceId: randomUUID(),
      sessionId: null,
      step: "post",
    }));
    for (const head of heads) lane.join(head);
    let released = 0;
    // Forty-second bursts, re-asked every thirty seconds. Stop when our turn arrives: the existing
    // approval-expiry fail-safe still decides whether this oldest possible wait may actually post.
    for (let elapsed = 0; elapsed < 49 * 40_000; elapsed += 30_000) {
      await recordBalanceReading(g.t.deps.db, {
        rail: "sandbox",
        availableCents: 100_000_000,
        asOf: g.t.clock.now(),
        source: "searchBalances",
      });
      while ((released + 1) * 40_000 <= elapsed) {
        const head = heads[released++];
        if (!head) throw new Error("lane head");
        lane.releaseWorkspace(head.workspaceId);
      }
      await g.t.pg?.owner.db
        .update(schema.taskOutbox)
        .set({ runAfter: new Date(Date.now() - 1000) })
        .where(
          and(
            eq(schema.taskOutbox.workspaceId, g.world.workspaceId),
            eq(schema.taskOutbox.name, "postPayoutBatch"),
            eq(schema.taskOutbox.state, "queued"),
          ),
        );
      await runQueued(g, "postPayoutBatch");
      g.t.clock.advance(30_000);
    }
    const rows = await g.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, g.world.workspaceId),
          eq(schema.taskOutbox.name, "postPayoutBatch"),
        ),
      );
    expect(rows).toHaveLength(67);
    expect(rows.length).toBeLessThan(MAX_ATTEMPT_ROWS);
    expect(rows.filter((row) => row.state === "queued")).toHaveLength(1);
    expect(rows.some((row) => row.state === "dead")).toBe(false);
  } finally {
    await g.close();
  }
}, 120_000);
