import { HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  buildInvoicePlan,
  InvoiceAdoptError,
  InvoiceApprovalError,
  type InvoiceCheckpoint,
  InvoiceDraftRejectedError,
  InvoiceNotPayableError,
  InvoiceRuleDateError,
  InvoiceStateError,
  Invoices,
  type InvoicesDeps,
  invoiceMemo,
  invoiceMoneyExtras,
  PayPalToolkit,
  RECORD_PAYMENT_NOTE,
  ToolkitError,
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
  PAYER,
  payerViewLink,
  paypalError,
  RATE_CARD_SHA256,
  searchResult,
} from "./support/fixtures.js";
import {
  onDelete,
  onGet,
  onPost,
  paypalEmpty,
  paypalJson,
  requests,
  sequence,
  useMsw,
} from "./support/msw.js";
import { MemoryInvoiceRepo } from "./support/repo.js";

useMsw();

/** 02:00 UTC on 5 Nov is 18:00 on 4 Nov in Los Angeles: PayPal's "today" (ppDate) is 4 Nov. */
const NOW = new Date("2026-11-05T02:00:00.000Z");
const RUN = heroRun();
const SECOND_ID = "INV2-AB12-CD34-EF56-GH78";
/** Claude's three item labels (S4.4 create_run_invoice): the only words the agent adds. */
const LABELS = ["Fairtrade premium", "Bean quality bonus", "Payout and audit costs"] as const;
const QUOTE_NAMES = ["Premium", "Quality bonus", "Disbursement costs"];
const labelled = (names: readonly string[]) =>
  invoiceBody().items.map((item, i) => ({ ...item, name: names[i] as string }));

function setup(
  seed: ConstructorParameters<typeof MemoryInvoiceRepo>[0] = {},
  extra: Partial<InvoicesDeps> = {},
) {
  const repo = new MemoryInvoiceRepo(seed);
  const toolkit = new PayPalToolkit({ auth: fakeAuth(), limiter: openLimiter() });
  const invoices = new Invoices({
    tk: toolkit.tk,
    repo,
    businessEmail: BUSINESS_EMAIL,
    ppMode: "sandbox",
    now: () => NOW,
    ...extra,
  });
  return { repo, invoices };
}

const happyPayPal = (getStatus = "UNPAID") => {
  onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201, "dbg-create"));
  onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink(), 200, "dbg-send"));
  onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: getStatus }), 200, "dbg-get"));
  onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty(204, "dbg-rule"));
};

const callLog = () => requests.map((r) => `${r.method} ${r.url.pathname}`);
const ruleDate = (i = -1) =>
  (
    requests.at(i)?.body as
      | { rules?: { rule_expiry_terms: { condition_rule_end_date: string } }[] }
      | undefined
  )?.rules?.[0]?.rule_expiry_terms.condition_rule_end_date;

/** What a run's checkpoint holds once the invoice is created, sent and confirmed payable. */
const PAYABLE: Partial<InvoiceCheckpoint> = {
  invoiceId: INVOICE_ID,
  invoiceNumber: "FS-2026A-r37",
  invoiceDate: "2026-11-05",
  sentAt: "2026-11-05T02:00:02.000Z",
  payerViewUrl: payerViewLink().href,
  payableAt: "2026-11-05T02:00:03.000Z",
};

describe("Invoices.ensureForRun: create → send → payable GET → AUTO_CANCEL rule", () => {
  it("builds exactly the register §8 invoice, never sends a date, and checkpoints each step", async () => {
    happyPayPal();
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toEqual({
      status: "SENT",
      invoiceId: INVOICE_ID,
      invoiceNumber: "FS-2026A-r37",
      adopted: false,
      invoiceDate: "2026-11-05",
      payerViewUrl: invoiceBody().detail.metadata.recipient_view_url,
      autoCancelOn: "2026-11-30",
      recreated: false,
      calls: 4,
      provenance: "live",
    });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
    const [create, send, , rule] = requests;
    // The body PayPal receives, as the toolkit nests our flat create_invoice arguments: no invoice_date.
    expect(create?.body).toEqual({
      detail: {
        reference: `rc:${RATE_CARD_SHA256.slice(0, 16)}`,
        invoice_number: "FS-2026A-r37",
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
      ["adopted", "invoiceDate", "invoiceId", "invoiceNumber", "itemLabels"],
      ["payerViewUrl", "sentAt"],
      ["invoiceDate", "payableAt", "payerViewUrl"],
      ["autoCancelOn", "ruleSetAt"],
    ]);
  });

  it("dates the AUTO_CANCEL rule from the date PayPal gave the invoice (C-27), not from our clock", async () => {
    happyPayPal();
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "UNPAID", invoiceDate: "2026-11-04" })),
    );
    const { invoices, repo } = setup();
    const out = await invoices.ensureForRun(RUN);
    expect(out).toMatchObject({ invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29" });
    expect(ruleDate()).toBe("2026-11-29");
    expect(repo.rows.get(RUN.runId)).toMatchObject({ invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29" });
  });

  it.each(["SENT", "UNPAID", "SHARED"])("accepts %s on the payable GET", async (status) => {
    happyPayPal(status);
    await expect(setup().invoices.ensureForRun(RUN)).resolves.toMatchObject({ status: "SENT" });
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
    onGet(
      "/v2/invoicing/invoices/:id",
      sequence(
        () => paypalJson(invoiceBody({ status: "DRAFT" })),
        () => paypalJson(invoiceBody({ status: "UNPAID" })),
      ),
    );
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", invoiceId: INVOICE_ID, adopted: true, calls: 6 });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      "POST /v2/invoicing/search-invoices",
      // The match is verified on a fresh GET, never on the search result alone.
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
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

    // The adoption GET was a fresh GET of a sent invoice: it is the payable check too.
    expect(out).toMatchObject({ status: "SENT", adopted: true, calls: 4 });
    expect(out.payerViewUrl).toBe(invoiceBody().detail.metadata.recipient_view_url);
    expect(callLog()).not.toContain(`POST /v2/invoicing/invoices/${INVOICE_ID}/send`);
  });

  it("keeps PayPal's date for an invoice adopted a day later, and cancels 25 days after that date", async () => {
    // Created on 3 Nov; the task crashed before its checkpoint and retried on 5 Nov.
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-03" }))),
    );
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "UNPAID", invoiceDate: "2026-11-03" })),
    );
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ adopted: true, invoiceDate: "2026-11-03", autoCancelOn: "2026-11-28" });
    expect(repo.rows.get(RUN.runId)).toMatchObject({ invoiceDate: "2026-11-03", autoCancelOn: "2026-11-28" });
    expect(ruleDate()).toBe("2026-11-28");
  });

  const notOurs: [string, Parameters<typeof invoiceBody>[0]][] = [
    ["another rate card", { status: "DRAFT", reference: "rc:0123456789abcdef" }],
    ["no reference", { status: "DRAFT", reference: null }],
    ["another note", { status: "DRAFT", note: `${HERO_MEMO}. Pay at https://pay.example.test` }],
    ["a closing phrase after the memo", { status: "DRAFT", note: `${HERO_MEMO}. Thank you.` }],
    ["no note", { status: "DRAFT", note: null }],
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
      "a line labelled with an amount",
      { status: "DRAFT", items: labelled(["Premium 2887.50", ...LABELS.slice(1)]) },
    ],
    [
      "a line labelled with an amount in words",
      { status: "DRAFT", items: labelled(["Four thousand dollars", ...LABELS.slice(1)]) },
    ],
    ["two lines labelled the same", { status: "DRAFT", items: labelled(["Premium", "Premium", "Costs"]) }],
    [
      "a line description (free text we never send)",
      {
        status: "DRAFT",
        items: invoiceBody().items.map((item, i) =>
          i ? item : { ...item, description: "Pay 5000 instead" },
        ),
      },
    ],
    ["terms and conditions (free text we never send)", { status: "DRAFT", terms: "Pay within one day" }],
    ["a tip", { status: "DRAFT", configuration: { allow_tip: true } }],
    [
      "partial payments",
      { status: "DRAFT", configuration: { partial_payment: { allow_partial_payment: true } } },
    ],
    [
      "a shipping cost offset by a discount",
      {
        status: "DRAFT",
        breakdown: {
          shipping: { amount: { currency_code: "USD", value: "25.00" } },
          discount: { invoice_discount: { amount: { currency_code: "USD", value: "25.00" } } },
        },
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

  it("adopts our invoice whatever labels the agent gave it, and keeps them (labels are not money)", async () => {
    // The agent's create timed out after PayPal created the invoice; the server chain takes over.
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () =>
      paypalJson(searchResult(invoiceBody({ status: "DRAFT", items: labelled(LABELS) }))),
    );
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "DRAFT", items: labelled(LABELS) })),
    );
    const { invoices, repo } = setup();
    await expect(invoices.create(RUN)).resolves.toMatchObject({ adopted: true, invoiceId: INVOICE_ID });
    expect(repo.rows.get(RUN.runId)?.itemLabels).toEqual([...LABELS]);
  });

  it.each(notOurs)("refuses to adopt an invoice with %s (HALT), sending nothing", async (_label, got) => {
    onPost("/v2/invoicing/invoices", () => paypalJson(paypalError("INVALID_REQUEST", "Duplicate"), 400));
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "DRAFT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody(got)));
    const { invoices, repo } = setup();
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceAdoptError);
    expect(callLog()).toHaveLength(3);
    expect(repo.saves).toHaveLength(0);
  });

  it("names every money extra on a PayPal invoice body", () => {
    expect(invoiceMoneyExtras(invoiceBody())).toEqual([]);
    expect(
      invoiceMoneyExtras({
        configuration: {
          allow_tip: true,
          payment_method_overrides: [{ payment_method_type: "PAY_BY_BANK" }],
        },
        amount: {
          breakdown: {
            custom: { label: "Fee", amount: { value: "1.00" } },
            tax_total: { value: "0.01" },
            discount: { item_discount: { value: "2.00" } },
          },
        },
        items: [{ tax: { percent: "12" } }, { discount: { amount: { value: "0.50" } } }],
      }),
    ).toEqual([
      "configuration.allow_tip",
      "configuration.payment_method_overrides",
      "amount.breakdown.custom",
      "amount.breakdown.tax_total",
      "amount.breakdown.discount.item_discount",
      "items[0].tax",
      "items[1].discount",
    ]);
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
    const { invoices } = setup({ [RUN.runId]: { ...PAYABLE, invoiceDate: "2026-11-04" } });
    const out = await invoices.ensureForRun(RUN);
    expect(callLog()).toEqual([`POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`]);
    // The date PayPal gave the invoice wins over today's date: the run is never re-dated.
    expect(out).toMatchObject({ invoiceDate: "2026-11-04", autoCancelOn: "2026-11-29", calls: 1 });
  });

  it("resumes a sent invoice with the payable GET it has not had yet", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({ [RUN.runId]: { ...PAYABLE, invoiceDate: null, payableAt: null } });
    await expect(invoices.ensureForRun(RUN)).resolves.toMatchObject({ status: "SENT", calls: 2 });
    expect(callLog()).toEqual([
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
    ]);
  });

  it("does nothing for a run that is already done", async () => {
    const { invoices } = setup({
      [RUN.runId]: { ...PAYABLE, ruleSetAt: "2026-11-05T02:00:04.000Z", autoCancelOn: "2026-11-30" },
    });
    await expect(invoices.ensureForRun(RUN)).resolves.toMatchObject({
      status: "SENT",
      autoCancelOn: "2026-11-30",
      calls: 0,
    });
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
    expect(pending).toMatchObject({
      status: "PENDING_APPROVAL",
      calls: 1,
      autoCancelOn: null,
      invoiceDate: null,
    });
    expect(callLog()).toEqual(["POST /v2/invoicing/invoices"]);

    const sent = await invoices.ensureForRun(RUN);
    expect(sent).toMatchObject({ status: "SENT", calls: 3, adopted: false });
    expect(callLog()).toHaveLength(4);
  });

  it("can put the AUTO_CANCEL rule on before the send (S2 fallback order), reading PayPal's date first", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onGet(
      "/v2/invoicing/invoices/:id",
      sequence(
        () => paypalJson(invoiceBody({ status: "DRAFT" })),
        () => paypalJson(invoiceBody({ status: "UNPAID" })),
      ),
    );
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    const { invoices } = setup({}, { ruleBeforeSend: true });
    await expect(invoices.ensureForRun(RUN)).resolves.toMatchObject({ status: "SENT", calls: 5 });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/conditional-rules`,
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
    ]);
    expect(ruleDate(2)).toBe("2026-11-30");
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

  it("uses the agent's labels (S4.4 canonicalInvoice(quote, labels)); every number and the memo stay the code's", async () => {
    happyPayPal();
    const { invoices, repo } = setup();
    const plan = buildInvoicePlan(RUN, { businessEmail: BUSINESS_EMAIL });
    const draft = withItemLabels(plan, LABELS);
    await invoices.ensureForRun(RUN, { draft });
    const body = requests[0]?.body as {
      detail: { note: string };
      items: { name: string; unit_amount: unknown }[];
    };
    expect(body.detail.note).toBe(HERO_MEMO);
    expect(body.items).toEqual(plan.createArgs.items.map((item, i) => ({ ...item, name: LABELS[i] })));
    expect(repo.rows.get(RUN.runId)?.itemLabels).toEqual([...LABELS]);
  });

  it("refuses an agent draft with free text before any call", async () => {
    const { invoices } = setup();
    const plan = buildInvoicePlan(RUN, { businessEmail: BUSINESS_EMAIL });
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
    // A run whose invoice PayPal dated 1 Oct, resumed on 5 Nov: invoice date + 25 = 26 Oct is past.
    const { invoices, repo } = setup({ [RUN.runId]: { ...PAYABLE, invoiceDate: "2026-10-01" } });
    await expect(invoices.ensureForRun(RUN)).rejects.toThrow(/not after today/);
    expect(requests).toHaveLength(0);
    expect(repo.rows.get(RUN.runId)?.ruleSetAt ?? null).toBeNull();
  });

  it("inv.i1.no-model-numbers: a draft with a model-written amount is refused before any call", async () => {
    const { invoices, repo } = setup();
    const plan = buildInvoicePlan(RUN, { businessEmail: BUSINESS_EMAIL });
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

describe("Invoices.ensureForRun: a SCHEDULED invoice is deleted and recreated once", () => {
  const twoInvoices = (secondGetStatus: string) => {
    onPost(
      "/v2/invoicing/invoices",
      sequence(
        () => paypalJson(createdLink(INVOICE_ID), 201),
        () => paypalJson(createdLink(SECOND_ID), 201),
      ),
    );
    onPost("/v2/invoicing/invoices/:id/send", ({ url }) =>
      paypalJson(payerViewLink(url.pathname.split("/").at(-2) as string)),
    );
    onGet("/v2/invoicing/invoices/:id", (_req, { id }) =>
      paypalJson(invoiceBody({ id, status: id === INVOICE_ID ? "SCHEDULED" : secondGetStatus })),
    );
    onDelete("/v2/invoicing/invoices/:id", () => paypalEmpty(204));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
  };

  it("deletes the SCHEDULED invoice, creates the run's invoice again, sends it and checks it", async () => {
    twoInvoices("UNPAID");
    const { invoices, repo } = setup();

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", invoiceId: SECOND_ID, recreated: true, calls: 8 });
    expect(callLog()).toEqual([
      "POST /v2/invoicing/invoices",
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
      `DELETE /v2/invoicing/invoices/${INVOICE_ID}`,
      "POST /v2/invoicing/invoices",
      `POST /v2/invoicing/invoices/${SECOND_ID}/send`,
      `GET /v2/invoicing/invoices/${SECOND_ID}`,
      `POST /v2/invoicing/invoices/${SECOND_ID}/conditional-rules`,
    ]);
    // The same number, the same body: deleting a SCHEDULED invoice frees its number.
    expect(requests[4]?.body).toEqual(requests[0]?.body);
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      invoiceId: SECOND_ID,
      scheduledInvoiceId: INVOICE_ID,
      ruleSetAt: expect.any(String),
    });
  });

  it("halts on a second SCHEDULED: never a third invoice", async () => {
    twoInvoices("SCHEDULED");
    const { invoices } = setup();

    const error = (await invoices.ensureForRun(RUN).catch((e: unknown) => e)) as InvoiceNotPayableError;

    expect(error).toBeInstanceOf(InvoiceNotPayableError);
    expect(error).toMatchObject({ invoiceId: SECOND_ID, status: "SCHEDULED" });
    expect(callLog().filter((c) => c === "POST /v2/invoicing/invoices")).toHaveLength(2);
    expect(callLog()).not.toContain(`DELETE /v2/invoicing/invoices/${SECOND_ID}`);
  });

  it("a retry halts too, once the one recreate is spent", async () => {
    twoInvoices("SCHEDULED");
    const { invoices } = setup();
    await invoices.ensureForRun(RUN).catch(() => undefined);
    requests.length = 0;
    await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceNotPayableError);
    expect(callLog()).toEqual([`GET /v2/invoicing/invoices/${SECOND_ID}`]);
  });

  it("finishes a recreate interrupted between the delete and the checkpoint", async () => {
    onGet("/v2/invoicing/invoices/:id", (_req, { id }) =>
      id === INVOICE_ID
        ? paypalJson(paypalError("RESOURCE_NOT_FOUND", "The specified resource does not exist."), 404)
        : paypalJson(invoiceBody({ id, status: "UNPAID" })),
    );
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(SECOND_ID), 201));
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink(SECOND_ID)));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({
      [RUN.runId]: { ...PAYABLE, itemLabels: [...LABELS], payableAt: null, scheduledInvoiceId: INVOICE_ID },
    });

    const out = await invoices.ensureForRun(RUN);

    expect(out).toMatchObject({ status: "SENT", invoiceId: SECOND_ID, recreated: true });
    expect(callLog()[0]).toBe(`GET /v2/invoicing/invoices/${INVOICE_ID}`);
    // The recreated invoice reads as the first did: the agent's labels are kept from the checkpoint.
    const body = requests[1]?.body as { detail: { note: string }; items: { name: string }[] };
    expect(body.items.map((i) => i.name)).toEqual([...LABELS]);
    expect(body.detail.note).toBe(HERO_MEMO);
  });

  it("recreates with the quote's names when the checkpointed labels are no longer valid labels", async () => {
    onGet("/v2/invoicing/invoices/:id", (_req, { id }) =>
      id === INVOICE_ID
        ? paypalJson(paypalError("RESOURCE_NOT_FOUND", "The specified resource does not exist."), 404)
        : paypalJson(invoiceBody({ id, status: "UNPAID" })),
    );
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(SECOND_ID), 201));
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink(SECOND_ID)));
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({
      [RUN.runId]: {
        ...PAYABLE,
        itemLabels: ["Five thousand dollars", "Bonus", "Costs"],
        payableAt: null,
        scheduledInvoiceId: INVOICE_ID,
      },
    });
    await invoices.ensureForRun(RUN);
    const body = requests[1]?.body as { items: { name: string }[] } | undefined;
    expect(body?.items.map((i) => i.name)).toEqual(QUOTE_NAMES);
  });

  it.each(["CANCELLED", "AUTO_CANCELLED", "DRAFT", "SOMETHING_NEW"])(
    "halts when the payable GET shows %s after the send",
    async (status) => {
      onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
      onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
      onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status })));
      const { invoices, repo } = setup();
      await expect(invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceNotPayableError);
      expect(callLog()).toHaveLength(3);
      expect(repo.rows.get(RUN.runId)?.payableAt ?? null).toBeNull();
    },
  );

  it("halts when PayPal's invoice date is unreadable (no AUTO_CANCEL date can be derived)", async () => {
    onPost("/v2/invoicing/invoices", () => paypalJson(createdLink(), 201));
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "UNPAID", invoiceDate: null })),
    );
    await expect(setup().invoices.ensureForRun(RUN)).rejects.toBeInstanceOf(InvoiceNotPayableError);
    expect(callLog()).toHaveLength(3);
  });
});

describe("Invoices steps one at a time (the agent's create, send, rule and read)", () => {
  const created = { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37", itemLabels: QUOTE_NAMES };
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
      invoiceDate: null,
      adopted: false,
      alreadyDone: false,
      sent: false,
      payerViewUrl: null,
      calls: 1,
    });
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      invoiceId: INVOICE_ID,
      invoiceDate: null,
      itemLabels: QUOTE_NAMES,
    });
    await expect(invoices.create(RUN)).resolves.toMatchObject({ alreadyDone: true, calls: 0 });
    expect(callLog()).toEqual(["POST /v2/invoicing/invoices"]);
  });

  it("create() records an adopted invoice that PayPal already shows sent and payable", async () => {
    onPost("/v2/invoicing/invoices", () => HttpResponse.error());
    onPost("/v2/invoicing/search-invoices", () => paypalJson(searchResult(invoiceBody({ status: "SENT" }))));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SENT" })));
    const { invoices, repo } = setup();
    await expect(invoices.create(RUN)).resolves.toMatchObject({
      adopted: true,
      sent: true,
      invoiceDate: "2026-11-05",
      calls: 3,
    });
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      sentAt: NOW.toISOString(),
      payableAt: NOW.toISOString(),
    });
  });

  it("send() sends the run's invoice once and checks it is payable; it needs the invoice first", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "UNPAID" })));
    await expect(setup().invoices.send(RUN, approval)).rejects.toBeInstanceOf(InvoiceStateError);
    const { invoices, repo } = setup({ [RUN.runId]: created });
    await expect(invoices.send(RUN, approval)).resolves.toEqual({
      invoiceId: INVOICE_ID,
      payerViewUrl: invoiceBody().detail.metadata.recipient_view_url,
      alreadyDone: false,
      calls: 2,
    });
    await expect(invoices.send(RUN, approval)).resolves.toMatchObject({ alreadyDone: true, calls: 0 });
    expect(callLog()).toEqual([
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
    ]);
    expect(repo.rows.get(RUN.runId)).toMatchObject({
      invoiceDate: "2026-11-05",
      payableAt: NOW.toISOString(),
    });
  });

  it("send() refuses an approval of another invoice, and an unsent invoice without one", async () => {
    const { invoices } = setup({ [RUN.runId]: created });
    await expect(invoices.send(RUN, { ...approval, invoiceNumber: "FS-2026A-r38" })).rejects.toBeInstanceOf(
      InvoiceApprovalError,
    );
    await expect(invoices.send(RUN, null)).rejects.toBeInstanceOf(InvoiceApprovalError);
    expect(requests).toHaveLength(0);
  });

  it("send() leaves a SCHEDULED invoice to the server chain: the agent path never deletes", async () => {
    onPost("/v2/invoicing/invoices/:id/send", () => paypalJson(payerViewLink()));
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SCHEDULED" })));
    const { invoices, repo } = setup({ [RUN.runId]: created });
    await expect(invoices.send(RUN, approval)).rejects.toBeInstanceOf(InvoiceNotPayableError);
    expect(callLog()).toEqual([
      `POST /v2/invoicing/invoices/${INVOICE_ID}/send`,
      `GET /v2/invoicing/invoices/${INVOICE_ID}`,
    ]);
    expect(repo.rows.get(RUN.runId)?.sentAt).toBe(NOW.toISOString());
    expect(repo.rows.get(RUN.runId)?.payableAt ?? null).toBeNull();
  });

  it("ensureRule() dates the rule from PayPal's invoice date, once", async () => {
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices } = setup({ [RUN.runId]: { ...PAYABLE, invoiceDate: "2026-11-04" } });
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

  it("ensureRule() reads PayPal's date with a GET when the run does not hold it yet", async () => {
    onGet("/v2/invoicing/invoices/:id", () =>
      paypalJson(invoiceBody({ status: "DRAFT", invoiceDate: "2026-11-04" })),
    );
    onPost("/v2/invoicing/invoices/:id/conditional-rules", () => paypalEmpty());
    const { invoices, repo } = setup({ [RUN.runId]: created });
    await expect(invoices.ensureRule(RUN)).resolves.toMatchObject({ autoCancelOn: "2026-11-29", calls: 2 });
    expect(repo.rows.get(RUN.runId)?.invoiceDate).toBe("2026-11-04");
    expect(repo.rows.get(RUN.runId)?.payableAt ?? null).toBeNull();
  });

  it("ensureRule() refuses an end date other than PayPal's invoice date + 25 days, before the rule call", async () => {
    const { invoices } = setup({ [RUN.runId]: PAYABLE });
    const error = (await invoices
      .ensureRule(RUN, { endDate: "2026-12-04" })
      .catch((e: unknown) => e)) as InvoiceRuleDateError;
    expect(error).toBeInstanceOf(InvoiceRuleDateError);
    expect(error).toMatchObject({ asked: "2026-12-04", expected: "2026-11-30" });
    expect(requests).toHaveLength(0);
  });

  it("fetch() reads the run's own invoice and writes nothing", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody()));
    const { invoices, repo } = setup({ [RUN.runId]: created });
    await expect(invoices.fetch(RUN)).resolves.toMatchObject({ id: INVOICE_ID });
    await expect(setup().invoices.fetch(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    expect(callLog()).toEqual([`GET /v2/invoicing/invoices/${INVOICE_ID}`]);
    expect(repo.saves).toHaveLength(0);
  });
});

describe("Invoices.recordPayment: Judge Mode funding, labelled simulated rail", () => {
  it("records the code total by BANK_TRANSFER with the labelled note, and no payment date", async () => {
    onPost("/v2/invoicing/invoices/:id/payments", () =>
      paypalJson({ payment_id: "EXTR-86F38350LX4353815" }, 200),
    );
    const { invoices, repo } = setup({ [RUN.runId]: PAYABLE });

    const out = await invoices.recordPayment(RUN);

    expect(out).toEqual({
      invoiceId: INVOICE_ID,
      recorded: true,
      alreadyRecorded: false,
      paymentId: "EXTR-86F38350LX4353815",
      provenance: "simulated_rail",
      calls: 1,
    });
    // PayPal dates the payment itself (S3): no UTC date can land on PayPal's tomorrow.
    expect(requests[0]?.body).toEqual({
      method: "BANK_TRANSFER",
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
    const { invoices } = setup({ [RUN.runId]: PAYABLE });
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
      [RUN.runId]: { ...PAYABLE, paymentAttemptedAt: "2026-11-05T02:01:00.000Z" },
    });
    const out = await invoices.recordPayment(RUN);
    expect(out).toMatchObject({ recorded: false, alreadyRecorded: true, calls: 1 });
    expect(callLog()).toEqual([`GET /v2/invoicing/invoices/${INVOICE_ID}`]);
  });

  it("after an unknown outcome records it if PayPal does not show it paid", async () => {
    onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status: "SENT" })));
    onPost("/v2/invoicing/invoices/:id/payments", () => paypalJson({ payment_id: "EXTR-2" }));
    const { invoices } = setup({
      [RUN.runId]: { ...PAYABLE, paymentAttemptedAt: "2026-11-05T02:01:00.000Z" },
    });
    await expect(invoices.recordPayment(RUN)).resolves.toMatchObject({ recorded: true, calls: 2 });
  });

  it("refuses to pay an invoice that does not exist, was not sent, or is not confirmed payable", async () => {
    await expect(setup().invoices.recordPayment(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    const draftOnly = setup({ [RUN.runId]: { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37" } });
    await expect(draftOnly.invoices.recordPayment(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
    const unchecked = setup({ [RUN.runId]: { ...PAYABLE, payableAt: null } });
    await expect(unchecked.invoices.recordPayment(RUN)).rejects.toBeInstanceOf(InvoiceStateError);
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

describe("inv.i8.labels: ADR-0002 PP_MODE=simulator labels everything PayPal-derived simulated_rail", () => {
  it.each(["PAID", "MARKED_AS_PAID"])(
    "labels a %s invoice simulated_rail in simulator mode",
    async (status) => {
      onGet("/v2/invoicing/invoices/:id", () => paypalJson(invoiceBody({ status, due: "0.00" })));
      const { invoices } = setup(
        { [RUN.runId]: { invoiceId: INVOICE_ID, invoiceNumber: "FS-2026A-r37" } },
        { ppMode: "simulator" },
      );
      await expect(invoices.confirmFunding(RUN)).resolves.toMatchObject({
        state: "FUNDED",
        provenance: "simulated_rail",
      });
    },
  );

  it("labels the invoice chain's result simulated_rail in simulator mode", async () => {
    happyPayPal();
    const { invoices } = setup({}, { ppMode: "simulator" });
    await expect(invoices.ensureForRun(RUN)).resolves.toMatchObject({
      status: "SENT",
      provenance: "simulated_rail",
    });
  });

  it("refuses to be built without knowing which rail it is on (a missing label is a boot error)", () => {
    expect(() => setup({}, { ppMode: undefined as unknown as "sandbox" })).toThrow(/PP_MODE/);
    expect(() => setup({}, { ppMode: "live" as unknown as "sandbox" })).toThrow(/PP_MODE/);
  });
});
