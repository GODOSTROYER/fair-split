// The AgentMoneyPort and the C-06 replay on embedded Postgres, PayPal answered by msw. The agent's recorded
// invoice turn runs live through the policy lattice: code builds every body PayPal sees (I1), the send waits
// for the treasurer (Judge Mode: the session start), and every call is a recorded verdict. A tampered draft
// (the "make Claude's draft overcharge" and "offsetting invoice" demos, eval case A2) is denied and sends
// nothing; so is anything while kill_paypal_live is on.
import { schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { canonicalInvoice } from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { quoteRun } from "../money/funding.js";
import { invoiceWorld } from "../money/policy.js";
import { ACTORS } from "../runs/events.js";
import { runById } from "../runs/load.js";
import { type RunsHarness, startRuns } from "../runs/testing/app.js";
import { paypalScript } from "../runs/testing/paypal.js";
import { createAgentMoneyPort } from "./executor.js";
import { PLACEHOLDER_DRAFT_INVOICE } from "./recording.js";

const script = paypalScript({ invoiceStatus: "DRAFT" });
let h: RunsHarness;
const session = {
  sessionId: "00000000-0000-7000-8000-00000000a6e1",
  purpose: "DRAFT_INVOICE" as const,
  mode: "replay" as const,
  spentMicros: 0,
  capMicros: 250_000,
  iteration: 0,
  maxIterations: 6,
};
const labels = { premium: "Fair-trade premium", bonus: "Quality bonus", disbursement: "Disbursement costs" };

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { runState: "DRAFT", invoice: null } });
});
afterAll(async () => h?.close());

const scope = () => systemScope(h.world.workspaceId, ACTORS.outbox);

async function verdicts() {
  return h.t.deps.db
    .select({ payload: schema.runEvents.payload, provenance: schema.runEvents.provenance })
    .from(schema.runEvents)
    .where(
      and(eq(schema.runEvents.workspaceId, h.world.workspaceId), eq(schema.runEvents.type, "policy.verdict")),
    )
    .orderBy(asc(schema.runEvents.id));
}

describe("the AgentMoneyPort: the lattice decides the body code built", () => {
  it("quotes the run from the ratified card before any draft (C-09)", async () => {
    const w = await quoteRun(h.t.deps, scope(), h.world.runId);
    expect(w.run.state).toBe("QUOTED");
    expect(w.quote.totalCents).toBe(getSnapshot().figures.invoiceCents);
    expect(w.expected.reference).toBe(`rc:${h.world.rateCardSha256.slice(0, 16)}`);
  });

  it("inv.i1.tamper: an overcharging or offsetting draft is denied and nothing is sent (eval A2)", async () => {
    const port = createAgentMoneyPort(h.t.deps, scope(), { session, sendApproval: null });
    const w = await withWorkspaceTx(h.t.deps.db, scope(), async (tx) =>
      invoiceWorld(tx, scope(), h.t.deps, await runById(tx, scope(), h.world.runId)),
    );
    const canonical = canonicalInvoice(w.expected, [labels.premium, labels.bonus, labels.disbursement]);
    const overcharge = {
      ...canonical,
      items: canonical.items.map((it, i) =>
        i === 0 ? { ...it, unit_amount: { currency_code: "USD", value: "3887.50" } } : it,
      ),
    };
    const offsetting = {
      ...canonical,
      shipping_cost: "50.00",
      items: canonical.items.map((it, i) =>
        i === 0 ? { ...it, discount: { amount: { currency_code: "USD", value: "50.00" } } } : it,
      ),
    };
    for (const draft of [overcharge, offsetting]) {
      const r = await port.createRunInvoice({ runId: h.world.runId, itemLabels: labels, draft });
      expect(r).toMatchObject({ ok: false, verdict: "DENY", error: "POLICY_DENIED" });
      if (!r.ok) expect(r.decidedBy).toContain("invoiceEqualsQuote");
    }
    const bad = await port.createRunInvoice({
      runId: h.world.runId,
      itemLabels: { ...labels, bonus: "Bonus 1386.00" },
    });
    expect(bad).toMatchObject({ ok: false, verdict: "DENY" });
    expect(script.calls).toEqual([]);
    const recorded = await verdicts();
    expect(recorded.map((v) => (v.payload as { verdict: string }).verdict)).toEqual(["DENY", "DENY", "DENY"]);
    expect(recorded.every((v) => v.provenance === "replay")).toBe(true);
  });

  it("kill_paypal_live denies every toolkit call before anything is sent (S3.11)", async () => {
    const api = h.t.client(h.tokens.treasurer);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: true } });
    const port = createAgentMoneyPort(h.t.deps, scope(), { session, sendApproval: null });
    const r = await port.createRunInvoice({ runId: h.world.runId, itemLabels: labels });
    expect(r).toMatchObject({ ok: false, verdict: "DENY" });
    if (!r.ok) expect(r.decidedBy).toContain("killSwitch");
    expect(script.calls).toEqual([]);
    await api.setFlag({ body: { flag: "kill_paypal_live", on: false } });
  });
});

describe("C-06: the recorded invoice turn replays through the live lattice", () => {
  it("agentTurn{DRAFT_INVOICE} creates the code-built invoice, sends it under the judge's approval, adds the rule: INVOICED in 4 calls", async () => {
    const id = await withWorkspaceTx(h.t.deps.db, scope(), async (tx) => {
      const args = { runId: h.world.runId, purpose: "DRAFT_INVOICE" as const, holdId: null, turn: 0 };
      return (await enqueue(tx, "agentTurn", args, "agent:test:draft", { workspaceId: h.world.workspaceId }))
        .id;
    });
    await h.t.deps.outbox?.runTask(id);
    expect(script.calls).toEqual([
      "create_invoice",
      "send_invoice",
      "get_invoice",
      "create_conditional_rules_for_invoice",
    ]);
    const sent = script.created.at(-1) as {
      detail: { invoice_number: string; reference: string; note: string; invoice_date?: string };
      items: { name: string; unit_amount: { value: string } }[];
      primary_recipients: { billing_info: { email_address: string } }[];
    };
    expect(sent.detail.invoice_number).toBe(`FS-${h.world.runSlug}`);
    expect(sent.detail.reference).toBe(`rc:${h.world.rateCardSha256.slice(0, 16)}`);
    expect(sent.detail.invoice_date).toBeUndefined();
    expect(sent.items.map((i) => i.name)).toEqual([
      "Fair-trade premium",
      "Quality bonus (Grade one)",
      "Disbursement costs",
    ]);
    expect(sent.items.map((i) => i.unit_amount.value)).toEqual(["2887.50", "1386.00", "60.00"]);
    expect(sent.primary_recipients.map((r) => r.billing_info.email_address)).toEqual([
      "lantern-bay@example.com",
    ]);

    const run = await runById(h.t.deps.db, scope(), h.world.runId);
    expect(run.state).toBe("INVOICED");
    const [inv] = await h.t.deps.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.runId, h.world.runId));
    expect(inv).toMatchObject({ paypalInvoiceId: "INV2-TEST-RUNS-0001", autoCancelOn: "2026-11-22" });

    const recorded = (await verdicts())
      .slice(4)
      .map((v) => v.payload as { tool: string; verdict: string; sessionId: string });
    expect(recorded.map((v) => [v.tool, v.verdict])).toEqual([
      ["get_invoice_quote", "ALLOW"],
      ["get_rate_card", "ALLOW"],
      ["create_invoice", "ALLOW"],
      ["send_invoice", "REQUIRE_APPROVAL"],
      ["create_conditional_rules_for_invoice", "ALLOW"],
    ]);
    const deltas = await h.t.deps.db
      .select()
      .from(schema.runEvents)
      .where(
        and(eq(schema.runEvents.workspaceId, h.world.workspaceId), eq(schema.runEvents.type, "agent.delta")),
      );
    expect(deltas).toHaveLength(PLACEHOLDER_DRAFT_INVOICE.steps.length);
    expect(deltas.every((d) => d.provenance === "replay" && d.actorKind === "agent")).toBe(true);
    const blocks = await h.t.deps.db
      .select()
      .from(schema.agentSessions)
      .where(eq(schema.agentSessions.workspaceId, h.world.workspaceId));
    expect(blocks).toHaveLength(PLACEHOLDER_DRAFT_INVOICE.steps.length);
    expect(blocks.every((b) => b.provenance === "replay")).toBe(true);
  });
});
