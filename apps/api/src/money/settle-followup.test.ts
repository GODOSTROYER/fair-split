// The settle GET's follow-ups (+90 s, +10 min) exist only for items still open (S3.6.5: "again at +90 s and +10 min
// only while an item is open"). One queued while an item was open can come due after every item became terminal
// (a webhook settled it first); it then has nothing to read, so it makes no PayPal call. Before, it read the batch
// anyway, and after a restart of the in-process simulator that GET failed until the task died. The first GET (n=1)
// still reads the batch whatever its items say (its status and fees). On embedded Postgres, PayPal answered by msw.
import { schema } from "@fairsplit/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { settleBatch } from "./settle.js";

const script = paypalScript({ parked: [] });
let h: RunsHarness;
let batchId = "";
const gets = () => script.calls.filter((c) => c === "get_payout_batch").length;

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: {} });
  await resolveAll(h);
  await signBoth(h);
  await runQueued(h, "postPayoutBatch");
  const [batch] = await h.t.deps.db
    .select({ id: schema.payoutBatches.id })
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  batchId = batch?.id as string;
});
afterAll(async () => h?.close());

describe("settleBatch: a follow-up GET with every item terminal makes no PayPal call", () => {
  it("the first GET settles every item (no one is parked) and the run settles", async () => {
    const before = gets();
    await settleBatch(h.t.deps, { batchId, n: 1 }, { workspaceId: h.world.workspaceId });
    expect(gets()).toBe(before + 1);
    const items = await h.t.deps.db
      .select({ status: schema.payoutItems.status })
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.batchId, batchId));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.status === "SUCCESS")).toBe(true);
    const [run] = await h.t.deps.db
      .select({ state: schema.payRuns.state })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, h.world.runId));
    expect(run?.state).toBe("SETTLED");
  });

  it("a stale +90 s or +10 min follow-up then reads nothing", async () => {
    const before = gets();
    await settleBatch(h.t.deps, { batchId, n: 2 }, { workspaceId: h.world.workspaceId });
    await settleBatch(h.t.deps, { batchId, n: 3 }, { workspaceId: h.world.workspaceId });
    expect(gets()).toBe(before);
  });

  it("a first GET (a webhook's, or the scheduled one) still reads the batch", async () => {
    const before = gets();
    await settleBatch(h.t.deps, { batchId, n: 1 }, { workspaceId: h.world.workspaceId });
    expect(gets()).toBe(before + 1);
  });
});
