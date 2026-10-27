// "Change one payout after both keys" (plan, Judge Mode; S5 E-03) end to end at this slice's boundary: the
// armed change is applied in its own committed transaction, the REAL PayoutsService re-hashes the batch from
// the database and refuses it before any PayPal call (I4), and the change is undone, compare-and-set, so the
// line equals what code computed and the batch hashes back to exactly what both keys signed. A post that
// throws is undone too; a crash between apply and undo is repaired before the next post, never re-applied.
import { type ApiError, CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { schema, systemScope, verifyChain } from "@fairsplit/db";
import { batchDigest, seasonLabelOf } from "@fairsplit/domain";
import {
  type ApprovedLine,
  type BatchOutcome,
  type PayoutsRepository,
  PayoutsService,
  type PostingSnapshot,
  type SignedApproval,
  senderBatchId,
  senderItemId,
} from "@fairsplit/paypal-payouts";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JUDGE_COOKIE } from "../credentials/verify/index.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { applyArmedTamper, tamperArmed, withArmedTamper } from "./tamper.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
});
afterAll(async () => t.close());
beforeEach(() => t.deps.rateLimits.reset());

type Session = ReturnType<typeof CreateJudgeSessionResponse.parse> & { cookie: string };
let ipSeq = 0;
async function session(): Promise<Session> {
  ipSeq++;
  const r = await t.json<Session>("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "true-client-ip": `198.18.0.${ipSeq}` },
  });
  expect(r.status).toBe(201);
  const cookie = /fs_js=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1] ?? "";
  return { ...CreateJudgeSessionResponse.parse(r.body), cookie };
}

const arm = (s: Session) =>
  t.json<{ armed: boolean } & ApiError>(`/v1/judge/sessions/${s.sessionId}/tamper`, {
    method: "POST",
    body: { kind: "change_payout" },
    headers: { cookie: `${JUDGE_COOKIE.name}=${s.cookie}` },
  });

function owner() {
  if (!t.pg) throw new Error("no database");
  return t.pg.owner;
}

const RECEIVERS: Record<string, string> = { "M-014": "m014@example.com", "M-031": "m031@example.com" };

/** Two LOCKED on-rail lines in the session's run, the run APPROVED: the batch both keys are about to sign. */
async function lockedBatch(s: Session) {
  const members = await t.deps.db
    .select({ id: schema.members.id, no: schema.members.memberNo })
    .from(schema.members)
    .where(
      and(
        eq(schema.members.workspaceId, s.workspaceId),
        inArray(schema.members.memberNo, ["M-014", "M-031"]),
      ),
    );
  const nets = { "M-014": 4369n, "M-031": 2665n } as Record<string, bigint>;
  for (const m of members) {
    await owner()
      .db.insert(schema.memberLines)
      .values({
        workspaceId: s.workspaceId,
        runId: s.runId,
        memberId: m.id,
        state: "LOCKED",
        rail: "ON",
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 1000n,
        premiumCents: nets[m.no] as bigint,
        bonusCents: 0n,
        deductionsCents: 0n,
        creditsCents: 0n,
        netCents: nets[m.no] as bigint,
        deductions: [],
        provenance: "replay",
      });
  }
  await owner().sql`update pay_runs set state = 'APPROVED' where id = ${s.runId}`;
}

/** The run's on-rail lines as the database holds them now (what executeApproved re-reads). */
async function linesNow(s: Session): Promise<(ApprovedLine & { credits: bigint })[]> {
  const rows = await t.deps.db
    .select({
      lineId: schema.memberLines.id,
      memberNo: schema.members.memberNo,
      net: schema.memberLines.netCents,
      credits: schema.memberLines.creditsCents,
    })
    .from(schema.memberLines)
    .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
    .where(and(eq(schema.memberLines.runId, s.runId), eq(schema.memberLines.rail, "ON")))
    .orderBy(asc(schema.memberLines.id));
  return rows.map((r) => ({
    lineId: r.lineId,
    memberNo: r.memberNo,
    receiver: RECEIVERS[r.memberNo] as string,
    amountCents: r.net,
    currency: "USD" as const,
    credits: r.credits,
  }));
}

async function facts(s: Session) {
  const [run] = await t.deps.db
    .select({
      runSeq: schema.payRuns.runSeq,
      seasonCode: schema.payRuns.seasonCode,
      seasonId: schema.payRuns.seasonId,
      rateCardSha256: schema.payRuns.rateCardSha256,
    })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, s.runId));
  if (!run) throw new Error("no run");
  return {
    runId: s.runId,
    runSeq: Number(run.runSeq),
    // PayoutsService names the season as its label (2026-A); the row holds its id code (2026A)
    seasonCode: seasonLabelOf(run.seasonCode),
    seasonId: run.seasonId,
    rateCardSha256: run.rateCardSha256,
    cosign: { ruleId: "R5" as const, batchOverCents: 30_000, lineOverCents: 15_000, anyOverride: true },
  };
}

/** IC-02 batchSha256 over lines, exactly as PayoutsService builds the items. */
function digestOf(f: Awaited<ReturnType<typeof facts>>, lines: readonly ApprovedLine[]): string {
  const sbid = senderBatchId(f);
  return batchDigest(
    { runId: f.runId, senderBatchId: sbid, rateCardSha256: f.rateCardSha256 },
    lines.map((l) => ({
      senderItemId: senderItemId({ runSeq: f.runSeq, memberNo: l.memberNo }),
      receiver: l.receiver,
      amountCents: Number(l.amountCents),
      currency: "USD" as const,
    })),
  ).batchSha256;
}

/** The treasurer's and the Chair's approvals over the batch as it stands now (two people, two keys). */
async function signBoth(s: Session) {
  const f = await facts(s);
  const lines = await linesNow(s);
  const digest = digestOf(f, lines);
  const exp = new Date(t.clock.nowMs() + 20 * 60_000).toISOString();
  const payload = (role: "treasurer" | "chair", approverId: string, nonce: string) => ({
    v: 1 as const,
    runId: s.runId,
    seasonId: f.seasonId,
    rateCardSha256: f.rateCardSha256,
    batchSha256: digest,
    itemCount: lines.length,
    totalCents: lines.reduce((sum, l) => sum + Number(l.amountCents), 0),
    currency: "USD" as const,
    role,
    approverId,
    nonce,
    exp,
  });
  const approvals: SignedApproval[] = [
    {
      role: "treasurer",
      keyId: "fs-analyn-w482913",
      publicKeyHex: "a".repeat(64),
      payload: payload("treasurer", "treasurer:analyn", "nonce-treasurer-1"),
      signatureHex: "b".repeat(128),
    },
    {
      role: "chair",
      keyId: "fs-ernesto-w104729",
      publicKeyHex: "c".repeat(64),
      payload: payload("chair", "board:ernesto", "nonce-chair-0001"),
      signatureHex: "d".repeat(128),
    },
  ];
  return { facts: f, digest, approvals };
}

/**
 * The real PayoutsService over this run: lines re-read from Postgres at the moment of the post; any PayPal
 * request or any write fails the test (a refused batch writes nothing and sends nothing).
 */
function service(s: Session, signed: Awaited<ReturnType<typeof signBoth>>) {
  const paypal: unknown[] = [];
  const refuse = async (what: string): Promise<never> => {
    throw new Error(`a refused post must not ${what}`);
  };
  const repo: PayoutsRepository = {
    async loadPosting(runId): Promise<PostingSnapshot | null> {
      if (runId !== s.runId) return null;
      const lines = (await linesNow(s)).map(({ credits: _c, ...l }) => l);
      return { ...signed.facts, lines, approvals: signed.approvals, overrides: 0, submitted: null };
    },
    loadRun: async () => null,
    writeSubmitted: () => refuse("write the batch"),
    markPosted: () => refuse("mark a batch posted"),
    markRejected: () => refuse("mark a batch rejected"),
    findItem: async () => null,
    findSupersedingItem: async () => null,
    markCancelRequested: () => refuse("cancel"),
    applyItemStatus: () => refuse("apply a status"),
  };
  const svc = new PayoutsService({
    http: {
      request: async (r) => {
        paypal.push(r);
        throw new Error("a refused post must not reach PayPal");
      },
    },
    repo,
    batchDigest: (run, items) =>
      batchDigest(
        run,
        items.map((i) => ({ ...i, amountCents: Number(i.amountCents) })),
      ).batchSha256,
    verifyApprovalSignature: async () => true,
    killSwitch: async () => false,
    limits: {
      maxBatchTotalCents: 40_000n,
      maxItems: 8,
      receiverAllowed: (r) => Object.values(RECEIVERS).includes(r),
    },
    now: () => t.clock.now(),
    sleep: async () => undefined,
  });
  return { svc, paypal };
}

async function tamperLedger(s: Session) {
  const rows = await t.deps.db
    .select({ kind: schema.ledgerEntries.kind, payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.workspaceId, s.workspaceId), eq(schema.ledgerEntries.runId, s.runId)))
    .orderBy(asc(schema.ledgerEntries.seq));
  return rows.filter((r) => r.kind.startsWith("judge.tamper."));
}

describe("change one payout after both keys (simulated, labelled)", () => {
  it("inv.i4.digest: the real PayoutsService refuses the 1-cent change before PayPal, and the change is undone", async () => {
    const s = await session();
    expect((await arm(s)).body.armed).toBe(true);
    await lockedBatch(s);
    const before = await linesNow(s);
    const signed = await signBoth(s);
    const { svc, paypal } = service(s, signed);

    let during: bigint[] = [];
    const outcome = await withArmedTamper(
      t.deps,
      { scope: systemScope(s.workspaceId), runId: s.runId },
      async () => {
        during = (await linesNow(s)).map((l) => l.amountCents);
        return svc.executeApproved(s.runId);
      },
    );

    // the post saw one line a cent higher, exactly as an insider's edit would leave it…
    expect(during).toEqual(before.map((l, i) => l.amountCents + (i === 0 ? 1n : 0n)));
    // …and refused it: the approvals sign another digest (I4). Nothing reached PayPal.
    expect(outcome).toMatchObject({ kind: "refused", code: "DIGEST_MISMATCH" });
    expect(paypal).toHaveLength(0);
    // the change is undone: every line is what code computed, and the batch re-hashes to what both keys signed
    expect(await linesNow(s)).toEqual(before);
    expect(digestOf(signed.facts, await linesNow(s))).toBe(signed.digest);
    const ledger = await tamperLedger(s);
    expect(ledger.map((l) => l.kind)).toEqual([
      "judge.tamper.armed",
      "judge.tamper.applied",
      "judge.tamper.reverted",
    ]);
    expect(ledger[1]?.payload).toMatchObject({ lineId: before[0]?.lineId, deltaCents: 1, simulated: true });
    expect(ledger[2]?.payload).toMatchObject({
      restored: true,
      reason: "refused:DIGEST_MISMATCH",
      simulated: true,
    });
    expect(await tamperArmed(t.deps.db, s.workspaceId, s.runId)).toBe(false);
    expect(await verifyChain(t.deps.db, s.workspaceId)).toMatchObject({ ok: true });
  });

  it("a post that throws is undone too; arming answers the truth (409 while applied, armed again after)", async () => {
    const s = await session();
    await arm(s);
    await lockedBatch(s);
    const before = await linesNow(s);
    const scope = systemScope(s.workspaceId);
    let armWhileApplied: number | null = null;
    await expect(
      withArmedTamper(t.deps, { scope, runId: s.runId }, async () => {
        armWhileApplied = (await arm(s)).status;
        throw new Error("the POST blew up");
      }),
    ).rejects.toThrow("the POST blew up");
    expect(armWhileApplied).toBe(409);
    expect(await linesNow(s)).toEqual(before);
    expect((await tamperLedger(s)).at(-1)?.payload).toMatchObject({ reason: "post_failed", restored: true });
    // the run slice sends the refused run back to review: the judge may arm the change again
    await owner().sql`update pay_runs set state = 'IN_REVIEW' where id = ${s.runId}`;
    const again = await arm(s);
    expect(again.status).toBe(200);
    expect(again.body.armed).toBe(true);
    expect(await tamperArmed(t.deps.db, s.workspaceId, s.runId)).toBe(true);
  });

  it("a crash between apply and undo is repaired before the next post, which is never tampered twice", async () => {
    const s = await session();
    await arm(s);
    await lockedBatch(s);
    const before = await linesNow(s);
    const scope = systemScope(s.workspaceId);
    // an attempt applied the change and died before PayoutsService answered
    const applied = await t.deps.db.transaction((tx) => applyArmedTamper(tx, scope, s.runId, t.clock.now()));
    expect(applied).toMatchObject({ applied: true, lineId: before[0]?.lineId });
    expect((await linesNow(s))[0]?.amountCents).toBe((before[0]?.amountCents ?? 0n) + 1n);
    // the retry: the leftover change is undone first, and the post sees the batch as code computed it
    let seen: bigint[] = [];
    const ok: BatchOutcome = {
      kind: "refused",
      code: "KILL_SWITCH_ON",
      reason: "paused",
      senderBatchId: null,
    };
    await withArmedTamper(t.deps, { scope, runId: s.runId }, async () => {
      seen = (await linesNow(s)).map((l) => l.amountCents);
      return ok;
    });
    expect(seen).toEqual(before.map((l) => l.amountCents));
    expect((await tamperLedger(s)).map((l) => [l.kind, (l.payload as { reason?: string }).reason])).toEqual([
      ["judge.tamper.armed", undefined],
      ["judge.tamper.applied", undefined],
      ["judge.tamper.reverted", "recovered"],
    ]);
  });

  it("an undo never overwrites a line code has recomputed since (compare-and-set)", async () => {
    const s = await session();
    await arm(s);
    await lockedBatch(s);
    const before = await linesNow(s);
    const scope = systemScope(s.workspaceId);
    await t.deps.db.transaction((tx) => applyArmedTamper(tx, scope, s.runId, t.clock.now()));
    // the run slice recomputed the line from code before the undo ran
    await owner()
      .sql`update member_lines set net_cents = ${String(before[0]?.amountCents)}, credits_cents = 0 where id = ${before[0]?.lineId ?? ""}`;
    await withArmedTamper(t.deps, { scope, runId: s.runId }, async () => ({
      kind: "refused",
      code: "APPROVALS_MISSING",
      reason: "x",
      senderBatchId: null,
    }));
    expect(await linesNow(s)).toEqual(before);
    expect((await tamperLedger(s)).at(-1)?.payload).toMatchObject({ reason: "recovered", restored: false });
  });

  it("if a changed batch ever reached PayPal (I4 broken), the database keeps what was posted and says so", async () => {
    const s = await session();
    await arm(s);
    await lockedBatch(s);
    const before = await linesNow(s);
    const posted = await withArmedTamper(
      t.deps,
      { scope: systemScope(s.workspaceId), runId: s.runId },
      async (): Promise<BatchOutcome> => ({
        kind: "created",
        senderBatchId: "2026A-escape-r1",
        payoutBatchId: "ESCAPED01",
        batchStatus: "PENDING",
        batchSha256: "e".repeat(64),
        requestId: "f".repeat(64),
        debugId: null,
        attempts: 1,
        verifiedBy: null,
      }),
    );
    expect(posted.kind).toBe("created");
    expect((await linesNow(s))[0]?.amountCents).toBe((before[0]?.amountCents ?? 0n) + 1n);
    expect((await tamperLedger(s)).map((l) => l.kind)).toEqual([
      "judge.tamper.armed",
      "judge.tamper.applied",
      "judge.tamper.escaped",
    ]);
  });

  it("does nothing outside judge workspaces, or when nothing is armed", async () => {
    const fx = await t.fixture({ kind: "showcase", withRun: true });
    const scope = systemScope(fx.workspaceId);
    const out = await t.deps.db.transaction((tx) =>
      applyArmedTamper(tx, scope, fx.runId as string, t.clock.now()),
    );
    expect(out).toEqual({ applied: false });
    const s = await session();
    await lockedBatch(s);
    const before = await linesNow(s);
    await withArmedTamper(t.deps, { scope: systemScope(s.workspaceId), runId: s.runId }, async () => ({
      kind: "refused",
      code: "KILL_SWITCH_ON",
      reason: "x",
      senderBatchId: null,
    }));
    expect(await linesNow(s)).toEqual(before);
    expect(await tamperLedger(s)).toHaveLength(0);
  });
});
