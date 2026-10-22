import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLimiter, type LimiterRequest, type PayPalLimiter } from "../limiter.js";
import type { PayPalCallRecord } from "../recorder.js";
import { server, useMswServer } from "../test-support.js";
import {
  createCertificate,
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_SUBJECT,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
  testCertUrl,
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

const serve = (label: string, pem: string) => {
  const url = testCertUrl(label);
  certs.set(url, pem);
  return url;
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
        ? new HttpResponse(pem, {
            headers: { "content-type": "application/x-pem-file", "paypal-debug-id": "dbg-cert" },
          })
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
      certWarning: null,
    });
    expect(outcome.transmissionId).toBe(s.headers["paypal-transmission-id"]);
  });

  it("accepts the raw body as string, Buffer, Uint8Array or ArrayBuffer alike", async () => {
    const v = verifier();
    const forms = [
      (body: string) => body,
      (body: string) => Buffer.from(body, "utf8"),
      (body: string) => new Uint8Array(Buffer.from(body, "utf8")),
      (body: string) => {
        const bytes = Buffer.from(body, "utf8");
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    ];
    for (const form of forms) {
      const s = signed(); // a new transmission each time: a transmission id is accepted once
      expect(await v.verifyPayPal(form(s.body), s.headers, TEST_WEBHOOK_ID)).toBe("self");
    }
  });

  it("reads headers case-insensitively from Headers and plain objects (Node style, arrays joined)", async () => {
    const v = verifier();
    const s = signed();
    const upper = Object.fromEntries(Object.entries(s.headers).map(([k, v]) => [k.toUpperCase(), v]));
    expect(await v.verifyPayPal(s.body, upper, TEST_WEBHOOK_ID)).toBe("self");
    const s2 = signed();
    expect(await v.verifyPayPal(s2.body, new Headers(s2.headers), TEST_WEBHOOK_ID)).toBe("self");
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

  it.each([
    ["paypal-transmission-id", (id: string) => `${id}0`],
    // Still well-formed and fresh, one second later: only the signature can tell.
    ["paypal-transmission-time", (time: string) => new Date(Date.parse(time) + 1_000).toISOString()],
  ] as const)("rejects a changed %s", async (header, change) => {
    const s = signed();
    const outcome = await verifier().verifyDetailed(
      s.body,
      { ...s.headers, [header]: change(s.headers[header] ?? "") },
      TEST_WEBHOOK_ID,
    );
    expect(outcome.reason).toBe("SIGNATURE_MISMATCH");
  });

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
    ["https://evil.example.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596", "HOST_NOT_PAYPAL"],
    [
      "https://api.sandbox.paypal.com.evil.example.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
      "HOST_NOT_PAYPAL",
    ],
    ["https://api.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596", "HOST_NOT_ALLOWED"],
    [
      "https://www.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
      "HOST_NOT_ALLOWED",
    ],
    ["http://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596", "NOT_HTTPS"],
    ["https://api.sandbox.paypal.com/v1/oauth2/token", "BAD_PATH"],
    ["https://api.sandbox.paypal.com/v1/notifications/certs/CERT-forged-random-123", "BAD_PATH"],
  ])("refuses cert URL %s (%s) without fetching it", async (url, why) => {
    const s = signed({ certUrl: url });
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED", detail: why });
    expect(certFetches).toBe(0);
  });

  it("re-checks validity on every use, so a cached certificate expires on time", async () => {
    let now = Date.now();
    const shortLived = pki.issueLeaf({ notBefore: new Date(now - DAY), notAfter: new Date(now + 60_000) });
    const url = serve("short", shortLived.pem);
    const v = verifier({ now: () => now });
    const s = signed({ privateKey: shortLived.privateKey, certUrl: url });
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    now += 120_000;
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("CERT_EXPIRED");
    expect(certFetches).toBe(1);
  });

  it("rejects a certificate that is not valid yet", async () => {
    const early = pki.issueLeaf({
      notBefore: new Date(Date.now() + DAY),
      notAfter: new Date(Date.now() + 30 * DAY),
    });
    const s = signed({ privateKey: early.privateKey, certUrl: serve("early", early.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_NOT_YET_VALID",
    );
  });

  it("rejects a certificate for another subject host, even an expired one", async () => {
    const wrong = pki.issueLeaf({ commonName: "evil.example.com", dnsNames: ["evil.example.com"] });
    const s = signed({ privateKey: wrong.privateKey, certUrl: serve("wrong-host", wrong.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_SUBJECT_MISMATCH",
    );
    const old = pki.issueLeaf({
      commonName: "evil.example.com",
      dnsNames: ["evil.example.com"],
      notBefore: new Date(Date.now() - 400 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    const s2 = signed({ privateKey: old.privateKey, certUrl: serve("wrong-host-old", old.pem) });
    const outcome = await verifier({ expiredCertPolicy: "accept" }).verifyDetailed(
      s2.body,
      s2.headers,
      TEST_WEBHOOK_ID,
    );
    expect(outcome.reason).toBe("CERT_SUBJECT_MISMATCH");
  });

  it("rejects a live-PayPal subject in the sandbox", async () => {
    const live = pki.issueLeaf({
      commonName: "messageverificationcerts.paypal.com",
      dnsNames: ["messageverificationcerts.paypal.com"],
    });
    const s = signed({ privateKey: live.privateKey, certUrl: serve("live-subject", live.pem) });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_SUBJECT_MISMATCH",
    );
  });

  it("rejects a CA certificate and a key under 2048 bits", async () => {
    const asCa = signed({ privateKey: pki.ca.privateKey, certUrl: serve("ca", pki.ca.pem) });
    expect((await verifier().verifyDetailed(asCa.body, asCa.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_IS_CA",
    );
    const weak = pki.issueLeaf({ keyBits: 1024 });
    const s = signed({ privateKey: weak.privateKey, certUrl: serve("weak", weak.pem) });
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome.reason).toBe("CERT_KEY_UNSUPPORTED");
  });

  it("with trust anchors, accepts a leaf issued by the test CA and refuses a self-signed look-alike", async () => {
    const v = verifier({ trustAnchors: [pki.ca.pem] });
    const good = signed();
    expect(await v.verifyPayPal(good.body, good.headers, TEST_WEBHOOK_ID)).toBe("self");

    const lookAlike = createCertificate({ commonName: TEST_CERT_SUBJECT, dnsNames: [TEST_CERT_SUBJECT] });
    const forged = signed({ privateKey: lookAlike.privateKey, certUrl: serve("forged", lookAlike.pem) });
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
    const url = serve("chain", `${issued.pem}${intermediate.pem}`);
    const s = signed({ privateKey: issued.privateKey, certUrl: url });
    expect(
      await verifier({ trustAnchors: [pki.ca.pem] }).verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID),
    ).toBe("self");
    const leafOnly = serve("chain-leaf-only", issued.pem);
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
    const s = signed({ certUrl: testCertUrl("missing") });
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
        testCertUrl("redirect"),
        () =>
          new HttpResponse(null, { status: 302, headers: { location: "https://evil.example.com/cert.pem" } }),
      ),
    );
    const s = signed({ certUrl: testCertUrl("redirect") });
    expect((await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_FETCH_FAILED",
    );
  });

  it("rejects an oversized or unparseable certificate response", async () => {
    const s1 = signed({ certUrl: serve("junk", "hello") });
    expect((await verifier().verifyDetailed(s1.body, s1.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_PARSE_FAILED",
    );
    const s2 = signed({ certUrl: serve("huge", "x".repeat(70_000)) });
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
      const s = signed({ certUrl: testCertUrl(`flood-${i}`) });
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

describe("verifyPayPal: certificate fetches are PayPal calls (limiter, recorder, circuit)", () => {
  it("takes a background limiter token and writes a paypal_calls record for each fetch", async () => {
    const takes: LimiterRequest[] = [];
    const records: PayPalCallRecord[] = [];
    const limiter: PayPalLimiter = {
      take: async (req) => {
        takes.push(req);
        return { ok: true, ticket: "ticket-7" };
      },
    };
    const v = verifier({ limiter, recorder: { record: (r) => void records.push(r) } });
    for (let i = 0; i < 2; i++) {
      const s = signed();
      expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    }
    expect(takes).toEqual([{ purpose: "webhooks.cert", priority: "background" }]);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      purpose: "webhooks.cert",
      priority: "background",
      method: "GET",
      path: new URL(TEST_CERT_URL).pathname,
      status: 200,
      outcome: "ok",
      debugId: "dbg-cert",
      requestId: null,
      attempt: 1,
      ticket: "ticket-7",
    });
  });

  it("does not fetch when the limiter says no, and does not block the URL afterwards", async () => {
    let allow = false;
    const limiter: PayPalLimiter = {
      take: async () => (allow ? { ok: true } : { ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: 1_000 }),
    };
    const v = verifier({ limiter });
    const s = signed();
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "CERT_FETCH_THROTTLED",
      detail: "limiter CIRCUIT_OPEN",
    });
    expect(certFetches).toBe(0);
    allow = true;
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
  });

  it("opens the shared 6-minute circuit when PayPal answers a certificate fetch with 429", async () => {
    const t = Date.parse("2026-10-29T09:00:00Z");
    const limiter = createMemoryLimiter({ now: () => t });
    const records: PayPalCallRecord[] = [];
    server.use(
      http.get(TEST_CERT_URL, () =>
        HttpResponse.json(
          { name: "RATE_LIMIT_REACHED" },
          { status: 429, headers: { "paypal-debug-id": "dbg-429" } },
        ),
      ),
    );
    const v = verifier({ limiter, now: () => t, recorder: { record: (r) => void records.push(r) } });
    const s = signed({ transmissionTime: new Date(t).toISOString() });
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "CERT_FETCH_FAILED",
      detail: "HTTP 429",
      retryable: true,
    });
    expect(records[0]).toMatchObject({ status: 429, outcome: "http_error", debugId: "dbg-429" });
    expect(limiter.snapshot().circuitOpenUntil).toBe(t + 6 * 60_000);
    expect(await limiter.take({ purpose: "payouts.get", priority: "live" })).toMatchObject({
      ok: false,
      reason: "CIRCUIT_OPEN",
    });
  });
});

describe("verifyPayPal: a reserved fetch slot for certificate URLs PayPal really signs with", () => {
  it("forged URLs use up the budget, yet a URL that signed a verified delivery is still fetched", async () => {
    let t = Date.parse("2026-10-29T09:00:00Z");
    const now = () => t;
    const v = verifier({
      now,
      certCache: createMemoryCertCache({ now, ttlMs: 60_000 }),
      newCertFetchesPerMinute: 2,
    });
    const at = () => ({ transmissionTime: new Date(t).toISOString() });
    const genuine = signed(at());
    expect(await v.verifyPayPal(genuine.body, genuine.headers, TEST_WEBHOOK_ID)).toBe("self");
    t += 61_000; // the cached certificate expires from the cache; the budget is full again

    const forged = [0, 1, 2].map((i) => signed({ ...at(), certUrl: testCertUrl(`random-${i}`) }));
    const reasons = [];
    for (const f of forged) reasons.push((await v.verifyDetailed(f.body, f.headers, TEST_WEBHOOK_ID)).reason);
    expect(reasons).toEqual(["CERT_FETCH_FAILED", "CERT_FETCH_FAILED", "CERT_FETCH_THROTTLED"]);
    const unknown = signed({ ...at(), certUrl: serve("new-but-unknown", leaf.pem) });
    expect((await v.verifyDetailed(unknown.body, unknown.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_FETCH_THROTTLED",
    );

    const again = signed(at());
    expect(await v.verifyDetailed(again.body, again.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      certSource: "network",
    });
    expect(certFetches).toBe(4);
  });
});

describe("verifier.prewarm", () => {
  it("fetches certificates of stored verified events, so the first delivery after boot needs no fetch", async () => {
    const v = verifier();
    const results = await v.prewarm([
      TEST_CERT_URL,
      TEST_CERT_URL,
      "https://evil.example.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
    ]);
    expect(results).toEqual([
      {
        certUrl: TEST_CERT_URL,
        ok: true,
        source: "network",
        reason: null,
        detail: null,
        validTo: leaf.cert.validToDate.toISOString(),
      },
      {
        certUrl: "https://evil.example.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
        ok: false,
        source: null,
        reason: "CERT_URL_REJECTED",
        detail: "HOST_NOT_PAYPAL",
        validTo: null,
      },
    ]);
    const s = signed();
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      certSource: "cache",
    });
    expect(certFetches).toBe(1);
  });

  it("gives pre-warmed URLs the reserved slot when forged traffic has used the budget", async () => {
    const v = verifier({ newCertFetchesPerMinute: 1 });
    const forged = signed({ certUrl: testCertUrl("forged-first") });
    expect((await v.verifyDetailed(forged.body, forged.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "CERT_FETCH_FAILED",
    );
    const [result] = await v.prewarm([TEST_CERT_URL]);
    expect(result).toMatchObject({ ok: true, source: "network" });
  });
});

describe("verifyPayPal: deliveries signed with an expired PayPal certificate", () => {
  const expiredLeaf = pki.issueLeaf({
    notBefore: new Date(Date.now() - 400 * DAY),
    notAfter: new Date(Date.now() - DAY),
  });
  const expiredDelivery = () =>
    signed({ privateKey: expiredLeaf.privateKey, certUrl: serve("expired", expiredLeaf.pem) });

  it("policy reject: CERT_EXPIRED once the signature has checked out", async () => {
    const s = expiredDelivery();
    expect(
      await verifier({ expiredCertPolicy: "reject" }).verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID),
    ).toMatchObject({
      mode: false,
      reason: "CERT_EXPIRED",
      detail: expect.stringContaining("signature valid"),
    });
  });

  it("a bad signature under an expired certificate is SIGNATURE_MISMATCH and does not degrade health", async () => {
    const other = pki.issueLeaf();
    const s = signed({ privateKey: other.privateKey, certUrl: serve("expired", expiredLeaf.pem) });
    const v = verifier({ expiredCertPolicy: "accept" });
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("SIGNATURE_MISMATCH");
    expect(v.health()).toMatchObject({ status: "ok", signedWithExpiredCert: 0 });
  });

  it("policy accept: 'self' with CERT_EXPIRED_ACCEPTED, logged, and health() turns degraded", async () => {
    const warn = vi.fn();
    const v = verifier({ expiredCertPolicy: "accept", logger: { warn } });
    const s = expiredDelivery();
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      reason: null,
      certWarning: "CERT_EXPIRED_ACCEPTED",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        expiredCertPolicy: "accept",
        validTo: expiredLeaf.cert.validToDate.toISOString(),
      }),
      "paypal webhook signed with an expired certificate",
    );
    const health = v.health();
    expect(health).toMatchObject({
      status: "degraded",
      signedWithExpiredCert: 1,
      acceptedWithExpiredCert: 1,
      expiredCertPolicy: "accept",
    });
    expect(health.problems.join(" ")).toMatch(/signed with an expired certificate/);
    expect(health.problems.join(" ")).toMatch(/signing certificate expired on/);
  });

  it("policy postback (default): PayPal confirms once per certificate; later deliveries pass as 'self'", async () => {
    const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
    const v = verifier({ postback });
    const first = expiredDelivery();
    expect(await v.verifyDetailed(first.body, first.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "postback",
      postback: "SUCCESS",
      certWarning: "CERT_EXPIRED_CONFIRMED",
    });
    expect(postback.mock.calls[0]?.[0]).toMatchObject({ rawEvent: first.body, webhookId: TEST_WEBHOOK_ID });
    const second = expiredDelivery();
    expect(await v.verifyDetailed(second.body, second.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      postback: null,
      certWarning: "CERT_EXPIRED_CONFIRMED",
    });
    expect(postback).toHaveBeenCalledTimes(1);
    expect(v.health()).toMatchObject({
      status: "degraded",
      signedWithExpiredCert: 2,
      acceptedWithExpiredCert: 2,
    });
  });

  it("policy postback: no confirmation is a 400 (PayPal retries), and PayPal is asked again only after 10 min", async () => {
    let t = Date.now();
    const postback = vi.fn<PostbackFn>(async () => "FAILURE");
    const v = verifier({ postback, now: () => t });
    const s = expiredDelivery();
    expect(await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: false,
      reason: "CERT_EXPIRED",
      postback: "FAILURE",
    });
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).detail).toMatch(/asked recently/);
    expect(postback).toHaveBeenCalledTimes(1);
    t += 11 * 60_000;
    // PayPal's retry 11 minutes on is a fresh transmission (the first one is now outside the 5-minute window).
    const retry = signed({
      privateKey: expiredLeaf.privateKey,
      certUrl: testCertUrl("expired"),
      transmissionTime: new Date(t).toISOString(),
    });
    await v.verifyDetailed(retry.body, retry.headers, TEST_WEBHOOK_ID);
    expect(postback).toHaveBeenCalledTimes(2);
  });

  it("policy postback: a concurrent burst shares one confirmation instead of 400-ing while it runs", async () => {
    let release: (answer: "SUCCESS") => void = () => undefined;
    const postback = vi.fn<PostbackFn>(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const v = verifier({ postback });
    const burst = [expiredDelivery(), expiredDelivery(), expiredDelivery()].map((s) =>
      v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID),
    );
    await vi.waitFor(() => expect(postback).toHaveBeenCalledTimes(1));
    release("SUCCESS");
    const outcomes = await Promise.all(burst);
    expect(outcomes.map((o) => [o.mode, o.certWarning])).toEqual([
      ["postback", "CERT_EXPIRED_CONFIRMED"],
      ["self", "CERT_EXPIRED_CONFIRMED"],
      ["self", "CERT_EXPIRED_CONFIRMED"],
    ]);
    expect(postback).toHaveBeenCalledTimes(1);
  });

  it("policy postback without a postback function fails closed", async () => {
    const s = expiredDelivery();
    expect(await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      reason: "CERT_EXPIRED",
      detail: expect.stringContaining("no postback configured"),
    });
    expect(await verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe(false);
  });

  it("a hanging confirmation cannot hold the delivery past the postback deadline", async () => {
    let signal: AbortSignal | undefined;
    const postback: PostbackFn = (_input, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    };
    const v = verifier({ postback, postbackDeadlineMs: 50 });
    const s = expiredDelivery();
    const started = performance.now();
    const outcome = await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_EXPIRED", postback: "TIMEOUT" });
    expect(signal?.aborted).toBe(true);
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
        { postback: true },
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

  it("returns within the deadline when the postback hangs, aborting it, and stays 'self'", async () => {
    let signal: AbortSignal | undefined;
    const postback = vi.fn<PostbackFn>((_input, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    });
    const s = signed();
    const started = performance.now();
    const outcome = await verifier({ postback, postbackDeadlineMs: 50 }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
      { postback: true },
    );
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(outcome).toMatchObject({ mode: "self", postback: "TIMEOUT" });
    expect(postback).toHaveBeenCalledTimes(1);
    expect(signal?.aborted).toBe(true);
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

describe("verifier.health (for /readyz and /ops)", () => {
  it("is ok and empty before any traffic", () => {
    expect(verifier().health()).toMatchObject({
      status: "ok",
      problems: [],
      verified: 0,
      rejected: {},
      signedWithExpiredCert: 0,
      signingCert: null,
      expiredCertPolicy: "postback",
    });
  });

  it("counts accepted and rejected deliveries by reason inside the window, then forgets them", async () => {
    let t = Date.now();
    const v = verifier({ now: () => t });
    const good = signed();
    await v.verifyDetailed(good.body, good.headers, TEST_WEBHOOK_ID);
    await v.verifyDetailed(`${good.body} `, good.headers, TEST_WEBHOOK_ID);
    await v.verifyDetailed(good.body, {}, TEST_WEBHOOK_ID);
    expect(v.health()).toMatchObject({
      status: "ok",
      verified: 1,
      rejected: { SIGNATURE_MISMATCH: 1, MISSING_HEADER: 1 },
      signingCert: { certUrl: TEST_CERT_URL, validTo: leaf.cert.validToDate.toISOString() },
    });
    t += 16 * 60_000;
    expect(v.health()).toMatchObject({ verified: 0, rejected: {} });
  });

  it("turns degraded when PayPal's signing certificate is about to expire", async () => {
    const soon = pki.issueLeaf({
      notBefore: new Date(Date.now() - DAY),
      notAfter: new Date(Date.now() + 10 * DAY),
    });
    const s = signed({ privateKey: soon.privateKey, certUrl: serve("expiring-soon", soon.pem) });
    const v = verifier();
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    const health = v.health();
    expect(health.status).toBe("degraded");
    expect(health.signingCert?.daysLeft).toBeGreaterThanOrEqual(9);
    expect(health.problems[0]).toMatch(/signing certificate expires in \d+ days/);
  });

  it("reports a certificate URL that signed earlier deliveries but can no longer be fetched", async () => {
    let t = Date.now();
    const now = () => t;
    const v = verifier({ now, certCache: createMemoryCertCache({ now, ttlMs: 60_000 }) });
    const s = signed();
    expect(await v.verifyPayPal(s.body, s.headers, TEST_WEBHOOK_ID)).toBe("self");
    t += 61_000;
    certs.delete(TEST_CERT_URL);
    expect((await v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID)).reason).toBe("CERT_FETCH_FAILED");
    const health = v.health();
    expect(health.status).toBe("degraded");
    expect(health.problems).toContain(
      `could not fetch ${TEST_CERT_URL}, which signed earlier deliveries: CERT_FETCH_FAILED (HTTP 404)`,
    );
  });
});
