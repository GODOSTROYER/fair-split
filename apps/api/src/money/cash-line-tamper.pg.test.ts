// Security audit T1, finding S1 (inv.i4 at the POST, cash lines): `linesDigest` binds every member line, the cash
// lines too, so "a cash line changed after signing no longer matches either key" (domain approval.ts). The service
// recomputes it from what the repository hands it, `{memberNo, lineSha256}`. If the repository hands it the STORED
// hash without re-hashing the line's own columns, an insider who edits a cash line's amount and leaves its hash alone
// (exactly what the on-rail "change one payout" tamper does to a PayPal line) changes what the clerk pays in cash
// while both signatures still verify, and the batch is posted. The line must be re-hashed from its columns (I4:
// "lines are re-hashed from the DB immediately before POST").
import { schema } from "@fairsplit/db";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PayPalScript, paypalScript } from "../runs/test/paypal.js";

interface Bench {
  h: RunsHarness;
  script: PayPalScript;
}

async function bench(): Promise<Bench> {
  const script = paypalScript();
  const h = await startRuns({ paypal: script.handlers });
  await resolveAll(h);
  await signBoth(h);
  return { h, script };
}

async function runState(b: Bench): Promise<string | undefined> {
  const [run] = await b.h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, b.h.world.runId));
  return run?.state;
}

async function liveApprovals(b: Bench): Promise<number> {
  const rows = await b.h.t.deps.db
    .select({ id: schema.approvals.id })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.runId, b.h.world.runId),
        eq(schema.approvals.decision, "SIGNED"),
        isNull(schema.approvals.voidedAt),
      ),
    );
  return rows.length;
}

describe("inv.i4.lines-digest: a cash line's amount changed after both keys (its stored hash left alone)", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  it("is refused before PayPal: the line is re-hashed from its columns, not read back as its stored hash", async () => {
    const owner = b.h.t.pg?.owner;
    if (!owner) throw new Error("db");
    expect(await liveApprovals(b)).toBeGreaterThan(0);
    const [cash] = await b.h.t.deps.db
      .select({ id: schema.memberLines.id, net: schema.memberLines.netCents })
      .from(schema.memberLines)
      .where(and(eq(schema.memberLines.runId, b.h.world.runId), eq(schema.memberLines.rail, "OFF")))
      .limit(1);
    if (!cash) throw new Error("the seeded run has no cash line");
    // the insider's edit: one more centavo of credit on a cash line, the net with it (the line CHECK holds), and
    // line_sha256 untouched, as the on-rail change_payout tamper leaves it
    await owner.sql`update member_lines set credits_cents = credits_cents + 1, net_cents = net_cents + 1
                     where id = ${cash.id}`;
    await runQueued(b.h, "postPayoutBatch");
    expect(b.script.calls).not.toContain("create_payout_batch");
    const batches = await b.h.t.deps.db
      .select({ id: schema.payoutBatches.id })
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, b.h.world.runId));
    expect(batches).toHaveLength(0);
    expect(await runState(b)).toBe("IN_REVIEW");
    expect(await liveApprovals(b)).toBe(0);
  });
});
