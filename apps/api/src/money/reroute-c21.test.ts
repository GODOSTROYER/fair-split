// C-21 counts a re-route by when it reaches PayPal (S3.6.4, register C-21; round 3, D7), on embedded Postgres with
// PayPal answered by msw. The service checks C-21's 40 live batches a day only at a batch's first write; a written
// re-route whose POST was paced and that resumes more than a lane lease later is checked again before it goes out
// (under the spend lock) and counted from then (a `batch_sent` mark in the system ledger): while the day is full it
// waits (never replayed, nothing sent), and once it posts it weighs on C-21 for the 24 h after that POST although
// its rows were written two days before. A showcase workspace (a co-op's own): no judge quota is involved.
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { and, eq, like } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JUDGE_QUOTA } from "../judge/index.js";
import {
  type RunsHarness,
  reroutePayload,
  resolveAll,
  runQueued,
  signBoth,
  startRuns,
} from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { postsInLast24h } from "./payouts.js";
import { resumeStalledPosts } from "./resume.js";
import { settleBatch } from "./settle.js";

const H = 3_600_000;
const script = paypalScript({ parked: ["rhea", "m018"] });
let h: RunsHarness;
let keys: Awaited<ReturnType<typeof signBoth>>["keys"];
let sbid: string;
let lineId: string;
const sent: { at: number; sbid: string }[] = [];

interface LineView {
  id: string;
  memberNo: string;
  state: string;
  netCents: number;
}
const line = async (memberNo: string) =>
  (
    await h.t.json<{ lines: LineView[] }>(`/v1/runs/${h.world.runSlug}/lines`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    })
  ).body.lines.find((l) => l.memberNo === memberNo) as LineView;

const posts = () => script.calls.filter((c) => c === "create_payout_batch").length;

async function dueNow() {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, "reroute")),
    );
}

async function rerouteBatch() {
  const [b] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.senderBatchId, sbid));
  return b;
}

/** A co-op's other workspace posts C-21's 40 an hour ago (live batches on the sandbox rail). */
async function fillC21() {
  const owner = h.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  const other = await h.t.fixture({ kind: "real", withRun: true });
  const at = new Date(h.t.clock.nowMs() - H);
  for (let i = 0; i < JUDGE_QUOTA.dailyMax; i++) {
    await owner.insert(schema.payoutBatches).values({
      workspaceId: other.workspaceId,
      runId: other.runId as string,
      senderBatchId: `2026A-c21-${randomUUID()}`,
      requestId: "a".repeat(64),
      batchSha256: "b".repeat(64),
      kind: "primary",
      status: "SUCCESS",
      itemCount: 8,
      totalCents: 36_839n,
      currency: "USD",
      provenance: "live",
      submittedAt: at,
    });
  }
}

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
  h.paypal?.use(
    http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, async ({ request }) => {
      const body = (await request.clone().json()) as { sender_batch_header: { sender_batch_id: string } };
      sent.push({ at: h.t.clock.nowMs(), sbid: body.sender_batch_header.sender_batch_id });
    }),
  );
  await resolveAll(h);
  ({ keys } = await signBoth(h));
  await runQueued(h, "postPayoutBatch");
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
  // M-018 is parked (UNCLAIMED): the treasurer re-routes it; PayPal paces the re-route's POST after its rows are written
  const m018 = await line("M-018");
  expect(m018.state).toBe("UNCLAIMED");
  lineId = m018.id;
  const built = await reroutePayload(h, {
    memberNo: "M-018",
    receiver: "m039@example.com",
    amountCents: m018.netCents,
    nonce: randomUUID().replaceAll("-", ""),
    exp: new Date(h.t.clock.nowMs() + 20 * 60_000).toISOString(),
  });
  sbid = built.senderBatchId;
  h.paypal?.use(
    http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, () => paypalError(429, "RATE_LIMIT_REACHED"), {
      once: true,
    }),
  );
  await expect(
    h.t.client(h.tokens.treasurer).resend({
      params: { lineId },
      body: {
        newReceiver: "m039@example.com",
        keyId: "fs-analyn-a1",
        signature: ed25519Sign(keys.analyn.privateKey, approvalBytes(built.payload)),
        payload: built.payload,
      },
    }),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  expect(await rerouteBatch()).toMatchObject({ status: "SUBMITTED", paypalBatchId: null, kind: "reroute" });
  // an outage outlasts its attempts: every re-route row dies, and the day passes
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ state: "dead" })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        like(schema.taskOutbox.dedupeKey, `reroute:${lineId}:%`),
      ),
    );
  h.t.clock.advance(25 * H);
});
afterAll(async () => h?.close());

describe("D7: a re-route resumed after a day answers to C-21 at its POST and is counted from it", () => {
  it("its write is out of C-21's window; the day is full (40): the catch-up's resume waits, nothing is sent", async () => {
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
    await fillC21();
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
    expect(await resumeStalledPosts(h.t.deps)).toBe(1);
    const before = posts();
    await dueNow();
    await runQueued(h, "reroute");
    expect(posts()).toBe(before);
    expect(await rerouteBatch()).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(JUDGE_QUOTA.dailyMax);
    // it waits as its press's next attempt row (never the replay rail: a showcase post is live)
    const queued = await h.t.deps.db
      .select({ state: schema.taskOutbox.state })
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          like(schema.taskOutbox.dedupeKey, `reroute:${lineId}:%`),
          eq(schema.taskOutbox.state, "queued"),
        ),
      );
    expect(queued).toHaveLength(1);
  });

  it("a day on, the others aged out: it posts once with its ids, and C-21 counts it 2 h and 23 h after that POST", async () => {
    h.t.clock.advance(24 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
    const before = posts();
    const postedAt = h.t.clock.nowMs();
    await dueNow();
    await runQueued(h, "reroute");
    expect(posts()).toBe(before + 1);
    expect(sent.at(-1)).toEqual({ at: postedAt, sbid });
    expect((await rerouteBatch())?.paypalBatchId).not.toBeNull();
    h.t.clock.advance(2 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    h.t.clock.advance(21 * H);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(1);
    h.t.clock.advance(H + JUDGE_QUOTA.restampAfterMs + 1_000);
    expect(await postsInLast24h(h.t.deps, h.t.clock.now())).toBe(0);
  });
});
