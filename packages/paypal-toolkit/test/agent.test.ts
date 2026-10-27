import { createHash } from "node:crypto";
import { autoCancelRuleArgs, canonicalInvoiceCall } from "@fairsplit/domain";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentInvoiceSession,
  AgentToolNotAllowedError,
  AgentToolRefusedError,
  buildInvoicePlan,
  conditionalRuleRequestId,
  type InvoiceCheckpoint,
  InvoiceNotPayableError,
  type InvoicePolicy,
  Invoices,
  invoiceSendApproval,
  PayPalToolkit,
  runAgentToolkitTool,
  sendArgsSha256,
  type Tk,
  type TreasurerApproval,
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
  policyOf,
} from "./support/fixtures.js";
import { onGet, onPost, paypalEmpty, paypalJson, requests, useMsw } from "./support/msw.js";
import { mutants } from "./support/mutations.js";
import { MemoryInvoiceRepo } from "./support/repo.js";

useMsw();

const NOW = new Date("2026-11-05T02:00:00.000Z");
const RUN = heroRun({ sendApproval: null });
/** Analyn's approval of sending the run's invoice, bound to its PayPal id and to the exact send. */
const APPROVAL: TreasurerApproval = invoiceSendApproval({
  approverId: "persona:analyn",
  approvedAt: "2026-11-05T02:00:00.000Z",
  invoiceNumber: "FS-2026A-r37",
  invoiceId: INVOICE_ID,
});
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
/** Claude's three item labels: the only words the agent adds (S4.4), in core's per-line vocabulary. */
const LABELS = ["Fairtrade premium", "Bean quality bonus", "Payout disbursement costs"] as const;
const [PREMIUM, BONUS, DISBURSEMENT] = LABELS;
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

/** A tk() that records the exact object each call is handed, then runs it on the real toolkit over msw. */
function recordingTk() {
  const handed: { method: string; args: unknown }[] = [];
  const toolkit = new PayPalToolkit({ auth: fakeAuth(), limiter: openLimiter() });
  const tk: Tk = (method, args, requestId, options) => {
    handed.push({ method, args });
    return toolkit.tk(method, args, requestId, options);
  };
  return { handed, tk };
}

function session(
  seed: Partial<InvoiceCheckpoint> | null = null,
  options: { tk?: Tk; policy?: InvoicePolicy } = {},
) {
  const repo = new MemoryInvoiceRepo(seed ? { [RUN.runId]: seed } : {});
  const recorder = recordingTk();
  const invoices = new Invoices({
    tk: options.tk ?? recorder.tk,
    repo,
    businessEmail: BUSINESS_EMAIL,
    ppMode: "sandbox",
    now: () => NOW,
  });
  const lattice = policyOf();
  const s: AgentInvoiceSession = { run: RUN, invoices, policy: options.policy ?? lattice.policy };
  return { session: s, repo, handed: recorder.handed, decisions: lattice.decisions };
}

/** Core's canonical create body for these labels: what a well-behaved agent may write out in full. */
const canonicalDraft = (labels: readonly string[] = LABELS) => {
  const plan = buildInvoicePlan(RUN, { businessEmail: BUSINESS_EMAIL });
  const call = canonicalInvoiceCall(
    "create_invoice",
    { ...plan.expected, invoiceId: null, invoiceDate: null },
    labels,
  );
  if (!call.ok || call.method !== "create_invoice") throw new Error("the hero run cannot be invoiced");
  return structuredClone(call.args);
};

const refusal = (p: Promise<unknown>) => p.then(() => null).catch((e: unknown) => e as AgentToolRefusedError);
const callLog = () => requests.map((r) => `${r.method} ${r.url.pathname}`);

describe("runAgentToolkitTool: create_invoice builds core's canonical body, never the model's", () => {
  it("creates the run's invoice from S4.4's keyed item_labels, and checkpoints it", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    const { session: s, repo, handed, decisions } = session();

    const out = await runAgentToolkitTool(s, "create_invoice", {
      run_id: RUN.runId,
      item_labels: { premium: PREMIUM, bonus: BONUS, disbursement: DISBURSEMENT },
    });

    expect(out).toEqual({
      status: "DONE",
      method: "create_invoice",
      invoiceId: INVOICE_ID,
      invoiceNumber: "FS-2026A-r37",
      adopted: false,
      alreadyDone: false,
    });
    // tk() was handed core's canonical body, the very object the lattice allowed.
    expect(handed).toEqual([{ method: "create_invoice", args: canonicalDraft() }]);
    expect(decisions.map((d) => [d.call.name, d.decision.verdict])).toEqual([["create_invoice", "ALLOW"]]);
    expect(decisions[0]?.call.args).toBe(handed[0]?.args);
    const body = requests[0]?.body as {
      detail: Record<string, unknown>;
      items: { name: string; unit_amount: { value: string } }[];
    };
    expect(body.detail.note).toBe(HERO_MEMO);
    expect(body.detail.invoice_number).toBe("FS-2026A-r37");
    expect(body.detail).not.toHaveProperty("invoice_date");
    // The labels are Claude's; every amount is the code's.
    expect(body.items.map((i) => [i.name, i.unit_amount.value])).toEqual([
      [PREMIUM, "2887.50"],
      [BONUS, "1386.00"],
      [DISBURSEMENT, "60.00"],
    ]);
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      invoiceId: INVOICE_ID,
      adopted: false,
      itemLabels: [...LABELS],
    });
  });

  it("accepts a toolkit draft that is exactly core's canonical body, and sends core's object, not the model's", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    const { session: s, handed } = session();
    const draft = canonicalDraft();
    await runAgentToolkitTool(s, "create_invoice", draft);
    expect(handed[0]?.args).toEqual(draft);
    expect(handed[0]?.args).not.toBe(draft);
  });

  it("does not create a second invoice for a run that holds one (a retried tool call is a no-op)", async () => {
    const { session: s, handed } = session(CREATED);
    const out = await runAgentToolkitTool(s, "create_invoice", canonicalDraft());
    expect(out).toMatchObject({ status: "DONE", invoiceId: INVOICE_ID, alreadyDone: true });
    expect(handed).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("adopts the invoice already carrying FS-{runSlug}, exactly as the deterministic path does", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson({ name: "INVALID_REQUEST", message: "dup" }, 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson({ items: [invoiceBody({ status: "DRAFT" })], total_items: 1 }),
    );
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "DRAFT" })));
    const { session: s } = session();
    const out = await runAgentToolkitTool(s, "create_invoice", canonicalDraft());
    expect(out).toMatchObject({ status: "DONE", invoiceId: INVOICE_ID, adopted: true });
  });

  it("inv.i1.canonical-body: an agent draft that differs from the canonical body in any byte never reaches PayPal", async () => {
    const all = mutants(canonicalDraft());
    expect(all.length).toBeGreaterThan(150);
    for (const { label, draft } of all) {
      const { session: s, repo, handed, decisions } = session();
      const error = await refusal(runAgentToolkitTool(s, "create_invoice", draft));
      expect(error, label).toBeInstanceOf(AgentToolRefusedError);
      expect(error?.mismatches.length, label).toBeGreaterThan(0);
      expect(handed, label).toHaveLength(0);
      expect(decisions, label).toHaveLength(0);
      expect(repo.saves, label).toHaveLength(0);
    }
    expect(requests).toHaveLength(0);
  });

  type Draft = ReturnType<typeof canonicalDraft>;
  const named: [string, (d: Draft) => unknown, string][] = [
    [
      "a changed amount",
      (d) => ({
        ...d,
        items: d.items.map((i, n) =>
          n === 0 ? { ...i, unit_amount: { currency_code: "USD", value: "2900.00" } } : i,
        ),
      }),
      "items[0].unit_amount.value: differs",
    ],
    [
      "pay-by-bank",
      (d) => ({ ...d, enable_pay_by_bank: true }),
      "enable_pay_by_bank: not in the canonical body",
    ],
    ["a partial payment", (d) => ({ ...d, allow_partial_payment: true }), "allow_partial_payment"],
    ["a shipping cost", (d) => ({ ...d, shipping_cost: "25.00" }), "shipping_cost"],
    ["a tip", (d) => ({ ...d, allow_tip: true }), "allow_tip"],
    [
      "a foreign invoice_number",
      (d) => ({ ...d, invoice_number: "FS-2026A-r38" }),
      "invoice_number: differs",
    ],
    ["an invoice date", (d) => ({ ...d, invoice_date: "2026-11-05" }), "invoice_date"],
    [
      "free text in the note",
      (d) => ({ ...d, note: `${d.note} Pay at pay-me.example.test instead.` }),
      "note",
    ],
    [
      "an amount in words as an item label",
      (d) => ({
        ...d,
        items: d.items.map((i, n) => (n === 0 ? { ...i, name: "Five thousand premium" } : i)),
      }),
      "items: ",
    ],
    [
      "a label core's vocabulary does not have",
      (d) => ({
        ...d,
        items: d.items.map((i, n) => (n === 2 ? { ...i, name: "Payout and audit costs" } : i)),
      }),
      "items: ",
    ],
    [
      "another recipient",
      (d) => ({ ...d, primary_recipients: [{ billing_info: { email_address: "attacker@example.test" } }] }),
      "primary_recipients[0].billing_info",
    ],
  ];

  it.each(named)(
    "inv.i1.no-model-numbers: refuses a draft with %s on the agent path, with zero requests",
    async (_label, mutate, mismatch) => {
      const { session: s, repo } = session();
      const error = await refusal(runAgentToolkitTool(s, "create_invoice", mutate(canonicalDraft())));
      expect(error).toBeInstanceOf(AgentToolRefusedError);
      expect(error?.mismatches.some((m) => m.startsWith(mismatch))).toBe(true);
      expect(requests).toHaveLength(0);
      expect(repo.saves).toHaveLength(0);
    },
  );

  it.each([
    [
      "another run's run_id",
      {
        run_id: "0199f6a0-0000-7000-8000-000000000038",
        item_labels: { premium: PREMIUM, bonus: BONUS, disbursement: DISBURSEMENT },
      },
    ],
    [
      "a note beside the labels",
      { item_labels: { premium: PREMIUM, bonus: BONUS, disbursement: DISBURSEMENT }, note: "Pay 5000" },
    ],
    [
      "a label core refuses",
      { item_labels: { premium: "Four thousand premium", bonus: BONUS, disbursement: DISBURSEMENT } },
    ],
    [
      "a fourth label",
      { item_labels: { premium: PREMIUM, bonus: BONUS, disbursement: DISBURSEMENT, tip: "Tip" } },
    ],
  ])("refuses keyed item_labels with %s, sending nothing", async (_label, args) => {
    const { session: s, handed } = session();
    await expect(runAgentToolkitTool(s, "create_invoice", args)).rejects.toBeInstanceOf(
      AgentToolRefusedError,
    );
    expect(handed).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("inv.i1.no-model-numbers: a refused draft is refused again once the run holds its invoice", async () => {
    // A retried tool call never turns a bad draft into a no-op success.
    const { session: s } = session(CREATED);
    const bad = { ...canonicalDraft(), shipping_cost: "25.00" };
    await expect(runAgentToolkitTool(s, "create_invoice", bad)).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: the lattice decides the body the executor is about to send", () => {
  it("decide() runs on exactly the args tk() is handed, read fresh for every call", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const lattice = policyOf();
    const { session: s, handed } = session(null, { policy: lattice.policy });
    await runAgentToolkitTool(s, "create_invoice", {
      item_labels: { premium: PREMIUM, bonus: BONUS, disbursement: DISBURSEMENT },
    });
    await runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID }, { treasurerApproval: APPROVAL });
    await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", { invoice_id: INVOICE_ID });
    await runAgentToolkitTool(s, "get_invoice", { invoice_id: INVOICE_ID });

    const decided = handed.filter((_, i) => i !== 2); // the chain's own payable GET after the send is not the agent's call
    expect(lattice.decisions.map((d) => [d.call.name, d.decision.verdict])).toEqual([
      ["create_invoice", "ALLOW"],
      ["send_invoice", "REQUIRE_APPROVAL"],
      ["create_conditional_rules_for_invoice", "ALLOW"],
      ["get_invoice", "ALLOW"],
    ]);
    expect(handed.map((h) => h.method)).toEqual([
      "create_invoice",
      "send_invoice",
      "get_invoice",
      "create_conditional_rules_for_invoice",
      "get_invoice",
    ]);
    lattice.decisions.forEach((d, i) => {
      expect(d.call.name).toBe(decided[i]?.method);
      expect(d.call.args).toBe(decided[i]?.args);
    });
    expect(lattice.env).toHaveBeenCalledTimes(4);
  });

  it.each([
    [
      "kill_ai_live is on",
      { flags: { killPayouts: false, killPaypalLive: false, killAiLive: true } },
      "killSwitch",
    ],
    ["the brand is not on the allowlist", { brandAllowlist: [] }, "recipientInBrandAllowlist"],
    ["the run is not QUOTED", { runState: "IN_REVIEW" as const }, "phaseGate"],
    [
      "the iteration limit is reached",
      { budget: { spentMicros: 0, capMicros: 1_000_000, iteration: 24, maxIterations: 24 } },
      "budgetCap",
    ],
  ])("refuses a canonical create when %s: nothing is sent", async (_label, env, deniedBy) => {
    const lattice = policyOf(env);
    const { session: s, handed } = session(null, { policy: lattice.policy });
    const error = await refusal(runAgentToolkitTool(s, "create_invoice", canonicalDraft()));
    expect(error).toBeInstanceOf(AgentToolRefusedError);
    expect(error?.reason).toBe("the policy lattice answered DENY");
    expect(error?.mismatches.some((m) => m.startsWith(`${deniedBy}: `))).toBe(true);
    expect(handed).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });

  it("refuses a send the lattice denies even with the treasurer's bound approval", async () => {
    const lattice = policyOf({ flags: { killPayouts: false, killPaypalLive: true, killAiLive: false } });
    const { session: s, handed } = session(CREATED, { policy: lattice.policy });
    const error = await refusal(
      runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID }, { treasurerApproval: APPROVAL }),
    );
    expect(error?.mismatches).toContain("killSwitch: kill_paypal_live is on");
    expect(handed).toHaveLength(0);
  });

  it("needs the agent turn's policy: a session without one is a wiring fault, and nothing is sent", async () => {
    const { session: s, handed } = session();
    const bare = { run: s.run, invoices: s.invoices } as unknown as AgentInvoiceSession;
    await expect(runAgentToolkitTool(bare, "create_invoice", canonicalDraft())).rejects.toThrow(TypeError);
    expect(handed).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: send_invoice (sendNeedsTreasurer)", () => {
  it("parks until the treasurer approves", async () => {
    const { session: s } = session(CREATED);
    const out = await runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID });
    expect(out).toEqual({ status: "PENDING_APPROVAL", method: "send_invoice", invoiceId: INVOICE_ID });
    expect(requests).toHaveLength(0);
  });

  it("sends core's canonical send, never e-mailed and without agent text, then checks it is payable", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    const { session: s, repo } = session(CREATED);
    const out = await runAgentToolkitTool(
      s,
      "send_invoice",
      { invoice_id: INVOICE_ID, send_to_recipient: false },
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
    ["the model's e-mail flag", CREATED, { invoice_id: INVOICE_ID, send_to_recipient: true }, APPROVAL],
    ["a note", CREATED, { invoice_id: INVOICE_ID, note: "Please pay 5000" }, APPROVAL],
    ["a subject", CREATED, { invoice_id: INVOICE_ID, subject: "Season premium" }, APPROVAL],
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
    [
      "an approval naming the invoice number only (not bound to the invoice)",
      CREATED,
      { invoice_id: INVOICE_ID },
      { approverId: "persona:analyn", approvedAt: APPROVAL.approvedAt, invoiceNumber: "FS-2026A-r37" },
    ],
    [
      "an approval naming the invoice id but not the send",
      CREATED,
      { invoice_id: INVOICE_ID },
      { ...APPROVAL, sendArgsSha256: null },
    ],
    [
      "an approval of another invoice's send",
      CREATED,
      { invoice_id: INVOICE_ID },
      { ...APPROVAL, sendArgsSha256: sendArgsSha256("INV2-AAAA-BBBB-CCCC-DDDD") },
    ],
    [
      "an approval of a send with other arguments (e-mailed by PayPal)",
      CREATED,
      { invoice_id: INVOICE_ID },
      {
        ...APPROVAL,
        sendArgsSha256: sha256(JSON.stringify({ invoice_id: INVOICE_ID, send_to_recipient: true })),
      },
    ],
    ["an approval without an approver", CREATED, { invoice_id: INVOICE_ID }, { ...APPROVAL, approverId: "" }],
    ["no invoice yet", null, { invoice_id: INVOICE_ID }, APPROVAL],
  ])("inv.i6.human-gate: refuses a send with %s, and sends nothing", async (_label, seed, args, approval) => {
    const { session: s, handed } = session(seed);
    const error = await refusal(
      runAgentToolkitTool(s, "send_invoice", args, { treasurerApproval: approval }),
    );
    expect(error).toBeInstanceOf(AgentToolRefusedError);
    expect(handed).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});

describe("runAgentToolkitTool: create_conditional_rules_for_invoice", () => {
  it("adds core's AUTO_CANCEL on PayPal's invoice date + 25 days under request id cr-{invoiceId}", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { session: s, repo, handed } = session(PAYABLE);
    const out = await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", {
      invoice_id: INVOICE_ID,
    });
    expect(out).toEqual({
      status: "DONE",
      method: "create_conditional_rules_for_invoice",
      invoiceId: INVOICE_ID,
      autoCancelOn: "2026-11-30",
      alreadyDone: false,
    });
    expect(handed).toEqual([
      { method: "create_conditional_rules_for_invoice", args: autoCancelRuleArgs(INVOICE_ID, "2026-11-30") },
    ]);
    expect(requests[0]?.headers.get("paypal-request-id")).toBe(conditionalRuleRequestId(INVOICE_ID));
    expect(conditionalRuleRequestId(INVOICE_ID)).toBe(`cr-${INVOICE_ID}`);
    expect(repo.rows.get(RUN.runId)).toMatchObject({ autoCancelOn: "2026-11-30" });

    // A second identical call is a no-op; a different date is refused even then.
    await expect(
      runAgentToolkitTool(
        s,
        "create_conditional_rules_for_invoice",
        autoCancelRuleArgs(INVOICE_ID, "2026-11-30"),
      ),
    ).resolves.toMatchObject({ alreadyDone: true });
    await expect(
      runAgentToolkitTool(
        s,
        "create_conditional_rules_for_invoice",
        autoCancelRuleArgs(INVOICE_ID, "2026-12-01"),
      ),
    ).rejects.toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(1);
  });

  it("accepts the canonical rule written out in full, and sends core's object, not the model's", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { session: s, handed } = session(PAYABLE);
    const asked = autoCancelRuleArgs(INVOICE_ID, "2026-11-30");
    await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", asked);
    expect(handed[0]?.args).toEqual(asked);
    expect(handed[0]?.args).not.toBe(asked);
  });

  it("reads PayPal's invoice date first when the run does not hold it yet", async () => {
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-04" })),
    );
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { session: s } = session(CREATED);
    await expect(
      runAgentToolkitTool(
        s,
        "create_conditional_rules_for_invoice",
        autoCancelRuleArgs(INVOICE_ID, "2026-11-29"),
      ),
    ).resolves.toMatchObject({ status: "DONE", autoCancelOn: "2026-11-29" });
    expect(callLog()).toEqual([
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
  });

  it("inv.i1.canonical-body: a rule that differs from core's canonical rule in any byte never reaches PayPal", async () => {
    const all = mutants(autoCancelRuleArgs(INVOICE_ID, "2026-11-30")).filter(
      // Without any key but invoice_id it is the wrapper form ({invoice_id}): accepted on purpose.
      (m) => !(m.draft && typeof m.draft === "object" && Object.keys(m.draft).join() === "invoice_id"),
    );
    expect(all.length).toBeGreaterThan(25);
    for (const { label, draft } of all) {
      const { session: s, handed } = session(PAYABLE);
      await expect(
        runAgentToolkitTool(s, "create_conditional_rules_for_invoice", draft),
        label,
      ).rejects.toBeInstanceOf(AgentToolRefusedError);
      expect(handed, label).toHaveLength(0);
    }
    expect(requests).toHaveLength(0);
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
      {
        invoice_id: INVOICE_ID,
        rules: [
          ...autoCancelRuleArgs(INVOICE_ID, "2026-11-30").rules,
          ...autoCancelRuleArgs(INVOICE_ID, "2026-12-01").rules,
        ],
      },
    ],
    ["a date other than invoice date + 25 days (C-27)", autoCancelRuleArgs(INVOICE_ID, "2026-12-04")],
    ["another invoice", autoCancelRuleArgs("INV2-AAAA-BBBB-CCCC-DDDD", "2026-11-30")],
    [
      "a note in the expiry terms",
      { ...autoCancelRuleArgs(INVOICE_ID, "2026-11-30"), note: "Pay now or lose the premium" },
    ],
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
      runAgentToolkitTool(s, "create_conditional_rules_for_invoice", { invoice_id: INVOICE_ID }),
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
    const extra = await refusal(
      runAgentToolkitTool(s, "get_invoice", { invoice_id: INVOICE_ID, fields: "all" }),
    );
    expect(extra).toBeInstanceOf(AgentToolRefusedError);
    expect(requests).toHaveLength(1);
  });

  it("refuses an invoice id that is not this run's, before anything is sent", async () => {
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
    const { session: s } = session(PAYABLE, { tk: spy });
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
    const { session: s } = session(null, { tk: spy });
    await runAgentToolkitTool(s, "create_invoice", canonicalDraft());
    await runAgentToolkitTool(s, "send_invoice", { invoice_id: INVOICE_ID }, { treasurerApproval: APPROVAL });
    await runAgentToolkitTool(s, "create_conditional_rules_for_invoice", { invoice_id: INVOICE_ID });
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
