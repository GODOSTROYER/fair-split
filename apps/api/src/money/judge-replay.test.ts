// Judge Mode obeys its own live-or-replay decision (S3.9, S3.11, C-06; verifier probe P11), on embedded Postgres on
// the sandbox rail with PayPal answered by msw, which records every call it answers. The sandbox balance reads
// US$5,000, under the US$10,000 floor: every PayPal step of a judge run is a labelled replay. A session decided
// replay drafts and sends its invoice, "Mark paid" funds the run, both keys post the batch, the settle GET parks
// Rhea and pays the rest, and her cash move settles the run: through the very same code (the lattice, I4, the state
// machine), with zero PayPal calls, and every PayPal-derived row and event labelled `replay` (I8). As in a judge
// clone, the replay photos start unread: the reading is the seed's labelled stand-in (runs/extract.ts), `seeded`.
import { RunEvent } from "@fairsplit/contracts";
import { schema, verifyChain } from "@fairsplit/db";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveSpend } from "../judge/quota.js";
import { type RunsHarness, readSlips, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { settleBatch } from "./settle.js";

const figures = getSnapshot().figures;
const script = paypalScript();
let h: RunsHarness;

beforeAll(async () => {
  h = await startRuns({
    paypal: script.handlers,
    world: { runState: "INVOICED", replayRows: false },
    balanceCents: 500_000,
  });
});
afterAll(async () => h?.close());

const api = () => h.t.client(h.tokens.treasurer);

async function paypalCalls(workspaceId: string) {
  return h.t.deps.db
    .select({ id: schema.paypalCalls.id })
    .from(schema.paypalCalls)
    .where(eq(schema.paypalCalls.workspaceId, workspaceId));
}

async function replayed(workspaceId: string) {
  return (
    await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, workspaceId),
          eq(schema.ledgerEntries.kind, "judge.step.replayed"),
        ),
      )
      .orderBy(asc(schema.ledgerEntries.seq))
  ).map((e) => e.payload as { step: string; reason: string; source: { runSlug: string; kind: string } });
}

describe("a judge run whose PayPal steps replay (balance under the floor) calls PayPal not once", () => {
  it("Mark paid replays: the run is funded, labelled replay; nothing reaches PayPal", async () => {
    const r = await api().markPaid({ params: { runSlug: h.world.runSlug } });
    expect(r).toMatchObject({ invoiceStatus: "MARKED_AS_PAID", runState: "EXTRACTING" });
    expect(script.calls).toEqual([]);
    expect(await paypalCalls(h.world.workspaceId)).toEqual([]);
    const steps = await replayed(h.world.workspaceId);
    expect(steps).toEqual([
      expect.objectContaining({
        step: "fund",
        reason: "balance_low",
        source: expect.objectContaining({ kind: "seed" }),
      }),
    ]);
    const funded = await h.t.deps.db
      .select({ provenance: schema.runEvents.provenance, payload: schema.runEvents.payload })
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, h.world.runId), eq(schema.runEvents.type, "run.state")));
    const to = (e: { payload: unknown }) => (e.payload as { to: string }).to;
    expect(funded.filter((e) => to(e) === "FUNDED").map((e) => e.provenance)).toEqual(["replay"]);
  });

  it("the seed's reading replays, photo by photo, and the engine opens the review on the funded run", async () => {
    await runQueued(h, "computeRun"); // the funding's: the photos are unread, nothing to compute yet
    expect(await readSlips(h)).toBe(12);
    await runQueued(h, "computeRun");
    const run = await h.t.json<{ run: { state: string }; holds: { open: number; blocking: number } }>(
      `/v1/runs/${h.world.runSlug}`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.holds).toMatchObject({ open: 4, blocking: 3 });
    expect(script.calls).toEqual([]);
  });

  it("both keys post the batch exactly as signed, replayed: no POST reaches PayPal, the rows say replay", async () => {
    await resolveAll(h);
    const { batchSha256 } = await signBoth(h);
    await runQueued(h, "postPayoutBatch");
    expect(script.calls).toEqual([]);
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch).toMatchObject({
      provenance: "replay",
      batchSha256,
      itemCount: figures.batchItemCount,
      totalCents: BigInt(figures.batchTotalCents),
    });
    expect(batch?.paypalBatchId).toMatch(/^RPLY[0-9A-F]{16}$/);
    const items = await h.t.deps.db
      .select({ provenance: schema.payoutItems.provenance })
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.batchId, batch?.id as string));
    expect(items).toHaveLength(figures.batchItemCount);
    expect(items.every((i) => i.provenance === "replay")).toBe(true);
    expect((await replayed(h.world.workspaceId)).map((s) => s.step)).toEqual(["fund", "post"]);

    // the settle GET is replayed too: Rhea parks as she did in the replayed run, the rest are paid
    await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
    const run = await h.t.json<{ run: { state: string }; lines: Record<string, number> }>(
      `/v1/runs/${h.world.runSlug}`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    expect(run.body.run.state).toBe("NEEDS_FOLLOW_UP");
    expect(run.body.lines.PAID).toBe(figures.batchItemCount - 1);
    expect(run.body.lines.UNCLAIMED).toBe(1);
    expect(script.calls).toEqual([]);
  });

  it("Rhea's cash move replays her cancel: her line is due at the bodega, the run settles, still no call", async () => {
    const lines = await h.t.json<{ lines: { id: string; memberNo: string; state: string }[] }>(
      `/v1/runs/${h.world.runSlug}/lines`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    const rhea = lines.body.lines.find((l) => l.state === "UNCLAIMED");
    expect(rhea?.memberNo).toBe("M-031");
    const r = await api().payCash({ params: { lineId: rhea?.id as string } });
    expect(r).toMatchObject({ cancelled: true, line: { memberNo: "M-031", state: "OFF_RAIL_DUE" } });
    const run = await h.t.json<{ run: { state: string } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    });
    expect(run.body.run.state).toBe("SETTLED");
    expect(script.calls).toEqual([]);
    expect(await paypalCalls(h.world.workspaceId)).toEqual([]);
  });

  it("inv.i8.labels: every PayPal-derived event is `replay`, the chain verifies, and no live post or spend is counted", async () => {
    expect((await verifyChain(h.t.deps.db, h.world.workspaceId)).ok).toBe(true);
    const events = await h.t.deps.db
      .select()
      .from(schema.runEvents)
      .where(eq(schema.runEvents.workspaceId, h.world.workspaceId));
    for (const e of events) {
      const ok = RunEvent.safeParse({
        id: String(e.id),
        ws: e.workspaceId,
        runId: e.runId,
        at: e.at.toISOString(),
        actor: { kind: e.actorKind, id: e.actorId, impersonatedBy: e.impersonatedBy },
        provenance: e.provenance,
        type: e.type,
        payload: e.payload,
      }).success;
      expect(ok, `${e.type} ${JSON.stringify(e.payload)}`).toBe(true);
    }
    const items = events.filter((e) => e.type === "item.updated");
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.provenance === "replay")).toBe(true);
    const moves = events.filter(
      (e) =>
        e.type === "run.state" &&
        ["FUNDED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED"].includes(
          (e.payload as { to: string }).to,
        ),
    );
    expect(moves.map((e) => e.provenance)).toEqual(Array(moves.length).fill("replay"));
    // a replay reached no one: it is neither a live post of the judge quota nor spend of the business account
    expect(await liveSpend(h.t.deps.db, "sandbox", null)).toBe(0);
  });
});

describe("P11: a session decided replay (the balance is under the floor) drafts its invoice without a PayPal call", () => {
  it("POST /v1/judge/sessions answers 201, labelled replay; Claude's invoice turn invoices the run, replayed", async () => {
    const r = await h.t.json<{ workspaceId: string; runId: string; runSlug: string }>("/v1/judge/sessions", {
      method: "POST",
      body: {},
      headers: { "cf-connecting-ip": "198.18.7.1" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const ws = r.body.workspaceId;
    const [started] = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(eq(schema.ledgerEntries.workspaceId, ws), eq(schema.ledgerEntries.kind, "judge.session.started")),
      );
    expect(started?.payload).toMatchObject({ rail: "replay", replayReason: "balance_low" });

    const turns = await h.t.deps.db
      .select({ id: schema.taskOutbox.id })
      .from(schema.taskOutbox)
      .where(and(eq(schema.taskOutbox.workspaceId, ws), eq(schema.taskOutbox.name, "agentTurn")));
    expect(turns).toHaveLength(1);
    await h.t.deps.outbox?.runTask(turns[0]?.id as string);

    const [run] = await h.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, r.body.runId));
    expect(run).toMatchObject({ state: "INVOICED", provenance: "replay" });
    const [invoice] = await h.t.deps.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.runId, r.body.runId));
    expect(invoice).toMatchObject({ provenance: "replay", status: "UNPAID" });
    expect(invoice?.paypalInvoiceId).toMatch(/^INV2-RPLY-/);
    expect(invoice?.autoCancelOn).not.toBeNull();
    // not one call: msw answered nothing and no paypal_calls row exists for the workspace
    expect(script.calls).toEqual([]);
    expect(await paypalCalls(ws)).toEqual([]);
    expect((await replayed(ws)).map((s) => [s.step, s.reason])).toEqual([["invoice", "balance_low"]]);
    const verdicts = await h.t.deps.db
      .select({ provenance: schema.runEvents.provenance })
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, r.body.runId), sql`${schema.runEvents.type} = 'invoice.state'`));
    expect(verdicts.every((v) => v.provenance === "replay")).toBe(true);
  });
});
