// Judge Mode's "Mark paid" (S3.6.3 Funding): record_payment_for_invoice, then a fresh GET. Two guards:
//   1. Mark paid is Judge Mode's (or the simulated rail's). On the sandbox rail, a real or showcase run is funded
//      by the brand paying the hosted page; the treasurer alone never marks the brand's invoice paid.
//   2. S3.10 "Record payment: a retry GETs first". A payment PayPal recorded before its answer was lost is never
//      recorded twice: the retry reads the invoice, finds MARKED_AS_PAID and funds the run from that GET.
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, startRuns } from "../runs/test/app.js";
import { paypalScript, TEST_INVOICE_ID, TOOLKIT_HOST } from "../runs/test/paypal.js";
import { seedWorld } from "../runs/test/world.js";
import { paypalError } from "../test/index.js";

const INVOICE = `${TOOLKIT_HOST}/v2/invoicing/invoices/${TEST_INVOICE_ID}`;

const press = (h: RunsHarness) =>
  h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });

async function runState(h: RunsHarness) {
  const [run] = await h.t.deps.db
    .select({ state: schema.payRuns.state })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, h.world.runId));
  return run?.state;
}

async function invoiceRow(h: RunsHarness) {
  const [inv] = await h.t.deps.db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.runId, h.world.runId));
  if (!inv) throw new Error("invoice");
  return inv;
}

async function ledgerKinds(h: RunsHarness, kind: string) {
  return h.t.deps.db
    .select()
    .from(schema.ledgerEntries)
    .where(
      and(eq(schema.ledgerEntries.workspaceId, h.world.workspaceId), eq(schema.ledgerEntries.kind, kind)),
    );
}

describe("a retry GETs first (S3.10)", () => {
  const script = paypalScript({ invoiceStatus: "UNPAID" });
  let h: RunsHarness;
  let recorded = 0;
  let paid = false;
  const invoiceBody = () => ({
    id: TEST_INVOICE_ID,
    status: paid ? "MARKED_AS_PAID" : "UNPAID",
    detail: {
      invoice_number: `FS-${h.world.runSlug}`,
      reference: `rc:${h.world.rateCardSha256.slice(0, 16)}`,
      currency_code: "USD",
      invoice_date: "2026-10-27",
    },
    amount: { currency_code: "USD", value: "4333.50" },
    due_amount: { currency_code: "USD", value: paid ? "0.00" : "4333.50" },
  });

  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED" } });
    h.paypal?.use(
      http.post(`${INVOICE}/payments`, () => {
        recorded += 1;
        paid = true; // PayPal applied it; the answer never reaches us
        return paypalError(500, "INTERNAL_SERVICE_ERROR");
      }),
      http.get(INVOICE, () => HttpResponse.json(invoiceBody())),
    );
  });
  afterAll(async () => h?.close());

  it("PayPal records the payment but its answer is lost: the press is QUEUED for the outbox's retry", async () => {
    await expect(press(h)).rejects.toMatchObject({ code: "QUEUED" });
    expect(recorded).toBe(1);
    expect(await runState(h)).toBe("INVOICED");
    expect((await invoiceRow(h)).paymentRecordedAt).toBeNull();
  });

  it("the retry reads the invoice first, finds MARKED_AS_PAID and funds the run without recording again", async () => {
    const owner = h.t.pg?.owner.db;
    if (!owner) throw new Error("db");
    await owner
      .update(schema.taskOutbox)
      .set({ runAfter: new Date(Date.now() - 1_000) })
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          eq(schema.taskOutbox.name, "recordPayment"),
        ),
      );
    const r = await press(h);
    expect(r).toMatchObject({
      invoiceStatus: "MARKED_AS_PAID",
      runState: "EXTRACTING",
      provenance: "simulated_rail",
    });
    expect(recorded).toBe(1);
    expect((await invoiceRow(h)).paymentRecordedAt).not.toBeNull();
    expect(await ledgerKinds(h, "invoice.funded")).toHaveLength(1);
  });
});

describe("Mark paid is Judge Mode's on the sandbox rail (S3.6.3)", () => {
  const script = paypalScript({ invoiceStatus: "UNPAID" });
  let h: RunsHarness;
  beforeAll(async () => {
    h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED", kind: "real" } });
  });
  afterAll(async () => h?.close());

  it("a real co-op's treasurer cannot mark the brand's invoice paid: refused before anything is queued or sent", async () => {
    await expect(press(h)).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
    expect(script.calls).toEqual([]);
    const tasks = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.workspaceId, h.world.workspaceId));
    expect(tasks).toHaveLength(0);
    expect(await ledgerKinds(h, "invoice.mark_paid_requested")).toHaveLength(0);
    expect(await runState(h)).toBe("INVOICED");
  });

  it("nor can the showcase run's treasurer (in the film, Lantern Bay pays the hosted page)", async () => {
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    const showcase = await seedWorld(db, {
      kind: "showcase",
      runState: "INVOICED",
      invoice: { paypalInvoiceId: "INV2-TEST-RUNS-0002", status: "UNPAID", sent: true },
    });
    const token = await h.t.credentials.frameToken({
      workspaceId: showcase.workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    await expect(h.t.client(token).markPaid({ params: { runSlug: showcase.runSlug } })).rejects.toMatchObject(
      { code: "INVALID_TRANSITION" },
    );
    expect(script.calls).toEqual([]);
  });
});
