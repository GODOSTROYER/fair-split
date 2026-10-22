import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  buildInvoicePlan,
  InvoiceAdoptError,
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
      dueDate: "2026-11-30",
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
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", invoiceId: INVOICE_ID, adopted: true, calls: 4 });
    const search = requests[1];
    expect(search?.url.pathname).toBe("/v2/invoicing/search-invoices");
    expect(search?.body).toEqual({ invoice_number: "FS-2026A-r37" });
    expect(repo.rows.get(RUN.runId)).toMatchObject({ adopted: true, invoiceId: INVOICE_ID });
  });

  it("adopts after a dropped connection too, and skips the send when PayPal already shows it sent", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "UNPAID" }))),
    );
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", adopted: true, calls: 3 });
    expect(out.payerViewUrl).toBe(invoiceBody().detail.metadata.recipient_view_url);
    expect(callLog()).not.toContain(`POST /v2/invoicing/invoices/${INVOICE_ID}/send`);
  });

  it("refuses to adopt an invoice that cites another rate card or amount (HALT)", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "DRAFT", reference: "rc:0123456789abcdef" }))),
    );
    const { invoices } = setup();
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceAdoptError);

    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "DRAFT", total: "4333.51" }))),
    );
    await expect(setup().invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceAdoptError);
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

  it("uses the agent's wording, never its numbers", async () => {
    happyPayPal();
    const { invoices } = setup();
    const plan = buildInvoicePlan(RUN, { invoiceDate: "2026-11-05", businessEmail: BUSINESS_EMAIL });
    const draft = {
      ...plan.createArgs,
      note: `${plan.note}. Thank you, Lantern Bay.`,
      items: plan.createArgs.items.map((item) => ({ ...item, name: `${item.name} (Season premium share)` })),
    };
    await invoices.ensureForRun(RUN, { draft });
    const body = requests[0]?.body as {
      detail: { note: string };
      items: { name: string; unit_amount: unknown }[];
    };
    expect(body.detail.note).toBe(draft.note);
    expect(body.items.map((i) => i.name)).toEqual(draft.items.map((i) => i.name));
    expect(body.items.map((i) => i.unit_amount)).toEqual(plan.createArgs.items.map((i) => i.unit_amount));
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
