import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it } from "vitest";
import { createPayPalCore } from "./core.js";
import { PayPalScopeError } from "./errors.js";
import { createMemoryLimiter } from "./limiter.js";
import type { PayPalCallRecord } from "./recorder.js";
import { PAYPAL_SCOPES } from "./scopes.js";
import {
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "./test-support.js";
import {
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
} from "./testing/index.js";

useMswServer();

const pki = createTestPki();
const leaf = pki.issueLeaf();

beforeEach(() => {
  server.use(
    http.get(
      TEST_CERT_URL,
      () => new HttpResponse(leaf.pem, { headers: { "content-type": "application/x-pem-file" } }),
    ),
  );
});

const core = (records: PayPalCallRecord[] = [], devMocks = false) =>
  createPayPalCore({
    config: { clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, devMocks },
    limiter: createMemoryLimiter(),
    recorder: { record: (r) => void records.push(r) },
    sleep: recordingSleep().sleep,
    webhookTrustAnchors: [pki.ca.pem],
  });

describe("createPayPalCore", () => {
  it("boot() fetches one token and asserts the required scopes", async () => {
    const oauth = oauthHandler();
    server.use(oauth.handler);
    const records: PayPalCallRecord[] = [];
    const report = await core(records).boot();
    expect(report.ok).toBe(true);
    expect(oauth.stub.calls).toBe(1);
    expect(records.map((r) => r.purpose)).toEqual(["oauth.token"]);
  });

  it("boot() fails fast without the payouts scope", async () => {
    server.use(oauthHandler({ scope: `${PAYPAL_SCOPES.invoicing} ${PAYPAL_SCOPES.webhooks}` }).handler);
    await expect(core().boot()).rejects.toBeInstanceOf(PayPalScopeError);
  });

  it("verifyPayPal self-verifies offline and spends one postback call only when asked", async () => {
    server.use(oauthHandler().handler);
    let postbacks = 0;
    server.use(
      http.post(`${SANDBOX}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
        postbacks += 1;
        const body = await request.text();
        expect(body).toContain('"webhook_event":{"id":"WH-');
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const records: PayPalCallRecord[] = [];
    const c = core(records);
    // Two transmissions of the event (each transmission id is accepted once).
    const delivery = () =>
      signWebhook({
        body: syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } }),
        webhookId: TEST_WEBHOOK_ID,
        privateKey: leaf.privateKey,
      });
    const s = delivery();
    expect(await c.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(postbacks).toBe(0);
    const s2 = delivery();
    expect(await c.verifyPayPal(s2.body, s2.headers, TEST_WEBHOOK_ID, { postback: true })).toBe("postback");
    expect(postbacks).toBe(1);
    expect(records.filter((r) => r.purpose === "webhooks.verify")).toHaveLength(1);
  });

  it("routes the verifier's certificate fetch through the shared limiter and recorder", async () => {
    const records: PayPalCallRecord[] = [];
    const limiter = createMemoryLimiter();
    const c = createPayPalCore({
      config: { clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET, devMocks: false },
      limiter,
      recorder: { record: (r) => void records.push(r) },
      webhookTrustAnchors: [pki.ca.pem],
    });
    const s = signWebhook({
      body: syntheticEvent("PAYMENT.PAYOUTSBATCH.SUCCESS", {}),
      webhookId: TEST_WEBHOOK_ID,
      privateKey: leaf.privateKey,
    });
    expect(await c.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(records.map((r) => [r.purpose, r.priority, r.status])).toEqual([
      ["webhooks.cert", "background", 200],
    ]);
    expect(limiter.snapshot()).toMatchObject({ inWindow: 1, backgroundInWindow: 1 });
    expect(c.verifier.health()).toMatchObject({ status: "ok", verified: 1, expiredCertPolicy: "postback" });
  });

  it("passes the dev-mocks switch through to the verifier", async () => {
    const s = signWebhook({
      body: syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {}),
      webhookId: "WEBHOOK_ID",
      privateKey: leaf.privateKey,
    });
    expect(await core([], false).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe(false);
    expect(await core([], true).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("dev_mock");
  });
});
