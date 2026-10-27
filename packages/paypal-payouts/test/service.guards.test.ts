// S3 §S3.6.4 step 4, the plan's "receiver, US$400 (C-21), 8-item, daily-cap and balance guards": the
// two guards that move by the hour. Register C-21 caps live batches per rolling 24 h; the estimated
// sandbox balance must stay at or above the floor after the batch. Both are read only before a NEW
// batch's rows are written, in the same turn of the service's queue as that write, and a refusal
// writes nothing and sends nothing.

import { describe, expect, it, vi } from "vitest";
import { type ApprovedLine, type PayoutLimits, type PostingSnapshot, senderBatchId } from "../src/index.js";
import {
  approvalsFor,
  created,
  digestFor,
  HERO_LINES,
  HERO_SENDER_BATCH_ID,
  NOW,
  postingSnapshot,
  RUN_BASE,
  RUN_FACTS,
  type RunIds,
} from "./support/fixtures.js";
import { onPost, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryPayoutsRepo } from "./support/repo.js";
import { BALANCE_FLOOR_CENTS, JUDGE_LIMITS, makeService, SANDBOX_BALANCE_CENTS } from "./support/service.js";

useMsw();

const RUN_ID = RUN_FACTS.runId;
/** Register §2: the hero batch, 8 items. */
const HERO_TOTAL_CENTS = 36_839n;

const posts = () => requests.filter((r) => r.method === "POST" && r.url.pathname === "/v1/payments/payouts");

/** PayPal's 201, echoing whichever sender_batch_id was posted. */
function acceptEveryBatch() {
  onPost("/v1/payments/payouts", (req) => {
    const sbid = (req.body as { sender_batch_header: { sender_batch_id: string } }).sender_batch_header
      .sender_batch_id;
    return paypalJson(created(sbid), 201);
  });
}

async function setup(limits: Partial<PayoutLimits>, snapshot: Partial<PostingSnapshot> = {}) {
  const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES, snapshot)] });
  return { repo, ...makeService(repo, { limits: { ...JUDGE_LIMITS, ...limits } }) };
}

describe("the daily cap: register C-21's live batches per rolling 24 h", () => {
  // 40 is the register's figure; 60 is the earlier S3.6.4 draft's. Either way the cap is passed in.
  it.each([
    [40, 40, 41],
    [60, 60, 61],
  ])(
    "at a cap of %i, batch %i of the day goes out and batch %i is refused before any row is written",
    async (cap) => {
      acceptEveryBatch();
      const counted: Date[] = [];
      const last = await setup({
        maxPostsPer24h: cap,
        postsInLast24h: async (now) => {
          counted.push(now);
          return cap - 1;
        },
      });
      await expect(last.service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
      expect(counted).toEqual([NOW]);
      expect(posts()).toHaveLength(1);

      const balance = vi.fn(async () => SANDBOX_BALANCE_CENTS);
      const over = await setup({
        maxPostsPer24h: cap,
        postsInLast24h: async () => cap,
        balanceCents: balance,
      });
      await expect(over.service.executeApproved(RUN_ID)).resolves.toEqual({
        kind: "refused",
        code: "DAILY_CAP",
        reason: `${cap} live batches in the last 24 h: the cap is ${cap}`,
        senderBatchId: HERO_SENDER_BATCH_ID,
      });
      expect(over.repo.events).toHaveLength(0);
      expect(balance).not.toHaveBeenCalled();
      expect(posts()).toHaveLength(1);
    },
  );

  it("two runs racing for the day's last slot: the count and the write take turns, so one batch goes out", async () => {
    const run38: RunIds = { runId: "0199f6a0-0000-7000-8000-000000000038", runSeq: 38 };
    const small = HERO_LINES.slice(0, 3);
    const repo = new MemoryPayoutsRepo({
      postings: [
        await postingSnapshot(HERO_LINES),
        await postingSnapshot(small, { ...run38, approvals: await approvalsFor(small, { run: run38 }) }),
      ],
    });
    // 39 batches earlier today, from other runs: one slot left under the register's 40.
    for (let i = 1; i <= 39; i++)
      repo.earlierPosts.push(new Date(NOW.getTime() - i * 30 * 60_000).toISOString());
    const { service } = makeService(repo, {
      limits: { ...JUDGE_LIMITS, postsInLast24h: (now) => repo.postsInLast24h(now) },
    });
    acceptEveryBatch();

    const [r37, r38] = await Promise.all([
      service.executeApproved(RUN_ID),
      service.executeApproved(run38.runId),
    ]);

    expect(r37).toMatchObject({ kind: "created", senderBatchId: HERO_SENDER_BATCH_ID });
    expect(r38).toEqual({
      kind: "refused",
      code: "DAILY_CAP",
      reason: "40 live batches in the last 24 h: the cap is 40",
      senderBatchId: senderBatchId({ ...RUN_BASE, ...run38 }),
    });
    expect(repo.types().filter((t) => t === "writeSubmitted")).toHaveLength(1);
    expect(posts()).toHaveLength(1);
  });

  it("only a full 24 h window counts: a batch written 24 h ago no longer takes a slot", async () => {
    const repo = new MemoryPayoutsRepo({ postings: [await postingSnapshot(HERO_LINES)] });
    repo.earlierPosts.push(new Date(NOW.getTime() - 24 * 60 * 60_000).toISOString());
    for (let i = 1; i <= 39; i++) repo.earlierPosts.push(new Date(NOW.getTime() - i * 60_000).toISOString());
    const { service } = makeService(repo, {
      limits: { ...JUDGE_LIMITS, postsInLast24h: (now) => repo.postsInLast24h(now) },
    });
    acceptEveryBatch();
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
  });

  it.each([
    ["not a number", Number.NaN],
    ["negative", -1],
    ["fractional", 2.5],
  ])("refuses when the day's count is %s", async (_label, count) => {
    const { service, repo } = await setup({ postsInLast24h: async () => count });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "DAILY_CAP",
      reason: "The live batches of the last 24 h could not be counted",
    });
    expect(repo.events).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("a count that throws writes nothing, and the next post still gets its turn", async () => {
    let failing = true;
    const { service, repo } = await setup({
      postsInLast24h: async () => {
        if (failing) throw new Error("database unavailable");
        return 0;
      },
    });
    await expect(service.executeApproved(RUN_ID)).rejects.toThrow("database unavailable");
    expect(repo.events).toHaveLength(0);
    expect(requests).toHaveLength(0);

    failing = false;
    acceptEveryBatch();
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
  });

  it("a resumed post was counted and funded when its rows were written: it resumes without reading either", async () => {
    const counted = vi.fn(async () => JUDGE_LIMITS.maxPostsPer24h);
    const balance = vi.fn(async () => 0n);
    const { service, repo } = await setup(
      { postsInLast24h: counted, balanceCents: balance },
      { submitted: { at: NOW.toISOString(), batchSha256: await digestFor(HERO_LINES) } },
    );
    acceptEveryBatch();
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
    expect(counted).not.toHaveBeenCalled();
    expect(balance).not.toHaveBeenCalled();
    expect(repo.types()).toEqual(["markPosted"]);
  });
});

describe("the balance guard: the estimated sandbox balance stays at or above the floor after the batch", () => {
  it("refuses a batch the balance cannot cover", async () => {
    acceptEveryBatch();
    const short = await setup({ minBalanceCents: 0n, balanceCents: async () => HERO_TOTAL_CENTS - 1n });
    await expect(short.service.executeApproved(RUN_ID)).resolves.toEqual({
      kind: "refused",
      code: "SANDBOX_GUARD",
      reason:
        "The estimated sandbox balance (US$368.38) less this US$368.39 batch is under the US$0.00 floor",
      senderBatchId: HERO_SENDER_BATCH_ID,
    });
    expect(short.repo.events).toHaveLength(0);
    expect(posts()).toHaveLength(0);

    const exact = await setup({ minBalanceCents: 0n, balanceCents: async () => HERO_TOTAL_CENTS });
    await expect(exact.service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
  });

  it("keeps the plan's US$10,000 floor: a cent short of floor plus batch is refused, the exact sum goes out", async () => {
    acceptEveryBatch();
    const under = await setup({ balanceCents: async () => BALANCE_FLOOR_CENTS + HERO_TOTAL_CENTS - 1n });
    await expect(under.service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "SANDBOX_GUARD",
      reason:
        "The estimated sandbox balance (US$10368.38) less this US$368.39 batch is under the US$10000.00 floor",
    });
    expect(under.repo.events).toHaveLength(0);

    const at = await setup({ balanceCents: async () => BALANCE_FLOOR_CENTS + HERO_TOTAL_CENTS });
    await expect(at.service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
    expect(posts()).toHaveLength(1);
  });

  it("refuses while there is no balance estimate", async () => {
    const { service, repo } = await setup({ balanceCents: async () => null });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({
      kind: "refused",
      code: "SANDBOX_GUARD",
      reason: "The sandbox balance is not known yet",
    });
    expect(repo.events).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("reads the balance afresh for every new batch", async () => {
    acceptEveryBatch();
    const balance = vi.fn(async () => SANDBOX_BALANCE_CENTS);
    const lines: ApprovedLine[] = HERO_LINES.slice(0, 2);
    const run38: RunIds = { runId: "0199f6a0-0000-7000-8000-000000000038", runSeq: 38 };
    const repo = new MemoryPayoutsRepo({
      postings: [
        await postingSnapshot(HERO_LINES),
        await postingSnapshot(lines, { ...run38, approvals: await approvalsFor(lines, { run: run38 }) }),
      ],
    });
    const { service } = makeService(repo, { limits: { ...JUDGE_LIMITS, balanceCents: balance } });
    await expect(service.executeApproved(RUN_ID)).resolves.toMatchObject({ kind: "created" });
    await expect(service.executeApproved(run38.runId)).resolves.toMatchObject({ kind: "created" });
    expect(balance).toHaveBeenCalledTimes(2);
  });
});
