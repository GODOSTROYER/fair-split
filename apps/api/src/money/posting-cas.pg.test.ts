// inv.i4 / inv.i6 at the write boundary, on Postgres: the PayoutsRepository's compare-and-sets behind the real
// PayoutsService (money/payouts.ts), driven by concurrent executors of one run.
//
//   writeSubmitted (primary)  APPROVED → POSTING only while every approval the service checked
//                             (`SubmittedBatch.approvalNonces`) is a live SIGNED approval of the run over this
//                             very digest; otherwise null and nothing written. Rows under the sender_batch_id are
//                             never overwritten: a second writer gets their mark.
//   voidApprovals             only while the run is APPROVED and every live approval is one it names: those voided,
//                             lines unlocked, `payout.refused`, APPROVED → IN_REVIEW; otherwise nothing.
//   loadPosting / loadRun     every member line {memberNo, lineSha256} (on and off rail) and the spent nonces.
//
// Every run_events row these writes leave is an IC-01 RunEvent (the typed SSE client rejects anything else).
import { randomUUID } from "node:crypto";
import { RunEvent } from "@fairsplit/contracts";
import { schema, systemScope } from "@fairsplit/db";
import type { PayoutsRepository, SubmittedBatch } from "@fairsplit/paypal-payouts";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PayPalScript, paypalScript } from "../runs/test/paypal.js";
import { toRunEventEnvelope } from "../sse/envelope.js";
import { payoutsRepository, payoutsServiceFor } from "./payouts.js";

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

const scope = (b: Bench) => systemScope(b.h.world.workspaceId, ACTORS.outbox);
const repo = (b: Bench) => payoutsRepository(b.h.t.deps, scope(b));

async function runOf(b: Bench) {
  const [run] = await b.h.t.deps.db
    .select()
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, b.h.world.runId));
  if (!run) throw new Error("run");
  return run;
}

async function batches(b: Bench) {
  return b.h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, b.h.world.runId));
}

async function liveNonces(b: Bench): Promise<string[]> {
  const rows = await b.h.t.deps.db
    .select({ nonce: schema.approvals.nonce })
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.runId, b.h.world.runId),
        eq(schema.approvals.decision, "SIGNED"),
        isNull(schema.approvals.voidedAt),
      ),
    );
  return rows.map((r) => r.nonce ?? "").sort();
}

async function lineStates(b: Bench, rail: "ON" | "OFF" = "ON"): Promise<string[]> {
  const rows = await b.h.t.deps.db
    .select({ state: schema.memberLines.state })
    .from(schema.memberLines)
    .where(and(eq(schema.memberLines.runId, b.h.world.runId), eq(schema.memberLines.rail, rail)));
  return [...new Set(rows.map((r) => r.state))].sort();
}

async function ledgerKinds(b: Bench, kind: string) {
  return b.h.t.deps.db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.runId, b.h.world.runId), eq(schema.ledgerEntries.kind, kind)));
}

/** The run's state moves, in order, from its run_events. */
async function runMoves(b: Bench): Promise<string[]> {
  const rows = await b.h.t.deps.db
    .select({ payload: schema.runEvents.payload })
    .from(schema.runEvents)
    .where(and(eq(schema.runEvents.runId, b.h.world.runId), eq(schema.runEvents.type, "run.state")))
    .orderBy(asc(schema.runEvents.id));
  return rows.map((r) => {
    const p = r.payload as { from: string; to: string };
    return `${p.from}→${p.to}`;
  });
}

/** Every run_events row of the workspace parses as an IC-01 RunEvent envelope. */
async function expectIc01Events(b: Bench): Promise<void> {
  const rows = await b.h.t.deps.db
    .select()
    .from(schema.runEvents)
    .where(eq(schema.runEvents.workspaceId, b.h.world.workspaceId));
  const bad = rows.filter((r) => !RunEvent.safeParse(toRunEventEnvelope(r as never)).success);
  expect(bad.map((r) => `${r.type} ${JSON.stringify(r.payload)}`)).toEqual([]);
}

/**
 * What the real service would write for the run as it stands: its `SubmittedBatch` (ids, digest, the nonces it
 * checked), captured from a post whose write is withheld, so nothing is written or sent.
 */
async function capturedBatch(b: Bench): Promise<SubmittedBatch> {
  let captured: SubmittedBatch | null = null;
  const service = await payoutsServiceFor(b.h.t.deps, scope(b), {
    repo: (base) => ({
      ...base,
      async writeSubmitted(batch) {
        captured = batch;
        return null;
      },
    }),
  });
  const outcome = await service.executeApproved(b.h.world.runId);
  expect(outcome).toMatchObject({ kind: "refused", code: "INVALID_BATCH" });
  if (!captured) throw new Error("the service never reached its write");
  return captured;
}

/** The treasurer withdraws the approved batch: live approvals voided, run back to IN_REVIEW. */
const withdraw = (b: Bench) =>
  b.h.t.client(b.h.tokens.treasurer).declineApproval({
    params: { runSlug: b.h.world.runSlug },
    body: { role: "treasurer", reason: "Check slip 0462 again" },
  });

/** A PayoutsService whose write first lets `between` run (another request moving the run in the meantime). */
function racing(b: Bench, between: () => Promise<void>) {
  return payoutsServiceFor(b.h.t.deps, scope(b), {
    repo: (base): PayoutsRepository => ({
      ...base,
      async writeSubmitted(batch) {
        await between();
        return base.writeSubmitted(batch);
      },
    }),
  });
}

describe("loadPosting and loadRun: every member line and the spent nonces, from the database", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  it("returns {memberNo, lineSha256} for every member line of the run, on and off rail, as stored", async () => {
    const rows = await b.h.t.deps.db
      .select({ memberNo: schema.members.memberNo, lineSha256: schema.memberLines.lineSha256 })
      .from(schema.memberLines)
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(eq(schema.memberLines.runId, b.h.world.runId));
    expect(new Set(await lineStates(b, "OFF")).size).toBeGreaterThan(0);
    const expected = rows
      .map((r) => ({ memberNo: r.memberNo, lineSha256: r.lineSha256 ?? "" }))
      .sort((x, y) => (x.memberNo < y.memberNo ? -1 : 1));
    const posting = await repo(b).loadPosting(b.h.world.runId);
    expect(posting?.memberLines).toEqual(expected);
    expect((await repo(b).loadRun(b.h.world.runId))?.memberLines).toEqual(expected);
    // the PayPal lines are the LOCKED on-rail ones; the cash lines are in memberLines only
    expect(posting?.lines.length).toBeLessThan(expected.length);
    expect(posting?.approvals.map((a) => a.payload.nonce).sort()).toEqual(await liveNonces(b));
    expect(posting?.approvals.every((a) => a.payload.linesDigest.length === 64)).toBe(true);
  });

  it("spent nonces are the voided approvals' (a re-route's own approval excepted: it authorises only itself)", async () => {
    const first = await liveNonces(b);
    await withdraw(b);
    await signBoth(b.h);
    const owner = b.h.t.pg?.owner.db;
    if (!owner) throw new Error("db");
    const [template] = await owner
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.runId, b.h.world.runId), isNotNull(schema.approvals.voidedAt)))
      .limit(1);
    if (!template) throw new Error("no voided approval");
    const { id: _id, createdAt: _c, ...rest } = template;
    const rerouteNonce = `reroute-${randomUUID()}`;
    await owner.insert(schema.approvals).values({ ...rest, nonce: rerouteNonce, voidReason: "reroute" });
    const facts = await repo(b).loadRun(b.h.world.runId);
    expect([...(facts?.spentNonces ?? [])].sort()).toEqual(first);
    expect(facts?.spentNonces).not.toContain(rerouteNonce);
  });
});

describe("inv.i4.write-cas: writeSubmitted moves the run APPROVED → POSTING only under the approvals checked", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  it("re-approved over a changed batch between the check and the write: nothing written or sent", async () => {
    const first = (await runOf(b)).batchSha256;
    let second = "";
    const service = await racing(b, async () => {
      await withdraw(b);
      await b.h.t
        .client(b.h.tokens.treasurer)
        .enterField({ params: { fieldId: b.h.world.fields0462.gross }, body: { value: "64.90" } });
      ({ batchSha256: second } = await signBoth(b.h));
    });
    const outcome = await service.executeApproved(b.h.world.runId);
    expect(outcome).toMatchObject({ kind: "refused", code: "INVALID_BATCH" });
    expect(second).not.toBe(first);
    expect(b.script.calls).not.toContain("create_payout_batch");
    expect(await batches(b)).toHaveLength(0);
    expect(await runOf(b)).toMatchObject({ state: "APPROVED", batchSha256: second });
    expect(await liveNonces(b)).toHaveLength(2);
  });

  it("re-approved over the same batch: the checked approvals were voided since, so nothing is written either", async () => {
    const signed = (await runOf(b)).batchSha256;
    let fresh: string[] = [];
    const service = await racing(b, async () => {
      await withdraw(b);
      await signBoth(b.h);
      fresh = await liveNonces(b);
    });
    expect(await service.executeApproved(b.h.world.runId)).toMatchObject({
      kind: "refused",
      code: "INVALID_BATCH",
    });
    expect(b.script.calls).not.toContain("create_payout_batch");
    expect(await batches(b)).toHaveLength(0);
    expect(await runOf(b)).toMatchObject({ state: "APPROVED", batchSha256: signed });
    expect(await liveNonces(b)).toEqual(fresh);
  });

  it("an approval named for another digest does not count: null, nothing written", async () => {
    const batch = await capturedBatch(b);
    const out = await repo(b).writeSubmitted({ ...batch, batchSha256: "e".repeat(64) });
    expect(out).toBeNull();
    expect(await batches(b)).toHaveLength(0);
    expect((await runOf(b)).state).toBe("APPROVED");
  });

  it("two executors write one batch at once: one write and one move, both answered with the same mark", async () => {
    const batch = await capturedBatch(b);
    const [x, y] = await Promise.all([repo(b).writeSubmitted(batch), repo(b).writeSubmitted(batch)]);
    expect(x).toEqual({ at: batch.at, batchSha256: batch.batchSha256 });
    expect(y).toEqual(x);
    expect(await batches(b)).toHaveLength(1);
    const items = await b.h.t.deps.db
      .select()
      .from(schema.payoutItems)
      .innerJoin(schema.payoutBatches, eq(schema.payoutBatches.id, schema.payoutItems.batchId))
      .where(eq(schema.payoutBatches.runId, b.h.world.runId));
    expect(items).toHaveLength(batch.items.length);
    expect((await runMoves(b)).filter((m) => m === "APPROVED→POSTING")).toHaveLength(1);
    expect(await lineStates(b)).toEqual(["SUBMITTED"]);
    expect(await ledgerKinds(b, "payout.submitting")).toHaveLength(1);
  });

  it("rows under the id are never overwritten: a write with another digest gets the stored mark", async () => {
    const [stored] = await batches(b);
    const other = await repo(b).writeSubmitted({
      runId: b.h.world.runId,
      kind: "primary",
      senderBatchId: stored?.senderBatchId ?? "",
      requestId: "f".repeat(64),
      batchSha256: "d".repeat(64),
      note: "x",
      totalCents: 1n,
      currency: "USD",
      items: [],
      approvalNonces: await liveNonces(b),
      at: new Date().toISOString(),
    });
    expect(other).toEqual({ at: stored?.submittedAt.toISOString(), batchSha256: stored?.batchSha256 });
    expect(await batches(b)).toHaveLength(1);
  });

  it("the live generation's own POST resumes those rows and pays exactly what was signed, once", async () => {
    const [stored] = await batches(b);
    expect(await runQueued(b.h, "postPayoutBatch")).toBeGreaterThan(0);
    expect(b.script.posted).toHaveLength(1);
    expect(b.script.posted[0]?.sender_batch_header.sender_batch_id).toBe(stored?.senderBatchId);
    expect((await batches(b))[0]?.batchSha256).toBe(stored?.batchSha256);
    expect((await runOf(b)).state).toBe("POSTED");
    await expectIc01Events(b);
  });
});

describe("inv.i6.void-cas: voidApprovals only while the run is APPROVED and every live approval is named", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  const voiding = (nonces: readonly string[]) => ({
    runId: b.h.world.runId,
    nonces,
    code: "DIGEST_MISMATCH" as const,
    reason: "The batch changed after it was signed. Nothing was sent.",
    at: b.h.t.clock.now().toISOString(),
  });

  it("a stale void (the set it checked was replaced by a newer signing) writes nothing", async () => {
    const stale = await liveNonces(b);
    await withdraw(b);
    await signBoth(b.h);
    const fresh = await liveNonces(b);
    const before = await runOf(b);
    await repo(b).voidApprovals(voiding(stale));
    expect(await liveNonces(b)).toEqual(fresh);
    expect(await runOf(b)).toEqual(before);
    expect(await lineStates(b)).toEqual(["LOCKED"]);
    expect(await ledgerKinds(b, "payout.refused")).toHaveLength(0);
  });

  it("a void naming only part of the live set writes nothing", async () => {
    const live = await liveNonces(b);
    await repo(b).voidApprovals(voiding(live.slice(0, 1)));
    expect(await liveNonces(b)).toEqual(live);
    expect((await runOf(b)).state).toBe("APPROVED");
  });

  it("naming every live approval: voided, lines unlocked, payout.refused recorded, APPROVED → IN_REVIEW", async () => {
    const live = await liveNonces(b);
    await repo(b).voidApprovals(voiding(live));
    expect(await liveNonces(b)).toEqual([]);
    const voided = await b.h.t.deps.db
      .select({ nonce: schema.approvals.nonce, reason: schema.approvals.voidReason })
      .from(schema.approvals)
      .where(and(eq(schema.approvals.runId, b.h.world.runId), isNotNull(schema.approvals.voidedAt)));
    expect(voided.filter((v) => live.includes(v.nonce ?? "")).map((v) => v.reason)).toEqual([
      "refused:DIGEST_MISMATCH",
      "refused:DIGEST_MISMATCH",
    ]);
    expect((await runOf(b)).state).toBe("IN_REVIEW");
    expect(await lineStates(b)).not.toContain("LOCKED");
    expect(await ledgerKinds(b, "payout.refused")).toHaveLength(1);
    expect((await runMoves(b)).at(-1)).toBe("APPROVED→IN_REVIEW");
  });

  it("a void after another executor wrote its rows (the run is POSTING) writes nothing", async () => {
    await signBoth(b.h);
    const batch = await capturedBatch(b);
    expect(await repo(b).writeSubmitted(batch)).not.toBeNull();
    const live = await liveNonces(b);
    await repo(b).voidApprovals(voiding(live));
    expect(await liveNonces(b)).toEqual(live);
    expect((await runOf(b)).state).toBe("POSTING");
    await expectIc01Events(b);
  });
});

describe("a void and a write racing on one run: exactly one of them takes effect", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  it("two executors, one refusing (void) and one posting (write), at once: never both, never neither", async () => {
    for (let round = 0; round < 3; round++) {
      const batch = await capturedBatch(b);
      const nonces = [...batch.approvalNonces];
      const [, written] = await Promise.all([
        repo(b).voidApprovals({
          runId: b.h.world.runId,
          nonces,
          code: "DIGEST_MISMATCH",
          reason: "stale",
          at: b.h.t.clock.now().toISOString(),
        }),
        repo(b).writeSubmitted(batch),
      ]);
      const state = (await runOf(b)).state;
      const rows = (await batches(b)).length;
      const live = await liveNonces(b);
      if (written) {
        // the write won: rows under these approvals, which stay live; the void found the run POSTING
        expect({ state, rows, live }).toEqual({ state: "POSTING", rows: 1, live: [...nonces].sort() });
        await expectIc01Events(b);
        return;
      }
      // the void won: the approvals are voided and the run is back in review; the write found them voided
      expect({ state, rows, live }).toEqual({ state: "IN_REVIEW", rows: 0, live: [] });
      await signBoth(b.h);
    }
    // three voids in a row are possible but the invariant held each time; one write must also be shown
    const batch = await capturedBatch(b);
    expect(await repo(b).writeSubmitted(batch)).not.toBeNull();
    expect((await runOf(b)).state).toBe("POSTING");
    await expectIc01Events(b);
  });
});

describe("inv.i4.lines-digest: a cash line changed after both keys signed is refused before PayPal", () => {
  let b: Bench;
  beforeAll(async () => {
    b = await bench();
  });
  afterAll(async () => b?.h.close());

  it("the service recomputes linesDigest from every member line: DIGEST_MISMATCH, approvals voided, nothing sent", async () => {
    const owner = b.h.t.pg?.owner;
    if (!owner) throw new Error("db");
    const signed = await liveNonces(b);
    // an insider rewrites one off-rail (cash) line's stored hash behind the signatures' back
    const [cash] = await b.h.t.deps.db
      .select({ id: schema.memberLines.id })
      .from(schema.memberLines)
      .where(and(eq(schema.memberLines.runId, b.h.world.runId), eq(schema.memberLines.rail, "OFF")))
      .limit(1);
    await owner.sql`update member_lines set line_sha256 = ${"9".repeat(64)} where id = ${cash?.id ?? ""}`;
    await runQueued(b.h, "postPayoutBatch");
    expect(b.script.calls).not.toContain("create_payout_batch");
    expect(await batches(b)).toHaveLength(0);
    expect(await liveNonces(b)).toEqual([]);
    expect((await runOf(b)).state).toBe("IN_REVIEW");
    const refused = await ledgerKinds(b, "payout.refused");
    expect(refused.map((r) => (r.payload as { code: string }).code)).toEqual(["DIGEST_MISMATCH"]);
    const voided = await b.h.t.deps.db
      .select({ nonce: schema.approvals.nonce })
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.runId, b.h.world.runId),
          sql`${schema.approvals.voidReason} = 'refused:DIGEST_MISMATCH'`,
        ),
      );
    expect(voided.map((v) => v.nonce ?? "").sort()).toEqual(signed);
    await expectIc01Events(b);
  });
});
