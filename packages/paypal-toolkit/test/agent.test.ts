import { describe, expect, it, vi } from "vitest";
import {
  type AgentInvoiceSession,
  AgentToolNotAllowedError,
  AgentToolRefusedError,
  buildInvoicePlan,
  conditionalRuleRequestId,
  type InvoiceCheckpoint,
  InvoiceNotPayableError,
  Invoices,
  PayPalToolkit,
  runAgentToolkitTool,
  type Tk,
  type TreasurerApproval,
  withItemLabels,
} from "../src/index.js";
import {
  BUSINESS_EMAIL,
  createdLink,
  fakeAuth,
  HERO_MEMO,
  heroRun,
  INVOICE_ID,
  invoiceBody,
  openLimiter,
  payerViewLink,
} from "./support/fixtures.js";
import { onGet, onPost, paypalEmpty, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryInvoiceRepo } from "./support/repo.js";

useMsw();

const NOW = new Date("2026-11-05T02:00:00.000Z");
const RUN = heroRun({ sendApproval: null });
const APPROVAL: TreasurerApproval = {
  approverId: "persona:analyn",
  approvedAt: "2026-11-05T02:00:00.000Z",
  invoiceNumber: "FS-2026A-r37",
};
/** Claude's three item labels: the only words the agent adds to the invoice (S4.4 create_run_invoice). */
const LABELS = ["Fairtrade premium", "Bean quality bonus", "Payout and audit costs"] as const;
/** Created, not yet sent: PayPal's date is not read yet. */
const CREATED: Partial<InvoiceCheckpoint> = {
  invoiceId: INVOICE_ID,
  invoiceNumber: "FS-2026A-r37",
  adopted: false,
  itemLabels: [...LABELS],
};
/** Sent, and a fresh GET showed it payable, dated 5 Nov by PayPal. */
const PAYABLE: Partial<InvoiceCheckpoint> = {
  ...CREATED,
  invoiceDate: "2026-11-05",
  sentAt: "2026-11-05T02:00:02.000Z",
  payerViewUrl: payerViewLink().href,
  payableAt: "2026-11-05T02:00:03.000Z",
};

function session(seed: Partial<InvoiceCheckpoint> | null = null, tk?: Tk) {
  const repo = new MemoryInvoiceRepo(seed ? { [RUN.runId]: seed } : {});
  const invoices = new Invoices({
    tk: tk ?? new PayPalToolkit({ auth: fakeAuth(), limiter: openLimiter() }).tk,
    repo,
    businessEmail: BUSINESS_EMAIL,
    ppMode: "sandbox",
    now: () => NOW,
  });
  const s: AgentInvoiceSession = { run: RUN, invoices };
  return { session: s, repo };
}

/** The draft a well-behaved agent sends: the code-built invoice with its own labels as item names. */
const goodDraft = () => {
  const plan = buildInvoicePlan(RUN, { businessEmail: BUSINESS_EMAIL });
  return structuredClone(withItemLabels(plan, LABELS));
};

const autoCancel = (date = "2026-11-30", invoiceId = INVOICE_ID) => ({
  invoice_id: invoiceId,
  rules: [
    {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date },
    },
  ],
});

const refusal = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e as AgentToolRefusedError);
const callLog = () => requests.map((r) => `${r.method} ${r.url.pathname}`);

describe("runAgentToolkitTool: create_invoice through the run's checkpointed chain", () => {
  it("creates the run's invoice from a draft equal to the code-built one, and checkpoints it", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    const { session: s, repo } = session();

    const out = await runAgentToolkitTool(s, "create_invoice", goodDraft());

    expect(out).toEqual({
      status: "DONE",
      method: "create_invoice",
      invoiceId: INVOICE_ID,
      invoiceNumber: "FS-2026A-r37",
      adopted: false,
      alreadyDone: false,
    });
    const body = requests[0]?.body as {
      detail: Record<string, unknown>;
      items: { name: string; unit_amount: { value: string } }[];
    };
    expect(body.detail.note).toBe(HERO_MEMO);
    expect(body.detail.invoice_number).toBe("FS-2026A-r37");
    expect(body.detail).not.toHaveProperty("invoice_date");
    // The labels are Claude's; every amount is the code's.
    expect(body.items.map((i) => [i.name, i.unit_amount.value])).toEqual([
      ["Fairtrade premium", "2887.50"],
      ["Bean quality bonus", "1386.00"],
      ["Payout and audit costs", "60.00"],
    ]);
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      invoiceId: INVOICE_ID,
      adopted: false,
      itemLabels: [...LABELS],
    });
  });

  it("does not create a second invoice for a run that holds one (a retried tool call is a no-op)", async () => {
    const { session: s } = session(CREATED);
    const out = await runAgentToolkitTool(s, "create_invoice", goodDraft());
    expect(out).toMatchObject({ status: "DONE", invoiceId: INVOICE_ID, alreadyDone: true });
    expect(requests).toHaveLength(0);
  });

  it("adopts the invoice already carrying FS-{runSlug}, exactly as the deterministic path does", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson({ name: "INVALID_REQUEST", message: "dup" }, 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson({ items: [invoiceBody({ status: "DRAFT" })], total_items: 1 }),
    );
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "DRAFT" })));
    const { session: s } = session();
    const out = await runAgentToolkitTool(s, "create_invoice", goodDraft());
    expect(out).toMatchObject({ status: "DONE", invoiceId: INVOICE_ID, adopted: true });
  });

  type Draft = ReturnType<typeof goodDraft>;
  const agentPathCases: [string, (d: Draft) => unknown, string][] = [
    [
      "a changed amount",
      (d) => ({
        ...d,
        items: d.items.map((i, n) =>
          n === 0 ? { ...i, unit_amount: { currency_code: "USD", value: "2900.00" } } : i,
        ),
      }),
      "items[0].unit_amount: differs from the quote",
    ],
    [
      "an extra item",
      (d) => ({
        ...d,
        items: [
          ...d.items,
          { name: "Tip", quantity: "1", unit_amount: { currency_code: "USD", value: "1000.00" } },
        ],
      }),
      "items: 4 lines, the quote has 3",
    ],
    ["pay-by-bank", (d) => ({ ...d, enable_pay_by_bank: true }), "enable_pay_by_bank"],
    [
      "pay-by-bank as the only method above the threshold",
      (d) => ({ ...d, pay_by_bank_exclusive_above_threshold: true }),
      "pay_by_bank_exclusive_above_threshold",
    ],
    ["a partial payment", (d) => ({ ...d, allow_partial_payment: true }), "allow_partial_payment"],
    [
      "a partial-payment minimum",
      (d) => ({ ...d, minimum_partial_payment_amount: "100.00" }),
      "minimum_partial_payment_amount",
    ],
    ["a shipping cost", (d) => ({ ...d, shipping_cost: "25.00" }), "shipping_cost"],
    ["a tip", (d) => ({ ...d, allow_tip: true }), "allow_tip"],
    [
      "a per-item discount",
      (d) => ({ ...d, items: d.items.map((i) => ({ ...i, discount: { percent: "10" } })) }),
      "items[0].discount",
    ],
    [
      "a foreign invoice_number",
      (d) => ({ ...d, invoice_number: "FS-2026A-r38" }),
      "invoice_number: differs from the code-built invoice",
    ],
    ["an invoice date", (d) => ({ ...d, invoice_date: "2026-11-05" }), "invoice_date"],
    ["a due date the toolkit schema would strip", (d) => ({ ...d, due_date: "2026-11-06" }), "due_date"],
    [
      "free text in the note",
      (d) => ({ ...d, note: `${d.note} Pay at pay-me.example.test instead.` }),
      "note",
    ],
    ["an amount in words", (d) => ({ ...d, note: `${d.note}. Please pay five thousand dollars.` }), "note"],
    ["a closing phrase after the memo", (d) => ({ ...d, note: `${d.note}. Thank you.` }), "note"],
    [
      "an amount in words as an item label",
      (d) => ({
        ...d,
        items: d.items.map((i, n) => (n === 0 ? { ...i, name: "Five thousand dollars" } : i)),
      }),
      "items[0].name",
    ],
    [
      "a digit in an item label",
      (d) => ({ ...d, items: d.items.map((i, n) => (n === 2 ? { ...i, name: "Costs 60" } : i)) }),
      "items[2].name",
    ],
    [
      "another recipient",
      (d) => ({ ...d, primary_recipients: [{ billing_info: { email_address: "attacker@example.test" } }] }),
      "primary_recipients",
    ],
  ];

  it.each(agentPathCases)(
    "inv.i1.no-model-numbers: refuses a draft with %s on the agent path, with zero requests",
    async (_label, mutate, mismatch) => {
      const { session: s, repo } = session();
      const error = await refusal(runAgentToolkitTool(s, "create_invoice", mutate(goodDraft())));
      expect(error).toBeInstanceOf(AgentToolRefusedError);
      expect(error?.mismatches.some((m) => m.startsWith(mismatch))).toBe(true);
      expect(requests).toHaveLength(0);
      expect(repo.saves).toHaveLength(0);
    },
  );

  it("inv.i1.no-model-numbers: a refused draft is refused again once the run holds its invoice", async () => {
    // A retried tool call never turns a bad draft into a no-op success.
    const { session: s } = session(CREATED);
    const bad = { ...goodDraft(), shipping_cost: "25.00" };
    await expect(runAgentToolkitTool(s, "create_invoice", bad)).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: send_invoice (sendNeedsTreasurer)", () => {
  it("parks until the treasurer approves; the model's e-mail flag and note are ignored", async () => {
    const { session: s } = session(CREATED);
    const out = await runAgentToolkitTool(s, "send_invoice", {
      invoice_id: INVOICE_ID,
      send_to_recipient: true,
      note: "Season premium",
    });
    expect(out).toEqual({ status: "PENDING_APPROVAL", method: "send_invoice", invoiceId: INVOICE_ID });
    expect(requests).toHaveLength(0);
  });

  it("sends this run's invoice, never e-mailed and without agent text, then checks it is payable", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    const { session: s, repo } = session(CREATED);
    const out = await runAgentToolkitTool(
      s,
      "send_invoice",
      { invoice_id: INVOICE_ID, send_to_recipient: true, note: "Please pay 5000" },
      { treasurerApproval: APPROVAL },
    );
    expect(out).toEqual({
      status: "DONE",
      method: "send_invoice",
      invoiceId: INVOICE_ID,
      payerViewUrl: invoiceBody().detail.metadata.recipient_view_url,
      alreadyDone: false,
    });
    // The toolkit posts its parsed arguments as the body: no note, and never e-mailed.
    expect(requests[0]?.body).toEqual({ invoice_id: INVOICE_ID, send_to_recipient: false });
    expect(callLog()).toEqual([
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
    ]);
    expect(repo.rows.get(RUN.runId)).toMatchObject({ sentAt: NOW.toISOString(), invoiceDate: "2026-11-05" });
  });

  it("is a no-op for an invoice already sent and payable", async () => {
    const { session: s } = session(PAYABLE);
    const out = await runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID });
    expect(out).toMatchObject({ status: "DONE", alreadyDone: true, payerViewUrl: PAYABLE.payerViewUrl });
    expect(requests).toHaveLength(0);
  });

  it("leaves a SCHEDULED invoice to the server chain: it reports it and deletes nothing", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SCHEDULED" })));
    const { session: s } = session(CREATED);
    await expect(
      runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID }, { treasurerApproval: APPROVAL }),
    ).rejects.toBeInstanceOf(InvoiceNotPayableError);
    expect(callLog().some((c) => c.startsWith("DELETE"))).toBe(false);
  });

  it.each([
    [
      "extra recipients",
      CREATED,
      { invoice_id: INVOICE_ID, additional_recipients: ["attacker@example.test"] },
      APPROVAL,
    ],
    ["another invoice", CREATED, { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD" }, APPROVAL],
    [
      "an approval of another invoice number",
      CREATED,
      { invoice_id: INVOICE_ID },
      { ...APPROVAL, invoiceNumber: "FS-2026A-r36" },
    ],
    [
      "an approval of another invoice id",
      CREATED,
      { invoice_id: INVOICE_ID },
      { ...APPROVAL, invoiceId: "INV2-AAAA-BBBB-CCCC-DDDD" },
    ],
    ["an approval without an approver", CREATED, { invoice_id: INVOICE_ID }, { ...APPROVAL, approverId: "" }],
    ["no invoice yet", null, { invoice_id: INVOICE_ID }, APPROVAL],
  ])("refuses a send with %s, and sends nothing", async (_label, seed, args, approval) => {
    const { session: s } = session(seed);
    const error = await refusal(
      runAgentToolkitTool(s, "send_invoice", args, { treasurerApproval: approval }),
    );
    expect(error).toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: create_conditional_rules_for_invoice", () => {
  it("adds AUTO_CANCEL on PayPal's invoice date + 25 days under request id cr-{invoiceId}", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { session: s, repo } = session(PAYABLE);
    const out = await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel());
    expect(out).toEqual({
      status: "DONE",
      method: "create_conditional_rules_for_invoice",
      invoiceId: INVOICE_ID,
      autoCancelOn: "2026-11-30",
      alreadyDone: false,
    });
    expect(requests[0]?.headers.get("paypal-request-id")).toBe(conditionalRuleRequestId(INVOICE_ID));
    expect(conditionalRuleRequestId(INVOICE_ID)).toBe(`cr-${INVOICE_ID}`);
    expect(repo.rows.get(RUN.runId)).toMatchObject({ autoCancelOn: "2026-11-30" });

    // A second identical call is a no-op; a different date is refused even then.
    await expect(
      runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel()),
    ).resolves.toMatchObject({ alreadyDone: true });
    await expect(
      runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel("2026-12-01")),
    ).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(1);
  });

  it("reads PayPal's invoice date first when the run does not hold it yet", async () => {
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-04" })),
    );
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { session: s } = session(CREATED);
    await expect(
      runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel("2026-11-29")),
    ).resolves.toMatchObject({ status: "DONE", autoCancelOn: "2026-11-29" });
    expect(callLog()).toEqual([
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
  });

  it.each([
    [
      "an early-payment discount",
      {
        invoice_id: INVOICE_ID,
        rules: [
          {
            conditional_rule_type: "EARLY_PAYMENT_DISCOUNT",
            conditional_rule_value_type: "PERCENT",
            conditional_rule_value: "10",
            rule_expiry_terms: {
              rule_expiry_condition: "SPECIFIC_DATE",
              condition_rule_end_date: "2026-11-30",
            },
          },
        ],
      },
    ],
    [
      "a relative expiry",
      {
        invoice_id: INVOICE_ID,
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: {
              rule_expiry_condition: "THIRTY_DAYS_AFTER_ISSUE_DATE",
              condition_rule_end_date: "2026-12-05",
            },
          },
        ],
      },
    ],
    [
      "two rules",
      { invoice_id: INVOICE_ID, rules: [...autoCancel().rules, ...autoCancel("2026-12-01").rules] },
    ],
    ["a date other than invoice date + 25 days (C-27)", autoCancel("2026-12-04")],
    ["another invoice", autoCancel("2026-11-30", "INV2-AAAA-BBBB-CCCC-DDDD")],
  ])("refuses %s", async (_label, args) => {
    const { session: s } = session(PAYABLE);
    const error = await refusal(runAgentToolkitTool(s, "create_conditional_rules_for_invoice", args));
    expect(error).toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });

  it("refuses an AUTO_CANCEL date that is already past (dueWithin30Days), before any call", async () => {
    // An invoice PayPal dated 1 Oct cancels on 26 Oct: on 5 Nov that is not after today.
    const { session: s } = session({ ...PAYABLE, invoiceDate: "2026-10-01" });
    const error = await refusal(
      runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel("2026-10-26")),
    );
    expect(error).toBeInstanceOf(AgentToolRefusedError);
    expect(error?.reason).toMatch(/not after today/);
    expect(requests).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: get_invoice and the allowlist", () => {
  it("reads this run's invoice, and no other", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const { session: s } = session(PAYABLE);
    const got = await runAgentToolkitTool(s, "get_invoice", { invoice_id: INVOICE_ID });
    expect(got).toMatchObject({ status: "DONE", method: "get_invoice", invoiceId: INVOICE_ID });
    const other = await refusal(
      runAgentToolkitTool(s, "get_invoice", { invoice_id: "INV2-AAAA-BBBB-CCCC-DDDD" }),
    );
    expect(other).toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(1);
  });

  it("refuses arguments the toolkit schema rejects, before anything is sent", async () => {
    const { session: s } = session(PAYABLE);
    await expect(runAgentToolkitTool(s, "get_invoice", { invoice_id: "a/b" })).rejects.toBeInstanceOf(
      AgentToolRefusedError,
    );
    expect(requests).toHaveLength(0);
  });

  it.each([
    "record_payment_for_invoice",
    "search_invoicing",
    "delete_invoice",
    "create_payout_batch",
    "cancel_unclaimed_payout_item",
    "cancel_sent_invoice",
    "create_refund",
    "pay_order",
    "generate_invoice_qr_code",
    "update_invoicing",
    "record_refund_for_invoice",
  ])("contract: the agent cannot reach %s", async (tool) => {
    const spy = vi.fn() as unknown as Tk;
    const { session: s } = session(PAYABLE, spy);
    await expect(runAgentToolkitTool(s, tool, {})).rejects.toBeInstanceOf(AgentToolNotAllowedError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("contract: every PayPal call the agent can cause is one of the four Invoicing tools", async () => {
    const methods: string[] = [];
    const spy: Tk = async <T>(method: string) => {
      methods.push(method);
      if (method === "create_invoice") return createdLink() as T;
      if (method === "send_invoice") return payerViewLink() as T;
      if (method === "get_invoice") return invoiceBody() as T;
      return {} as T;
    };
    const { session: s } = session(null, spy);
    await runAgentToolkitTool(s, "create_invoice", goodDraft());
    await runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID }, { treasurerApproval: APPROVAL });
    await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", autoCancel());
    await runAgentToolkitTool(s, "get_invoice", { invoice_id: INVOICE_ID });
    expect(methods).toEqual([
      "create_invoice",
      "send_invoice",
      "get_invoice",
      "create_conditional_rules_for_invoice",
      "get_invoice",
    ]);
    expect(new Set(methods)).toEqual(
      new Set(["create_invoice", "send_invoice", "create_conditional_rules_for_invoice", "get_invoice"]),
    );
  });
});
