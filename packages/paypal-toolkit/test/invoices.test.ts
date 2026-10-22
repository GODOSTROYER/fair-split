import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  buildInvoicePlan,
  INVOICE_NOTE_CLOSINGS,
  InvoiceAdoptError,
  InvoiceApprovalError,
  InvoiceDraftRejectedError,
  InvoiceStateError,
  Invoices,
  type InvoicesDeps,
  invoiceMemo,
  PayPalToolkit,
  RECORD_PAYMENT_NOTE,
  ToolkitError,
} from "../src/index.js";
import {
  BUSINESS_EMAIL,
  createdLink,
  fakeAuth,
  heroRun,
  INVOICE_ID,
  invoiceBody,
  PAYER,
  payerViewLink,
  paypalError,
  RATE_CARD_SHA256,
  searchResult,
} from "./support/fixtures.js";
import { onGet, onPost, paypalEmpty, paypalJson, requests, useMsw } from "./support/msw.js";
import { MemoryInvoiceRepo } from "./support/repo.js";

useMsw();

const NOW = new Date("2026-11-05T02:00:00.000Z");
const RUN = heroRun();

function setup(
  seed: ConstructorParameters<typeof MemoryInvoiceRepo>[0] = {},
  extra: Partial<InvoicesDeps> = {},
) {
  const repo = new MemoryInvoiceRepo(seed);
  const toolkit = new PayPalToolkit({ auth: fakeAuth() });
  const invoices = new Invoices({
    tk: toolkit.tk,
    repo,
    businessEmail: BUSINESS_EMAIL,
    now: () => NOW,
    ...extra,
  });
  return { repo, invoices };
}

const happyPayPal = () => {
  onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201, "dbg-create"));
  onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink(), 200, "dbg-send"));
  onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty(204, "dbg-rule"));
};

const callLog = () => requests.map((r) => `${r.method} ${r.url.pathname}`);

describe("Invoices.ensureForRun: create → send → AUTO_CANCEL rule", () => {
  it("builds exactly the register §8 invoice and checkpoints each step", async () => {
    happyPayPal();
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toEqual({
      status: "SENT",
      invoiceId: INVOICE_ID,
      invoiceNumber: "FS-2026A-r37",
      adopted: false,
      invoiceDate: "2026-11-05",
      payerViewUrl: payerViewLink().href,
      autoCancelOn: "2026-11-30",
      calls: 3,
    });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
    const [create, send, rule] = requests;
    // The body PayPal receives, as the toolkit nests our flat create_invoice arguments.
    expect(create?.body).toEqual({
      detail: {
        reference: `rc:${RATE_CARD_SHA256.slice(0, 16)}`,
        invoice_number: "FS-2026A-r37",
        invoice_date: "2026-11-05",
        currency_code: "USD",
        note: invoiceMemo("2026-A", RATE_CARD_SHA256, "LB-PH-2026-03"),
      },
      invoicer: { email_address: BUSINESS_EMAIL },
      primary_recipients: [
        { billing_info: { business_name: PAYER.businessName, email_address: PAYER.email } },
      ],
      items: [
        {
          name: "Premium",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "2887.50" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Quality bonus",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "1386.00" },
          unit_of_measure: "AMOUNT",
        },
        {
          name: "Disbursement costs",
          quantity: "1",
          unit_amount: { currency_code: "USD", value: "60.00" },
          unit_of_measure: "AMOUNT",
        },
      ],
    });
    expect(send?.body).toEqual({ invoice_id: INVOICE_ID, send_to_recipient: false });
    expect(rule?.body).toEqual({
      rules: [
        {
          conditional_rule_type: "AUTO_CANCEL",
          rule_expiry_terms: {
            rule_expiry_condition: "SPECIFIC_DATE",
            condition_rule_end_date: "2026-11-30",
          },
        },
      ],
    });
    expect(rule?.headers.get("paypal-request-id")).toBe(`cr-${INVOICE_ID}`);
    expect(create?.headers.get("paypal-request-id")).toBeNull();
    expect(repo.saves.map((s) => Object.keys(s.patch).sort())).toEqual([
      ["adopted", "invoiceDate", "invoiceId", "invoiceNumber"],
      ["payerViewUrl", "sentAt"],
      ["autoCancelOn", "ruleSetAt"],
    ]);
  });

  it("adopts the invoice already carrying our number when create fails", async () => {
    onPost("/v2/invoicing/invoices", () =>
      paypalJson(
        paypalError(
          "INVALID_REQUEST",
          "Request is not well-formed, syntactically incorrect, or violates schema.",
        ),
        400,
      ),
    );
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "DRAFT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "DRAFT" })));
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", invoiceId: INVOICE_ID, adopted: true, calls: 5 });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      "POST /v2/invoicing/search-invoices",
      // The match is verified on a fresh GET, never on the search result alone.
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
    expect(requests[1]?.body).toEqual({ invoice_number: "FS-2026A-r37" });
    expect(repo.rows.get(RUN.runId)).toMatchObject({ adopted: true, invoiceId: INVOICE_ID });
  });

  it("adopts after a dropped connection too, and skips the send when PayPal already shows it sent", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "UNPAID" }))),
    );
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", adopted: true, calls: 4 });
    expect(out.payerViewUrl).toBe(invoiceBody().detail.metadata.recipient_view_url);
    expect(callLog()).not.toContain(`POST /v2/invoicing/invoices/${INVOICE_ID}/send`);
  });

  it("keeps PayPal's date for an invoice adopted a day later, and cancels 25 days after that date", async () => {
    // Created at 23:59 UTC on 4 Nov; the task crashed before its checkpoint and retried on 5 Nov.
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-04" }))),
    );
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-04" })),
    );
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ adopted: true, invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29" });
    expect(repo.rows.get(RUN.runId)).toMatchObject({ invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29" });
    const rule = requests.at(-1)?.body as {
      rules: { rule_expiry_terms: { condition_rule_end_date: string } }[];
    };
    expect(rule.rules[0]?.rule_expiry_terms.condition_rule_end_date).toBe("2026-11-29");
  });

  const notOurs: [string, Parameters<typeof invoiceBody>[0]][] = [
    ["another rate card", { status: "DRAFT", reference: "rc:0123456789abcdef" }],
    ["no reference", { status: "DRAFT", reference: null }],
    ["another total", { status: "DRAFT", total: "4333.51" }],
    ["no total", { status: "DRAFT", total: null }],
    ["another invoicer", { status: "DRAFT", invoicer: "someone-else@example.test" }],
    ["another payer", { status: "DRAFT", recipient: "attacker@example.test" }],
    [
      "other lines with the same total",
      {
        status: "DRAFT",
        items: [
          { name: "Premium", quantity: "1", unit_amount: { currency_code: "USD", value: "2947.50" } },
          { name: "Quality bonus", quantity: "1", unit_amount: { currency_code: "USD", value: "1386.00" } },
        ],
      },
    ],
    [
      "renamed lines",
      {
        status: "DRAFT",
        items: [
          { name: "Tip", quantity: "1", unit_amount: { currency_code: "USD", value: "2887.50" } },
          { name: "Quality bonus", quantity: "1", unit_amount: { currency_code: "USD", value: "1386.00" } },
          {
            name: "Disbursement costs",
            quantity: "1",
            unit_amount: { currency_code: "USD", value: "60.00" },
          },
        ],
      },
    ],
    ["a cancelled invoice", { status: "CANCELLED" }],
    ["an auto-cancelled invoice", { status: "AUTO_CANCELLED" }],
    ["a refunded invoice", { status: "REFUNDED" }],
    ["an unknown status", { status: "SOMETHING_NEW" }],
    ["another invoice id on the GET", { status: "DRAFT", id: "INV2-AAAA-BBBB-CCCC-DDDD" }],
    ["no invoice date", { status: "DRAFT", invoiceDate: null }],
    ["an impossible invoice date", { status: "DRAFT", invoiceDate: "2026-02-30" }],
  ];

  it.each(notOurs)("refuses to adopt an invoice with %s (HALT), sending nothing", async (_label, got) => {
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "DRAFT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody(got)));
    const { invoices, repo } = setup();
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceAdoptError);
    expect(callLog()).toHaveLength(3);
    expect(repo.saves).toHaveLength(0);
  });

  it("refuses to choose between two invoices carrying our number (HALT)", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody(), invoiceBody({ id: "INV2-AAAA-BBBB-CCCC-DDDD" }))),
    );
    await expect(setup().invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceAdoptError);
    expect(callLog()).toHaveLength(2);
  });

  it("reports the create failure when the adoption GET fails", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "DRAFT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(paypalError("INTERNAL_SERVER_ERROR", "down"), 503));
    const error = (await setup()
      .invoices.ensureForRun(RUN)
      .catch((e: unknown) => e)) as ToolkitError;
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error.method).toBe("create_invoice");
  });

  it("rethrows the create failure when no invoice carries our number", async () => {
    onPost("/v2/invoicing/invoices", () =>
      paypalJson(paypalError("INTERNAL_SERVER_ERROR", "An internal server error occurred."), 500),
    );
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult()));
    const { invoices, repo } = setup();
    await expect(invoices.ensureForRun(RUN)).rejects.toMatchObject({ name: "ToolkitError", status: 500 });
    expect(repo.saves).toHaveLength(0);
  });

  it("reports the create failure, not the search's, when the adopt search fails too", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(paypalError("INTERNAL_SERVER_ERROR", "search down"), 503),
    );
    const error = (await setup()
      .invoices.ensureForRun(RUN)
      .catch((e: unknown) => e)) as ToolkitError;
    expect(error).toBeInstanceOf(ToolkitError);
    expect(error.method).toBe("create_invoice");
    expect(error.outcomeUnknown).toBe(true);
  });

  it("resumes from its checkpoint without repeating a step", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({
      [RUN.runId]: {
        invoiceId: INVOICE_ID,
        invoiceNumber: "FS-2026A-r37",
        invoiceDate: "2026-11-04",
        sentAt: "2026-11-04T23:59:00.000Z",
        payerViewUrl: payerViewLink().href,
      },
    });
    const out = await invoices.ensureForRun(RUN);
    expect(callLog()).toEqual([`POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`]);
    // The checkpointed invoice date wins over today's date: the run is never re-dated.
    expect(out).toMatchObject({ invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29", calls: 1 });
  });

  it("does nothing for a run that is already done", async () => {
    const { invoices } = setup({
      [RUN.runId]: {
        invoiceId: INVOICE_ID,
        invoiceNumber: "FS-2026A-r37",
        invoiceDate: "2026-11-05",
        sentAt: "x",
        ruleSetAt: "y",
        autoCancelOn: "2026-11-30",
      },
    });
    await expect(invoices.ensureForRun(RUN)).resolves.toMatchObject({ status: "SENT", calls: 0 });
    expect(requests).toHaveLength(0);
  });

  it("refuses a checkpoint that belongs to another invoice number", async () => {
    const { invoices } = setup({ [RUN.runId]: { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r36" } });
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
  });

  it("waits for the treasurer before sending (sendNeedsTreasurer)", async () => {
    happyPayPal();
    const { invoices } = setup();
    const pending = await invoices.ensureForRun(heroRun({ sendApproval: null }));
    expect(pending).toMatchObject({ status: "PENDING_APPROVAL", calls: 1, autoCancelOn: null });
    expect(callLog()).toEqual(["POST /v2/invoicing/invoices"]);

    const sent = await invoices.ensureForRun(RUN);
    expect(sent).toMatchObject({ status: "SENT", calls: 2, adopted: false });
    expect(callLog()).toHaveLength(3);
  });

  it("can put the AUTO_CANCEL rule on before the send (S2 fallback order)", async () => {
    happyPayPal();
    const { invoices } = setup({}, { ruleBeforeSend: true });
    await invoices.ensureForRun(RUN);
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
    ]);
  });

  it("checks a failed send with a GET and treats a sent invoice as sent", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onPost("/v2/invoicing/invoices/:id/send", () =>
      paypalJson(paypalError("INTERNAL_SERVER_ERROR", "oops"), 503),
    );
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SENT" })));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup();
    const out = await invoices.ensureForRun(RUN);
    expect(out).toMatchObject({
      status: "SENT",
      payerViewUrl: invoiceBody().detail.metadata.recipient_view_url,
    });
    expect(callLog()[2]).toBe(`GET /v2/invoicing/invoices/${INVOICE_ID}`);
  });

  it("rethrows a failed send when the GET shows the invoice still in DRAFT", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onPost("/v2/invoicing/invoices/:id/send", () =>
      paypalJson(paypalError("UNPROCESSABLE_ENTITY", "nope"), 422),
    );
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "DRAFT" })));
    const { invoices, repo } = setup();
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(ToolkitError);
    expect(repo.rows.get(RUN.runId)?.sentAt ?? null).toBeNull();
  });

  it("uses the agent's chosen closing; every name and number stays the code's", async () => {
    happyPayPal();
    const { invoices } = setup();
    const plan = buildInvoicePlan(RUN, { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL });
    const draft = { ...plan.createArgs, note: `${plan.note}. ${INVOICE_NOTE_CLOSINGS[2]}` };
    await invoices.ensureForRun(RUN, { draft });
    const body = requests[0]?.body as {
      detail: { note: string };
      items: { name: string; unit_amount: unknown }[];
    };
    expect(body.detail.note).toBe(draft.note);
    expect(body.items).toEqual(plan.createArgs.items);
  });

  it("refuses an agent draft with free text before any call", async () => {
    const { invoices } = setup();
    const plan = buildInvoicePlan(RUN, { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL });
    const draft = { ...plan.createArgs, note: `${plan.note}. Thank you, Lantern Bay.` };
    await expect(invoices.ensureForRun(RUN, { draft })).rejects.toBeInstanceOf(InvoiceDraftRejectedError);
    expect(requests).toHaveLength(0);
  });

  it("refuses an approval that names another invoice number before any call", async () => {
    const { invoices, repo } = setup();
    const run = heroRun({
      sendApproval: {
        approverId: "persona:analyn",
        approvedAt: NOW.toISOString(),
        invoiceNumber: "FS-2026A-r36",
      },
    });
    await expect(invoices.ensureForRun(run)).rejects.toBeInstanceOf(InvoiceApprovalError);
    expect(requests).toHaveLength(0);
    expect(repo.saves).toHaveLength(0);
  });

  it("never sends with an approval that names another PayPal invoice", async () => {
    happyPayPal();
    const { invoices, repo } = setup();
    const run = heroRun({
      sendApproval: {
        approverId: "persona:analyn",
        approvedAt: NOW.toISOString(),
        invoiceNumber: "FS-2026A-r37",
        invoiceId: "INV2-AAAA-BBBB-CCCC-DDDD",
      },
    });
    await expect(invoices.ensureForRun(run)).rejects.toBeInstanceOf(InvoiceApprovalError);
    expect(callLog()).toEqual(["POST /v2/invoicing/invoices"]);
    expect(repo.rows.get(RUN.runId)).toMatchObject({ invoiceId: INVOICE_ID });
    expect(repo.rows.get(RUN.runId)?.sentAt ?? null).toBeNull();
  });

  it("refuses an AUTO_CANCEL date that has already passed (dueWithin30Days), before calling", async () => {
    // A run whose invoice is dated 1 Oct, resumed on 5 Nov: invoice date + 25 = 26 Oct is past.
    const { invoices, repo } = setup({
      [RUN.runId]: {
        invoiceId: INVOICE_ID,
        invoiceNumber: "FS-2026A-r37",
        invoiceDate: "2026-10-01",
        sentAt: "2026-10-01T02:00:00.000Z",
      },
    });
    await expect(invoices.ensureForRun(RUN)).rejects.toThrow(/not after today/);
    expect(requests).toHaveLength(0);
    expect(repo.rows.get(RUN.runId)?.ruleSetAt ?? null).toBeNull();
  });

  it("inv.i1.no-model-numbers: a draft with a model-written amount is refused before any call", async () => {
    const { invoices, repo } = setup();
    const plan = buildInvoicePlan(RUN, { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL });
    const draft = {
      ...plan.createArgs,
      items: plan.createArgs.items.map((item, i) =>
        i === 0 ? { ...item, unit_amount: { currency_code: "USD", value: "2900.00" } } : item,
      ),
    };
    const error = await invoices.ensureForRun(RUN, { draft }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvoiceDraftRejectedError);
    expect((error as InvoiceDraftRejectedError).mismatches).toContain(
      "items[0].unit_amount: differs from the quote",
    );
    expect(requests).toHaveLength(0);
    expect(repo.saves).toHaveLength(0);
  });
});

describe("Invoices steps one at a time (the agent's create, send, rule and read)", () => {
  const created = { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37", invoiceDate: "2026-11-05" };
  const approval = {
    approverId: "persona:analyn",
    approvedAt: NOW.toISOString(),
    invoiceNumber: "FS-2026A-r37",
  };

  it("create() creates and checkpoints, never sends, and is a no-op once the run holds its invoice", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    const { invoices, repo } = setup();
    const first = await invoices.create(RUN);
    expect(first).toEqual({
      invoiceId: INVOICE_ID,
      invoiceNumber: "FS-2026A-r37",
      invoiceDate: "2026-11-05",
      adopted: false,
      alreadyDone: false,
      sent: false,
      payerViewUrl: null,
      calls: 1,
    });
    expect(repo.rows.get(RUN.runId)).toMatchObject({ invoiceId: INVOICE_ID, invoiceDate: "2026-11-05" });
    await expect(invoices.create(RUN)).resolves.toMatchObject({ alreadyDone: true, calls: 0 });
    expect(callLog()).toEqual(["POST /v2/invoicing/invoices"]);
  });

  it("create() records an adopted invoice that PayPal already shows sent", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "SENT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SENT" })));
    const { invoices, repo } = setup();
    await expect(invoices.create(RUN)).resolves.toMatchObject({ adopted: true, sent: true, calls: 3 });
    expect(repo.rows.get(RUN.runId)?.sentAt).toBe(NOW.toISOString());
  });

  it("send() sends the run's invoice once, and needs the invoice first", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    await expect(setup().invoices.send(RUN, approval)).rejects.toBeInstanceOf(InvoiceStateError);
    const { invoices } = setup({ [RUN.runId]: created });
    await expect(invoices.send(RUN, approval)).resolves.toEqual({
      invoiceId: INVOICE_ID,
      payerViewUrl: payerViewLink().href,
      alreadyDone: false,
      calls: 1,
    });
    await expect(invoices.send(RUN, approval)).resolves.toMatchObject({ alreadyDone: true, calls: 0 });
    expect(callLog()).toEqual([`POST /v2/invoicing/invoices/${INVOICE_ID}/send`]);
  });

  it("send() refuses an approval of another invoice", async () => {
    const { invoices } = setup({ [RUN.runId]: created });
    await expect(invoices.send(RUN, { ...approval, invoiceNumber: "FS-2026A-r38" })).rejects.toBeInstanceOf(
      InvoiceApprovalError,
    );
    expect(requests).toHaveLength(0);
  });

  it("ensureRule() dates the rule from the checkpointed invoice date, once", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({ [RUN.runId]: { ...created, invoiceDate: "2026-11-04" } });
    await expect(invoices.ensureRule(RUN)).resolves.toEqual({
      invoiceId: INVOICE_ID,
      autoCancelOn: "2026-11-29",
      alreadyDone: false,
      calls: 1,
    });
    await expect(invoices.ensureRule(RUN)).resolves.toMatchObject({ alreadyDone: true, calls: 0 });
    expect(requests[0]?.headers.get("paypal-request-id")).toBe(`cr-${INVOICE_ID}`);
    await expect(setup().invoices.ensureRule(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
  });

  it("fetch() reads the run's own invoice", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const { invoices } = setup({ [RUN.runId]: created });
    await expect(invoices.fetch(RUN)).resolves.toMatchObject({ id: INVOICE_ID });
    await expect(setup().invoices.fetch(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    expect(callLog()).toEqual([`GET /v2/invoicing/invoices/${INVOICE_ID}`]);
  });
});

describe("Invoices.recordPayment: Judge Mode funding, labelled simulated rail", () => {
  const sentCheckpoint = {
    invoiceId: INVOICE_ID,
    invoiceNumber: "FS-2026A-r37",
    invoiceDate: "2026-11-05",
    sentAt: "2026-11-05T02:00:01.000Z",
  };

  it("records the code total by BANK_TRANSFER with the labelled note", async () => {
    onPost("/v2/invoicing/invoices/:id/payments", () =>
      paypalJson({ payment_id: "EXTR-86F38350LX4353815" }, 200),
    );
    const { invoices, repo } = setup({ [RUN.runId]: sentCheckpoint });

    const out = await invoices.recordPayment(RUN);

    expect(out).toEqual({
      invoiceId: INVOICE_ID,
      recorded: true,
      alreadyRecorded: false,
      paymentId: "EXTR-86F38350LX4353815",
      provenance: "simulated_rail",
      calls: 1,
    });
    expect(requests[0]?.body).toEqual({
      method: "BANK_TRANSFER",
      payment_date: "2026-11-05",
      amount: { currency_code: "USD", value: "4333.50" },
      note: RECORD_PAYMENT_NOTE,
    });
    expect(repo.saves.map((s) => Object.keys(s.patch).sort())).toEqual([
      ["paymentAttemptedAt"],
      ["paymentId", "paymentRecordedAt"],
    ]);
  });

  it("is idempotent: a recorded payment is never recorded twice", async () => {
    onPost("/v2/invoicing/invoices/:id/payments", () => paypalJson({ payment_id: "EXTR-1" }));
    const { invoices } = setup({ [RUN.runId]: sentCheckpoint });
    await invoices.recordPayment(RUN);
    const again = await invoices.recordPayment(RUN);
    expect(again).toMatchObject({ recorded: false, alreadyRecorded: true, calls: 0 });
    expect(requests).toHaveLength(1);
  });

  it("after an unknown outcome GETs first and skips the call if PayPal shows it paid", async () => {
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "MARKED_AS_PAID", due: "0.00" })),
    );
    const { invoices } = setup({
      [RUN.runId]: { ...sentCheckpoint, paymentAttemptedAt: "2026-11-05T02:01:00.000Z" },
    });
    const out = await invoices.recordPayment(RUN);
    expect(out).toMatchObject({ recorded: false, alreadyRecorded: true, calls: 1 });
    expect(callLog()).toEqual([`GET /v2/invoicing/invoices/${INVOICE_ID}`]);
  });

  it("after an unknown outcome records it if PayPal does not show it paid", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SENT" })));
    onPost("/v2/invoicing/invoices/:id/payments", () => paypalJson({ payment_id: "EXTR-2" }));
    const { invoices } = setup({
      [RUN.runId]: { ...sentCheckpoint, paymentAttemptedAt: "2026-11-05T02:01:00.000Z" },
    });
    await expect(invoices.recordPayment(RUN)).resolves.toMatchObject({ recorded: true, calls: 2 });
  });

  it("refuses to pay an invoice that does not exist or was not sent", async () => {
    await expect(setup().invoices.recordPayment(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    const draftOnly = setup({ [RUN.runId]: { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37" } });
    await expect(draftOnly.invoices.recordPayment(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    expect(requests).toHaveLength(0);
  });
});

describe("Invoices.confirmFunding: FUNDED only on a fresh GET with 0.00 due", () => {
  const seeded = { [RUN.runId]: { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37" } };

  it.each([
    ["MARKED_AS_PAID", "0.00", "FUNDED", "simulated_rail"],
    ["PAID", "0.00", "FUNDED", "live"],
    ["SENT", "4333.50", "NOT_YET", "live"],
    ["PARTIALLY_PAID", "100.00", "NOT_YET", "live"],
    ["MARKED_AS_PAID", "10.00", "NOT_YET", "simulated_rail"],
  ])("%s with %s due is %s", async (status, due, state, provenance) => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status, due })));
    const out = await setup(seeded).invoices.confirmFunding(RUN);
    expect(out).toMatchObject({ state, invoiceStatus: status, provenance });
  });

  it("needs an invoice first", async () => {
    await expect(setup().invoices.confirmFunding(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
  });
});
