// Tests that kill mutation-testing survivors (handoff T3) in webhook self-verification: the expired
// certificate policies (reject never asks PayPal; postback accepts only on PayPal's own SUCCESS), the
// signature's size bounds and whitespace, the reported transmission id, the skew detail, and the
// certificate size limits.
import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server, useMswServer } from "../test-support.js";
import {
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
  testCertUrl,
} from "../testing/index.js";
import { createPayPalWebhookVerifier, type PostbackFn, type WebhookVerifierConfig } from "./verify.js";

useMswServer();

const DAY = 86_400_000;
const VALID_FROM = new Date(Date.parse("2026-10-01T00:00:00Z"));
const pki = createTestPki({ notBefore: VALID_FROM });
const leaf = pki.issueLeaf({ notBefore: VALID_FROM });
const certs = new Map<string, string>();

beforeEach(() => {
  certs.clear();
  certs.set(TEST_CERT_URL, leaf.pem);
  server.use(
    http.get("https://api.sandbox.paypal.com/v1/notifications/certs/:id", ({ request }) => {
      const pem = certs.get(request.url);
      return pem
        ? new HttpResponse(pem, { headers: { "content-type": "application/x-pem-file" } })
        : HttpResponse.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    }),
  );
});

const event = syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
  payout_item_id: "5KX",
  transaction_status: "SUCCESS",
});
const signed = (overrides: Partial<Parameters<typeof signWebhook>[0]> = {}) =>
  signWebhook({ body: event, webhookId: TEST_WEBHOOK_ID, privateKey: leaf.privateKey, ...overrides });
const verifier = (config: WebhookVerifierConfig = {}) =>
  createPayPalWebhookVerifier({ expectedCertIdPattern: /^CERT-00000000-/, ...config });

describe("expired certificates", () => {
  const expiredLeaf = pki.issueLeaf({
    notBefore: new Date(Date.now() - 400 * DAY),
    notAfter: new Date(Date.now() - DAY),
  });
  const expired = () => {
    const url = testCertUrl("expired");
    certs.set(url, expiredLeaf.pem);
    return signed({ privateKey: expiredLeaf.privateKey, certUrl: url });
  };

  it("policy reject refuses without asking PayPal, even with a postback configured", async () => {
    const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
    const s = expired();
    const out = await verifier({ expiredCertPolicy: "reject", postback }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(out).toMatchObject({
      mode: false,
      reason: "CERT_EXPIRED",
      detail: expect.stringMatching(/policy reject$/),
    });
    expect(postback).not.toHaveBeenCalled();
  });

  it("policy postback accepts only on PayPal's SUCCESS for this very delivery", async () => {
    const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
    const s = expired();
    const out = await verifier({ expiredCertPolicy: "postback", postback }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(out).toMatchObject({
      mode: "postback",
      reason: null,
      postback: "SUCCESS",
      certWarning: "CERT_EXPIRED",
    });
    expect(postback).toHaveBeenCalledTimes(1);
  });
});

describe("the signature header", () => {
  const withSig = (sig: string) => {
    const s = signed();
    return { ...s, headers: { ...s.headers, "paypal-transmission-sig": sig } };
  };

  it("1,024 bytes is checked (and does not match); 1,025 bytes is not a signature at all", async () => {
    const v = verifier();
    const at = withSig(Buffer.alloc(1_024, 7).toString("base64"));
    expect((await v.verifyDetailed(at.body, at.headers, TEST_WEBHOOK_ID)).reason).toBe("SIGNATURE_MISMATCH");
    const over = withSig(Buffer.alloc(1_025, 7).toString("base64"));
    expect((await v.verifyDetailed(over.body, over.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "BAD_SIGNATURE_ENCODING",
    );
  });

  it("surrounding whitespace is not part of the signature", async () => {
    const s = signed();
    const padded = { ...s.headers, "paypal-transmission-sig": ` ${s.headers["paypal-transmission-sig"]} ` };
    expect((await verifier().verifyDetailed(s.body, padded, TEST_WEBHOOK_ID)).mode).toBe("self");
  });
});

describe("what the outcome reports", () => {
  it("a malformed transmission id is refused and never reported back", async () => {
    const s = signed();
    const out = await verifier().verifyDetailed(
      s.body,
      { ...s.headers, "paypal-transmission-id": "bad id!" },
      TEST_WEBHOOK_ID,
    );
    expect(out).toMatchObject({ reason: "MALFORMED_HEADER", transmissionId: null });
  });

  it("a missing transmission id is reported as none, not as the text null", async () => {
    const s = signed();
    const { "paypal-transmission-id": _gone, ...headers } = s.headers;
    const out = await verifier().verifyDetailed(s.body, headers, TEST_WEBHOOK_ID);
    expect(out).toMatchObject({
      reason: "MISSING_HEADER",
      detail: "paypal-transmission-id",
      transmissionId: null,
    });
  });

  it("names the direction and size of an out-of-window clock", async () => {
    const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString().replace(/\.\d{3}Z$/, "Z");
    const v = verifier();
    const past = signed({ transmissionTime: at(-400_000) });
    expect((await v.verifyDetailed(past.body, past.headers, TEST_WEBHOOK_ID)).detail).toMatch(
      /^skew -(399|400|401) s$/,
    );
    const future = signed({ transmissionTime: at(400_000) });
    expect((await v.verifyDetailed(future.body, future.headers, TEST_WEBHOOK_ID)).detail).toMatch(
      /^skew \+(399|400|401) s$/,
    );
  });

  it("names an unsupported algorithm, cut to 40 characters", async () => {
    const s = signed({ authAlgo: `MD5withRSA${"x".repeat(60)}` });
    const out = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(out).toMatchObject({ reason: "UNSUPPORTED_ALGO", detail: `MD5withRSA${"x".repeat(30)}` });
  });
});

describe("certificate size", () => {
  it("a certificate of exactly the limit is read; one byte more is refused, declared or not", async () => {
    const pem = leaf.pem;
    const exact = verifier({ maxCertBytes: pem.length });
    const s = signed();
    expect((await exact.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).mode).toBe("self");
    const small = verifier({ maxCertBytes: pem.length - 1 });
    const s2 = signed();
    expect(await small.verifyDetailed(s2.body, s2.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "CERT_FETCH_FAILED",
      detail: "too large",
      retryable: false,
    });
  });
});
