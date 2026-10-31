// The hero path end to end on embedded Postgres against the REAL in-process PayPal simulator (ADR-0010), no msw:
// the run is invoiced through Agent Toolkit 1.11.0 (create, send, GET, AUTO_CANCEL: its axios reaches the simulator
// through the interceptor), "Mark paid" records the payment and a fresh GET funds it, the engine reads the slips (the
// world still pre-seeds the slip rows; J1's extract replay removes that), the review and both keys, then the POST of
// exactly the signed batch through PayoutsService (fs-api's rail → the simulator's REST routes). The simulator pays the
// seven members with accounts and parks Rhea (M-031, no account) UNCLAIMED; its signed webhooks reach our own
// /webhooks/paypal and are verified (RSA-SHA256 over the CRC32, its cert URL and CA, freshness, transmission ids) and
// stored; the settle GET reads 7 SUCCESS and 1 UNCLAIMED; "Pay in cash at the bodega" cancels her item (RETURNED) and
// the run settles. The ledger chain verifies, every event is an IC-01 RunEvent, and every PayPal-derived row and event
// says `simulated_rail` (I8). The simulator found nothing off its vendored specs.
import { RunEvent } from "@fairsplit/contracts";
import { schema, verifyChain } from "@fairsplit/db";
import { getSnapshot } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { settleBatch } from "../money/settle.js";
import { type RunsHarness, resolveAll, runQueued, signBoth } from "../runs/test/app.js";
import type { InProcessPayPalSimulator } from "./simulator.js";
import { startSimRuns, storedWebhooks } from "./test/sim.js";

const figures = getSnapshot().figures;
let h: RunsHarness & { sim: InProcessPayPalSimulator };
/** Every delivery the simulator made to our webhook route, with the route's answer. */
const deliveries: { eventId: string | null; status: number }[] = [];

beforeAll(async () => {
  h = await startSimRuns({ world: { runState: "QUOTED" } });
  h.sim.deliverTo(async (request) => {
    const body = (await request.clone().json()) as { id?: string };
    const res = await h.t.app.fetch(request);
    deliveries.push({ eventId: body.id ?? null, status: res.status });
    return res;
  });
});
afterAll(async () => {
  expect(h?.sim.violations).toEqual([]);
  await h?.close();
});

const treasurer = () => h.t.credentials.bearer(h.tokens.treasurer);

async function runView() {
  return h.t.json<{
    run: { state: string };
    lines: Record<string, number>;
    holds: { open: number; blocking: number };
  }>(`/v1/runs/${h.world.runSlug}`, { as: treasurer() });
}

describe("the hero path on the in-process simulator rail (no msw)", () => {
  it("invoices the brand through the Agent Toolkit on the simulator; X-FS-Rail says simulated", async () => {
    const r = await h.t.json<{
      runState: string;
      invoiceStatus: string;
      paypalInvoiceId: string;
      rail: string;
    }>(`/v1/runs/${h.world.runSlug}/invoice`, { method: "POST", body: {}, as: treasurer() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.get("x-fs-rail")).toBe("simulated");
    expect(r.body).toMatchObject({ runState: "INVOICED", rail: "simulated" });
    expect(r.body.paypalInvoiceId).toMatch(/^INV2-/);
    expect(["SENT", "UNPAID"]).toContain(r.body.invoiceStatus);
  });

  it("MM-S: Mark paid records the payment and a fresh GET funds the run, live on the simulated rail", async () => {
    const r = await h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });
    expect(r).toMatchObject({
      invoiceStatus: "MARKED_AS_PAID",
      runState: "EXTRACTING",
      provenance: "simulated_rail",
    });
    const replayed = await h.t.deps.db
      .select({ id: schema.ledgerEntries.id })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "judge.step.replayed"),
        ),
      );
    expect(replayed).toEqual([]);
    const calls = await h.t.deps.db
      .select({ purpose: schema.paypalCalls.purpose, status: schema.paypalCalls.status })
      .from(schema.paypalCalls)
      .where(eq(schema.paypalCalls.workspaceId, h.world.workspaceId));
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.status !== null && c.status < 500)).toBe(true);
  });

  it("computeRun: the engine reads every slip and opens the review with the seed's holds", async () => {
    expect(await runQueued(h, "computeRun")).toBeGreaterThan(0);
    const run = await runView();
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.holds).toMatchObject({ open: 4, blocking: 3 });
  });

  it("MM-5 → MM-6: two keys post exactly the signed batch; 7 SUCCESS and Rhea UNCLAIMED", async () => {
    await resolveAll(h);
    const { batchSha256 } = await signBoth(h);
    expect(await runQueued(h, "postPayoutBatch")).toBe(1);
    let run = await runView();
    expect(run.body.run.state).toBe("POSTED");
    expect(run.body.lines.PAYPAL_PENDING).toBe(figures.batchItemCount);
    expect(run.body.lines.OFF_RAIL_DUE).toBe(figures.cashMembers);
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    expect(batch?.batchSha256).toBe(batchSha256);
    expect(batch?.paypalBatchId).toBeTruthy();
    expect(batch?.provenance).toBe("simulated_rail");

    await h.sim.idle(); // the simulator processes the batch and delivers its webhooks
    await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
    run = await runView();
    expect(run.body.run.state).toBe("NEEDS_FOLLOW_UP");
    expect(run.body.lines.PAID).toBe(figures.batchItemCount - 1);
    expect(run.body.lines.UNCLAIMED).toBe(1);
    const items = await h.t.deps.db
      .select({ status: schema.payoutItems.status, receiver: schema.payoutItems.receiver })
      .from(schema.payoutItems)
      .where(eq(schema.payoutItems.workspaceId, h.world.workspaceId));
    expect(items.filter((i) => i.status === "SUCCESS")).toHaveLength(7);
    expect(items.filter((i) => i.status === "UNCLAIMED").map((i) => i.receiver)).toEqual([
      "rhea.jumawan@example.org",
    ]);
  });

  it("the simulator's signed webhooks reached /webhooks/paypal, verified and stored (and each resent once)", async () => {
    const rows = await storedWebhooks(h.t);
    const verified = rows.filter((r) => r.verified === "self");
    expect(verified.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.verified === "self" && r.provenance === "simulated_rail")).toBe(true);
    const types = new Set(verified.map((r) => r.eventType));
    for (const type of ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED"]) {
      expect(types.has(type), type).toBe(true);
    }
    expect(verified.filter((r) => r.eventType === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toHaveLength(7);
    // the duplicate toggle: every event delivered twice, every copy answered 200, one row per event
    expect(deliveries.every((d) => d.status === 200)).toBe(true);
    for (const row of rows) {
      expect(
        deliveries.filter((d) => d.eventId === row.paypalEventId),
        row.eventType,
      ).toHaveLength(2);
    }
  });

  it("MM-6: Rhea's parked item is cancelled (RETURNED at the simulator) and her line moves to cash; the run settles", async () => {
    const lines = await h.t.json<{ lines: { id: string; memberNo: string; state: string }[] }>(
      `/v1/runs/${h.world.runSlug}/lines`,
      { as: treasurer() },
    );
    const rhea = lines.body.lines.find((l) => l.state === "UNCLAIMED");
    expect(rhea?.memberNo).toBe("M-031");
    const r = await h.t.client(h.tokens.treasurer).payCash({ params: { lineId: rhea?.id as string } });
    expect(r).toMatchObject({
      cancelled: true,
      line: { memberNo: "M-031", state: "OFF_RAIL_DUE", rail: "PAYPAL" },
    });
    const run = await runView();
    expect(run.body.run.state).toBe("SETTLED");
    const [item] = await h.t.deps.db
      .select({
        payoutItemId: schema.payoutItems.payoutItemId,
        transactionStatus: schema.payoutItems.transactionStatus,
      })
      .from(schema.payoutItems)
      .where(
        and(
          eq(schema.payoutItems.workspaceId, h.world.workspaceId),
          eq(schema.payoutItems.receiver, "rhea.jumawan@example.org"),
        ),
      );
    expect(item?.transactionStatus).toBe("RETURNED");
    const atSim = await h.t.deps.paypal.core.http.request<{ transaction_status: string }>({
      method: "GET",
      path: `/v1/payments/payouts-item/${item?.payoutItemId}`,
      purpose: "payouts.item.get",
      priority: "background",
    });
    expect(atSim.ok && atSim.body.transaction_status).toBe("RETURNED");
  });

  it("inv.i7/i8: the ledger chain verifies; every event is an IC-01 RunEvent; PayPal-derived ones say simulated_rail", async () => {
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
    expect(items.every((e) => e.provenance === "simulated_rail")).toBe(true);
    expect(events.some((e) => e.provenance === "replay")).toBe(false);
    const runStates = events
      .filter((e) => e.type === "run.state")
      .map((e) => (e.payload as { to: string }).to);
    expect(runStates).toEqual(
      expect.arrayContaining([
        "INVOICED",
        "FUNDED",
        "EXTRACTING",
        "IN_REVIEW",
        "APPROVED",
        "POSTING",
        "POSTED",
        "NEEDS_FOLLOW_UP",
        "SETTLED",
      ]),
    );
  });
});
