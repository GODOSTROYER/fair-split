import { createPublicKey, verify, X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Simulator } from "../src/simulator.js";
import {
  batchBody,
  call,
  canonicalInvoice,
  type Delivery,
  MEMBER_PAYOUTS,
  newSim,
  type Receiver,
  receiver,
  subscribe,
  token,
} from "./helpers.js";

/** Builds the verify-webhook-signature body by splicing the raw event bytes in, as S3.6.5 prescribes. */
function verifyBody(d: Delivery, webhookId: string, rawEvent = d.raw): string {
  const h = d.headers;
  const head = JSON.stringify({
    auth_algo: h["paypal-auth-algo"],
    cert_url: h["paypal-cert-url"],
    transmission_id: h["paypal-transmission-id"],
    transmission_sig: h["paypal-transmission-sig"],
    transmission_time: h["paypal-transmission-time"],
    webhook_id: webhookId,
  });
  return `${head.slice(0, -1)},"webhook_event":${rawEvent}}`;
}

describe("Webhooks v1", () => {
  let sim: Simulator;
  let tok: string;
  let rx: Receiver;

  beforeEach(async () => {
    sim = await newSim();
    tok = await token(sim);
    rx = await receiver();
  });
  afterEach(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
    await rx.close();
  });

  const recordPaid = async () => {
    const created = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body: canonicalInvoice("FS-WH-1"),
    });
    const id = String(created.json.href).split("/").pop() as string;
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    await call(sim, "POST", `/v2/invoicing/invoices/${id}/payments`, {
      token: tok,
      body: { method: "BANK_TRANSFER" },
    });
    await sim.idle();
    return id;
  };

  it("creates, lists, patches and deletes webhooks", async () => {
    const id = await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.PAID"]);
    expect(id).toMatch(/^[A-Z0-9]{17}$/);
    const list = await call(sim, "GET", "/v1/notifications/webhooks", { token: tok });
    expect(list.json.webhooks).toHaveLength(1);
    const dup = await call(sim, "POST", "/v1/notifications/webhooks", {
      token: tok,
      body: { url: rx.url, event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
    });
    expect(dup.status).toBe(400);
    expect(dup.json.name).toBe("WEBHOOK_URL_ALREADY_EXISTS");
    const patched = await call(sim, "PATCH", `/v1/notifications/webhooks/${id}`, {
      token: tok,
      body: [{ op: "replace", path: "/event_types", value: [{ name: "*" }] }],
    });
    expect(patched.status).toBe(200);
    expect(patched.json.event_types[0].name).toBe("*");
    const types = await call(sim, "GET", `/v1/notifications/webhooks/${id}/event-types`, { token: tok });
    expect(types.json.event_types[0].name).toBe("*");
    const all = await call(sim, "GET", "/v1/notifications/webhooks-event-types", { token: tok });
    expect(all.json.event_types.map((e: { name: string }) => e.name)).toContain(
      "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
    );
    const bad = await call(sim, "POST", "/v1/notifications/webhooks", {
      token: tok,
      body: { url: `${rx.url}/x`, event_types: [{ name: "NOT.A.REAL.EVENT" }] },
    });
    expect(bad.status).toBe(400);
    const del = await call(sim, "DELETE", `/v1/notifications/webhooks/${id}`, { token: tok });
    expect(del.status).toBe(204);
    expect((await call(sim, "GET", `/v1/notifications/webhooks/${id}`, { token: tok })).status).toBe(404);
  });

  it("isolates webhooks per REST app (fs-dev cannot see fs-judge's)", async () => {
    const judge = await token(sim, "fs-judge");
    const id = await subscribe(sim, judge, rx.url);
    expect((await call(sim, "GET", `/v1/notifications/webhooks/${id}`, { token: tok })).status).toBe(404);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).json.webhooks).toHaveLength(
      0,
    );
  });

  it("signs deliveries so node:crypto verifies them with the served certificate chain", async () => {
    const webhookId = await subscribe(sim, tok, rx.url);
    await recordPaid();
    const d = rx.deliveries.find((x) => x.json.event_type === "INVOICING.INVOICE.PAID") as Delivery;
    const certUrl = String(d.headers["paypal-cert-url"]);
    expect(certUrl).toBe(sim.certUrl);
    expect(certUrl).not.toMatch(/paypal\.com/);
    const pem = await (await sim.fetch(new Request(certUrl))).text();
    const [leafPem, caPem] = pem.split(/(?<=-----END CERTIFICATE-----\n)/);
    const leaf = new X509Certificate(leafPem as string);
    const ca = new X509Certificate(caPem as string);
    expect(leaf.verify(ca.publicKey)).toBe(true);
    expect(leaf.subject).toContain("NOT PayPal");
    const message = `${d.headers["paypal-transmission-id"]}|${d.headers["paypal-transmission-time"]}|${webhookId}|${crc32(Buffer.from(d.raw)) >>> 0}`;
    const sig = Buffer.from(String(d.headers["paypal-transmission-sig"]), "base64");
    expect(verify("RSA-SHA256", Buffer.from(message), createPublicKey(pem), sig)).toBe(true);
    expect(verify("RSA-SHA256", Buffer.from(`${message}0`), createPublicKey(pem), sig)).toBe(false);
    expect(d.json).toMatchObject({
      event_version: "1.0",
      resource_type: "invoices",
      resource_version: "2.0",
    });
    expect(d.json.id).toMatch(/^WH-[A-Z0-9]{17}-[A-Z0-9]{17}$/);
    expect(d.json.links.map((l: { rel: string }) => l.rel)).toEqual(["self", "resend"]);
  });

  it("verify-webhook-signature: SUCCESS for a genuine delivery, FAILURE when anything is altered", async () => {
    const webhookId = await subscribe(sim, tok, rx.url);
    await recordPaid();
    const d = rx.deliveries.find((x) => x.json.event_type === "INVOICING.INVOICE.PAID") as Delivery;
    const post = (raw: string) =>
      call(sim, "POST", "/v1/notifications/verify-webhook-signature", {
        token: tok,
        raw,
        headers: { "content-type": "application/json" },
      });
    const ok = await post(verifyBody(d, webhookId));
    expect(ok.status).toBe(200);
    expect(ok.json.verification_status).toBe("SUCCESS");
    const tampered = await post(verifyBody(d, webhookId, d.raw.replace("MARKED_AS_PAID", "PAID")));
    expect(tampered.json.verification_status).toBe("FAILURE");
    const wrongHook = await post(verifyBody(d, "0NH55953DH663215D"));
    expect(wrongHook.json.verification_status).toBe("FAILURE");
    const judge = await token(sim, "fs-judge");
    const otherApp = await call(sim, "POST", "/v1/notifications/verify-webhook-signature", {
      token: judge,
      raw: verifyBody(d, webhookId),
      headers: { "content-type": "application/json" },
    });
    expect(otherApp.json.verification_status).toBe("FAILURE");
  });

  it("retries a failing endpoint with backoff until it answers 2xx (each retry freshly signed)", async () => {
    const webhookId = await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.PAID"]);
    rx.failures.push(500, 503);
    await recordPaid();
    const delivery = Object.values(sim.state.deliveries)[0];
    expect(delivery?.status).toBe("SUCCESS");
    expect(delivery?.attempts).toBe(3);
    expect(rx.deliveries).toHaveLength(1);
    const verified = await call(sim, "POST", "/v1/notifications/verify-webhook-signature", {
      token: tok,
      raw: verifyBody(rx.deliveries[0] as Delivery, webhookId),
      headers: { "content-type": "application/json" },
    });
    expect(verified.json.verification_status).toBe("SUCCESS");
  });

  it("gives up after maxAttempts", async () => {
    const s = await newSim({ delivery: { maxAttempts: 3 } });
    const t = await token(s);
    await subscribe(s, t, rx.url, ["INVOICING.INVOICE.CREATED"]);
    rx.failures.push(500, 500, 500, 500);
    await call(s, "POST", "/v2/invoicing/invoices", { token: t, body: canonicalInvoice("FS-GIVEUP") });
    await s.idle();
    const d = Object.values(s.state.deliveries)[0];
    expect(d?.status).toBe("FAILED");
    expect(d?.attempts).toBe(3);
    await s.close();
  });

  it("resend creates a new transmission id for the same event (the duplicate beat)", async () => {
    const webhookId = await subscribe(sim, tok, rx.url);
    await recordPaid();
    const first = rx.deliveries.find((x) => x.json.event_type === "INVOICING.INVOICE.PAID") as Delivery;
    const res = await call(sim, "POST", `/v1/notifications/webhooks-events/${first.json.id}/resend`, {
      token: tok,
      body: { webhook_ids: [webhookId] },
    });
    expect(res.status).toBe(202);
    expect(res.json.id).toBe(first.json.id);
    await sim.idle();
    const copies = rx.deliveries.filter((x) => x.json.id === first.json.id);
    expect(copies).toHaveLength(2);
    expect(copies[0]?.headers["paypal-transmission-id"]).not.toBe(
      copies[1]?.headers["paypal-transmission-id"],
    );
    expect(copies[1]?.raw).toBe(copies[0]?.raw);
    const verified = await call(sim, "POST", "/v1/notifications/verify-webhook-signature", {
      token: tok,
      raw: verifyBody(copies[1] as Delivery, webhookId),
      headers: { "content-type": "application/json" },
    });
    expect(verified.json.verification_status).toBe("SUCCESS");
    const single = await call(sim, "GET", `/v1/notifications/webhooks-events/${first.json.id}`, {
      token: tok,
    });
    expect(single.json.event_type).toBe("INVOICING.INVOICE.PAID");
  });

  it("duplicate-delivery toggle: every event arrives twice with distinct transmissions", async () => {
    sim.state.delivery.duplicate = true;
    await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.PAID"]);
    await recordPaid();
    expect(rx.deliveries).toHaveLength(2);
    expect(rx.deliveries[0]?.json.id).toBe(rx.deliveries[1]?.json.id);
    expect(rx.deliveries[0]?.headers["paypal-transmission-id"]).not.toBe(
      rx.deliveries[1]?.headers["paypal-transmission-id"],
    );
  });

  it("out-of-order toggle: a batch's events are released newest first", async () => {
    sim.state.delivery.outOfOrder = true;
    await subscribe(sim, tok, rx.url);
    const res = await call(sim, "POST", "/v1/payments/payouts", {
      token: tok,
      body: batchBody("2026A-ooo", MEMBER_PAYOUTS.slice(0, 2)),
    });
    expect(res.status).toBe(201);
    await sim.idle();
    const types = rx.deliveries.map((d) => d.json.event_type);
    expect(types).toEqual([
      "PAYMENT.PAYOUTSBATCH.SUCCESS",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      "PAYMENT.PAYOUTSBATCH.PROCESSING",
    ]);
  });

  it("simulate-event sends a mock signed with WEBHOOK_ID whose postback verification FAILS", async () => {
    const webhookId = await subscribe(sim, tok, rx.url);
    const res = await call(sim, "POST", "/v1/notifications/simulate-event", {
      token: tok,
      body: { webhook_id: webhookId, event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS" },
    });
    expect(res.status).toBe(202);
    // The vendored spec pattern for simulate_event.event_type (^[a-zA-Z0-9.]+$) rejects hyphenated names.
    const hyphen = await call(sim, "POST", "/v1/notifications/simulate-event", {
      token: tok,
      body: { webhook_id: webhookId, event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" },
    });
    expect(hyphen.status).toBe(400);
    expect(hyphen.json.details[0].issue).toBe("INVALID_PARAMETER_SYNTAX");
    await sim.idle();
    const mock = rx.deliveries[0] as Delivery;
    const pem = await (await sim.fetch(new Request(String(mock.headers["paypal-cert-url"])))).text();
    const message = `${mock.headers["paypal-transmission-id"]}|${mock.headers["paypal-transmission-time"]}|WEBHOOK_ID|${crc32(Buffer.from(mock.raw)) >>> 0}`;
    expect(
      verify(
        "RSA-SHA256",
        Buffer.from(message),
        createPublicKey(pem),
        Buffer.from(String(mock.headers["paypal-transmission-sig"]), "base64"),
      ),
    ).toBe(true);
    const postback = await call(sim, "POST", "/v1/notifications/verify-webhook-signature", {
      token: tok,
      raw: verifyBody(mock, webhookId),
      headers: { "content-type": "application/json" },
    });
    expect(postback.json.verification_status).toBe("FAILURE");
  });

  it("webhooks-events filters by start_time, event_type and transaction_id", async () => {
    await subscribe(sim, tok, rx.url);
    const res = await call(sim, "POST", "/v1/payments/payouts", {
      token: tok,
      body: batchBody("2026A-events", MEMBER_PAYOUTS.slice(0, 1)),
    });
    await sim.idle();
    const later = new Date(sim.clock.now() + 60_000).toISOString();
    const none = await call(
      sim,
      "GET",
      `/v1/notifications/webhooks-events?start_time=${encodeURIComponent(later)}`,
      {
        token: tok,
      },
    );
    expect(none.json.events).toHaveLength(0);
    const typed = await call(
      sim,
      "GET",
      "/v1/notifications/webhooks-events?event_type=PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      {
        token: tok,
      },
    );
    expect(typed.json.events).toHaveLength(1);
    const batchId = res.json.batch_header.payout_batch_id as string;
    const byTxn = await call(sim, "GET", `/v1/notifications/webhooks-events?transaction_id=${batchId}`, {
      token: tok,
    });
    expect(byTxn.json.count).toBe(3);
    const lookup = await call(sim, "POST", "/v1/notifications/webhooks-lookup", { token: tok });
    expect(lookup.status).toBe(201);
    expect(
      (await call(sim, "GET", "/v1/notifications/webhooks-lookup", { token: tok })).json.webhooks_lookups,
    ).toHaveLength(1);
  });
});
