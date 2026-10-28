// Judge Mode's live steps (S3.9, S3.11, plan "Limits"), on embedded Postgres on the sandbox rail with PayPal answered
// by msw, and a fresh US$1,000,000 balance reading so judge steps may run live:
//   - kill_paypal_live in Judge Mode is a labelled replay of the step, never a refusal;
//   - a live step waits its turn in the single-flight lane (it re-queues itself, nothing is sent) and runs once the
//     burst ahead of it ends;
//   - the armed one-cent tamper meets the real post: I4 refuses it, nothing is sent, both approvals are voided and
//     the line is restored;
//   - over a quota (three live posts this clock hour) the post is a labelled replay, not a live post.
// Several judge worlds share one app (one msw server per process): each test takes its own.
import { randomUUID } from "node:crypto";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { enqueue } from "@fairsplit/outbox";
import { and, asc, eq, isNull } from "drizzle-orm";
import { http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { beginLiveStep, reserveLivePost } from "../judge/index.js";
import { armChangePayout } from "../judge/tamper.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { type SeedWorldOptions, seedWorld } from "../runs/test/world.js";
import { PAYPAL_SANDBOX, paypalError } from "../test/index.js";

// UNPAID until a payment is recorded (a retried Mark paid reads the invoice first, S3.10)
const script = paypalScript({ invoiceStatus: "UNPAID" });
let base: RunsHarness;
let worlds = 0;

beforeAll(async () => {
  base = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED" } });
});
afterAll(async () => base?.close());

/** Another judge world in the same app, with its own officers' tokens. */
async function world(o: SeedWorldOptions): Promise<RunsHarness> {
  const db = base.t.pg?.app.db;
  if (!db) throw new Error("db");
  // PayPal invoice ids are UNIQUE: each world's invoice has its own
  const invoiceId = `INV2-TEST-LANE-${String(++worlds).padStart(4, "0")}`;
  const w = await seedWorld(db, {
    invoice: { paypalInvoiceId: invoiceId, status: "SENT", sent: true },
    ...o,
  });
  const ws = w.workspaceId;
  const tk = (role: "treasurer" | "board" | "clerk" | "member" | "brand", persona: string) =>
    base.t.credentials.frameToken({ workspaceId: ws, role, persona });
  return {
    ...base,
    world: w,
    tokens: {
      treasurer: await tk("treasurer", "analyn"),
      chair: await tk("board", "ernesto"),
      clerk: await tk("clerk", "jessie"),
      member: await tk("member", "celing"),
      brand: await tk("brand", "dana"),
    },
  };
}

const calls = (name: string) => script.calls.filter((c) => c === name).length;

async function runState(h: RunsHarness) {
  const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

async function replayedSteps(h: RunsHarness) {
  return (
    await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "judge.step.replayed"),
        ),
      )
      .orderBy(asc(schema.ledgerEntries.seq))
  ).map((e) => {
    const p = e.payload as { step: string; reason: string };
    return [p.step, p.reason];
  });
}

describe("Judge Mode obeys its rail decision at every PayPal step", () => {
  it("kill_paypal_live in Judge Mode is a labelled replay (S3.11), not a refusal: Mark paid funds the run, nothing is sent", async () => {
    const h = base;
    const api = h.t.client(h.tokens.treasurer);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: true } });
    const before = script.calls.length;
    const r = await api.markPaid({ params: { runSlug: h.world.runSlug } });
    expect(r).toMatchObject({ invoiceStatus: "MARKED_AS_PAID", runState: "EXTRACTING" });
    expect(script.calls.length).toBe(before);
    expect(await replayedSteps(h)).toEqual([["fund", "kill_switch"]]);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: false } });
  });

  it("a run whose funding was replayed replays to the end: its post replays too, the switch long off", async () => {
    const h = base;
    await runQueued(h, "computeRun");
    expect(await runState(h)).toBe("IN_REVIEW");
    await resolveAll(h);
    await signBoth(h);
    const before = calls("create_payout_batch");
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before);
    expect(await runState(h)).toBe("POSTED");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.provenance).toBe("replay");
    // why: the reason its first replayed step gave
    expect(await replayedSteps(h)).toEqual([
      ["fund", "kill_switch"],
      ["post", "kill_switch"],
    ]);
  });

  it("kill_paypal_live in Judge Mode: Claude's invoice turn is replayed too (the lattice refuses no call that reaches no one)", async () => {
    const h = await world({ runState: "DRAFT", invoice: null });
    const api = h.t.client(h.tokens.treasurer);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: true } });
    const id = await withWorkspaceTx(h.t.deps.db, h.world.workspaceId, async (tx) => {
      const args = { runId: h.world.runId, purpose: "DRAFT_INVOICE" as const, holdId: null, turn: 0 };
      return (
        await enqueue(tx, "agentTurn", args, `agent:lane:${h.world.runId}`, {
          workspaceId: h.world.workspaceId,
        })
      ).id;
    });
    const before = script.calls.length;
    await h.t.deps.outbox?.runTask(id);
    expect(script.calls.length).toBe(before);
    expect(await runState(h)).toBe("INVOICED");
    const [invoice] = await h.t.deps.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.runId, h.world.runId));
    expect(invoice).toMatchObject({ provenance: "replay", status: "UNPAID" });
    expect(await replayedSteps(h)).toEqual([["invoice", "kill_switch"]]);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: false } });
  });

  it("a live step waits its turn in the single-flight lane, sends nothing meanwhile, and runs once the burst ahead ends", async () => {
    const h = await world({ runState: "INVOICED" });
    const other = await world({ runState: "INVOICED" });
    // another judge's burst holds the lane (in this process and, through its advisory lock, in every process)
    const held = await beginLiveStep(h.t.deps, { workspaceId: other.world.workspaceId, step: "invoice" });
    expect(held.kind).toBe("live");
    if (held.kind !== "live") return;
    const before = calls("record_payment");
    await expect(
      h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } }),
    ).rejects.toMatchObject({ code: "QUEUED" });
    expect(calls("record_payment")).toBe(before);
    expect(await runState(h)).toBe("INVOICED");
    // the press waits as its next attempt row, never the outbox's retry budget
    const rows = await h.t.deps.db
      .select({ state: schema.taskOutbox.state })
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          eq(schema.taskOutbox.name, "recordPayment"),
        ),
      )
      .orderBy(asc(schema.taskOutbox.createdAt));
    expect(rows.map((r) => r.state)).toEqual(["done", "queued"]);

    await held.end();
    await h.t.pg?.owner.db
      .update(schema.taskOutbox)
      .set({ runAfter: new Date(Date.now() - 1_000) })
      .where(
        and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.state, "queued")),
      );
    await runQueued(h, "recordPayment");
    expect(calls("record_payment")).toBe(before + 1);
    expect(await runState(h)).toBe("EXTRACTING");
    expect(await replayedSteps(h)).toEqual([]);
  });

  it("the armed one-cent tamper meets the real post: refused before PayPal, both approvals voided, the line restored", async () => {
    const h = await world({});
    await resolveAll(h);
    // armed before the second key, as the stage's "Try to break it" does
    await armChangePayout(h.t.deps, {
      kind: "judge_session",
      sessionId: randomUUID(),
      workspaceId: h.world.workspaceId,
      role: "judge",
      persona: "judge",
      expiresAt: new Date(h.t.clock.nowMs() + 3_600_000),
    });
    const linesBefore = await h.t.deps.db
      .select({ id: schema.memberLines.id, net: schema.memberLines.netCents })
      .from(schema.memberLines)
      .where(eq(schema.memberLines.runId, h.world.runId))
      .orderBy(asc(schema.memberLines.id));
    await signBoth(h);
    const before = calls("create_payout_batch");
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before);
    expect(await runState(h)).toBe("IN_REVIEW");
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
    const tamper = (
      await h.t.deps.db
        .select({ kind: schema.ledgerEntries.kind, payload: schema.ledgerEntries.payload })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.runId, h.world.runId))
        .orderBy(asc(schema.ledgerEntries.seq))
    ).filter((e) => e.kind.startsWith("judge.tamper.") || e.kind === "payout.refused");
    expect(tamper.map((e) => e.kind)).toEqual([
      "judge.tamper.armed",
      "judge.tamper.applied",
      "payout.refused",
      "judge.tamper.reverted",
    ]);
    expect(tamper.at(-1)?.payload).toMatchObject({ restored: true, reason: "refused:DIGEST_MISMATCH" });
    const linesAfter = await h.t.deps.db
      .select({ id: schema.memberLines.id, net: schema.memberLines.netCents })
      .from(schema.memberLines)
      .where(eq(schema.memberLines.runId, h.world.runId))
      .orderBy(asc(schema.memberLines.id));
    expect(linesAfter).toEqual(linesBefore);
  });

  it("over a quota (three live posts this clock hour) the post is a labelled replay: nothing is posted live", async () => {
    const h = await world({});
    for (let i = 0; i < 3; i++) {
      const r = await reserveLivePost(h.t.deps, {
        workspaceId: h.world.workspaceId,
        sessionId: null,
        runId: randomUUID(),
        amountCents: 100,
      });
      expect(r.reservation).not.toBeNull();
    }
    await resolveAll(h);
    await signBoth(h);
    const before = calls("create_payout_batch");
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before);
    expect(await runState(h)).toBe("POSTED");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.provenance).toBe("replay");
    expect(await replayedSteps(h)).toEqual([["post", "hourly_cap"]]);
  });

  it("a live post in Judge Mode takes the lane and its reservation, and settles it as posted", async () => {
    const h = await world({});
    // a new clock hour: the three reservations above no longer fill this hour's cap
    h.t.clock.advance(60 * 60_000);
    await resolveAll(h);
    await signBoth(h);
    const before = calls("create_payout_batch");
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before + 1);
    expect(await runState(h)).toBe("POSTED");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.provenance).toBe("live");
    const settled = await h.t.deps.db
      .select({ summary: schema.reconciliationReports.summary })
      .from(schema.reconciliationReports)
      .where(isNull(schema.reconciliationReports.workspaceId));
    const mine = settled
      .map((r) => r.summary as { entry?: string; runId?: string; outcome?: string })
      .filter((s) => s.runId === h.world.runId);
    expect(mine.map((s) => [s.entry, s.outcome ?? null])).toEqual([
      ["judge_post", null],
      ["judge_post_settled", "posted"],
    ]);
  });

  it("a batch written live is resumed live, never replayed: a paced POST waits, and posts with its ids even once the hour's cap is full", async () => {
    const h = await world({});
    await resolveAll(h);
    await signBoth(h);
    // PayPal paces the first POST after the rows are written (a 429: the 6-minute circuit opens)
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, () => paypalError(429, "RATE_LIMIT_REACHED"), {
        once: true,
      }),
    );
    await runQueued(h, "postPayoutBatch");
    expect(await runState(h)).toBe("POSTING");
    // others fill this clock hour's live posts meanwhile
    for (let i = 0; i < 3; i++) {
      await reserveLivePost(h.t.deps, {
        workspaceId: h.world.workspaceId,
        sessionId: null,
        runId: randomUUID(),
        amountCents: 100,
      });
    }
    const due = () =>
      h.t.pg?.owner.db
        .update(schema.taskOutbox)
        .set({ runAfter: new Date(Date.now() - 1_000) })
        .where(
          and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.state, "queued")),
        );
    // while the circuit is open the written batch waits: nothing is sent, nothing is replayed
    const before = calls("create_payout_batch");
    await due();
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before);
    expect(await runState(h)).toBe("POSTING");
    expect(await replayedSteps(h)).toEqual([]);
    // the circuit closes: the same batch is posted live with its ids on a slot dated now (its own earlier slot aside,
    // the hour has room: the others could only fill it up to that slot)
    h.t.clock.advance(7 * 60_000);
    await due();
    await runQueued(h, "postPayoutBatch");
    expect(calls("create_payout_batch")).toBe(before + 1);
    expect(await runState(h)).toBe("POSTED");
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.provenance).toBe("live");
    expect(batch?.paypalBatchId).not.toMatch(/^RPLY/);
    expect(script.posted.at(-1)?.sender_batch_header.sender_batch_id).toBe(batch?.senderBatchId);
    expect(await replayedSteps(h)).toEqual([]);
  });
});
