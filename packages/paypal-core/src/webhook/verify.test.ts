import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server, useMswServer } from "../test-support.js";
import {
  createCertificate,
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_SUBJECT,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
} from "../testing/index.js";
import { createMemoryCertCache } from "./certs.js";
import {
  createPayPalWebhookVerifier,
  MOCK_WEBHOOK_ID,
  type PostbackFn,
  verifyPayPal,
  type WebhookVerifierConfig,
} from "./verify.js";

useMswServer();

const DAY = 86_400_000;
const pki = createTestPki();
const leaf = pki.issueLeaf();
const certs = new Map<string, string>();
let certFetches = 0;

const certUrl = (id: string) => `https://api.sandbox.paypal.com/v1/notifications/certs/${id}`;
const serve = (id: string, pem: string) => {
  certs.set(certUrl(id), pem);
  return certUrl(id);
};

beforeEach(() => {
  certs.clear();
  certFetches = 0;
  certs.set(TEST_CERT_URL, leaf.pem);
  server.use(
    http.get("https://api.sandbox.paypal.com/v1/notifications/certs/:id", ({ request }) => {
      certFetches += 1;
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
const verifier = (config: WebhookVerifierConfig = {}) => createPayPalWebhookVerifier(config);

describe("verifyPayPal: self-verification (CRC32 + RSA-SHA256)", () => {
  it("accepts a correctly signed delivery as 'self'", async () => {
    const s = signed();
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({
      mode: "self",
      reason: null,
      crc32: s.crc32,
      certSource: "network",
      postback: null,
    });
    expect(outcome.transmissionId).toBe(s.headers["paypal-transmission-id"]);
  });

  it("accepts the raw body as string, Buffer, Uint8Array or ArrayBuffer alike", async () => {
    const s = signed();
    const v = verifier();
    const bytes = Buffer.from(s.body, "utf8");
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const raw of [s.body, bytes, new Uint8Array(bytes), arrayBuffer]) {
      expect(await v.verifyPayPal(raw, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    }
  });

  it("reads headers case-insensitively from Headers and plain objects (Node style, arrays joined)", async () => {
    const s = signed();
    const upper = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k.toUpperCase(), v]));
    const v = verifier();
    expect(await v.verifyPayPal(s.body, upper, TEST_WEBHOOK_ID)).toBe("self");
    expect(await v.verifyPayPal(s.body, new Headers(s.headers), TEST_WEBHOOK_ID)).toBe("self");
  });

  it("rejects a tampered body (one byte changed)", async () => {
    const s = signed();
    const tampered = s.body.replace('"SUCCESS"', '"SUCCESZ"');
    expect(tampered).not.toBe(s.body);
    const outcome = await verifier().verifyDetailed(tampered, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({ mode: false, reason: "SIGNATURE_MISMATCH" });
  });

  it("rejects a re-serialized body even when it parses to the same JSON", async () => {
    const s = signed();
    const pretty = JSON.stringify(JSON.parse(s.body), null, 2);
    expect((await verifier().verifyDetailed(pretty, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it.each(["paypal-transmission-id", "paypal-transmission-time"] as const)(
    "rejects a changed %s",
    async (header) => {
      const s = signed();
      const outcome = await verifier().verifyDetailed(
        s.body,
        { ...s.headers, [header]: `${s.headers[header]}0` },
        TEST_WEBHOOK_ID,
      );
      expect(outcome.reason).toBe("SIGNATURE_MISMATCH");
    },
  );

  it("rejects a delivery signed for another webhook id", async () => {
    const s = signed({ webhookId: "OTHERWEBHOOK1" });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it("rejects a signature made by a key other than the certificate's", async () => {
    const other = pki.issueLeaf();
    const s = signed({ privateKey: other.privateKey });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "SIGNATURE_MISMATCH",
    );
  });

  it.each([
    ["paypal-transmission-id"],
    ["paypal-transmission-time"],
    ["paypal-transmission-sig"],
    ["paypal-cert-url"],
    ["paypal-auth-algo"],
  ])("rejects a delivery without %s", async (header) => {
    const s = signed();
    const headers = { ...s.headers };
    delete headers[header];
    expect(await verifier().verifyDetailed(s.body, headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "MISSING_HEADER",
      detail: header,
    });
    expect(certFetches).toBe(0);
  });

  it("rejects an unsupported auth algorithm and malformed signatures before fetching anything", async () => {
    const s = signed();
    const v = verifier();
    expect(
      (await v.verifyDetailed(s.body, { ...s.headers, "paypal-auth-algo": "SHA1withRSA" }, TEST_WEBHOOK_ID))
        .reason,
    ).toBe("UNSUPPORTED_ALGO");
    expect(
      (
        await v.verifyDetailed(
          s.body,
          { ...s.headers, "paypal-transmission-sig": "not base64!" },
          TEST_WEBHOOK_ID,
        )
      ).reason,
    ).toBe("BAD_SIGNATURE_ENCODING");
    expect(
      (await v.verifyDetailed(s.body, { ...s.headers, "paypal-transmission-sig": "AAAA" }, TEST_WEBHOOK_ID))
        .reason,
    ).toBe("BAD_SIGNATURE_ENCODING");
    expect((await v.verifyDetailed("", s.headers, TEST_WEBHOOK_ID)).reason).toBe("EMPTY_BODY");
    expect((await v.verifyDetailed(s.body, s.headers, "")).reason).toBe("WEBHOOK_ID_MISSING");
    expect(certFetches).toBe(0);
  });
});

describe("verifyPayPal: certificate URL and certificate checks", () => {
  it.each([
    ["https://evil.example.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://api.sandbox.paypal.com.evil.example.com/v1/notifications/certs/CERT-1", "HOST_NOT_PAYPAL"],
    ["https://api.paypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_ALLOWED"],
    ["https://www.sandbox.paypal.com/v1/notifications/certs/CERT-1", "HOST_NOT_ALLOWED"],
    ["http://api.sandbox.paypal.com/v1/notifications/certs/CERT-1", "NOT_HTTPS"],
    ["https://api.sandbox.paypal.com/v1/oauth2/token", "BAD_PATH"],
  ])("refuses cert URL %s (%s) without fetching it", async (url, why) => {
    const s = signed({ certUrl: url });
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED", detail: why });
    expect(certFetches).toBe(0);
  });

  it("rejects an expired certificate", async () => {
    const expired = pki.issueLeaf({
      notBefore: new Date(Date.now() - 400 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    const s = signed({ privateKey: expired.privateKey, certUrl: serve("CERT-expired", expired.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("CERT_EXPIRED");
  });

  it("rejects a certificate that is not valid yet", async () => {
    const early = pki.issueLeaf({
      notBefore: new Date(Date.now() + DAY),
      notAfter: new Date(Date.now() + 30 * DAY),
    });
    const s = signed({ privateKey: early.privateKey, certUrl: serve("CERT-early", early.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_NOT_YET_VALID",
    );
  });

  it("re-checks validity on every use, so a cached certificate expires on time", async () => {
    let now = Date.now();
    const shortLived = pki.issueLeaf({ notBefore: new Date(now - DAY), notAfter: new Date(now + 60_000) });
    const url = serve("CERT-short", shortLived.pem);
    const v = verifier({ now: () => now });
    const s = signed({ privateKey: shortLived.privateKey, certUrl: url });
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    now += 120_000;
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("CERT_EXPIRED");
    expect(certFetches).toBe(1);
  });

  it("rejects a certificate for another subject host", async () => {
    const wrong = pki.issueLeaf({ commonName: "evil.example.com", dnsNames: ["evil.example.com"] });
    const s = signed({ privateKey: wrong.privateKey, certUrl: serve("CERT-wrong-host", wrong.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_SUBJECT_MISMATCH",
    );
  });

  it("rejects a live-PayPal subject in the sandbox", async () => {
    const live = pki.issueLeaf({
      commonName: "messageverificationcerts.paypal.com",
      dnsNames: ["messageverificationcerts.paypal.com"],
    });
    const s = signed({ privateKey: live.privateKey, certUrl: serve("CERT-live-subject", live.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_SUBJECT_MISMATCH",
    );
  });

  it("rejects a CA certificate and a key under 2048 bits", async () => {
    const asCa = signed({ privateKey: pki.ca.privateKey, certUrl: serve("CERT-ca", pki.ca.pem) });
    expect((await verifier().verifyDetailed(asCa.body, asCa.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_IS_CA",
    );
    const weak = pki.issueLeaf({ keyBits: 1024 });
    const s = signed({ privateKey: weak.privateKey, certUrl: serve("CERT-weak", weak.pem) });
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome.reason).toBe("CERT_KEY_UNSUPPORTED");
  });

  it("with trust anchors, accepts a leaf issued by the test CA and refuses a self-signed look-alike", async () => {
    const v = verifier({ trustAnchors: [pki.ca.pem] });
    const good = signed();
    expect(await v.verifyPayPal(good.body, good.headers, TEST_WEBHOOK_ID)).toBe("self");

    const lookAlike = createCertificate({ commonName: TEST_CERT_SUBJECT, dnsNames: [TEST_CERT_SUBJECT] });
    const forged = signed({ privateKey: lookAlike.privateKey, certUrl: serve("CERT-forged", lookAlike.pem) });
    expect((await v.verifyDetailed(forged.body, forged.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_UNTRUSTED",
    );
    // Without anchors the same look-alike passes the leaf checks: trust then rests on TLS to PayPal's host.
    expect(await verifier().verifyPayPal(forged.body, forged.headers, TEST_WEBHOOK_ID)).toBe("self");
  });

  it("with trust anchors, follows an intermediate CA included in the PEM bundle", async () => {
    const intermediate = createCertificate({
      commonName: "Fair Split Test Intermediate",
      isCA: true,
      issuer: pki.ca,
    });
    const issued = createCertificate({
      commonName: TEST_CERT_SUBJECT,
      dnsNames: [TEST_CERT_SUBJECT],
      issuer: intermediate,
    });
    const url = serve("CERT-chain", `${issued.pem}${intermediate.pem}`);
    const s = signed({ privateKey: issued.privateKey, certUrl: url });
    expect(
      await verifier({ trustAnchors: [pki.ca.pem] }).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID),
    ).toBe("self");
    const leafOnly = serve("CERT-chain-leaf-only", issued.pem);
    const s2 = signed({ privateKey: issued.privateKey, certUrl: leafOnly });
    expect(
      (await verifier({ trustAnchors: [pki.ca.pem] }).verifyDetailed(s2.body, s2.headers, TEST_WEBHOOK_ID))
        .reason,
    ).toBe("CERT_UNTRUSTED");
  });

  it("refuses non-paypal.com hosts in its own configuration", () => {
    expect(() => verifier({ certHosts: ["certs.example.com"] })).toThrow(/paypal\.com/);
  });
});

describe("verifyPayPal: certificate fetching and caching", () => {
  it("fetches a certificate once and serves it from the cache afterwards", async () => {
    const v = verifier();
    for (let i = 0; i < 5; i++) {
      const s = signed();
      expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    }
    expect(certFetches).toBe(1);
    expect(v.cachedCerts()).toBe(1);
  });

  it("single-flights concurrent first fetches of the same certificate", async () => {
    const v = verifier();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => {
        const s = signed();
        return v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID);
      }),
    );
    expect(results.every((r) => r === "self")).toBe(true);
    expect(certFetches).toBe(1);
  });

  it("shares a cert cache between verifiers when one is injected", async () => {
    const cache = createMemoryCertCache();
    const s = signed();
    await verifier({ certCache: cache }).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID);
    await verifier({ certCache: cache }).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(certFetches).toBe(1);
  });

  it("reports a failed fetch and does not retry that URL for a minute", async () => {
    let now = Date.now();
    const v = verifier({ now: () => now });
    const s = signed({ certUrl: certUrl("CERT-missing") });
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "CERT_FETCH_FAILED",
      detail: "HTTP 404",
    });
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).detail).toBe("recently failed");
    expect(certFetches).toBe(1);
    now += 61_000;
    await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(certFetches).toBe(2);
  });

  it("refuses redirects from the certificate host", async () => {
    server.use(
      http.get(
        certUrl("CERT-redirect"),
        () =>
          new HttpResponse(null, { status: 302, headers: { location: "https://evil.example.com/cert.pem" } }),
      ),
    );
    const s = signed({ certUrl: certUrl("CERT-redirect") });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_FETCH_FAILED",
    );
  });

  it("rejects an oversized or unparseable certificate response", async () => {
    const s1 = signed({ certUrl: serve("CERT-junk", "hello") });
    expect((await verifier().verifyDetailed(s1.body, s1.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_PARSE_FAILED",
    );
    const s2 = signed({ certUrl: serve("CERT-huge", "x".repeat(70_000)) });
    expect(await verifier().verifyDetailed(s2.body, s2.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "CERT_FETCH_FAILED",
      detail: "too large",
    });
  });

  it("bounds how many unknown cert URLs forged requests can make us fetch; cached certs are unaffected", async () => {
    const v = verifier({ newCertFetchesPerMinute: 3 });
    const good = signed();
    expect(await v.verifyPayPal(good.body, good.headers, TEST_WEBHOOK_ID)).toBe("self");
    const reasons: (string | null)[] = [];
    for (let i = 0; i < 5; i++) {
      const s = signed({ certUrl: certUrl(`CERT-flood-${i}`) });
      reasons.push((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason);
    }
    expect(certFetches).toBe(3);
    expect(reasons).toEqual([
      "CERT_FETCH_FAILED",
      "CERT_FETCH_FAILED",
      "CERT_FETCH_THROTTLED",
      "CERT_FETCH_THROTTLED",
      "CERT_FETCH_THROTTLED",
    ]);
    const again = signed();
    expect(await v.verifyPayPal(again.body, again.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect(certFetches).toBe(3);
  });
});

describe("verifyPayPal: simulator events and postback", () => {
  const simulated = () => signed({ webhookId: MOCK_WEBHOOK_ID });

  it("inv.i8.labels: a simulator event is labelled 'dev_mock' when dev mocks are on, never 'self'", async () => {
    const s = simulated();
    expect(await verifier({ devMocks: true }).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe(
      "dev_mock",
    );
  });

  it("inv.i8.labels: a simulator event is rejected when dev mocks are off (fs-judge)", async () => {
    const s = simulated();
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "SIGNATURE_MISMATCH",
    );
    expect(await verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe(false);
  });

  it("never treats a configured webhook id of 'WEBHOOK_ID' as a real one", async () => {
    const s = simulated();
    expect((await verifier().verifyDetailed(s.body, s.headers, MOCK_WEBHOOK_ID)).reason).toBe(
      "WEBHOOK_ID_IS_MOCK_LITERAL",
    );
    expect(await verifier({ devMocks: true }).verifyPayPal(s.body, s.headers, MOCK_WEBHOOK_ID)).toBe(
      "dev_mock",
    );
  });

  it("upgrades to 'postback' when PayPal confirms, and passes the raw event through unchanged", async () => {
    const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
    const s = signed();
    const outcome = await verifier({ postback }).verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID, {
      postback: true,
    });
    expect(outcome).toMatchObject({ mode: "postback", postback: "SUCCESS" });
    expect(postback).toHaveBeenCalledTimes(1);
    expect(postback.mock.calls[0]?.[0]).toMatchObject({
      rawEvent: s.body,
      webhookId: TEST_WEBHOOK_ID,
      certUrl: TEST_CERT_URL,
      authAlgo: "SHA256withRSA",
      transmissionId: s.headers["paypal-transmission-id"],
    });
  });

  it("stays 'self' when the postback says FAILURE or errors", async () => {
    const s = signed();
    for (const answer of ["FAILURE", "ERROR"] as const) {
      const outcome = await verifier({ postback: async () => answer }).verifyDetailed(
        s.body,
        s.headers,
        TEST_WEBHOOK_ID,
        {
          postback: true,
        },
      );
      expect(outcome).toMatchObject({ mode: "self", postback: answer });
    }
    const throwing = await verifier({
      postback: async () => {
        throw new Error("boom");
      },
    }).verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID, { postback: true });
    expect(throwing).toMatchObject({ mode: "self", postback: "ERROR" });
  });

  it("never spends a postback call on a delivery that failed self-verification, or on a simulator event", async () => {
    const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
    const v = verifier({ postback, devMocks: true });
    const s = signed();
    await v.verifyDetailed(`${s.body} `, s.headers, TEST_WEBHOOK_ID, { postback: true });
    const sim = simulated();
    const outcome = await v.verifyDetailed(sim.body, sim.headers, TEST_WEBHOOK_ID, { postback: true });
    expect(outcome).toMatchObject({ mode: "dev_mock", postback: "SKIPPED" });
    expect(postback).not.toHaveBeenCalled();
  });

  it("reports SKIPPED when a postback is requested but none is configured", async () => {
    const s = signed();
    expect(
      await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID, { postback: true }),
    ).toMatchObject({
      mode: "self",
      postback: "SKIPPED",
    });
  });
});
