// Send-time counting for a judge post (S3.9, plan "Limits", I8; round 3 of the `[ws/api] SECURITY` review), on
// embedded Postgres on the sandbox rail with PayPal answered by msw. A judge post is counted by every quota (the
// rolling 24 h, the clock hour, the session's three, the public third) and by C-21 from a slot dated within one lane
// lease of the moment its POST reaches PayPal:
//   - the drift probe: a POST paced at 02:00, its run's slot held while 39 other posts fill the day and three the
//     hour; the resume at 00:10 the next day WAITS for the next clock hour (it never posts as the hour's fourth),
//     posts at 01:00:01 under a FRESH slot dated then, and is counted 2 h and 23 h after that POST by the judge day,
//     its session, the public third and C-21, so no other judge gets the 41st slot of a day;
//   - a run with two slots in one window counts once, and a post PayPal denies on the fresh slot leaves no spend;
//   - a held slot carries a quick retry (within the threshold) unchanged, and a POST that lands after a balance
//     reading is subtracted from it although its rows were written before it;
//   - a resumed post's peek leaves its own run out (no false wait);
//   - a batch PayPal named (POSTED) or one it holds under our ids but not ours (ADOPT_FAILED) takes no slot again;
//   - I8: the replay rail never marks rows written live as posted.
// Each scenario has its own app, so its own judge quota ledger.
import { randomBytes, randomUUID } from "node:crypto";
import { schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { and, asc, eq, isNull } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  estimateBalance,
  JUDGE_QUOTA,
  judgeRail,
  NO_JUDGE_QUOTA,
  recordBalanceReading,
  replayDecision,
  reserveLivePost,
} from "../judge/index.js";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { estimatedBalanceCents, payoutsServiceFor, postsInLast24h } from "./payouts.js";
import { railForStep, replayDeps } from "./rail.js";
import { resumeStalledPosts } from "./resume.js";

const POSTS = `${PAYPAL_SANDBOX}/v1/payments/payouts`;
const T0 = Date.parse("2026-10-28T02:00:00.000Z"); // the harness clock's start
const H = 3_600_000;
const MIN = 60_000;

interface Sent {
  at: number;
  senderBatchId: string;
  requestId: string | null;
  status: number;
}

/** A judge world on the sandbox rail whose every batch POST is recorded with the (fake) clock's time. */
async function judgeWorld(
  script: ReturnType<typeof paypalScript>,
  o: { clock?: string; balanceCents?: number } = {},
): Promise<{ h: RunsHarness; sent: Sent[] }> {
  const h = await startRuns({
    paypal: script.handlers,
    ...(o.clock ? { clock: o.clock } : {}),
    ...(o.balanceCents !== undefined ? { balanceCents: o.balanceCents } : {}),
  });
  const sent: Sent[] = [];
  // records every POST the script answers (201), then falls through to it
  h.paypal?.use(
    http.post(POSTS, async ({ request }) => {
      const body = (await request.clone().json()) as PostedBatch;
      sent.push({
        at: h.t.clock.nowMs(),
        senderBatchId: body.sender_batch_header.sender_batch_id,
        requestId: request.headers.get("paypal-request-id"),
        status: 201,
      });
    }),
  );
  return { h, sent };
}

/** PayPal answers the next POST with `res` (recorded: it reached PayPal). */
function answerNextPost(h: RunsHarness, sent: Sent[], res: () => Response, status: number) {
  h.paypal?.use(
    http.post(
      POSTS,
      async ({ request }) => {
        const body = (await request.json()) as PostedBatch;
        sent.push({
          at: h.t.clock.nowMs(),
          senderBatchId: body.sender_batch_header.sender_batch_id,
          requestId: request.headers.get("paypal-request-id"),
          status,
        });
        return res();
      },
      { once: true },
    ),
  );
}

/** PayPal paces the next POST (a 429 after the rows are written: the 6-minute circuit opens). */
const paceNextPost = (h: RunsHarness, sent: Sent[]) =>
  answerNextPost(h, sent, () => paypalError(429, "RATE_LIMIT_REACHED"), 429);

/** The next POST is answered 401 twice (PayPalHttp's own resend too): unresolved, retried in 30 s, no circuit. */
function refuseCredentialsOnce(h: RunsHarness, sent: Sent[]) {
  answerNextPost(h, sent, () => paypalError(401, "AUTHENTICATION_FAILURE"), 401);
  answerNextPost(h, sent, () => paypalError(401, "AUTHENTICATION_FAILURE"), 401);
}

async function runState(h: RunsHarness) {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

async function batchOf(h: RunsHarness) {
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  return batch;
}

interface QuotaRow {
  id: string;
  entry: string;
  at: number;
  reservationId?: string;
  outcome?: string;
}

/** The run's rows in the judge quota ledger (reservations and settlements), oldest first. */
async function quotaLedger(h: RunsHarness): Promise<QuotaRow[]> {
  const rows = await h.t.deps.db
    .select({
      id: schema.reconciliationReports.id,
      at: schema.reconciliationReports.windowEnd,
      summary: schema.reconciliationReports.summary,
    })
    .from(schema.reconciliationReports)
    .where(isNull(schema.reconciliationReports.workspaceId))
    .orderBy(asc(schema.reconciliationReports.createdAt), asc(schema.reconciliationReports.id));
  return rows
    .map((r) => ({
      id: r.id,
      at: r.at?.getTime() ?? 0,
      ...(r.summary as { entry: string; runId?: string; reservationId?: string; outcome?: string }),
    }))
    .filter((r) => r.runId === h.world.runId)
    .map(({ id, entry, at, reservationId, outcome }) => ({
      id,
      entry,
      at,
      ...(reservationId ? { reservationId } : {}),
      ...(outcome ? { outcome } : {}),
    }));
}

const shape = (rows: QuotaRow[]) => rows.map((r) => [r.entry, r.outcome ?? null]);

/** Other judges' live posts (coded sessions, so the public third is not what binds), all taken at `at`. */
async function others(h: RunsHarness, n: number, at: Date) {
  for (let i = 0; i < n; i++) {
    await h.t.deps.db.insert(schema.reconciliationReports).values({
      kind: "balance",
      windowEnd: at,
      summary: {
        v: 1,
        entry: "judge_post",
        runId: randomUUID(),
        workspaceId: randomUUID(),
        sessionId: randomUUID(),
        coded: true,
        amountCents: 100,
        rail: "sandbox",
      },
    });
  }
}

/** The nightly reconciliation's balance reading, now. */
const reading = (h: RunsHarness, cents = 100_000_000) =>
  recordBalanceReading(h.t.deps.db, {
    rail: "sandbox",
    availableCents: cents,
    asOf: h.t.clock.now(),
    source: "searchBalances",
  });

/** The workspace belongs to a judge session (no judge code): its posts count for the session and the public. */
async function giveSession(h: RunsHarness): Promise<string> {
  const sessionId = randomUUID();
  await h.t.pg?.owner.db.insert(schema.frameTokens).values({
    workspaceId: h.world.workspaceId,
    tokenSha256: randomBytes(32).toString("hex"),
    sessionId,
    persona: "judge",
    role: "judge",
    expiresAt: new Date(T0 + 30 * 24 * H),
  });
  return sessionId;
}

/** kill_payouts flipped on the co-op's side (as the treasurer's other phone would). */
async function switchPayouts(h: RunsHarness, on: boolean) {
  await h.t.pg?.owner.db
    .insert(schema.systemFlags)
    .values({ workspaceId: h.world.workspaceId, flag: "kill_payouts", on, setBy: "test", setAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.systemFlags.workspaceId, schema.systemFlags.flag],
      set: { on, setBy: "test" },
    });
}

/** Lets the waiting rows of the post run now (the outbox's schedule is the database's clock). */
async function due(h: RunsHarness) {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

async function resume(h: RunsHarness) {
  await due(h);
  await runQueued(h, "postPayoutBatch");
}

/** What another judge sees (no run of theirs left out). */
const peek = (h: RunsHarness, sessionId: string | null = null) =>
  judgeRail(h.t.deps, { workspaceId: h.world.workspaceId, sessionId, step: "post" });

/** Why a resumed post would wait right now (the rail the post task asks first); null when it would go live. */
async function waitingFor(h: RunsHarness): Promise<string | null> {
  const rail = await railForStep(h.t.deps, {
    workspaceId: h.world.workspaceId,
    runId: h.world.runId,
    step: "post",
  });
  if (rail.kind === "live") {
    await rail.end(null);
    return null;
  }
  return rail.kind === "queued" ? (rail.waitingFor ?? "turn") : rail.kind;
}

/** Signs and posts; PayPal paces the first POST, so the rows are written and the post waits (slot held). */
async function writeThenPace(h: RunsHarness, sent: Sent[]) {
  await resolveAll(h);
  await signBoth(h);
  paceNextPost(h, sent);
  await runQueued(h, "postPayoutBatch");
  expect(await runState(h)).toBe("POSTING");
  expect(sent).toHaveLength(1);
  expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
}

describe("the drift probe: a POST 22 h after its slot was taken is counted from when it reached PayPal", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  let session: string;
  const at = (ms: number) => new Date(T0 + ms);
  const POST_AT = T0 + 23 * H + 1_000; // the first second of the next clock hour, when the resume asks again
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    session = await giveSession(h);
    // R1 taken and the rows written at T0 = 02:00Z; PayPal paces the POST
    await writeThenPace(h, sent);
    // 36 other posts at T0+1h, then (the nightly reading in between) 3 at T0+22h: the day at 40, that hour at 3
    await others(h, 36, at(H));
    h.t.clock.set(at(22 * H));
    await reading(h);
    await others(h, 3, at(22 * H));
  });
  afterAll(async () => h?.close());

  it("(ii) T0+22h10m: the run's own slot aside, the day has room but the clock hour is full: the resume WAITS", async () => {
    h.t.clock.set(at(22 * H + 10 * MIN));
    // another judge sees the full day (the run's held slot included)
    expect(await peek(h)).toMatchObject({ mode: "replay", reason: "daily_cap", quota: { used24h: 40 } });
    expect(await waitingFor(h)).toBe("hourly_cap");
    await resume(h);
    // never the hour's fourth POST: nothing reaches PayPal, nothing is replayed, no slot taken
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    expect((await batchOf(h))?.status).toBe("SUBMITTED");
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
    expect((await peek(h)).quota.usedThisHour).toBe(3);
  });

  it("(ii) the next clock hour: it posts under a FRESH slot dated at the POST; the old one is superseded, not left open", async () => {
    h.t.clock.set(new Date(POST_AT));
    await resume(h);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({
      at: POST_AT,
      status: 201,
      senderBatchId: (await batchOf(h))?.senderBatchId,
    });
    expect(await runState(h)).toBe("POSTED");
    const ledger = await quotaLedger(h);
    expect(shape(ledger)).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "posted"],
    ]);
    expect(ledger[1]?.at).toBe(POST_AT);
    expect(ledger[2]?.reservationId).toBe(ledger[0]?.id);
    expect(ledger[3]?.reservationId).toBe(ledger[1]?.id);
    // the late POST counts in the clock hour it was sent
    h.t.clock.advance(5 * MIN);
    expect((await peek(h)).quota.usedThisHour).toBe(1);
  });

  it("(i) T0+24h15m: the day still holds that POST (40 with it): no other judge gets a slot", async () => {
    h.t.clock.set(at(24 * H + 15 * MIN));
    expect(await peek(h)).toMatchObject({ mode: "replay", reason: "daily_cap", quota: { used24h: 40 } });
    const other = await reserveLivePost(h.t.deps, {
      workspaceId: h.world.workspaceId,
      sessionId: null,
      runId: randomUUID(),
      amountCents: 100,
    });
    expect(other).toMatchObject({ decision: { mode: "replay", reason: "daily_cap" }, reservation: null });
    // C-21 counts the batch from its POST, not from its write a day ago
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
  });

  it("(i) 2 h after the POST: counted by the judge day, its session, the public third and C-21", async () => {
    h.t.clock.set(new Date(POST_AT + 2 * H));
    const view = await peek(h, session);
    expect(view.quota).toMatchObject({ used24h: 40, sessionUsed: 1, publicUsed: 1 });
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
  });

  it("(i) 23 h after the POST: still counted everywhere; a lane lease past 24 h, nowhere", async () => {
    h.t.clock.set(new Date(POST_AT + 23 * H));
    await reading(h);
    const view = await peek(h, session);
    expect(view.quota).toMatchObject({ used24h: 4, sessionUsed: 1, publicUsed: 1 });
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    h.t.clock.set(new Date(POST_AT + 24 * H + JUDGE_QUOTA.restampAfterMs + 1_000));
    const later = await peek(h, session);
    expect(later.quota).toMatchObject({ used24h: 0, sessionUsed: 0, publicUsed: 0 });
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
  });
});

describe("(iii) a run with two slots in one window counts once; a post PayPal denies on the new slot spends nothing", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    // the co-op pauses payouts after the write: the post waits, its slot held (the reading at T0 stays fresh)
    h.t.clock.advance(7 * MIN);
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
    await resume(h);
    expect(sent).toHaveLength(1);
    expect(shape(await quotaLedger(h))).toEqual([["judge_post", null]]);
  });
  afterAll(async () => h?.close());

  it("23.5 h on, switch off: a fresh slot, PayPal denies the batch; the old slot is superseded, no spend is left", async () => {
    h.t.clock.set(new Date(T0 + 23 * H + 30 * MIN));
    // the treasurer's other phone turns it off (this test's frame token expired meanwhile)
    await switchPayouts(h, false);
    answerNextPost(
      h,
      sent,
      () => paypalError(422, "INSUFFICIENT_FUNDS", "Sender has insufficient funds"),
      422,
    );
    await resume(h);
    expect(sent).toHaveLength(2);
    expect((await batchOf(h))?.status).toBe("DENIED");
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post", null],
      ["judge_post_settled", "superseded"],
      ["judge_post_settled", "denied"],
    ]);
    // both slots are in this window: the run is one post (a denied post still counts toward the caps)
    expect((await peek(h)).quota.used24h).toBe(1);
    // …and it moved no money: the reading at T0 minus nothing
    const balance = await estimateBalance(h.t.deps.db, "sandbox", h.t.clock.now());
    expect(balance).toMatchObject({ source: "reading", spentCents: 0, cents: 100_000_000 });
    expect(await estimatedBalanceCents(h.t.deps)).toBe(100_000_000n);
  });
});

describe("C: a held slot carries a quick retry unchanged, and its POST after a reading is spent from that reading", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await resolveAll(h);
    await signBoth(h);
    // PayPal refuses the credentials: the rows are written, nothing is created, the post retries in 30 s
    refuseCredentialsOnce(h, sent);
    await runQueued(h, "postPayoutBatch");
    expect(await runState(h)).toBe("POSTING");
    expect(sent.map((s) => s.status)).toEqual([401, 401]);
  });
  afterAll(async () => h?.close());

  it("a reading lands 20 s after the write; the retry 40 s after it posts under the held slot (no new slot)", async () => {
    h.t.clock.advance(20_000);
    await reading(h, 99_000_000);
    h.t.clock.advance(20_000);
    await resume(h);
    expect(sent.map((s) => s.status)).toEqual([401, 401, 201]);
    expect(await runState(h)).toBe("POSTED");
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
    // written before the reading, posted after it: the reading does not hold it, so it is subtracted
    const batch = await batchOf(h);
    const total = Number(batch?.totalCents);
    expect(await estimateBalance(h.t.deps.db, "sandbox", h.t.clock.now())).toMatchObject({
      spentCents: total,
      cents: 99_000_000 - total,
    });
    expect(await estimatedBalanceCents(h.t.deps)).toBe(BigInt(99_000_000 - total));
  });
});

describe("a POST paced at the write, resumed 7 min later after a new reading, is spent from that reading", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
  });
  afterAll(async () => h?.close());

  it("the resume takes a fresh slot after the reading: the batch is subtracted once", async () => {
    h.t.clock.advance(5 * MIN);
    await reading(h, 99_000_000);
    h.t.clock.advance(2 * MIN);
    await resume(h);
    expect(sent).toHaveLength(2);
    const total = Number((await batchOf(h))?.totalCents);
    expect(await estimateBalance(h.t.deps.db, "sandbox", h.t.clock.now())).toMatchObject({
      spentCents: total,
    });
  });
});

describe("D4: a resumed post's peek leaves its own run out", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
    await others(h, JUDGE_QUOTA.dailyMax - 1, new Date(T0 + H));
    h.t.clock.set(new Date(T0 + 23 * H + 30 * MIN));
    await reading(h);
  });
  afterAll(async () => h?.close());

  it("its slot 23.5 h old and 39 others: another judge sees 40, but the resume has room and posts", async () => {
    expect(await peek(h)).toMatchObject({ mode: "replay", reason: "daily_cap", quota: { used24h: 40 } });
    await resume(h);
    expect(sent).toHaveLength(2);
    expect(await runState(h)).toBe("POSTED");
    expect((await peek(h)).quota.used24h).toBe(40);
  });
});

describe("D5: a batch PayPal named takes no slot again", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await resolveAll(h);
    await signBoth(h);
    await runQueued(h, "postPayoutBatch");
    expect(await runState(h)).toBe("POSTED");
  });
  afterAll(async () => h?.close());

  it("a stray post of a POSTED run a day later completes with no PayPal call and no slot", async () => {
    h.t.clock.advance(25 * H);
    await reading(h);
    const batch = await batchOf(h);
    await withWorkspaceTx(h.t.deps.db, h.world.workspaceId, (tx) =>
      enqueue(
        tx,
        "postPayoutBatch",
        { runId: h.world.runId, senderBatchId: batch?.senderBatchId as string },
        `stray:${h.world.runId}`,
        { workspaceId: h.world.workspaceId },
      ),
    );
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
    expect((await peek(h)).quota.used24h).toBe(0);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
  });
});

describe("D5: a batch PayPal holds under our ids but not as ours (ADOPT_FAILED) is not posted again", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await resolveAll(h);
    await signBoth(h);
    // PayPal says the sender_batch_id exists and links no batch: ADOPT_FAILED, the HALT-and-alert case
    answerNextPost(
      h,
      sent,
      () => paypalError(400, "USER_BUSINESS_ERROR", "Batch with given sender_batch_id already exists"),
      400,
    );
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await batchOf(h)).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
  });
  afterAll(async () => h?.close());

  it("the hourly catch-up's post two hours on completes with no POST and no slot", async () => {
    h.t.clock.advance(2 * H);
    expect(await resumeStalledPosts(h.t.deps)).toBe(1);
    await resume(h);
    expect(sent).toHaveLength(1);
    expect(shape(await quotaLedger(h))).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
    expect(await batchOf(h)).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
  });
});

describe("D6 (I8): the replay rail never marks rows written live", () => {
  const script = paypalScript();
  let h: RunsHarness;
  let sent: Sent[];
  beforeAll(async () => {
    ({ h, sent } = await judgeWorld(script));
    await writeThenPace(h, sent);
  });
  afterAll(async () => h?.close());

  it("a replayed executeApproved over a live batch is refused: no replay id, the rows wait to be posted live", async () => {
    const decision = replayDecision("daily_cap", "sandbox", NO_JUDGE_QUOTA);
    const replay = await replayDeps(h.t.deps, decision);
    const service = await payoutsServiceFor(replay, systemScope(h.world.workspaceId, ACTORS.outbox));
    await expect(service.executeApproved(h.world.runId)).rejects.toThrow();
    expect(await batchOf(h)).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, provenance: "live" });
    expect(await runState(h)).toBe("POSTING");
    expect(sent).toHaveLength(1);
  });
});
