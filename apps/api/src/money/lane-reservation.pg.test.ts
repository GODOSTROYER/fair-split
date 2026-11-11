import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { judgeRuntime } from "../judge/runtime.js";
import { MAX_ATTEMPT_ROWS } from "../runs/now.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns({ paypal: paypalScript().handlers });
});
afterAll(async () => h?.close());

it("HD6 r5: an over-bound queue immediately becomes labelled replay with approvals intact", async () => {
  await resolveAll(h);
  await signBoth(h);
  const lane = judgeRuntime(h.t.deps).lane;
  const heads = [0, 1].map(() => ({ workspaceId: randomUUID(), sessionId: null, step: "post" }));
  const first = heads[0];
  if (!first) throw new Error("head");
  lane.acquire(first);
  for (const next of heads.slice(1)) lane.join(next);
  const start = h.t.clock.nowMs();
  await runQueued(h, "postPayoutBatch");
  const queued = await h.t.deps.db
    .select()
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
  expect(queued).toHaveLength(0);
  expect(h.t.clock.nowMs() - start).toBe(0);
  expect(lane.position(h.world.workspaceId)).toBeNull();
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  expect(batch?.provenance).toBe("replay");
  const labels = await h.t.deps.db
    .select()
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.runId, h.world.runId),
        eq(schema.ledgerEntries.kind, "judge.step.replayed"),
      ),
    );
  expect(labels.map((e) => e.payload)).toEqual([
    expect.objectContaining({ step: "post", reason: "lane_full" }),
  ]);
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

it("HD6 r5: a fifty-deep queue writes one attempt with labelled replay, below the outbox ceiling", async () => {
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
    await runQueued(g, "postPayoutBatch");
    const rows = await g.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, g.world.workspaceId),
          eq(schema.taskOutbox.name, "postPayoutBatch"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows.length).toBeLessThan(MAX_ATTEMPT_ROWS);
    expect(rows.filter((row) => row.state === "queued")).toHaveLength(0);
    expect(rows.some((row) => row.state === "dead")).toBe(false);
    const [batch] = await g.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, g.world.runId));
    expect(batch?.provenance).toBe("replay");
    const [run] = await g.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, g.world.runId));
    expect(run?.state).toBe("POSTED");
  } finally {
    await g.close();
  }
}, 120_000);
