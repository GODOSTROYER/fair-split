// inv.i4 at the write boundary. PayoutsService checks a snapshot (loadPosting, then the approvals check) and
// only then writes the batch rows. If the run is sent back and approved again in between, writing the old
// snapshot would post a batch under approvals that never signed it, or under approvals that were voided.
// writeSubmitted re-checks both under the run lock: the run's approved digest is the batch being written, and
// every approval the check used is still live. Otherwise nothing is written or sent, and the live
// generation's own POST pays exactly what it signed.
import { schema, systemScope } from "@fairsplit/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/testing/app.js";
import { paypalScript } from "../runs/testing/paypal.js";
import { payoutsServiceFor } from "./payouts.js";

const script = paypalScript();
let h: RunsHarness;

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers });
  await resolveAll(h);
  await signBoth(h);
});
afterAll(async () => h?.close());

async function runOf() {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  if (!run) throw new Error("run");
  return run;
}

async function batches() {
  return h.t.deps.db.select().from(schema.payoutBatches).where(eq(schema.payoutBatches.runId, h.world.runId));
}

async function liveApprovals() {
  return h.t.deps.db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.runId, h.world.runId),
        eq(schema.approvals.decision, "SIGNED"),
        isNull(schema.approvals.voidedAt),
      ),
    );
}

/** The run's PayoutsService, with `between` run just before the rows are written (another request's move). */
function racingService(between: () => Promise<void>) {
  return payoutsServiceFor(h.t.deps, systemScope(h.world.workspaceId, ACTORS.outbox), {
    repo: (base) => ({
      ...base,
      async writeSubmitted(batch) {
        await between();
        return base.writeSubmitted(batch);
      },
    }),
  });
}

/** The treasurer withdraws the approved batch (the Chair declines only while it waits for her). */
const sendBack = () =>
  h.t.client(h.tokens.treasurer).declineApproval({
    params: { runSlug: h.world.runSlug },
    body: { role: "treasurer", reason: "Check slip 0462 again" },
  });

describe("inv.i4.generation: the batch written is the one the live approvals signed", () => {
  it("re-approved over a changed batch between the check and the write: refused, nothing written or sent", async () => {
    const first = (await runOf()).batchSha256;
    let second = "";
    const service = await racingService(async () => {
      await sendBack();
      await h.t
        .client(h.tokens.treasurer)
        .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.90" } });
      ({ batchSha256: second } = await signBoth(h));
    });
    await expect(service.executeApproved(h.world.runId)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      opts: { transient: false },
    });
    expect(second).not.toBe(first);
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await batches()).toHaveLength(0);
    expect(await runOf()).toMatchObject({ state: "APPROVED", batchSha256: second });
    expect(await liveApprovals()).toHaveLength(2);
  });

  it("re-approved over the same batch: the approvals that were checked are voided, so it is refused too", async () => {
    const signed = (await runOf()).batchSha256;
    const service = await racingService(async () => {
      await sendBack();
      await signBoth(h);
    });
    await expect(service.executeApproved(h.world.runId)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      opts: { transient: false },
    });
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await batches()).toHaveLength(0);
    expect(await runOf()).toMatchObject({ state: "APPROVED", batchSha256: signed });
    expect(await liveApprovals()).toHaveLength(2);
  });

  it("the live generation's own POST then pays exactly the batch it signed, once", async () => {
    const signed = (await runOf()).batchSha256;
    expect(await runQueued(h, "postPayoutBatch")).toBeGreaterThan(0);
    expect(script.posted).toHaveLength(1);
    const [batch] = await batches();
    expect(batch?.batchSha256).toBe(signed);
    expect((await runOf()).state).toBe("POSTED");
  });
});
