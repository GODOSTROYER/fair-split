// Every implemented endpoint is exercised with a valid payload (whose response is validated against the
// vendored spec in strict mode) and with an invalid one (PayPal's 400 INVALID_REQUEST with details[].issue).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Contract, defaultSpecDir, ecmaPattern } from "../src/contract/openapi.js";
import type { Simulator } from "../src/simulator.js";
import {
  batchBody,
  call,
  canonicalInvoice,
  MEMBER_PAYOUTS,
  newSim,
  plusDays,
  ptToday,
  receiver,
  subscribe,
  token,
} from "./helpers.js";

describe("schema validation: invalid requests get 400 INVALID_REQUEST with details[].issue", () => {
  let sim: Simulator;
  let tok: string;
  let invoiceId: string;

  beforeAll(async () => {
    sim = await newSim();
    tok = await token(sim);
    const created = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body: canonicalInvoice("FS-VAL-1"),
    });
    invoiceId = String(created.json.href).split("/").pop() as string;
  });
  afterAll(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  const cases: {
    name: string;
    method: string;
    path: () => string;
    body: unknown;
    issue: string;
    field?: string;
  }[] = [
    {
      name: "invoice without detail.currency_code",
      method: "POST",
      path: () => "/v2/invoicing/invoices",
      body: { detail: { invoice_number: "X-1" } },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/detail/currency_code",
    },
    {
      name: "invoice_number longer than 25",
      method: "POST",
      path: () => "/v2/invoicing/invoices",
      body: { detail: { currency_code: "USD", invoice_number: "X".repeat(26) } },
      issue: "INVALID_STRING_MAX_LENGTH",
      field: "/detail/invoice_number",
    },
    {
      name: "item without unit_amount",
      method: "POST",
      path: () => "/v2/invoicing/invoices",
      body: { detail: { currency_code: "USD" }, items: [{ name: "a", quantity: "1" }] },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/items/0/unit_amount",
    },
    {
      name: "send with a too-long subject",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/send`,
      body: { subject: "s".repeat(4001) },
      issue: "INVALID_STRING_MAX_LENGTH",
    },
    {
      name: "record payment without method",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/payments`,
      body: { amount: { currency_code: "USD", value: "1.00" } },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/method",
    },
    {
      name: "record payment with an unknown method",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/payments`,
      body: { method: "BITCOIN" },
      issue: "INVALID_PARAMETER_VALUE",
      field: "/method",
    },
    {
      name: "search with six statuses",
      method: "POST",
      path: () => "/v2/invoicing/search-invoices",
      body: { status: ["DRAFT", "SENT", "PAID", "UNPAID", "CANCELLED", "REFUNDED"] },
      issue: "INVALID_ARRAY_MAX_ITEMS",
    },
    {
      name: "conditional rule with an unknown expiry condition",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/conditional-rules`,
      body: {
        rules: [
          {
            conditional_rule_type: "AUTO_CANCEL",
            rule_expiry_terms: { rule_expiry_condition: "SEVENTY_DAYS_AFTER_ISSUE_DATE" },
          },
        ],
      },
      issue: "INVALID_PARAMETER_VALUE",
      field: "/rules/0/rule_expiry_terms/rule_expiry_condition",
    },
    {
      name: "payout batch without items",
      method: "POST",
      path: () => "/v1/payments/payouts",
      body: { sender_batch_header: { sender_batch_id: "x" } },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/items",
    },
    {
      name: "payout batch with an empty items array",
      method: "POST",
      path: () => "/v1/payments/payouts",
      body: { sender_batch_header: { sender_batch_id: "x" }, items: [] },
      issue: "INVALID_ARRAY_MIN_ITEMS",
    },
    {
      name: "payout item receiver longer than 127",
      method: "POST",
      path: () => "/v1/payments/payouts",
      body: {
        sender_batch_header: { sender_batch_id: "x" },
        items: [{ receiver: `${"r".repeat(120)}@example.org`, amount: { currency: "USD", value: "1.00" } }],
      },
      issue: "INVALID_STRING_MAX_LENGTH",
      field: "/items/0/receiver",
    },
    {
      name: "webhook without url",
      method: "POST",
      path: () => "/v1/notifications/webhooks",
      body: { event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/url",
    },
    {
      name: "verify-webhook-signature without webhook_event",
      method: "POST",
      path: () => "/v1/notifications/verify-webhook-signature",
      body: {
        auth_algo: "SHA256withRSA",
        cert_url: "https://example.org/c.pem",
        transmission_id: "abc-123",
        transmission_sig: "sig",
        transmission_time: "2026-10-22T10:00:00Z",
        webhook_id: "ABC123",
      },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/webhook_event",
    },
    {
      name: "resend with webhook_ids that is not an array",
      method: "POST",
      path: () => "/v1/notifications/webhooks-events/WH-X/resend",
      body: { webhook_ids: "not-an-array" },
      issue: "INVALID_PARAMETER_SYNTAX",
      field: "/webhook_ids",
    },
    {
      name: "full update without detail",
      method: "PUT",
      path: () => `/v2/invoicing/invoices/${invoiceId}`,
      body: { items: [] },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/detail",
    },
    {
      name: "remind with a non-boolean send_to_invoicer",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/remind`,
      body: { send_to_invoicer: "yes" },
      issue: "INVALID_PARAMETER_SYNTAX",
      field: "/send_to_invoicer",
    },
    {
      name: "cancel with too many additional recipients",
      method: "POST",
      path: () => `/v2/invoicing/invoices/${invoiceId}/cancel`,
      body: { additional_recipients: Array.from({ length: 101 }, (_, i) => `cc${i}@example.org`) },
      issue: "INVALID_ARRAY_MAX_ITEMS",
      field: "/additional_recipients",
    },
    {
      name: "generate-next-invoice-number with a string fetch_id",
      method: "POST",
      path: () => "/v2/invoicing/generate-next-invoice-number",
      body: { fetch_id: "duplicate" },
      issue: "INVALID_PARAMETER_SYNTAX",
      field: "/fetch_id",
    },
    {
      name: "conditional rule update without rule_expiry_terms",
      method: "PUT",
      path: () =>
        `/v2/invoicing/invoices/${invoiceId}/conditional-rules/CR-aaaa-bbbb-cccccccc-dddd-eeeeeeeeeeee`,
      body: { conditional_rule_type: "AUTO_CANCEL" },
      issue: "MISSING_REQUIRED_PARAMETER",
      field: "/rule_expiry_terms",
    },
  ];

  const queryCases: { name: string; path: string; issue: string; status?: number }[] = [
    {
      name: "list invoices with page_size 0",
      path: "/v2/invoicing/invoices?page_size=0",
      issue: "INVALID_INTEGER_MIN_VALUE",
    },
    {
      name: "transactions without start_date",
      path: "/v1/reporting/transactions?end_date=2026-10-22T00:00:00Z",
      issue: "MISSING_REQUIRED_PARAMETER",
    },
    {
      name: "transactions over more than 31 days",
      path: "/v1/reporting/transactions?start_date=2026-08-01T00:00:00Z&end_date=2026-10-01T00:00:00Z",
      issue: "INVALID_PARAMETER_VALUE",
    },
    {
      name: "balances with a bad as_of_time",
      path: "/v1/reporting/balances?as_of_time=yesterday",
      issue: "INVALID_PARAMETER_SYNTAX",
    },
  ];

  for (const q of queryCases) {
    it(`query: ${q.name}`, async () => {
      const res = await call(sim, "GET", q.path, { token: tok });
      expect(res.status).toBe(400);
      expect(res.json.name).toBe("INVALID_REQUEST");
      expect(res.json.details[0].issue).toBe(q.issue);
      expect(res.json.details[0].location).toBe("query");
    });
  }

  it("query: payouts and webhooks-events reject bad paging and times", async () => {
    const batch = await call(sim, "GET", "/v1/payments/payouts/ABC?page_size=0", { token: tok });
    expect(batch.status).toBe(404); // unknown batch is checked first
    const events = await call(sim, "GET", "/v1/notifications/webhooks-events?start_time=not-a-time", {
      token: tok,
    });
    expect(events.status).toBe(400);
    expect(events.json.name).toBe("VALIDATION_ERROR");
  });

  for (const c of cases) {
    it(c.name, async () => {
      const res = await call(sim, c.method, c.path(), { token: tok, body: c.body });
      expect(res.status).toBe(400);
      expect(res.json.name).toBe("INVALID_REQUEST");
      expect(res.json.debug_id).toMatch(/^sim-/);
      expect(res.headers.get("paypal-debug-id")).toBe(res.json.debug_id);
      const issues = (res.json.details as { issue: string; field: string }[]).map((d) => d.issue);
      expect(issues).toContain(c.issue);
      if (c.field) expect((res.json.details as { field: string }[]).map((d) => d.field)).toContain(c.field);
    });
  }

  it("malformed JSON is MALFORMED_REQUEST_JSON", async () => {
    const res = await call(sim, "POST", "/v2/invoicing/invoices", {
      token: tok,
      raw: "{not json",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(400);
    expect(res.json.details[0].issue).toBe("MALFORMED_REQUEST_JSON");
  });

  it("a PATCH body is validated as a JSON Patch array", async () => {
    const rx = await receiver();
    const id = await subscribe(sim, tok, rx.url, ["INVOICING.INVOICE.PAID"]);
    const res = await call(sim, "PATCH", `/v1/notifications/webhooks/${id}`, {
      token: tok,
      body: [{ path: "/url" }],
    });
    expect(res.status).toBe(400);
    expect(res.json.details[0].issue).toBe("MISSING_REQUIRED_PARAMETER");
    await rx.close();
  });

  it("OAuth: unsupported grant type and missing credentials", async () => {
    const app = sim.registry.apps[0];
    const basic = Buffer.from(`${app?.client_id}:${app?.client_secret}`).toString("base64");
    const bad = await sim.fetch(
      new Request("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=password",
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: "unsupported_grant_type",
      error_description: "Unsupported grant type",
    });
    const none = await sim.fetch(
      new Request("https://api-m.sandbox.paypal.com/v1/oauth2/token", { method: "POST" }),
    );
    expect(none.status).toBe(401);
  });

  it("missing, unknown and expired bearer tokens are 401 AUTHENTICATION_FAILURE", async () => {
    expect((await call(sim, "GET", "/v2/invoicing/invoices")).json.name).toBe("AUTHENTICATION_FAILURE");
    expect((await call(sim, "GET", "/v2/invoicing/invoices", { token: "SIM.nope" })).status).toBe(401);
    const s = await newSim();
    const t = await token(s);
    s.clock.advance(32_401_000);
    const expired = await call(s, "GET", "/v1/payments/payouts/ABC", { token: t });
    expect(expired.status).toBe(401);
    expect(expired.json.name).toBe("AUTHENTICATION_FAILURE");
    await s.close();
  });

  it("a token without the reporting scope gets 403", async () => {
    const s = await newSim({
      registry: (() => {
        const base = sim.registry;
        return {
          ...base,
          apps: base.apps.map((a) => ({ ...a, scopes: a.scopes.filter((x) => !x.includes("reporting")) })),
        };
      })(),
    });
    const t = await token(s);
    const res = await call(s, "GET", "/v1/reporting/balances", { token: t });
    expect(res.status).toBe(403);
    expect(res.json.name).toBe("NOT_AUTHORIZED");
    await s.close();
  });

  it("unimplemented endpoints say so plainly", async () => {
    const res = await call(sim, "GET", "/v2/checkout/orders/123", { token: tok });
    expect(res.status).toBe(404);
    expect(res.json.message).toContain("simulator does not implement");
    expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
  });
});

describe("contract tour: every implemented operation answers with spec-valid bodies", () => {
  it("touches every implemented operation and records no contract violation", async () => {
    const sim = await newSim();
    const tok = await token(sim);
    const rx = await receiver();
    const webhookId = await subscribe(sim, tok, rx.url);
    const ok = async (method: string, path: string, body?: unknown, headers?: Record<string, string>) => {
      const res = await call(sim, method, path, {
        token: tok,
        ...(body !== undefined ? { body } : {}),
        ...(headers ? { headers } : {}),
      });
      expect(res.status, `${method} ${path}: ${res.text}`).toBeLessThan(300);
      return res;
    };
    // invoicing
    const created = await ok("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-TOUR-1"), {
      prefer: "return=representation",
    });
    const id = created.json.id as string;
    await ok("GET", "/v2/invoicing/invoices?page=1&page_size=10&total_required=true");
    await ok("POST", "/v2/invoicing/search-invoices?total_required=true", { invoice_number: "FS-TOUR-1" });
    await ok("POST", "/v2/invoicing/generate-next-invoice-number", { fetch_id: false });
    await ok("PUT", `/v2/invoicing/invoices/${id}`, canonicalInvoice("FS-TOUR-1"));
    await ok("GET", `/v2/invoicing/invoices/${id}`);
    await ok("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: false });
    await ok("POST", `/v2/invoicing/invoices/${id}/remind`, {});
    const rule = await ok("POST", `/v2/invoicing/invoices/${id}/conditional-rules`, {
      rules: [
        {
          conditional_rule_type: "AUTO_CANCEL",
          rule_expiry_terms: {
            rule_expiry_condition: "SPECIFIC_DATE",
            condition_rule_end_date: plusDays(ptToday(), 10),
          },
        },
      ],
    });
    const ruleId = rule.json.rules[0].conditional_rule_id as string;
    await ok("GET", `/v2/invoicing/invoices/${id}/conditional-rules`);
    await ok("GET", `/v2/invoicing/invoices/${id}/conditional-rules/${ruleId}`);
    await ok("PUT", `/v2/invoicing/invoices/${id}/conditional-rules/${ruleId}`, {
      conditional_rule_type: "AUTO_CANCEL",
      rule_expiry_terms: {
        rule_expiry_condition: "SPECIFIC_DATE",
        condition_rule_end_date: plusDays(ptToday(), 12),
      },
    });
    await ok("DELETE", `/v2/invoicing/invoices/${id}/conditional-rules/${ruleId}`);
    const pay = await ok("POST", `/v2/invoicing/invoices/${id}/payments`, {
      method: "CASH",
      amount: { currency_code: "USD", value: "100.00" },
    });
    await ok("DELETE", `/v2/invoicing/invoices/${id}/payments/${pay.json.payment_id}`);
    await ok("POST", `/v2/invoicing/invoices/${id}/cancel`, {});
    const draft = await ok("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-TOUR-2"));
    await ok("DELETE", `/v2/invoicing/invoices/${String(draft.json.href).split("/").pop()}`);
    // payouts
    const batch = await ok("POST", "/v1/payments/payouts", batchBody("2026A-tour", MEMBER_PAYOUTS.slice(6)));
    await sim.idle();
    const got = await ok("GET", `/v1/payments/payouts/${batch.json.batch_header.payout_batch_id}`);
    const unclaimed = (got.json.items as { transaction_status: string; payout_item_id: string }[]).find(
      (i) => i.transaction_status === "UNCLAIMED",
    );
    await ok("GET", `/v1/payments/payouts-item/${unclaimed?.payout_item_id}`);
    await ok("POST", `/v1/payments/payouts-item/${unclaimed?.payout_item_id}/cancel`);
    // webhooks
    await ok("GET", "/v1/notifications/webhooks");
    await ok("GET", `/v1/notifications/webhooks/${webhookId}`);
    await ok("PATCH", `/v1/notifications/webhooks/${webhookId}`, [
      { op: "replace", path: "/url", value: `${rx.url}?v=2` },
    ]);
    await ok("GET", `/v1/notifications/webhooks/${webhookId}/event-types`);
    await ok("GET", "/v1/notifications/webhooks-event-types");
    const lookup = await ok("POST", "/v1/notifications/webhooks-lookup");
    await ok("GET", "/v1/notifications/webhooks-lookup");
    await ok("GET", `/v1/notifications/webhooks-lookup/${lookup.json.id}`);
    await ok("DELETE", `/v1/notifications/webhooks-lookup/${lookup.json.id}`);
    await sim.idle();
    const events = await ok("GET", "/v1/notifications/webhooks-events?page_size=100");
    const eventId = events.json.events[0].id as string;
    await ok("GET", `/v1/notifications/webhooks-events/${eventId}`);
    await ok("POST", `/v1/notifications/webhooks-events/${eventId}/resend`, {});
    await ok("POST", "/v1/notifications/verify-webhook-signature", {
      auth_algo: "SHA256withRSA",
      cert_url: sim.certUrl,
      transmission_id: "aaaa-bbbb",
      transmission_sig: "c2ln",
      transmission_time: "2026-10-22T10:00:00Z",
      webhook_id: webhookId,
      webhook_event: { id: "WH-X", event_type: "INVOICING.INVOICE.PAID" },
    });
    await ok("POST", "/v1/notifications/simulate-event", {
      webhook_id: webhookId,
      event_type: "INVOICING.INVOICE.PAID",
    });
    // reporting
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
    await ok(
      "GET",
      `/v1/reporting/transactions?start_date=${iso(Date.now() - 3_600_000)}&end_date=${iso(Date.now() + 60_000)}&fields=all`,
    );
    await ok("GET", "/v1/reporting/balances");
    await ok("DELETE", `/v1/notifications/webhooks/${webhookId}`);
    await sim.idle();

    const coverage = sim.contract.coverage();
    const implemented = [
      "invoicing:invoices.create",
      "invoicing:invoices.list",
      "invoicing:invoices.search-invoices",
      "invoicing:invoicing.generate-next-invoice-number",
      "invoicing:invoices.update",
      "invoicing:invoices.get",
      "invoicing:invoices.send",
      "invoicing:invoices.remind",
      "invoicing:invoices.cancel",
      "invoicing:invoices.payments",
      "invoicing:invoices.payments-delete",
      "invoicing:invoices.delete",
      "conditional_rules:conditional-rules.create",
      "conditional_rules:conditional-rules.list",
      "conditional_rules:conditional-rules.get",
      "conditional_rules:conditional-rules.update",
      "conditional_rules:conditional-rules.delete",
      "payouts:payouts.post",
      "payouts:payouts.get",
      "payouts:payouts-item.get",
      "payouts:payouts-item.cancel",
      "webhooks:webhooks.post",
      "webhooks:webhooks.list",
      "webhooks:webhooks.get",
      "webhooks:webhooks.update",
      "webhooks:webhooks.delete",
      "webhooks:event-types.list",
      "webhooks:webhooks-event-types.list",
      "webhooks:webhooks-lookup.post",
      "webhooks:webhooks-lookup.list",
      "webhooks:webhooks-lookup.get",
      "webhooks:webhooks-lookup.delete",
      "webhooks:webhooks-events.list",
      "webhooks:webhooks-events.get",
      "webhooks:webhooks-events.resend",
      "webhooks:verify-webhook-signature.post",
      "webhooks:simulate-event.post",
      "reporting:search.get",
      "reporting:balances.get",
      "oauth:oauth2.token",
    ];
    for (const op of implemented) expect(Object.keys(coverage.responses), op).toContain(op);
    expect(sim.violations).toEqual([]);
    await sim.close();
    await rx.close();
  });
});

describe("OpenAPI → JSON Schema conversion", () => {
  const contract = new Contract({ specDir: defaultSpecDir() });

  it("does not require readOnly properties in requests but does in responses", () => {
    // payout_header.required includes batch_status/payout_batch_id; invoice.id is readOnly but not required.
    expect(
      contract.check(
        "payouts",
        "payout_item",
        { payout_item: { amount: { currency: "USD", value: "1" }, receiver: "a" } },
        "res",
      ),
    ).not.toEqual([]);
    expect(contract.check("webhooks", "event", {}, "req")).toEqual([]);
  });

  it("expands Java-style (?i) patterns", () => {
    expect(new RegExp(ecmaPattern("(?i)^(pay|details)$")).test("PAY")).toBe(true);
    expect(new RegExp(ecmaPattern("(?i)^(pay|details)$")).test("x")).toBe(false);
  });

  it("knows the vendored spec versions", () => {
    expect(contract.specs.invoicing.version).toBe("2.6");
    expect(contract.specs.payouts.version).toBe("1.9");
    expect(contract.specs.webhooks.version).toBe("1.11");
    expect(contract.specs.reporting.version).toBe("1.9");
  });
});
