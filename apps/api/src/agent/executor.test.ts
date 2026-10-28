// The AgentMoneyPort reads and writes only this run's own invoice. add_auto_cancel_rule used to GET the
// agent-supplied invoice id before the policy gate and store that invoice's date as this run's PayPal invoice
// date: a wrong or hostile id from the model corrupted the run even though the rule itself was then denied.
// Now a foreign id goes straight to the lattice (a recorded DENY) and nothing is read or written.
import { schema, systemScope } from "@fairsplit/db";
import { and, asc, eq } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTORS } from "../runs/events.js";
import { type RunsHarness, startRuns } from "../runs/test/app.js";
import { paypalScript, TEST_INVOICE_ID, TOOLKIT_HOST } from "../runs/test/paypal.js";
import { createAgentMoneyPort } from "./executor.js";

const HOSTILE = "INV2-HOSTILE-0001";
const script = paypalScript({ invoiceStatus: "UNPAID" });
const hostileReads: string[] = [];
let h: RunsHarness;
const session = {
  sessionId: "00000000-0000-7000-8000-00000000a6e2",
  purpose: "DRAFT_INVOICE" as const,
  mode: "replay" as const,
  spentMicros: 0,
  capMicros: 250_000,
  iteration: 0,
  maxIterations: 6,
};
const scope = () => systemScope(h.world.workspaceId, ACTORS.outbox);

async function invoiceRow() {
  const [inv] = await h.t.deps.db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.runId, h.world.runId));
  if (!inv) throw new Error("invoice");
  return inv;
}

async function lastVerdict() {
  const rows = await h.t.deps.db
    .select({ payload: schema.runEvents.payload })
    .from(schema.runEvents)
    .where(
      and(eq(schema.runEvents.workspaceId, h.world.workspaceId), eq(schema.runEvents.type, "policy.verdict")),
    )
    .orderBy(asc(schema.runEvents.id));
  return rows.at(-1)?.payload as { tool: string; verdict: string } | undefined;
}

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { runState: "QUOTED" } });
  // the agent created and sent the invoice in its earlier steps; PayPal's invoice date is not read yet
  const owner = h.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  await owner
    .update(schema.invoices)
    .set({ paypalInvoiceId: TEST_INVOICE_ID, status: "DRAFT" })
    .where(eq(schema.invoices.runId, h.world.runId));
  h.paypal?.use(
    http.get(`${TOOLKIT_HOST}/v2/invoicing/invoices/${HOSTILE}`, () => {
      hostileReads.push(HOSTILE);
      return HttpResponse.json({
        id: HOSTILE,
        status: "UNPAID",
        detail: { invoice_number: "FS-ELSEWHERE", currency_code: "USD", invoice_date: "2026-01-01" },
        amount: { currency_code: "USD", value: "1.00" },
        due_amount: { currency_code: "USD", value: "1.00" },
      });
    }),
  );
});
afterAll(async () => h?.close());

describe("add_auto_cancel_rule touches only the run's own invoice", () => {
  it("a foreign invoice id is denied by the lattice before anything is read or written", async () => {
    const port = createAgentMoneyPort(h.t.deps, scope(), { session, sendApproval: null });
    const r = await port.addAutoCancelRule({ runId: h.world.runId, invoiceId: HOSTILE });
    expect(r).toMatchObject({ ok: false, verdict: "DENY", error: "POLICY_DENIED" });
    expect(hostileReads).toEqual([]);
    expect(script.calls).toEqual([]);
    expect(await invoiceRow()).toMatchObject({
      createdAtPaypal: null,
      ruleCreatedAt: null,
      autoCancelOn: null,
    });
    expect(await lastVerdict()).toMatchObject({
      tool: "create_conditional_rules_for_invoice",
      verdict: "DENY",
    });
  });

  it("this run's own invoice: PayPal's date is read, then the rule is added (date + 25 days)", async () => {
    const port = createAgentMoneyPort(h.t.deps, scope(), { session, sendApproval: null });
    const r = await port.addAutoCancelRule({ runId: h.world.runId, invoiceId: TEST_INVOICE_ID });
    expect(r).toMatchObject({ ok: true, value: { autoCancelOn: "2026-11-22" } });
    expect(script.calls).toEqual(["get_invoice", "create_conditional_rules_for_invoice"]);
    const inv = await invoiceRow();
    expect(inv.createdAtPaypal?.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    expect(inv.autoCancelOn).toBe("2026-11-22");
  });
});
