// inv.i4: the approved digest is the payout. "Try to break it: change one payout after both keys" (plan, Judge
// Mode): a line changed by one cent after both signatures never reaches PayPal. PayoutsService re-hashes the
// batch from the database before the POST, refuses the mismatch and sends nothing; the run goes back to
// IN_REVIEW with both approvals voided and its lines unlocked.
import { schema } from "@fairsplit/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/testing/app.js";
import { paypalScript } from "../runs/testing/paypal.js";

const script = paypalScript();
let h: RunsHarness;
let signedFirst: string;

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers });
  await resolveAll(h);
  ({ batchSha256: signedFirst } = await signBoth(h));
});
afterAll(async () => h?.close());

describe("inv.i4.digest: a one-cent change after both keys", () => {
  it("is refused before the POST: nothing sent, approvals voided, the run back in review", async () => {
    const owner = h.t.pg?.owner.db;
    if (!owner) throw new Error("db");
    // the tamper: one PayPal line gains a cent behind the approvals' back
    const [locked] = await owner
      .select({ id: schema.memberLines.id })
      .from(schema.memberLines)
      .where(and(eq(schema.memberLines.runId, h.world.runId), eq(schema.memberLines.state, "LOCKED")))
      .limit(1);
    await owner
      .update(schema.memberLines)
      .set({
        netCents: sql`${schema.memberLines.netCents} + 1`,
        creditsCents: sql`${schema.memberLines.creditsCents} + 1`,
      })
      .where(eq(schema.memberLines.id, locked?.id as string));

    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    expect(script.calls.filter((c) => c === "create_payout_batch")).toHaveLength(0);
    const run = await h.t.json<{ run: { state: string }; lines: Record<string, number> }>(
      `/v1/runs/${h.world.runSlug}`,
      {
        as: h.t.credentials.bearer(h.tokens.treasurer),
      },
    );
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.lines.LOCKED ?? 0).toBe(0);
    const live = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.runId, h.world.runId),
          eq(schema.approvals.decision, "SIGNED"),
          isNull(schema.approvals.voidedAt),
        ),
      );
    expect(live).toHaveLength(0);
    const refused = await h.t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "payout.refused"),
        ),
      );
    expect(refused.map((r) => (r.payload as { code: string }).code)).toEqual(["DIGEST_MISMATCH"]);
    const batches = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batches).toHaveLength(0);
  });

  it("signing again binds the batch as it now is, and that batch is the one posted", async () => {
    const { batchSha256 } = await signBoth(h);
    expect(batchSha256).not.toBe(signedFirst);
    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    expect(script.posted).toHaveLength(1);
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.batchSha256).toBe(batchSha256);
  });
});
