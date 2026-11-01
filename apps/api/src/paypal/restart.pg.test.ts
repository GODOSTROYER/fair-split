// A restart while a run is in flight on the in-process simulator (ADR-0010). The simulator's state lives in the process,
// so after a restart a batch the previous simulator accepted is unknown to the one now running: its settle GETs fail
// (they used to retry until dead), its items stay where the previous simulator left them, and a judge workspace holding
// it can never be purged (fs_purge_workspace refuses while an item is not terminal). The rule (paypal/boot.ts step 1,
// money/settle.ts): at boot each such batch is recorded once in its workspace's ledger as `payout.stranded`
// (reason `simulator_restarted`): in a judge workspace the outcome is `demo_run_ended`, and anywhere else
// `left_for_a_person`, never rewritten. No item is marked paid, failed or returned that the simulator did not report;
// the run stays where it stood; its settle GETs then end at once with no PayPal call instead of dying.
// On embedded Postgres against the real simulator, one simulator at a time (its interceptor is process-wide).
import { schema } from "@fairsplit/db";
import { createMemoryLimiter } from "@fairsplit/paypal-core";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../env.js";
import type { AppDeps } from "../lib/context.js";
import { PayPalStepError } from "../money/errors.js";
import { STRANDED_BATCH, settleBatch } from "../money/settle.js";
import { type RunsHarness, resolveAll, runQueued, signBoth } from "../runs/test/app.js";
import { TEST_ENV } from "../test/index.js";
import { bootInProcessSimulator } from "./boot.js";
import { createPayPalRail } from "./mode.js";
import type { InProcessPayPalSimulator } from "./simulator.js";
import { startSimRuns, startTestSimulator, type TestSimulator } from "./test/sim.js";

interface Restarted {
  h: RunsHarness & { sim: InProcessPayPalSimulator };
  /** The simulator after the restart: started empty. */
  s2: TestSimulator;
  /** fs-api's deps after the restart: the same database, a rail on the new simulator. */
  deps: AppDeps;
  batchId: string;
  /** Every REST call the new rail made (`METHOD /path`). */
  calls: string[];
  /** The items as the previous simulator left them. */
  before: { senderItemId: string; status: string }[];
}

async function items(h: RunsHarness) {
  return h.t.deps.db
    .select({ senderItemId: schema.payoutItems.senderItemId, status: schema.payoutItems.status })
    .from(schema.payoutItems)
    .where(eq(schema.payoutItems.workspaceId, h.world.workspaceId))
    .orderBy(schema.payoutItems.senderItemId);
}

async function runState(h: RunsHarness) {
  const [r] = await h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return r?.state;
}

async function stranded(h: RunsHarness) {
  return h.t.deps.db
    .select({ payload: schema.ledgerEntries.payload, actorId: schema.ledgerEntries.actorId })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
        eq(schema.ledgerEntries.kind, STRANDED_BATCH.kind),
      ),
    );
}

/** A run of `kind` POSTed to the simulator, then fs-api restarted before any status came back. */
async function postThenRestart(kind: "judge" | "showcase"): Promise<Restarted> {
  const h = await startSimRuns({ world: { kind, runState: "QUOTED" } });
  const treasurer = h.t.credentials.bearer(h.tokens.treasurer);
  const invoiced = await h.t.json(`/v1/runs/${h.world.runSlug}/invoice`, {
    method: "POST",
    body: {},
    as: treasurer,
  });
  expect(invoiced.status, JSON.stringify(invoiced.body)).toBe(200);
  if (kind !== "judge") {
    // outside Judge Mode the send waits for the treasurer's approval (sendNeedsTreasurer)
    const sent = await h.t.json(`/v1/runs/${h.world.runSlug}/invoice/approve-send`, {
      method: "POST",
      body: {},
      as: treasurer,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  }
  await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
  await runQueued(h, "computeRun");
  await resolveAll(h);
  await signBoth(h);
  expect(await runQueued(h, "postPayoutBatch")).toBe(1);
  expect(await runState(h)).toBe("POSTED");
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  expect(batch?.paypalBatchId).toBeTruthy();
  expect(batch?.provenance).toBe("simulated_rail");
  const before = await items(h);
  expect(before.some((i) => ["SUBMITTED", "PENDING", "ONHOLD", "UNCLAIMED"].includes(i.status))).toBe(true);

  // the restart: the simulator, and every batch and item it held, is gone; the one that starts now is empty
  await h.sim.stop();
  const s2 = await startTestSimulator();
  const calls: string[] = [];
  const rail = s2.sim.rail;
  const counted = {
    ...rail,
    fetch: (request: Request) => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      return rail.fetch(request);
    },
  };
  const deps: AppDeps = {
    ...h.t.deps,
    paypal: createPayPalRail({
      paypal: parseEnv({ ...TEST_ENV, ...s2.env }).paypal,
      limiter: createMemoryLimiter(),
      simulator: counted,
    }),
  };
  return { h, s2, deps, batchId: batch?.id as string, calls, before };
}

const settleGets = (calls: string[]) => calls.filter((c) => c.startsWith("GET /v1/payments/payouts/"));

describe("a judge run POSTed, then fs-api restarted: the demo run ends, labelled, and nothing is invented", () => {
  let r: Restarted;
  beforeAll(async () => {
    r = await postThenRestart("judge");
  });
  afterAll(async () => {
    await r?.s2.sim.stop();
    await r?.h.close();
  });

  it("the hazard: the new simulator never issued the batch, so its settle GET fails (and is retried)", async () => {
    const err = await settleBatch(
      r.deps,
      { batchId: r.batchId, n: 1 },
      { workspaceId: r.h.world.workspaceId },
    )
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalStepError);
    expect((err as PayPalStepError).opts.transient).toBe(true);
    expect(settleGets(r.calls)).toHaveLength(1);
  });

  it("at boot the batch is recorded once as stranded: outcome demo_run_ended, its open items counted", async () => {
    const stop = await bootInProcessSimulator(r.deps);
    stop();
    const entries = await stranded(r.h);
    expect(entries).toHaveLength(1);
    const open = r.before.filter((i) => !["SUCCESS", "RETURNED", "FAILED", "BLOCKED"].includes(i.status));
    expect(entries[0]).toMatchObject({
      actorId: "system:paypal-sim-boot",
      payload: {
        batchId: r.batchId,
        runId: r.h.world.runId,
        reason: STRANDED_BATCH.reason,
        outcome: STRANDED_BATCH.judge.outcome,
        openItems: open.length,
      },
    });
    expect(STRANDED_BATCH.judge.label).toBe("The simulated PayPal sandbox restarted; this demo run ended");
  });

  it("no item is marked paid, failed or returned, and the run stays where it stood", async () => {
    expect(await items(r.h)).toEqual(r.before);
    expect(await runState(r.h)).toBe("POSTED");
  });

  it("its settle GETs, first and follow-up, now end at once with no PayPal call (no dead row)", async () => {
    r.calls.length = 0;
    for (const n of [1, 2, 3]) {
      await settleBatch(r.deps, { batchId: r.batchId, n }, { workspaceId: r.h.world.workspaceId });
    }
    expect(settleGets(r.calls)).toEqual([]);
    expect(await items(r.h)).toEqual(r.before);
  });

  it("a second boot records nothing new", async () => {
    const stop = await bootInProcessSimulator(r.deps);
    stop();
    expect(await stranded(r.h)).toHaveLength(1);
  });
});

describe("a co-op (non-judge) run POSTed, then fs-api restarted: left for a person, never rewritten", () => {
  let r: Restarted;
  beforeAll(async () => {
    r = await postThenRestart("showcase");
  });
  afterAll(async () => {
    await r?.s2.sim.stop();
    await r?.h.close();
  });

  it("the batch is recorded stranded with outcome left_for_a_person; items and run are untouched", async () => {
    const stop = await bootInProcessSimulator(r.deps);
    stop();
    const entries = await stranded(r.h);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toMatchObject({
      batchId: r.batchId,
      reason: STRANDED_BATCH.reason,
      outcome: STRANDED_BATCH.other.outcome,
    });
    expect(await items(r.h)).toEqual(r.before);
    expect(await runState(r.h)).toBe("POSTED");
    r.calls.length = 0;
    await settleBatch(r.deps, { batchId: r.batchId, n: 1 }, { workspaceId: r.h.world.workspaceId });
    expect(settleGets(r.calls)).toEqual([]);
    expect(await items(r.h)).toEqual(r.before);
  });
});
