// S3.11 at the POST: the kill switch is read fresh just before PayPal is called. A switch that never went
// through setFlag's HALT (FS_KILL forced by env, or kill_paypal_live) used to leave the run APPROVED with its
// lines LOCKED and its approvals live, and nothing posted it once the switch was off.
//   kill_payouts (stored or forced by FS_KILL): the run is HALTED, approvals voided, lines unlocked.
//   kill_paypal_live ("refusal in real mode"): nothing is sent, the approvals are voided and the run goes back
//     to review; once the switch is off, signing again posts the batch.
//   A POST whose rows are already written (POSTING, PayPal's answer unknown) is never abandoned: the outbox
//     retries it while the switch is on, and it resumes with the same ids once the switch is off.
import { schema } from "@fairsplit/db";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq, isNull } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript, TEST_BATCH_ID } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";

const figures = getSnapshot().figures;

async function runOf(h: RunsHarness) {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  if (!run) throw new Error("run");
  return run;
}

async function lineCounts(h: RunsHarness) {
  const r = await h.t.json<{ lines: Record<string, number> }>(`/v1/runs/${h.world.runSlug}`, {
    as: h.t.credentials.bearer(h.tokens.treasurer),
  });
  return r.body.lines;
}

async function liveApprovals(h: RunsHarness) {
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

async function postTasks(h: RunsHarness) {
  return h.t.deps.db
    .select({ state: schema.taskOutbox.state, attempts: schema.taskOutbox.attempts })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
      ),
    );
}

/** Makes the queued rows of a task due now (the outbox claims a retried row only once run_after passed). */
async function due(h: RunsHarness, name: string) {
  const owner = h.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  await owner
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, name),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

describe("inv.i6.kill-post: kill_payouts forced by FS_KILL after both keys (no setFlag, so no HALT yet)", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("the queued POST HALTs the run: nothing sent, approvals voided, lines unlocked", async () => {
    expect((await runOf(h)).state).toBe("APPROVED");
    const kill = h.t.deps.env.kill as { FS_KILL?: string | undefined };
    kill.FS_KILL = "payouts";
    try {
      expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    } finally {
      kill.FS_KILL = undefined;
    }
    expect(script.calls).not.toContain("create_payout_batch");
    const run = await runOf(h);
    expect(run).toMatchObject({ state: "HALTED", haltedReason: "kill_payouts" });
    const lines = await lineCounts(h);
    expect(lines.LOCKED ?? 0).toBe(0);
    expect(lines.READY).toBeGreaterThanOrEqual(figures.batchItemCount);
    expect(await liveApprovals(h)).toHaveLength(0);
    expect((await postTasks(h)).map((t) => t.state)).toEqual(["done"]);
    const halted = await h.t.deps.db
      .select({ payload: schema.runEvents.payload })
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, h.world.runId), eq(schema.runEvents.type, "run.state")));
    expect(halted.map((e) => e.payload)).toContainEqual(
      expect.objectContaining({
        from: "APPROVED",
        to: "HALTED",
        cause: { code: "HALT", ref: "kill_payouts" },
      }),
    );
  });
});

describe("kill_paypal_live after both keys (setFlag HALTs nothing for it)", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("the POST is refused: nothing sent, approvals voided, lines unlocked, the run back in review", async () => {
    const api = h.t.client(h.tokens.treasurer);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: true } });
    expect((await runOf(h)).state).toBe("APPROVED");
    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    expect(script.calls).not.toContain("create_payout_batch");
    expect((await runOf(h)).state).toBe("IN_REVIEW");
    expect((await lineCounts(h)).LOCKED ?? 0).toBe(0);
    expect(await liveApprovals(h)).toHaveLength(0);
    expect((await postTasks(h)).map((t) => t.state)).toEqual(["done"]);
    const refused = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "payout.refused"),
        ),
      );
    expect(refused.map((r) => (r.payload as { code: string }).code)).toEqual(["KILL_SWITCH_ON"]);
  });

  it("once the switch is off, signing again posts the batch", async () => {
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_paypal_live", on: false } });
    await signBoth(h);
    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    expect(script.posted).toHaveLength(1);
    expect((await runOf(h)).state).toBe("POSTED");
  });
});

describe("a POST already written (POSTING) while the switch is on", () => {
  const script = paypalScript();
  let h: RunsHarness;
  const sent: string[] = [];
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("PayPal times out and the treasurer pulls the switch: the task waits, the rows stay SUBMITTED", async () => {
    h.paypal?.use(
      http.post(
        `${PAYPAL_SANDBOX}/v1/payments/payouts`,
        async ({ request }) => {
          const body = (await request.json()) as PostedBatch;
          sent.push(body.sender_batch_header.sender_batch_id);
          await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
          // a timeout: PayPal may or may not hold the batch; the service retries it itself, reading the switch
          return paypalError(408, "REQUEST_TIMEOUT");
        },
        { once: true },
      ),
    );
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect((await runOf(h)).state).toBe("POSTING");
    expect((await postTasks(h)).map((t) => t.state)).toEqual(["queued"]);

    // the retry finds the switch on before it calls PayPal: still waiting, nothing sent, nothing abandoned
    await due(h, "postPayoutBatch");
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(script.calls).not.toContain("create_payout_batch");
    expect((await runOf(h)).state).toBe("POSTING");
    const [task] = await postTasks(h);
    expect(task).toMatchObject({ state: "queued", attempts: 2 });
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
    expect(await liveApprovals(h)).toHaveLength(2);
  });

  it("once the switch is off the same batch is resumed with the same ids and posted", async () => {
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: false } });
    await due(h, "postPayoutBatch");
    await runQueued(h, "postPayoutBatch");
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual(sent);
    expect((await runOf(h)).state).toBe("POSTED");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch).toMatchObject({ paypalBatchId: TEST_BATCH_ID });
    expect((await postTasks(h)).map((t) => t.state)).toEqual(["done"]);
  });
});
