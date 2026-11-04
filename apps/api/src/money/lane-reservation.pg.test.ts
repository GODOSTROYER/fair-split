import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { judgeRuntime } from "../judge/runtime.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns({ paypal: paypalScript().handlers });
});
afterAll(async () => h?.close());

it("HD6-8: a seventh queued post catches its reservation after both heads reset, without voiding approvals", async () => {
  await resolveAll(h);
  await signBoth(h);
  const lane = judgeRuntime(h.t.deps).lane;
  const heads = [0, 1].map(() => ({ workspaceId: randomUUID(), sessionId: null, step: "post" }));
  const first = heads[0];
  if (!first) throw new Error("head");
  lane.acquire(first);
  for (const next of heads.slice(1)) lane.join(next);
  const due = async () => {
    await h.t.pg?.owner.db
      .update(schema.taskOutbox)
      .set({ runAfter: new Date(Date.now() - 1000) })
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          eq(schema.taskOutbox.name, "postPayoutBatch"),
          eq(schema.taskOutbox.state, "queued"),
        ),
      );
  };
  for (let i = 0; i < 7; i++) {
    await due();
    await runQueued(h, "postPayoutBatch");
    h.t.clock.advance(30_000);
    lane.renew(first);
  }
  const waiting = await h.t.deps.db
    .select()
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
  expect(waiting).toHaveLength(1);
  expect((waiting[0]?.runAfter.getTime() ?? Infinity) - Date.now()).toBeLessThanOrEqual(30_000);
  for (const head of heads) lane.releaseWorkspace(head.workspaceId);
  await due();
  await runQueued(h, "postPayoutBatch");
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  expect(run?.state).toBe("POSTED");
  const approvals = await h.t.deps.db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.runId, h.world.runId));
  expect(approvals).toHaveLength(2);
  expect(approvals.every((a) => a.voidedAt === null)).toBe(true);
}, 120_000);
