// The full money loop of a Judge Mode run against the simulator:
// token → create invoice → send → AUTO_CANCEL rule → record payment → INVOICING.INVOICE.PAID webhook →
// payout batch → PROCESSING → SUCCESS items, Rhea UNCLAIMED → cancel → RETURNED, balance in integer cents.
import { createHash, createPublicKey, verify } from "node:crypto";
import { crc32 } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Simulator } from "../src/simulator.js";
import {
  BUSINESS_EMAIL,
  batchBody,
  type call as CallFn,
  call,
  canonicalInvoice,
  type Delivery,
  newSim,
  plusDays,
  ptToday,
  type Receiver,
  RHEA_EMAIL,
  receiver,
  subscribe,
  token,
} from "./helpers.js";

type Reply = Awaited<ReturnType<typeof CallFn>>;

describe("money loop (simulated rail)", () => {
  let sim: Simulator;
  let rx: Receiver;
  let tok: string;
  let webhookId: string;
  let invoiceId: string;
  let batchId: string;
  let rheaItemId: string;
  const senderBatchId = "2026A-7f3a91c2-r37";

  beforeAll(async () => {
    sim = await newSim();
    rx = await receiver();
    tok = await token(sim);
    webhookId = await subscribe(sim, tok, rx.url);
  });

  afterAll(async () => {
    await sim.close();
    await rx.close();
  });

  const typesSeen = () => rx.deliveries.map((d) => d.json.event_type as string);

  it("issues an OAuth token with the scopes Fair Split checks at boot", async () => {
    const app = sim.registry.apps[0];
    const basic = Buffer.from(`${app?.client_id}:${app?.client_secret}`).toString("base64");
    const res = await sim.fetch(
      new Request("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      }),
    );
    const json = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    expect(json.token_type).toBe("Bearer");
    expect(json.expires_in).toBe(32400);
    for (const scope of [
      "https://uri.paypal.com/services/invoicing",
      "https://uri.paypal.com/payments/payouts",
      "https://uri.paypal.com/services/applications/webhooks",
    ])
      expect(String(json.scope)).toContain(scope);
  });

  it("creates a draft invoice (minimal 201 link, then a full GET)", async () => {
    const res = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body: canonicalInvoice("FS-2026A-r37"),
    });
    expect(res.status).toBe(201);
    expect(res.json.rel).toBe("self");
    invoiceId = String(res.json.href).split("/").pop() as string;
    expect(invoiceId).toMatch(/^INV2-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${invoiceId}`, { token: tok });
    expect(got.status).toBe(200);
    expect(got.json.status).toBe("DRAFT");
    expect(got.json.amount.value).toBe("4333.50");
    expect(got.json.due_amount).toEqual({ currency_code: "USD", value: "4333.50" });
    expect(got.json.invoicer.email_address).toBe(BUSINESS_EMAIL);
    expect(got.json.detail.invoice_date).toBe(ptToday(sim.clock.now()));
    expect(got.json.detail.metadata.recipient_view_url).toBe(
      `${sim.options.publicBaseUrl}/sim/invoice/${invoiceId}/pay`,
    );
  });

  it("sends with send_to_recipient false (UNPAID, payer-view link)", async () => {
    const res = await call(sim, "POST", `/v2/invoicing/invoices/${invoiceId}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    expect(res.status).toBe(200);
    expect(res.json.rel).toBe("payer-view");
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${invoiceId}`, { token: tok });
    expect(got.json.status).toBe("UNPAID");
  });

  it("adds an AUTO_CANCEL rule on a SPECIFIC_DATE; a retry with request id cr-{invoiceId} is NOT replayed", async () => {
    const date = plusDays(ptToday(sim.clock.now()), 25);
    const body = {
      rules: [
        {
          conditional_rule_type: "AUTO_CANCEL",
          rule_expiry_terms: { rule_expiry_condition: "SPECIFIC_DATE", condition_rule_end_date: date },
        },
      ],
    };
    const res = await call(sim, "POST", `/v2/invoicing/invoices/${invoiceId}/conditional-rules`, {
      token: tok,
      body,
      headers: { "paypal-request-id": `cr-${invoiceId}` },
    });
    expect(res.status).toBe(201);
    expect(res.json.rules[0].conditional_rule_id).toMatch(/^CR-/);
    expect(res.json.rules[0].rule_expiry_terms.condition_rule_end_date).toBe(date);
    // Invoicing v2 does not declare PayPal-Request-Id (only Payouts' POST does), so the header is ignored:
    // the retry is a second create, refused because the invoice already has an AUTO_CANCEL rule. The app's
    // own de-duplication (list the rules, adopt the existing one) is what makes the step idempotent.
    const again = await call(sim, "POST", `/v2/invoicing/invoices/${invoiceId}/conditional-rules`, {
      token: tok,
      body,
      headers: { "paypal-request-id": `cr-${invoiceId}` },
    });
    expect(again.status).toBe(422);
    expect(again.headers.get("paypal-idempotent-replay")).toBeNull();
    expect(again.json.details[0].issue).toBe("CONDITIONAL_RULE_ALREADY_EXISTS");
    const listed = await call(sim, "GET", `/v2/invoicing/invoices/${invoiceId}/conditional-rules`, {
      token: tok,
    });
    expect(listed.json.rules).toHaveLength(1);
    expect(listed.json.rules[0].conditional_rule_id).toBe(res.json.rules[0].conditional_rule_id);
  });

  it("records the payment and the invoice becomes MARKED_AS_PAID with nothing due", async () => {
    const res = await call(sim, "POST", `/v2/invoicing/invoices/${invoiceId}/payments`, {
      token: tok,
      body: {
        method: "BANK_TRANSFER",
        amount: { currency_code: "USD", value: "4333.50" },
        note: "Sandbox: marked as paid (simulated rail)",
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.payment_id).toMatch(/^EXTR-[A-Z0-9]{17}$/);
    const got = await call(sim, "GET", `/v2/invoicing/invoices/${invoiceId}`, { token: tok });
    expect(got.json.status).toBe("MARKED_AS_PAID");
    expect(got.json.due_amount.value).toBe("0.00");
    expect(got.json.payments.paid_amount.value).toBe("4333.50");
  });

  it("delivers INVOICING.INVOICE.PAID signed like PayPal (verifiable with the served certificate)", async () => {
    await sim.idle();
    const paid = rx.deliveries.find((d) => d.json.event_type === "INVOICING.INVOICE.PAID") as Delivery;
    expect(paid).toBeDefined();
    expect(paid.json.resource.invoice.id).toBe(invoiceId);
    expect(paid.json.resource.invoice.status).toBe("MARKED_AS_PAID");
    expect(paid.headers["x-fairsplit-simulated"]).toBe("true");
    expect(paid.headers["paypal-auth-algo"]).toBe("SHA256withRSA");
    const certUrl = String(paid.headers["paypal-cert-url"]);
    expect(certUrl).toMatch(sim.certUrlPattern);
    const cert = await sim.fetch(new Request(certUrl));
    const pem = await cert.text();
    const message = `${paid.headers["paypal-transmission-id"]}|${paid.headers["paypal-transmission-time"]}|${webhookId}|${crc32(Buffer.from(paid.raw)) >>> 0}`;
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(message),
        createPublicKey(pem),
        Buffer.from(String(paid.headers["paypal-transmission-sig"]), "base64"),
      ),
    ).toBe(true);
  });

  it("accepts the payout batch as PENDING with PayPal-Request-Id = sha256(sender_batch_id)", async () => {
    const res = await call(sim, "POST", "/v1/payments/payouts", {
      token: tok,
      body: batchBody(senderBatchId),
      headers: { "paypal-request-id": createHash("sha256").update(senderBatchId).digest("hex") },
    });
    expect(res.status).toBe(201);
    expect(res.json.batch_header.batch_status).toBe("PENDING");
    expect(res.json.batch_header.sender_batch_header.sender_batch_id).toBe(senderBatchId);
    batchId = res.json.batch_header.payout_batch_id;
    expect(res.json.links[0].href).toBe(`https://api-m.sandbox.paypal.com/v1/payments/payouts/${batchId}`);
  });

  it("moves PENDING → PROCESSING → SUCCESS; seven members SUCCESS, Rhea UNCLAIMED, fees per item", async () => {
    await sim.idle();
    const res: Reply = await call(
      sim,
      "GET",
      `/v1/payments/payouts/${batchId}?page_size=100&total_required=true`,
      {
        token: tok,
      },
    );
    expect(res.status).toBe(200);
    expect(res.json.batch_header.batch_status).toBe("SUCCESS");
    expect(res.json.total_items).toBe(8);
    expect(res.json.batch_header.amount).toEqual({ currency: "USD", value: "368.39" });
    expect(res.json.batch_header.fees).toEqual({ currency: "USD", value: "2.00" });
    const items = res.json.items as {
      transaction_status: string;
      payout_item: { receiver: string };
      payout_item_fee: { value: string };
      payout_item_id: string;
    }[];
    expect(items.filter((i) => i.transaction_status === "SUCCESS")).toHaveLength(7);
    const rhea = items.find((i) => i.payout_item.receiver === RHEA_EMAIL);
    expect(rhea?.transaction_status).toBe("UNCLAIMED");
    for (const i of items) expect(i.payout_item_fee.value).toBe("0.25");
    rheaItemId = rhea?.payout_item_id as string;
    const item = await call(sim, "GET", `/v1/payments/payouts-item/${rheaItemId}`, { token: tok });
    expect(item.json.errors.name).toBe("RECEIVER_UNREGISTERED");
    expect(item.json.sender_batch_id).toBe(senderBatchId);
  });

  it("emitted the payout webhooks in processing order", () => {
    const payoutTypes = typesSeen().filter((t) => t.startsWith("PAYMENT."));
    expect(payoutTypes[0]).toBe("PAYMENT.PAYOUTSBATCH.PROCESSING");
    expect(payoutTypes.at(-1)).toBe("PAYMENT.PAYOUTSBATCH.SUCCESS");
    expect(payoutTypes.filter((t) => t === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED")).toHaveLength(7);
    expect(payoutTypes.filter((t) => t === "PAYMENT.PAYOUTS-ITEM.UNCLAIMED")).toHaveLength(1);
    const batchEvent = rx.deliveries.find((d) => d.json.event_type === "PAYMENT.PAYOUTSBATCH.SUCCESS");
    expect(batchEvent?.json.resource_type).toBe("payouts");
    expect(batchEvent?.json.resource.items).toBeUndefined();
  });

  it("cancels Rhea's UNCLAIMED item → RETURNED, and only UNCLAIMED items can be cancelled", async () => {
    const res = await call(sim, "POST", `/v1/payments/payouts-item/${rheaItemId}/cancel`, { token: tok });
    expect(res.status).toBe(200);
    expect(res.json.transaction_status).toBe("RETURNED");
    const again = await call(sim, "POST", `/v1/payments/payouts-item/${rheaItemId}/cancel`, { token: tok });
    expect(again.status).toBe(400);
    expect(again.json.name).toBe("ITEM_ALREADY_CANCELLED");
    const batch = await call(sim, "GET", `/v1/payments/payouts/${batchId}`, { token: tok });
    const success = (batch.json.items as { transaction_status: string; payout_item_id: string }[]).find(
      (i) => i.transaction_status === "SUCCESS",
    );
    const refused = await call(sim, "POST", `/v1/payments/payouts-item/${success?.payout_item_id}/cancel`, {
      token: tok,
    });
    expect(refused.status).toBe(400);
    expect(refused.json.name).toBe("ITEM_INCORRECT_STATUS");
    expect(refused.json.message).toContain("Only items in Unclaimed status can be cancelled.");
    await sim.idle();
    expect(typesSeen()).toContain("PAYMENT.PAYOUTS-ITEM.CANCELED");
  });

  it("keeps the balance in integer cents: 100000.00 − 368.39 − 2.00 + 26.65 + 0.25", async () => {
    const res = await call(sim, "GET", "/v1/reporting/balances?currency_code=USD", { token: tok });
    expect(res.status).toBe(200);
    const usd = res.json.balances[0];
    expect(usd.currency).toBe("USD");
    expect(usd.available_balance.value).toBe("99656.51");
    expect(usd.total_balance.value).toBe("99656.51");
    expect(usd.withheld_balance.value).toBe("0.00");
    const cents = 10_000_000 - 36_839 - 200 + 2_665 + 25;
    expect(sim.balance("coop", "USD").available).toBe(cents);
    expect(sim.balance("M-014", "USD").available).toBe(6_445);
  });

  it("finds the payouts in Transaction Search (T0001, returned item reversed, T1115 refund)", async () => {
    const start = new Date(sim.clock.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const end = new Date(sim.clock.now() + 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const res = await call(
      sim,
      "GET",
      `/v1/reporting/transactions?start_date=${start}&end_date=${end}&fields=all`,
      {
        token: tok,
      },
    );
    expect(res.status).toBe(200);
    const rows = res.json.transaction_details as { transaction_info: Record<string, unknown> }[];
    const t0001 = rows.filter((r) => r.transaction_info.transaction_event_code === "T0001");
    expect(t0001).toHaveLength(8);
    expect(t0001.filter((r) => r.transaction_info.transaction_status === "V")).toHaveLength(1);
    expect(rows.filter((r) => r.transaction_info.transaction_event_code === "T1115")).toHaveLength(1);
    const rhea = t0001.find((r) => r.transaction_info.transaction_status === "V");
    expect(rhea?.transaction_info.custom_field).toBe("r37-M-031");
  });

  it("lists the delivered events for catch-up with start_time", async () => {
    const start = new Date(sim.clock.now() - 3_600_000).toISOString();
    const res = await call(
      sim,
      "GET",
      `/v1/notifications/webhooks-events?start_time=${encodeURIComponent(start)}&page_size=50`,
      {
        token: tok,
      },
    );
    expect(res.status).toBe(200);
    const types = (res.json.events as { event_type: string }[]).map((e) => e.event_type);
    expect(types).toContain("INVOICING.INVOICE.PAID");
    expect(types).toContain("PAYMENT.PAYOUTSBATCH.SUCCESS");
    expect(res.json.count).toBe(types.length);
  });
});
