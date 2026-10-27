// msw answers for the PayPal calls the runs slice makes (zero live calls). Agent Toolkit 1.11.0 sends Invoicing
// to api.sandbox.paypal.com (its PayPalClient's base URL); paypal-core sends Payouts and OAuth to api-m.
import { HttpResponse, http } from "msw";
import { PAYPAL_SANDBOX } from "../../test/index.js";

export const TOOLKIT_HOST = "https://api.sandbox.paypal.com";
export const TEST_INVOICE_ID = "INV2-TEST-RUNS-0001";
export const TEST_BATCH_ID = "PBTESTRUNS01";

export interface PostedBatch {
  sender_batch_header: { sender_batch_id: string; note: string };
  items: { receiver: string; amount: { value: string; currency: string }; sender_item_id: string }[];
}

export interface PayPalScript {
  /** Every call the mock answered, in order (method names). */
  calls: string[];
  posted: PostedBatch[];
  /** Created invoices (the toolkit's REST bodies). */
  created: unknown[];
  handlers: ReturnType<typeof http.get>[];
  /** PayPal's id of the batch POSTed n-th (0-based) and of its i-th item. */
  batchIdOf(n: number): string;
  itemIdOf(n: number, i: number): string;
}

/**
 * A scripted sandbox: invoices (create, send, rule, record payment, GET), payouts (POST, the settle GET, the
 * item GET, cancel → RETURNED). Batch and item ids are distinct per POST; a receiver starting with one of the
 * `parked` prefixes stays UNCLAIMED (Rhea has no PayPal account).
 */
export function paypalScript(
  o: { invoiceDate?: string; invoiceStatus?: string; parked?: readonly string[] } = {},
): PayPalScript {
  const calls: string[] = [];
  const posted: PostedBatch[] = [];
  const created: unknown[] = [];
  const parkedPrefixes = o.parked ?? ["rhea"];
  const parked = (receiver: string) => parkedPrefixes.some((p) => receiver.startsWith(p));
  const batchIdOf = (n: number) => (n === 0 ? TEST_BATCH_ID : `${TEST_BATCH_ID}X${n}`);
  const itemIdOf = (n: number, i: number) => `PIT${n}${String(i).padStart(4, "0")}`;
  const findItem = (id: string) => {
    for (const [n, batch] of posted.entries()) {
      for (const [i, item] of batch.items.entries()) if (itemIdOf(n, i) === id) return { n, item };
    }
    return null;
  };
  let status = o.invoiceStatus ?? "MARKED_AS_PAID";
  const invoiceDate = o.invoiceDate ?? "2026-10-28";
  const invoiceBody = (id: string) => {
    // The toolkit sends PayPal's nested REST body (detail, invoicer, primary_recipients, items).
    const body = created.at(-1) as
      | {
          detail?: { invoice_number?: string; reference?: string };
          invoicer?: { email_address?: string };
          primary_recipients?: unknown;
          items?: unknown;
        }
      | undefined;
    return {
      id,
      status,
      detail: {
        invoice_number: body?.detail?.invoice_number ?? "FS-x",
        reference: body?.detail?.reference ?? "rc:x",
        currency_code: "USD",
        invoice_date: invoiceDate,
        metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id}` },
      },
      invoicer: { email_address: body?.invoicer?.email_address ?? "coop-business@example.com" },
      primary_recipients: body?.primary_recipients ?? [],
      items: body?.items ?? [],
      amount: { currency_code: "USD", value: "4333.50" },
      due_amount: {
        currency_code: "USD",
        value: status === "PAID" || status === "MARKED_AS_PAID" ? "0.00" : "4333.50",
      },
    };
  };
  const handlers = [
    http.post(`${TOOLKIT_HOST}/v2/invoicing/invoices`, async ({ request }) => {
      calls.push("create_invoice");
      created.push(await request.json());
      status = "DRAFT";
      return HttpResponse.json(
        { rel: "self", href: `${TOOLKIT_HOST}/v2/invoicing/invoices/${TEST_INVOICE_ID}`, method: "GET" },
        { status: 201, headers: { "paypal-debug-id": "dbg-create" } },
      );
    }),
    http.post(`${TOOLKIT_HOST}/v2/invoicing/invoices/:id/send`, ({ params }) => {
      calls.push("send_invoice");
      status = "UNPAID";
      return HttpResponse.json({
        rel: "payer-view",
        href: `https://www.sandbox.paypal.com/invoice/p/#${String(params.id)}`,
        method: "GET",
      });
    }),
    http.post(`${TOOLKIT_HOST}/v2/invoicing/invoices/:id/conditional-rules`, () => {
      calls.push("create_conditional_rules_for_invoice");
      return HttpResponse.json({ rules: [] }, { status: 201 });
    }),
    http.post(`${TOOLKIT_HOST}/v2/invoicing/invoices/:id/payments`, () => {
      calls.push("record_payment");
      status = "MARKED_AS_PAID";
      return HttpResponse.json(
        { payment_id: "EXTRTESTRUNS01" },
        { headers: { "paypal-debug-id": "dbg-record" } },
      );
    }),
    http.get(`${TOOLKIT_HOST}/v2/invoicing/invoices/:id`, ({ params }) => {
      calls.push("get_invoice");
      return HttpResponse.json(invoiceBody(String(params.id)));
    }),
    http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts`, async ({ request }) => {
      calls.push("create_payout_batch");
      const body = (await request.json()) as PostedBatch;
      posted.push(body);
      return HttpResponse.json(
        {
          batch_header: {
            payout_batch_id: batchIdOf(posted.length - 1),
            batch_status: "PENDING",
            sender_batch_header: { sender_batch_id: body.sender_batch_header.sender_batch_id },
          },
          links: [],
        },
        { status: 201, headers: { "paypal-debug-id": "dbg-post" } },
      );
    }),
    http.get(`${PAYPAL_SANDBOX}/v1/payments/payouts/:batchId`, ({ params }) => {
      calls.push("get_payout_batch");
      const n = posted.findIndex((_, i) => batchIdOf(i) === params.batchId);
      const batch = posted[n];
      return HttpResponse.json({
        total_items: batch?.items.length ?? 0,
        total_pages: 1,
        batch_header: {
          payout_batch_id: params.batchId,
          batch_status: "SUCCESS",
          sender_batch_header: { sender_batch_id: batch?.sender_batch_header.sender_batch_id },
        },
        items: (batch?.items ?? []).map((it, i) => ({
          payout_item_id: itemIdOf(n, i),
          payout_batch_id: params.batchId,
          transaction_status: parked(it.receiver) ? "UNCLAIMED" : "SUCCESS",
          payout_item_fee: { currency: "USD", value: "0.25" },
          payout_item: { receiver: it.receiver, amount: it.amount, sender_item_id: it.sender_item_id },
        })),
      });
    }),
    http.get(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id`, ({ params }) => {
      calls.push("get_payout_item");
      const found = findItem(String(params.id));
      return HttpResponse.json({
        payout_item_id: params.id,
        payout_batch_id: found ? batchIdOf(found.n) : TEST_BATCH_ID,
        transaction_status: found && !parked(found.item.receiver) ? "SUCCESS" : "UNCLAIMED",
        payout_item: found?.item ?? {
          receiver: "unknown@example.com",
          amount: { currency: "USD", value: "1.00" },
        },
      });
    }),
    http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, ({ params }) => {
      calls.push("cancel_unclaimed");
      const found = findItem(String(params.id));
      return HttpResponse.json({
        payout_item_id: params.id,
        payout_batch_id: found ? batchIdOf(found.n) : TEST_BATCH_ID,
        transaction_status: "RETURNED",
        payout_item: found?.item ?? {
          receiver: "rhea-no-account@example.com",
          amount: { currency: "USD", value: "26.65" },
        },
      });
    }),
  ];
  return { calls, posted, created, handlers, batchIdOf, itemIdOf };
}
