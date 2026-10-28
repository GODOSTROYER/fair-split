// S3.6.4 step 4: a receiver guard failure is a visible, labelled refusal, never a silent omission. On the
// sandbox rail a PayPal member whose address is not configured (PP_RECEIVERS) cannot be paid. Leaving them out
// of the batch would let both keys sign a smaller batch while the member's line stays READY on-rail forever and
// the run still settles (I3: money conserved to the cent). Code refuses to build that batch for signing and
// names who is missing; and a receiver that disappears after both keys stops the POST by name.
import type { ApprovalPayload } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type RunsHarness,
  resolveAll,
  runQueued,
  SANDBOX_RECEIVERS,
  signBoth,
  startRuns,
} from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { registerKey } from "../runs/test/world.js";

interface BatchBody {
  items: { memberNo: string; receiver: string; amountCents: number }[];
  itemCount: number;
  totalCents: number;
  batchSha256: string | null;
  linesDigest: string | null;
  unpayable: string[];
}

const figures = getSnapshot().figures;
const { "M-014": _missing, ...withoutM014 } = SANDBOX_RECEIVERS;

const batchOf = (h: RunsHarness) =>
  h.t.json<BatchBody>(`/v1/runs/${h.world.runSlug}/batch`, {
    as: h.t.credentials.bearer(h.tokens.treasurer),
  });

const runStateOf = async (h: RunsHarness) =>
  (
    await h.t.json<{ run: { state: string } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    })
  ).body.run.state;

describe("a PayPal member with no configured receiver, before anyone signs (sandbox rail)", () => {
  let h: RunsHarness;
  let analyn: Awaited<ReturnType<typeof registerKey>>;
  beforeAll(async () => {
    h = await startRuns({ paypal: paypalScript().handlers, receivers: withoutM014 });
    await resolveAll(h);
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    analyn = await registerKey(db, h.world.workspaceId, { keyId: "fs-analyn-a1", persona: "analyn" });
  });
  afterAll(async () => h?.close());

  it("/batch names who would be left out, so the slab can say so before anyone signs", async () => {
    const r = await batchOf(h);
    expect(r.status).toBe(200);
    expect(r.body.unpayable).toEqual(["M-014"]);
    expect(r.body.items).toHaveLength(figures.batchItemCount - 1);
    expect(r.body.items.map((i) => i.memberNo)).not.toContain("M-014");
  });

  it("approvalPayload refuses the batch and lists the member", async () => {
    await expect(
      h.t
        .client(h.tokens.treasurer)
        .approvalPayload({ params: { runSlug: h.world.runSlug }, query: { role: "treasurer" } }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409, details: { unpayable: ["M-014"] } });
  });

  it("submitApproval refuses a signature over the smaller batch; nothing is stored and the run stays in review", async () => {
    const b = (await batchOf(h)).body;
    if (!b.batchSha256) throw new Error("the seven payable items still hash");
    const payload: ApprovalPayload = {
      v: 1,
      runId: h.world.runId,
      seasonId: h.world.seasonId,
      rateCardSha256: h.world.rateCardSha256,
      batchSha256: b.batchSha256,
      linesDigest: b.linesDigest ?? "",
      itemCount: b.itemCount,
      totalCents: b.totalCents,
      currency: "USD",
      role: "treasurer",
      approverId: "treasurer:analyn",
      nonce: "nonce-unpayable-0001",
      exp: new Date(h.t.clock.nowMs() + 10 * 60_000).toISOString(),
    };
    await expect(
      h.t.client(h.tokens.treasurer).submitApproval({
        params: { runSlug: h.world.runSlug },
        body: {
          role: "treasurer",
          keyId: "fs-analyn-a1",
          signature: ed25519Sign(analyn.privateKey, approvalBytes(payload)),
          payload,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", details: { unpayable: ["M-014"] } });
    const stored = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.runId, h.world.runId));
    expect(stored).toHaveLength(0);
    expect(await runStateOf(h)).toBe("IN_REVIEW");
  });
});

describe("a receiver that disappears after both keys (configuration changed before the POST)", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("the POST is refused as an invalid batch, never sent without the member: back to review", async () => {
    const paypal = h.t.deps.env.paypal as { receivers: string | undefined };
    const before = paypal.receivers;
    paypal.receivers = JSON.stringify(withoutM014);
    try {
      expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    } finally {
      paypal.receivers = before;
    }
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await runStateOf(h)).toBe("IN_REVIEW");
    const refused = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "payout.refused"),
        ),
      );
    expect(refused.map((r) => (r.payload as { code: string }).code)).toEqual(["INVALID_BATCH"]);
  });
});
