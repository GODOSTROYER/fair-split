// inv.i4: the approved digest is the payout. "Try to break it: change one payout after both keys" (plan, Judge
// Mode): a line changed by one cent after both signatures never reaches PayPal. PayoutsService re-hashes the
// batch from the database before the POST, refuses the mismatch and sends nothing; the run goes back to
// IN_REVIEW with both approvals voided and its lines unlocked.
import { schema } from "@fairsplit/db";
import { batchDigest, parseDecimalMinor } from "@fairsplit/domain";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";

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
    // Tamper M-060's PayPal line: the later legal correction is her slip 0462 by hand.
    const memberId = h.world.memberId.get("M-060");
    if (!memberId) throw new Error("M-060");
    const [locked] = await owner
      .select({ id: schema.memberLines.id })
      .from(schema.memberLines)
      .where(
        and(
          eq(schema.memberLines.runId, h.world.runId),
          eq(schema.memberLines.memberId, memberId),
          eq(schema.memberLines.state, "LOCKED"),
        ),
      )
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

  it("fresh hashes refuse another signature until the tampered lines are recomputed", async () => {
    await expect(signBoth(h)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      status: 409,
      message:
        "The stored member lines differ from the latest computation: recompute the run before anyone signs.",
    });
    expect(script.calls.filter((c) => c === "create_payout_batch")).toHaveLength(0);
  });

  it("a legal by-hand edit and signing again bind the changed batch, which is the one posted", async () => {
    // Re-enter through the review command: code derives the corrected line amounts and their fresh hashes.
    await h.t
      .client(h.tokens.treasurer)
      .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.90" } });
    const { batchSha256 } = await signBoth(h);
    expect(batchSha256).not.toBe(signedFirst);
    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    expect(script.posted).toHaveLength(1);
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.batchSha256).toBe(batchSha256);
    const posted = script.posted[0];
    if (!posted) throw new Error("Expected the approved batch POST.");
    const actual = batchDigest(
      {
        runId: h.world.runId,
        senderBatchId: posted.sender_batch_header.sender_batch_id,
        rateCardSha256: h.world.rateCardSha256,
      },
      posted.items.map((item) => {
        const amountCents = parseDecimalMinor(item.amount.value);
        if (amountCents === null) throw new Error("The POST contains an invalid money amount.");
        expect(item.amount.currency).toBe("USD");
        return {
          senderItemId: item.sender_item_id,
          receiver: item.receiver,
          amountCents,
          currency: "USD" as const,
        };
      }),
    );
    expect(actual.batchSha256).toBe(batchSha256);
  });
});
