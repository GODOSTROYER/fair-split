// Golden checks against what PayPal itself publishes (or returned in the sandbox), beyond schema validity:
// PayPal's schemas set few `additionalProperties: false`, so shapes are also pinned to published samples.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultSpecDir } from "../src/contract/openapi.js";
import { invoiceFeeCents } from "../src/domain/invoicing.js";
import { RETRY_BACKOFF_S } from "../src/domain/webhooks.js";
import { PUBLISHED_US_INVOICE_FEE, type Simulator } from "../src/simulator.js";
import { isSimulatedId } from "../src/util/ids.js";
import {
  batchBody,
  call,
  canonicalInvoice,
  MEMBER_PAYOUTS,
  newSim,
  type Receiver,
  receiver,
  subscribe,
  token,
} from "./helpers.js";

// biome-ignore lint/suspicious/noExplicitAny: walking raw OpenAPI documents
type Doc = any;
const spec = (file: string): Doc => JSON.parse(readFileSync(join(defaultSpecDir(), file), "utf8"));
/** Puts a PayPal test value where PayPal reads it: items[0]/note. */
function withNote(body: Record<string, unknown>, note: string): Record<string, unknown> {
  const items = body.items as Record<string, unknown>[];
  return { ...body, items: [{ ...items[0], note }, ...items.slice(1)] };
}
const example = (doc: Doc, path: string) =>
  Object.values(doc.paths[path].post.requestBody.content["application/json"].examples)[0] as {
    value: unknown;
  };

describe("golden: published PayPal samples", () => {
  let sim: Simulator;
  const open: Receiver[] = [];
  afterEach(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
    for (const r of open.splice(0)) await r.close();
  });

  it("ERRPYO002 answers exactly the body of PayPal's published sample (test-and-go-live)", async () => {
    sim = await newSim();
    const tok = await token(sim);
    const body = withNote(batchBody("2026A-golden-errpyo002", MEMBER_PAYOUTS.slice(0, 1)), "ERRPYO002");
    const res = await call(sim, "POST", "/v1/payments/payouts", { token: tok, body });
    // Sample: {"name":"SENDER_EMAIL_UNCONFIRMED","message":"Authorization error occurred",
    //          "debug_id":"ca787bdf80d7a","information_link":"/api/payments.payouts-batch/v1/errors"}
    expect(Object.keys(res.json)).toEqual(["name", "message", "debug_id", "information_link"]);
    expect(res.json).toMatchObject({
      name: "SENDER_EMAIL_UNCONFIRMED",
      message: "Authorization error occurred",
      information_link: "/api/payments.payouts-batch/v1/errors",
    });
    expect(res.json.debug_id).toMatch(/^sim-[0-9a-f]{12}$/); // never PayPal's 13-hex shape
    expect(Object.keys(sim.state.batches)).toHaveLength(0); // rejected before anything is held
  });

  it("POSPYO001 (the positive create test value) is a plain 201", async () => {
    sim = await newSim();
    const tok = await token(sim);
    const body = withNote(batchBody("2026A-golden-pospyo001", MEMBER_PAYOUTS.slice(0, 1)), "POSPYO001");
    const res = await call(sim, "POST", "/v1/payments/payouts", { token: tok, body });
    expect(res.status).toBe(201);
    expect(res.json.batch_header.batch_status).toBe("PENDING");
  });

  it("a refused webhook URL gets the body the sandbox returns for one (VALIDATION_ERROR, 'Not a valid webhook URL')", async () => {
    sim = await newSim({ allowLoopbackWebhooks: false });
    const tok = await token(sim);
    const res = await call(sim, "POST", "/v1/notifications/webhooks", {
      token: tok,
      body: {
        url: "http://shop.example.com/paypal/webhook",
        event_types: [{ name: "INVOICING.INVOICE.PAID" }],
      },
    });
    // Observed sandbox body (debug_id a0560f819296b): {"name":"VALIDATION_ERROR","message":"Invalid data
    // provided","debug_id":…,"information_link":"https://developer.paypal.com/docs/api/webhooks/#errors",
    // "details":[{"field":"url","location":"body","issue":"Not a valid webhook URL"}],"links":[]}
    expect(res.status).toBe(400);
    expect(Object.keys(res.json)).toEqual([
      "name",
      "message",
      "debug_id",
      "information_link",
      "details",
      "links",
    ]);
    expect(res.json).toMatchObject({
      name: "VALIDATION_ERROR",
      message: "Invalid data provided",
      information_link: "https://developer.paypal.com/docs/api/webhooks/#errors",
      details: [{ field: "url", location: "body", issue: "Not a valid webhook URL" }],
      links: [],
    });
  });

  it("PayPal's own request examples in the vendored specs pass the simulator's request validation", async () => {
    sim = await newSim();
    const payouts = spec("payments_payouts_batch_v1.json");
    const webhooks = spec("notifications_webhooks_v1.json");
    const payoutsExample = example(payouts, "/v1/payments/payouts").value;
    expect(sim.contract.validateRequest("payouts:payouts.post", payoutsExample)).toEqual([]);
    for (const [op, path] of [
      ["webhooks:webhooks.post", "/v1/notifications/webhooks"],
      ["webhooks:simulate-event.post", "/v1/notifications/simulate-event"],
    ] as const)
      expect(sim.contract.validateRequest(op, example(webhooks, path).value), op).toEqual([]);
    // PayPal's verify example carries the placeholder cert_url "cert_url", which breaks the spec's own
    // `format: uri`: the simulator flags exactly that field, and nothing else in the example.
    const verifyExample = example(webhooks, "/v1/notifications/verify-webhook-signature").value as {
      cert_url: string;
    };
    expect(verifyExample.cert_url).toBe("cert_url");
    const issues = sim.contract.validateRequest("webhooks:verify-webhook-signature.post", verifyExample);
    expect(issues).toEqual([
      expect.objectContaining({ field: "/cert_url", issue: "INVALID_PARAMETER_SYNTAX" }),
    ]);
    expect(
      sim.contract.validateRequest("webhooks:verify-webhook-signature.post", {
        ...verifyExample,
        cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
      }),
    ).toEqual([]);
  });

  it("verify-webhook-signature answers PayPal's own example (with a real-shaped cert_url) with a spec-valid FAILURE", async () => {
    sim = await newSim();
    const tok = await token(sim);
    const body = {
      ...(example(spec("notifications_webhooks_v1.json"), "/v1/notifications/verify-webhook-signature")
        .value as object),
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
    };
    const res = await call(sim, "POST", "/v1/notifications/verify-webhook-signature", { token: tok, body });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ verification_status: "FAILURE" });
  });

  it("webhook events keep PayPal's envelope: id, event_version, create_time, resource_type, resource_version, event_type, summary, resource, links", async () => {
    sim = await newSim();
    const rx = await receiver();
    open.push(rx);
    const tok = await token(sim);
    await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.CREATED"]);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-ENVELOPE") });
    await sim.idle();
    const event = rx.deliveries[0]?.json;
    expect(Object.keys(event)).toEqual([
      "id",
      "event_version",
      "create_time",
      "resource_type",
      "resource_version",
      "event_type",
      "summary",
      "resource",
      "links",
    ]);
    expect(event.create_time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("golden: webhook retries span PayPal's three days", () => {
  it("25 retries whose waits add up to exactly 3 days, never shrinking", () => {
    expect(RETRY_BACKOFF_S).toHaveLength(25);
    expect(RETRY_BACKOFF_S.reduce((a, b) => a + b, 0)).toBe(3 * 86_400);
    for (let i = 1; i < RETRY_BACKOFF_S.length; i++)
      expect(RETRY_BACKOFF_S[i] as number).toBeGreaterThanOrEqual(RETRY_BACKOFF_S[i - 1] as number);
  });

  it("by default a failing listener gets the first attempt plus 25 retries, then the delivery is FAILED", async () => {
    const sim = await newSim();
    const rx = await receiver();
    rx.failures.push(...Array.from({ length: 40 }, () => 500));
    const tok = await token(sim);
    await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.CREATED"]);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-RETRIES") });
    await sim.idle();
    const d = Object.values(sim.state.deliveries)[0];
    expect(d).toMatchObject({ status: "FAILED", attempts: 26, lastStatusCode: 500 });
    expect(rx.hits).toBe(26);
    await sim.close();
    await rx.close();
  });
});

describe("PayPal-Request-Id is honoured only where PayPal's spec declares it", () => {
  it("the vendored specs declare it on Payouts' POST only", async () => {
    const sim = await newSim();
    const declaring = sim.contract
      .operations()
      .filter((o) => o.headers.includes("paypal-request-id"))
      .map((o) => o.key);
    expect(declaring).toEqual(["payouts:payouts.post"]);
    await sim.close();
  });

  it("an invoice create retried with the same request id is a second create (DUPLICATE_INVOICE_NUMBER), not a replay", async () => {
    const sim = await newSim();
    const tok = await token(sim);
    const post = () =>
      call(sim, "POST", "/v2/invoicing/invoices", {
        token: tok,
        body: canonicalInvoice("FS-IDEM-INV"),
        headers: { "paypal-request-id": "fs-idem-inv-1" },
      });
    expect((await post()).status).toBe(201);
    const again = await post();
    expect(again.status).toBe(422);
    expect(again.headers.get("paypal-idempotent-replay")).toBeNull();
    expect(again.json.details[0].issue).toBe("DUPLICATE_INVOICE_NUMBER");
    expect(Object.keys(sim.state.invoices)).toHaveLength(1);
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  it("idempotency 'all-posts' restores the lenient replay everywhere", async () => {
    const sim = await newSim({ idempotency: "all-posts" });
    const tok = await token(sim);
    const post = () =>
      call(sim, "POST", "/v2/invoicing/invoices", {
        token: tok,
        body: canonicalInvoice("FS-IDEM-ALL"),
        headers: { "paypal-request-id": "fs-idem-all-1" },
      });
    const first = await post();
    const again = await post();
    expect(again.status).toBe(201);
    expect(again.headers.get("paypal-idempotent-replay")).toBe("true");
    expect(again.json.href).toBe(first.json.href);
    await sim.close();
  });
});

describe("honesty markers that survive storage", () => {
  it("inv.i8.sim-id-markers: every minted resource ID carries SIM inside PayPal's format; PayPal's documented IDs do not", async () => {
    const sim = await newSim();
    const rx = await receiver();
    const tok = await token(sim);
    const hook = await subscribe(sim, tok, rx.url);
    const inv = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body: canonicalInvoice("FS-MARKERS"),
      headers: { prefer: "return=representation" },
    });
    await call(sim, "POST", `/v2/invoicing/invoices/${inv.json.id}/send`, {
      token: tok,
      body: { send_to_recipient: false },
    });
    const pay = await call(sim, "POST", `/v2/invoicing/invoices/${inv.json.id}/payments`, {
      token: tok,
      body: { method: "BANK_TRANSFER" },
    });
    const batch = await call(sim, "POST", "/v1/payments/payouts", {
      token: tok,
      body: batchBody("2026A-markers", MEMBER_PAYOUTS.slice(0, 1)),
    });
    await sim.idle();
    const item = Object.values(sim.state.items)[0];
    const event = rx.deliveries[0]?.json;
    const ids: [string, RegExp][] = [
      [inv.json.id, /^INV2-SIM[A-Z0-9](-[A-Z0-9]{4}){3}$/],
      [pay.json.payment_id, /^EXTR-SIM[A-Z0-9]{14}$/],
      [batch.json.batch_header.payout_batch_id, /^SIM[A-Z0-9]{10}$/],
      [item?.id as string, /^SIM[A-Z0-9]{10}$/],
      [item?.transactionId as string, /^SIM[A-Z0-9]{14}$/],
      [hook, /^SIM[A-Z0-9]{14}$/],
      [event.id, /^WH-SIM[A-Z0-9]{14}-[A-Z0-9]{17}$/],
    ];
    for (const [id, shape] of ids) {
      expect(id).toMatch(shape);
      expect(isSimulatedId(id), id).toBe(true);
    }
    // PayPal's documented sample IDs keep reading as real ones.
    for (const real of [
      "INV2-Z56S-5LLA-Q52L-CPZ5",
      "5UXD2E8A7EBQJ",
      "WH-0G2756385H040842W-5Y612302CV158622M",
      "1JE4291016473214C",
    ])
      expect(isSimulatedId(real), real).toBe(false);
    expect(sim.violations).toEqual([]);
    await sim.close();
    await rx.close();
  });
});

describe("invoice receiving fee", () => {
  it("defaults to PayPal's published US rate for invoices paid with PayPal (3.49% + US$0.49), rounded half up", () => {
    expect(PUBLISHED_US_INVOICE_FEE).toEqual({ percentBps: 349, fixedCents: 49 });
    expect(invoiceFeeCents(433_350, PUBLISHED_US_INVOICE_FEE)).toBe(15_173); // 151.239… → 151.24 + 0.49
    expect(invoiceFeeCents(100, PUBLISHED_US_INVOICE_FEE)).toBe(52); // 0.0349 → 0.03 + 0.49
    expect(invoiceFeeCents(0, PUBLISHED_US_INVOICE_FEE)).toBe(0);
    expect(invoiceFeeCents(433_350, { percentBps: 0, fixedCents: 0 })).toBe(0);
  });
});

describe("strict property check (fields PayPal's schemas never declare)", () => {
  it("flags invented fields, allows free-form objects and the published-but-undeclared Payouts fields", async () => {
    const sim = await newSim();
    const c = sim.contract;
    expect(
      c.undeclared("payouts", "payout_batch", {
        batch_header: { payout_batch_id: "SIMABCDEFGHIJ", invented: 1 },
        links: [
          { href: "https://x/y", rel: "self", method: "GET", encType: "application/json", extra: true },
        ],
      }),
    ).toEqual(["/batch_header/invented", "/links/0/extra"]);
    expect(c.undeclared("invoicing", "invoice", { id: "INV2-SIMA-AAAA-BBBB-CCCC", made_up: true })).toEqual([
      "/made_up",
    ]);
    // An event's resource is a free-form object in the Webhooks spec: anything goes there (it is checked
    // against its own API schema separately).
    expect(c.undeclared("webhooks", "event", { id: "WH-1", resource: { anything: { at: "all" } } })).toEqual(
      [],
    );
    await sim.close();
  });

  it("checks every emitted event's resource against its API schema", async () => {
    const sim = await newSim();
    sim.webhooks.emit({
      clientId: sim.registry.apps[0]?.client_id as string,
      eventType: "INVOICING.INVOICE.UPDATED",
      resourceType: "invoices",
      resourceVersion: "2.0",
      summary: "broken on purpose",
      resource: { invoice: { id: "INV2-SIMA-AAAA-BBBB-CCCC", status: "NOT_A_STATUS", invented: 1 } },
      resourceIds: [],
    });
    expect(sim.violations.join(" | ")).toMatch(/event INVOICING\.INVOICE\.UPDATED resource\.invoice:/);
    await sim.close();
  });
});
