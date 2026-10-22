import {
  buildPostbackBody,
  createPayPalAuth,
  createPayPalHttp,
  createPayPalWebhookVerifier,
  createPostbackVerifier,
  unlimitedLimiter,
} from "@fairsplit/paypal-core";
import {
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
} from "@fairsplit/paypal-core/testing";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { RunInTransaction } from "./_shims/persistence.js";
import { createPayPalWebhookHandler, type WebhookEventInsert } from "./paypal.js";
import { confirmWebhookByPostback, type PostbackStepDeps, type StoredWebhookEvent } from "./postback.js";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const VERIFY_URL = `${SANDBOX}/v1/notifications/verify-webhook-signature`;
const server = setupServer(
  http.post(`${SANDBOX}/v1/oauth2/token`, () =>
    HttpResponse.json({
      access_token: "tok-postback",
      token_type: "Bearer",
      expires_in: 32_400,
      scope: "https://uri.paypal.com/services/applications/webhooks",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const pki = createTestPki();
const leaf = pki.issueLeaf();
const paid = syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } });

/** A PayPalHttp with a recording sleep, so a retry (there must be none) would show up as a delay. */
function paypal() {
  const delays: number[] = [];
  const auth = createPayPalAuth({
    clientId: "postback-client",
    clientSecret: ["postback", "secret"].join("-"),
  });
  const client = createPayPalHttp({
    auth,
    limiter: unlimitedLimiter,
    sleep: async (ms) => {
      delays.push(ms);
    },
  });
  return { client, delays };
}

/** Rows keyed by id; `markPostbackVerified` is the conditional UPDATE the step asks for. */
function fakeRows() {
  const rows = new Map<string, WebhookEventInsert & { id: string }>();
  let nextId = 1;
  const transaction: RunInTransaction<null> = (fn) => fn(null);
  return {
    rows,
    transaction,
    insertWebhookEvent: async (_tx: null, row: WebhookEventInsert) => {
      if ([...rows.values()].some((r) => r.paypalEventId === row.paypalEventId)) return null;
      const id = `row-${nextId++}`;
      rows.set(id, { ...row, id });
      return { id };
    },
    markPostbackVerified: vi.fn(async (_tx: null, id: string) => {
      const row = rows.get(id);
      if (row?.verified !== "self") return false;
      row.verified = "postback";
      return true;
    }),
  };
}

/** Store a signed INVOICE.PAID through the real route, as PayPal would deliver it. */
async function storedDelivery() {
  const db = fakeRows();
  const verifier = createPayPalWebhookVerifier({
    fetch: async () => new Response(leaf.pem, { headers: { "content-type": "application/x-pem-file" } }),
  });
  const handler = createPayPalWebhookHandler({
    transaction: db.transaction,
    insertWebhookEvent: db.insertWebhookEvent,
    enqueue: async () => undefined,
    verify: (raw, headers) => verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID),
  });
  const s = signWebhook({ body: paid, webhookId: TEST_WEBHOOK_ID, privateKey: leaf.privateKey });
  expect(await handler({ rawBody: Buffer.from(s.body), headers: s.headers })).toMatchObject({ status: 200 });
  const [row] = [...db.rows.values()];
  if (!row) throw new Error("not stored");
  return { db, row, signed: s };
}

const deps = (db: ReturnType<typeof fakeRows>, client: ReturnType<typeof paypal>["client"], extra = {}) =>
  ({
    postback: createPostbackVerifier(client),
    webhookId: TEST_WEBHOOK_ID,
    transaction: db.transaction,
    markPostbackVerified: db.markPostbackVerified,
    ...extra,
  }) satisfies PostbackStepDeps<null>;

describe("confirmWebhookByPostback (processWebhook's badge step, after the 200)", () => {
  it("replays the stored delivery to PayPal once and upgrades the row from 'self' to 'postback'", async () => {
    const { db, row, signed } = await storedDelivery();
    const bodies: string[] = [];
    server.use(
      http.post(VERIFY_URL, async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const { client } = paypal();
    expect(await confirmWebhookByPostback(deps(db, client), row)).toEqual({ status: "confirmed" });
    expect(bodies).toEqual([
      buildPostbackBody({
        authAlgo: "SHA256withRSA",
        certUrl: TEST_CERT_URL,
        transmissionId: signed.headers["paypal-transmission-id"] ?? "",
        transmissionSig: signed.headers["paypal-transmission-sig"] ?? "",
        transmissionTime: signed.headers["paypal-transmission-time"] ?? "",
        webhookId: TEST_WEBHOOK_ID,
        rawEvent: signed.body,
      }),
    ]);
    expect(db.rows.get(row.id)?.verified).toBe("postback");
    // Idempotent: a second run spends nothing.
    expect(await confirmWebhookByPostback(deps(db, client), { ...row, verified: "postback" })).toEqual({
      status: "already_confirmed",
    });
    expect(bodies).toHaveLength(1);
  });

  it("makes exactly one PayPal call on a 503, retries nothing, and leaves the row 'self'", async () => {
    const { db, row } = await storedDelivery();
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, () => {
        calls += 1;
        return HttpResponse.json({ name: "SERVICE_UNAVAILABLE" }, { status: 503 });
      }),
    );
    const { client, delays } = paypal();
    expect(await confirmWebhookByPostback(deps(db, client), row)).toEqual({
      status: "unconfirmed",
      postback: "ERROR",
    });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(db.rows.get(row.id)?.verified).toBe("self");
    expect(db.markPostbackVerified).not.toHaveBeenCalled();
  });

  it("gives up at the deadline when PayPal hangs, after exactly one call", async () => {
    const { db, row } = await storedDelivery();
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const { client } = paypal();
    const started = performance.now();
    expect(await confirmWebhookByPostback(deps(db, client, { deadlineMs: 100 }), row)).toEqual({
      status: "unconfirmed",
      postback: "TIMEOUT",
    });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
    expect(db.rows.get(row.id)?.verified).toBe("self");
  });

  it.each([
    ["dev_mock", "NOT_SELF_VERIFIED"],
    ["fetched", "NOT_SELF_VERIFIED"],
    [null, "NOT_SELF_VERIFIED"],
  ] as const)("spends nothing on a %s row", async (verified, reason) => {
    const { db, row } = await storedDelivery();
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, () => {
        calls += 1;
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const event: StoredWebhookEvent = { ...row, verified };
    expect(await confirmWebhookByPostback(deps(db, paypal().client), event)).toEqual({
      status: "not_eligible",
      reason,
    });
    expect(calls).toBe(0);
  });

  it("spends nothing when the transmission headers were not kept (no `delivery` column)", async () => {
    const { db, row } = await storedDelivery();
    const event: StoredWebhookEvent = { ...row, delivery: null };
    expect(await confirmWebhookByPostback(deps(db, paypal().client), event)).toEqual({
      status: "not_eligible",
      reason: "NO_TRANSMISSION_HEADERS",
    });
  });

  it("reports already_confirmed when another worker upgraded the row first", async () => {
    const { db, row } = await storedDelivery();
    server.use(http.post(VERIFY_URL, () => HttpResponse.json({ verification_status: "SUCCESS" })));
    const stored = db.rows.get(row.id);
    if (stored) stored.verified = "postback";
    expect(await confirmWebhookByPostback(deps(db, paypal().client), row)).toEqual({
      status: "already_confirmed",
    });
  });
});
