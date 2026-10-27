// resend (P1) when PayPal refuses the one-item re-route POST synchronously (ERRPYO005): the cancel has landed
// (RETURNED, for a re-route), nothing was paid, and the line needs action. Its own file: one msw server per
// process.
import { randomUUID } from "node:crypto";
import type { ApprovalPayload } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { approvalBytes, batchDigest, ed25519Sign, senderBatchId, senderItemId } from "@fairsplit/domain";
import { eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/testing/app.js";
import { paypalScript } from "../runs/testing/paypal.js";
import { registerKey } from "../runs/testing/world.js";
import { PAYPAL_SANDBOX } from "../test/index.js";
import { settleBatch } from "./settle.js";

interface LineView {
  id: string;
  memberNo: string;
  state: string;
  netCents: number;
}
describe("resend: PAYPAL_REJECTED when PayPal refuses the re-route POST synchronously", () => {
  const own = paypalScript({ parked: ["rhea"] });
  let g: RunsHarness;
  beforeAll(async () => {
    g = await startRuns({ paypal: own.handlers });
    await resolveAll(g);
    await signBoth(g);
    await runQueued(g, "postPayoutBatch");
    const [batch] = await g.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, g.world.runId));
    await settleBatch(g.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: g.world.workspaceId });
  });
  afterAll(async () => g?.close());

  it("the cancel lands (RETURNED, for a re-route), the one-item POST is refused (ERRPYO005): the line needs action", async () => {
    const all = (
      await g.t.json<{ lines: LineView[] }>(`/v1/runs/${g.world.runSlug}/lines`, {
        as: g.t.credentials.bearer(g.tokens.treasurer),
      })
    ).body.lines;
    const rhea = all.find((l) => l.memberNo === "M-031") as LineView;
    expect(rhea.state).toBe("UNCLAIMED");
    const db = g.t.pg?.app.db;
    if (!db) throw new Error("db");
    const key = await registerKey(db, g.world.workspaceId, { keyId: "fs-analyn-a2", persona: "analyn" });
    const sbid = senderBatchId("2026A", g.world.rateCardSha256, g.world.runSeq, 1);
    const receiver = "m014@example.com";
    const digest = batchDigest(
      { runId: g.world.runId, senderBatchId: sbid, rateCardSha256: g.world.rateCardSha256 },
      [
        {
          senderItemId: senderItemId(g.world.runSeq, "M-031", 1),
          receiver,
          amountCents: rhea.netCents,
          currency: "USD",
        },
      ],
    );
    const payload: ApprovalPayload = {
      v: 1,
      runId: g.world.runId,
      seasonId: g.world.seasonId,
      rateCardSha256: g.world.rateCardSha256,
      batchSha256: digest.batchSha256,
      itemCount: 1,
      totalCents: rhea.netCents,
      currency: "USD",
      role: "treasurer",
      approverId: "treasurer:analyn",
      nonce: randomUUID().replaceAll("-", ""),
      exp: new Date(g.t.clock.nowMs() + 20 * 60_000).toISOString(),
    };
    g.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, () =>
        HttpResponse.json(
          {
            name: "INSUFFICIENT_FUNDS",
            message: "Sender does not have sufficient funds.",
            debug_id: "dbg-errpyo005",
            details: [],
            links: [],
          },
          { status: 422, headers: { "paypal-debug-id": "dbg-errpyo005" } },
        ),
      ),
    );
    await expect(
      g.t.client(g.tokens.treasurer).resend({
        params: { lineId: rhea.id },
        body: {
          newReceiver: receiver,
          keyId: "fs-analyn-a2",
          signature: ed25519Sign(key.privateKey, approvalBytes(payload)),
          payload,
        },
      }),
    ).rejects.toMatchObject({ code: "PAYPAL_REJECTED" });
    const after = (
      await g.t.json<{ lines: LineView[] }>(`/v1/runs/${g.world.runSlug}/lines`, {
        as: g.t.credentials.bearer(g.tokens.treasurer),
      })
    ).body.lines;
    expect(after.find((l) => l.memberNo === "M-031")?.state).toBe("NEEDS_ACTION");
    expect(own.calls.filter((c) => c === "cancel_unclaimed")).toHaveLength(1);
  });
});
