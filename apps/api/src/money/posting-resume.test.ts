// A batch whose rows are written (run POSTING, rows SUBMITTED) is never abandoned (S3.6.4 step 7), on embedded
// Postgres with PayPal answered by msw (zero live calls). The post task honours the wait it is given: PayPal's
// 6-minute circuit after a 429, a kill switch held for ten minutes. Each wait re-queues the post as the press's
// next attempt row (never the outbox's two-minute budget), turning the switch off brings it forward, and a post
// that stopped anyway (an outage that outlasted its attempts) is resumed by the catch-up at boot and every hourly
// cron pass: same ids, I4 re-checked, posted once. Showcase workspaces, so Judge Mode's live lane plays no part.
import type { TaskName } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, asc, eq } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runJudgeReset } from "../judge/reset-task.js";
import runsFolder from "../routes/runs/index.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { type PostedBatch, paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";
import { resumeStalledPosts } from "./resume.js";

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

async function postRows(h: RunsHarness) {
  return h.t.deps.db
    .select({
      key: schema.taskOutbox.dedupeKey,
      state: schema.taskOutbox.state,
      runAfter: schema.taskOutbox.runAfter,
    })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, "postPayoutBatch"),
      ),
    )
    .orderBy(asc(schema.taskOutbox.createdAt), asc(schema.taskOutbox.dedupeKey));
}

/** Lets the waiting rows of a task run now (the outbox's schedule is the database's clock). */
async function due(h: RunsHarness, name: TaskName) {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        eq(schema.taskOutbox.name, name),
        eq(schema.taskOutbox.state, "queued"),
      ),
    );
}

describe("a 429 after the write: the post waits out the 6-minute circuit and is posted once it closes", () => {
  const script = paypalScript();
  let h: RunsHarness;
  const sent: string[] = [];
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("PayPal answers the first POST with 429: the rows stay SUBMITTED and the post waits about six minutes", async () => {
    h.paypal?.use(
      http.post(
        `${PAYPAL_SANDBOX}/v1/payments/payouts`,
        async ({ request }) => {
          sent.push(((await request.json()) as PostedBatch).sender_batch_header.sender_batch_id);
          return paypalError(429, "RATE_LIMIT_REACHED");
        },
        { once: true },
      ),
    );
    const before = Date.now();
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    expect(await batchOf(h)).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
    const rows = await postRows(h);
    expect(rows.map((r) => r.state)).toEqual(["done", "queued"]);
    // due when the circuit closes, not seconds from now
    expect(rows[1]?.runAfter.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
  });

  it("an attempt while the circuit is still open sends nothing and waits again; none ever goes dead", async () => {
    await due(h, "postPayoutBatch");
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(script.calls).not.toContain("create_payout_batch");
    expect((await postRows(h)).map((r) => r.state)).toEqual(["done", "done", "queued"]);
  });

  it("once the circuit has closed the same batch is posted, with the same ids, once", async () => {
    h.t.clock.advance(7 * 60_000);
    await due(h, "postPayoutBatch");
    await runQueued(h, "postPayoutBatch");
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual(sent);
    expect(await runState(h)).toBe("POSTED");
    expect((await batchOf(h))?.paypalBatchId).toBe(script.batchIdOf(0));
    const rows = await postRows(h);
    expect(rows.every((r) => r.state === "done")).toBe(true);
    expect(new Set(rows.map((r) => r.key.replace(/:r\d+$/, ""))).size).toBe(1);
  });
});

describe("a kill switch held for ten minutes after the write: the post waits and is posted once it is off", () => {
  const script = paypalScript();
  let h: RunsHarness;
  const sent: { sbid: string; requestId: string | null }[] = [];
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
    await resolveAll(h);
    await signBoth(h);
  });
  afterAll(async () => h?.close());

  it("PayPal times out and the co-op pauses PayPal calls: the rows stay SUBMITTED, the post waits", async () => {
    h.paypal?.use(
      http.post(
        `${PAYPAL_SANDBOX}/v1/payments/payouts`,
        async ({ request }) => {
          const body = (await request.json()) as PostedBatch;
          sent.push({
            sbid: body.sender_batch_header.sender_batch_id,
            requestId: request.headers.get("paypal-request-id"),
          });
          await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_paypal_live", on: true } });
          return paypalError(408, "REQUEST_TIMEOUT");
        },
        { once: true },
      ),
    );
    await runQueued(h, "postPayoutBatch");
    expect(sent).toHaveLength(1);
    expect(await runState(h)).toBe("POSTING");
    expect((await postRows(h)).map((r) => r.state)).toEqual(["done", "queued"]);
  });

  it("ten minutes of attempts while the switch is on: nothing is sent, nothing is abandoned", async () => {
    for (let i = 0; i < 4; i++) {
      h.t.clock.advance(150_000);
      await due(h, "postPayoutBatch");
      await runQueued(h, "postPayoutBatch");
    }
    expect(sent).toHaveLength(1);
    expect(script.calls).not.toContain("create_payout_batch");
    expect(await runState(h)).toBe("POSTING");
    const rows = await postRows(h);
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "done", "done", "queued"]);
    expect(await batchOf(h)).toMatchObject({ status: "SUBMITTED", paypalBatchId: null });
  });

  it("turning the switch off brings the waiting post forward: the same batch is posted with the same ids", async () => {
    const [waiting] = (await postRows(h)).filter((r) => r.state === "queued");
    expect(waiting?.runAfter.getTime()).toBeGreaterThan(Date.now());
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_paypal_live", on: false } });
    const [now] = (await postRows(h)).filter((r) => r.state === "queued");
    expect(now?.runAfter.getTime()).toBeLessThanOrEqual(Date.now());
    // no `due` here: the switch did it
    await runQueued(h, "postPayoutBatch");
    expect(script.posted.map((b) => b.sender_batch_header.sender_batch_id)).toEqual(sent.map((s) => s.sbid));
    expect(await runState(h)).toBe("POSTED");
    expect((await postRows(h)).every((r) => r.state === "done")).toBe(true);
  });
});

describe("catch-up: a POSTING run whose post stopped is resumed (boot, the hourly cron)", () => {
  const script = paypalScript();
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
    await resolveAll(h);
    await signBoth(h);
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, () => paypalError(429, "RATE_LIMIT_REACHED"), {
        once: true,
      }),
    );
    await runQueued(h, "postPayoutBatch");
    // an outage outlasted every attempt (or an older build gave up): every post row of the run is dead
    await killPosts();
  });
  /** Every post row of the run gone dead: nothing is left to post the written batch. */
  async function killPosts() {
    await h.t.pg?.owner.db
      .update(schema.taskOutbox)
      .set({ state: "dead" })
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          eq(schema.taskOutbox.name, "postPayoutBatch"),
        ),
      );
  }
  afterAll(async () => h?.close());

  it("resumeStalledPosts enqueues one resume post for the stalled run, and nothing more while it waits", async () => {
    expect(await runState(h)).toBe("POSTING");
    expect(await resumeStalledPosts(h.t.deps)).toBe(1);
    expect(await resumeStalledPosts(h.t.deps)).toBe(0);
    const rows = await postRows(h);
    expect(rows.filter((r) => r.state === "queued")).toHaveLength(1);
    expect(new Set(rows.map((r) => r.key.replace(/:r\d+$/, ""))).size).toBe(1);
  });

  it("boot runs the catch-up (the runs folder's onBoot)", async () => {
    await killPosts();
    expect((await postRows(h)).filter((r) => r.state === "queued")).toHaveLength(0);
    await runsFolder.onBoot?.(h.t.deps);
    expect((await postRows(h)).filter((r) => r.state === "queued")).toHaveLength(1);
  });

  it("the hourly cron pass resumes a stalled post too, and the resumed post is posted with the same ids", async () => {
    await killPosts();
    const report = await runJudgeReset(h.t.deps, {
      trigger: "cron",
      workspaceId: null,
      slot: "2026-10-28T03",
    });
    expect(report.postsResumed).toBe(1);
    h.t.clock.advance(7 * 60_000);
    await due(h, "postPayoutBatch");
    await runQueued(h, "postPayoutBatch");
    expect(await runState(h)).toBe("POSTED");
    expect(script.posted).toHaveLength(1);
    expect(script.posted[0]?.sender_batch_header.sender_batch_id).toBe((await batchOf(h))?.senderBatchId);
    // posted: nothing is left to resume
    expect(await resumeStalledPosts(h.t.deps)).toBe(0);
  });
});
