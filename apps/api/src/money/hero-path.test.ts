// The hero path end to end on embedded Postgres with PayPal answered by msw (zero live calls): Judge Mode's
// "Mark paid" (record_payment through Agent Toolkit 1.11.0, a fresh GET → FUNDED), the engine's read, the
// review, two keys, the POST through PayoutsService (I4: the approved digest is the payout), the settle GET
// (7 SUCCESS, Rhea UNCLAIMED), "Pay in cash at the bodega" (cancel → RETURNED → OFF_RAIL_DUE) and SETTLED.
// The ledger chain verifies at the end and every event is an IC-01 RunEvent.
import { RunEvent } from "@fairsplit/contracts";
import { schema, verifyChain } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, startRuns } from "../runs/testing/app.js";
import { registerKey } from "../runs/testing/world.js";
import { PAYPAL_SANDBOX } from "../test/index.js";
import { settleBatch } from "./settle.js";

const INV = "INV2-TEST-RUNS-0001";
/** Agent Toolkit 1.11.0 talks to api.sandbox.paypal.com (its PayPalClient base URL), the rest to api-m. */
const TOOLKIT = "https://api.sandbox.paypal.com";
const BATCH = "PBTESTRUNS01";
const figures = getSnapshot().figures;

interface PostedItem {
  receiver: string;
  amount: { value: string; currency: string };
  sender_item_id: string;
}
const posted: { sender_batch_header: { sender_batch_id: string; note: string }; items: PostedItem[] }[] = [];
const calls: string[] = [];

function invoiceBody(status: string, due: string) {
  return {
    id: INV,
    status,
    detail: { invoice_number: "FS-x", reference: "rc:x", currency_code: "USD", invoice_date: "2026-10-27" },
    amount: { currency_code: "USD", value: "4333.50" },
    due_amount: { currency_code: "USD", value: due },
  };
}

const handlers = [
  http.post(`${TOOLKIT}/v2/invoicing/invoices/${INV}/payments`, () => {
    calls.push("record_payment");
    return HttpResponse.json(
      { payment_id: "EXTRTESTRUNS01" },
      { headers: { "paypal-debug-id": "dbg-record" } },
    );
  }),
  http.get(`${TOOLKIT}/v2/invoicing/invoices/${INV}`, () => {
    calls.push("get_invoice");
    return HttpResponse.json(invoiceBody("MARKED_AS_PAID", "0.00"));
  }),
  http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, async ({ request }) => {
    calls.push("create_payout_batch");
    const body = (await request.json()) as (typeof posted)[number];
    posted.push(body);
    return HttpResponse.json(
      {
        batch_header: {
          payout_batch_id: BATCH,
          batch_status: "PENDING",
          sender_batch_header: { sender_batch_id: body.sender_batch_header.sender_batch_id },
        },
        links: [],
      },
      { status: 201, headers: { "paypal-debug-id": "dbg-post" } },
    );
  }),
  http.get(`${PAYPAL_SANDBOX}/v1/payments/payouts/${BATCH}`, () => {
    calls.push("get_payout_batch");
    const batch = posted.at(-1);
    return HttpResponse.json({
      total_items: batch?.items.length ?? 0,
      total_pages: 1,
      batch_header: {
        payout_batch_id: BATCH,
        batch_status: "SUCCESS",
        sender_batch_header: { sender_batch_id: batch?.sender_batch_header.sender_batch_id },
      },
      items: (batch?.items ?? []).map((it, i) => ({
        payout_item_id: `PIT${String(i).padStart(4, "0")}`,
        payout_batch_id: BATCH,
        transaction_status: it.receiver.startsWith("rhea") ? "UNCLAIMED" : "SUCCESS",
        payout_item_fee: { currency: "USD", value: "0.25" },
        payout_item: { receiver: it.receiver, amount: it.amount, sender_item_id: it.sender_item_id },
      })),
    });
  }),
  http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, ({ params }) => {
    calls.push("cancel_unclaimed");
    return HttpResponse.json({
      payout_item_id: params.id,
      payout_batch_id: BATCH,
      transaction_status: "RETURNED",
      payout_item: { receiver: "rhea-no-account@example.com", amount: { currency: "USD", value: "26.65" } },
    });
  }),
];

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns({ paypal: handlers, world: { runState: "INVOICED" } });
});
afterAll(async () => h?.close());

async function runQueued(name: string) {
  const rows = await h.t.deps.db
    .select({ id: schema.taskOutbox.id, state: schema.taskOutbox.state })
    .from(schema.taskOutbox)
    .where(and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, name)));
  const queued = rows.filter((r) => r.state === "queued");
  expect(queued.length, name).toBeGreaterThan(0);
  for (const r of queued) await h.t.deps.outbox?.runTask(r.id);
}

describe("the hero path on the sandbox rail (msw)", () => {
  it("MM-S: Mark paid records the payment and a fresh GET funds the run; the reading is queued (I7)", async () => {
    const r = await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    expect(r).toEqual({
      runSlug: h.world.runSlug,
      invoiceId: INV,
      invoiceStatus: "MARKED_AS_PAID",
      runState: "EXTRACTING",
      provenance: "simulated_rail",
    });
    expect(calls).toEqual(["record_payment", "get_invoice"]);
    const funded = await h.t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "invoice.funded"),
        ),
      );
    expect(funded).toHaveLength(1);
    expect(funded[0]?.payload).toMatchObject({
      status: "MARKED_AS_PAID",
      dueCents: 0,
      amountCents: figures.invoiceCents,
    });
    // a second press is refused: the run is no longer INVOICED
    await expect(
      h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } }),
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
  });

  it("computeRun: the engine reads every slip and opens the review with the seed's holds", async () => {
    await runQueued("computeRun");
    const run = await h.t.json<{ run: { state: string }; holds: { open: number; blocking: number } }>(
      `/v1/runs/${h.world.runSlug}`,
      {
        as: h.t.credentials.bearer(h.tokens.treasurer),
      },
    );
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.holds).toMatchObject({ open: 4, blocking: 3 });
  });

  it("MM-5 → MM-6: review, two keys, the POST of exactly the signed batch, then the settle GET", async () => {
    await resolveAll(h);
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    const analyn = await registerKey(db, h.world.workspaceId, { keyId: "fs-analyn-a1", persona: "analyn" });
    const ernesto = await registerKey(db, h.world.workspaceId, {
      keyId: "fs-ernesto-a1",
      persona: "ernesto",
    });
    const runSlug = h.world.runSlug;
    const t = (
      await h.t
        .client(h.tokens.treasurer)
        .approvalPayload({ params: { runSlug }, query: { role: "treasurer" } })
    ).payload;
    await h.t.client(h.tokens.treasurer).submitApproval({
      params: { runSlug },
      body: {
        role: "treasurer",
        keyId: "fs-analyn-a1",
        signature: ed25519Sign(analyn.privateKey, approvalBytes(t)),
        payload: t,
      },
    });
    const c = (
      await h.t.client(h.tokens.chair).approvalPayload({ params: { runSlug }, query: { role: "chair" } })
    ).payload;
    await h.t.client(h.tokens.chair).submitApproval({
      params: { runSlug },
      body: {
        role: "chair",
        keyId: "fs-ernesto-a1",
        signature: ed25519Sign(ernesto.privateKey, approvalBytes(c)),
        payload: c,
      },
    });

    await runQueued("postPayoutBatch");
    const sent = posted.at(-1);
    expect(sent?.items).toHaveLength(figures.batchItemCount);
    const total = (sent?.items ?? []).reduce((s, i) => s + Math.round(Number(i.amount.value) * 100), 0);
    expect(total).toBe(figures.batchTotalCents);
    expect(sent?.sender_batch_header.note).toBe(`Fair Split 2026-A, batch ${t.batchSha256.slice(0, 8)}`);
    let run = await h.t.json<{ run: { state: string }; lines: Record<string, number> }>(
      `/v1/runs/${runSlug}`,
      { as: h.t.credentials.bearer(h.tokens.treasurer) },
    );
    expect(run.body.run.state).toBe("POSTED");
    expect(run.body.lines.PAYPAL_PENDING).toBe(figures.batchItemCount);
    expect(run.body.lines.OFF_RAIL_DUE).toBe(figures.cashMembers);

    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch).toMatchObject({ paypalBatchId: BATCH, batchSha256: t.batchSha256, status: "PENDING" });
    await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
    run = await h.t.json(`/v1/runs/${runSlug}`, { as: h.t.credentials.bearer(h.tokens.treasurer) });
    expect(run.body.run.state).toBe("NEEDS_FOLLOW_UP");
    expect(run.body.lines.PAID).toBe(figures.batchItemCount - 1);
    expect(run.body.lines.UNCLAIMED).toBe(1);
  });

  it("MM-6: Rhea's parked item is cancelled and her line moves to cash; the run settles", async () => {
    const lines = await h.t.json<{ lines: { id: string; memberNo: string; state: string }[] }>(
      `/v1/runs/${h.world.runSlug}/lines`,
      {
        as: h.t.credentials.bearer(h.tokens.treasurer),
      },
    );
    const rhea = lines.body.lines.find((l) => l.state === "UNCLAIMED");
    expect(rhea?.memberNo).toBe("M-031");
    // a PAID line cannot move to cash
    const paid = lines.body.lines.find((l) => l.state === "PAID");
    await expect(
      h.t.client(h.tokens.treasurer).payCash({ params: { lineId: paid?.id as string } }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const r = await h.t.client(h.tokens.treasurer).payCash({ params: { lineId: rhea?.id as string } });
    expect(r).toMatchObject({
      cancelled: true,
      line: { memberNo: "M-031", state: "OFF_RAIL_DUE", rail: "PAYPAL" },
    });
    const run = await h.t.json<{ run: { state: string } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    });
    expect(run.body.run.state).toBe("SETTLED");
    expect(calls.filter((c) => c === "cancel_unclaimed")).toHaveLength(1);
    // again: already in cash, nothing sent
    const again = await h.t.client(h.tokens.treasurer).payCash({ params: { lineId: rhea?.id as string } });
    expect(again).toMatchObject({ cancelled: false, line: { state: "OFF_RAIL_DUE" } });
    expect(calls.filter((c) => c === "cancel_unclaimed")).toHaveLength(1);
  });

  it("inv.i7/i8: the ledger chain verifies; every event is an IC-01 RunEvent; PayPal-derived ones carry the rail's provenance", async () => {
    const verdict = await verifyChain(h.t.deps.db, h.world.workspaceId);
    expect(verdict.ok).toBe(true);
    const kinds = new Set(
      (
        await h.t.deps.db
          .select({ kind: schema.ledgerEntries.kind })
          .from(schema.ledgerEntries)
          .where(eq(schema.ledgerEntries.workspaceId, h.world.workspaceId))
      ).map((e) => e.kind),
    );
    for (const k of [
      "invoice.funded",
      "lines.computed",
      "key.registered",
      "approval.signed",
      "payout.submitting",
      "payout.cancel",
    ]) {
      expect(kinds.has(k), k).toBe(true);
    }
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
    expect(items.every((e) => e.provenance === "live")).toBe(true);
    const runStates = events
      .filter((e) => e.type === "run.state")
      .map((e) => (e.payload as { to: string }).to);
    expect(runStates).toEqual(
      expect.arrayContaining([
        "FUNDED",
        "EXTRACTING",
        "COMPUTED",
        "IN_REVIEW",
        "TREASURER_APPROVED",
        "AWAITING_BOARD",
        "APPROVED",
        "POSTING",
        "POSTED",
        "SETTLING",
        "NEEDS_FOLLOW_UP",
        "SETTLED",
      ]),
    );
  });
});
