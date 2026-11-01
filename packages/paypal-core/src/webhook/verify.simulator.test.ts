// The simulator branch of webhook verification (ADR-0002, ADR-0010). In PP_MODE=simulator fs-api runs the PayPal
// simulator in process; its deliveries are signed exactly like PayPal's (RSA-SHA256 over id|time|webhookId|crc32),
// but by a leaf its own CA issued, served at `{host}/paypal-sim/sim/certs/SIMCERT-….pem`, never on a PayPal host.
// The verifier accepts that shape only when it is configured with the simulator's trust (`simulator`), and then
// accepts ONLY that shape, and only a leaf that chains to the simulator's CA. Freshness and transmission-id replay
// apply unchanged. Without the option (sandbox mode) a simulator-signed delivery is refused before any fetch.
import { HttpResponse, http } from "msw/http";
import { beforeEach, describe, expect, it } from "vitest";
import { server, useMswServer } from "../test-support.js";
import {
  createCertificate,
  createTestPki,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
} from "../testing/index.js";
import { checkSimulatorCertUrl, SIMULATOR_CERT_ID_PATTERN } from "./cert-url.js";
import { createPayPalWebhookVerifier, type WebhookVerifierConfig } from "./verify.js";

useMswServer();

const SIM_HOST = "https://fs-api.example.org";
const CERT_ID = "SIMCERT-0123abcd-4567ef01-89abcdef";
const SIM_CERT_URL = `${SIM_HOST}/paypal-sim/sim/certs/${CERT_ID}.pem`;
/** As paypal-sim builds it (Simulator.certUrlPattern): the pages base, escaped, then the cert path. */
const SIM_PATTERN =
  /^https:\/\/fs-api\.example\.org\/paypal-sim\/sim\/certs\/SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}\.pem$/;

// The simulator's PKI: a CA named as paypal-sim names it, and a leaf with no PayPal subject at all.
const simPki = createTestPki({ commonName: "Fair Split PayPal Simulator Test CA (NOT PayPal)" });
const simLeaf = simPki.issueLeaf({
  commonName: "Fair Split PayPal Simulator webhook signer (NOT PayPal)",
  dnsNames: [],
});
// PayPal-shaped material (the sandbox path), to show it is refused in simulator mode.
const paypalPki = createTestPki();
const paypalLeaf = paypalPki.issueLeaf();

const served = new Map<string, string>();
let fetches = 0;

beforeEach(() => {
  served.clear();
  fetches = 0;
  served.set(SIM_CERT_URL, `${simLeaf.pem}${simPki.ca.pem}`);
  served.set(TEST_CERT_URL, paypalLeaf.pem);
  const answer = ({ request }: { request: Request }) => {
    fetches += 1;
    const pem = served.get(request.url);
    return pem
      ? new HttpResponse(pem, { headers: { "content-type": "application/x-pem-file" } })
      : HttpResponse.json({ error: "unknown certificate" }, { status: 404 });
  };
  server.use(
    http.get(`${SIM_HOST}/paypal-sim/sim/certs/:file`, answer),
    http.get("http://127.0.0.1:8787/paypal-sim/sim/certs/:file", answer),
    http.get("https://api.sandbox.paypal.com/v1/notifications/certs/:id", answer),
  );
});

const event = syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
  payout_item_id: "SIMITEM1",
  transaction_status: "SUCCESS",
});
const simSigned = (o: Partial<Parameters<typeof signWebhook>[0]> = {}) =>
  signWebhook({
    body: event,
    webhookId: TEST_WEBHOOK_ID,
    privateKey: simLeaf.privateKey,
    certUrl: SIM_CERT_URL,
    ...o,
  });
const simulatorTrust = { certUrlPattern: SIM_PATTERN, trustAnchors: [simPki.ca.pem] };
const verifier = (config: WebhookVerifierConfig = {}) => createPayPalWebhookVerifier(config);

describe("simulator cert URLs (checkSimulatorCertUrl)", () => {
  it("accepts the simulator's own cert URL and names the SIMCERT id", () => {
    const c = checkSimulatorCertUrl(SIM_CERT_URL, SIM_PATTERN);
    expect(c).toMatchObject({ ok: true, certId: CERT_ID, cacheKey: SIM_CERT_URL });
    expect(SIMULATOR_CERT_ID_PATTERN.test(CERT_ID)).toBe(true);
  });

  it.each([
    ["PayPal's own cert URL", TEST_CERT_URL, "HOST_NOT_ALLOWED"],
    [
      "another host",
      "https://evil.example.org/paypal-sim/sim/certs/SIMCERT-0123abcd-4567ef01-89abcdef.pem",
      "HOST_NOT_ALLOWED",
    ],
    ["a query string", `${SIM_CERT_URL}?x=1`, "HAS_QUERY_OR_FRAGMENT"],
    ["a fragment", `${SIM_CERT_URL}#x`, "HAS_QUERY_OR_FRAGMENT"],
    ["credentials", SIM_CERT_URL.replace("https://", "https://u:p@"), "HAS_CREDENTIALS"],
    ["plain http off loopback", SIM_CERT_URL.replace("https://", "http://"), "NOT_HTTPS"],
    ["not a URL", "not a url", "NOT_A_URL"],
  ])("refuses %s", (_label, url, reason) => {
    expect(checkSimulatorCertUrl(url, SIM_PATTERN)).toEqual({ ok: false, reason });
  });

  it("allows plain http only on loopback (local development, where the host app is http://127.0.0.1)", () => {
    const local =
      /^http:\/\/127\.0\.0\.1:8787\/paypal-sim\/sim\/certs\/SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}\.pem$/;
    const url = `http://127.0.0.1:8787/paypal-sim/sim/certs/${CERT_ID}.pem`;
    expect(checkSimulatorCertUrl(url, local)).toMatchObject({ ok: true, certId: CERT_ID });
  });
});

describe("verifyPayPal with the simulator's trust (PP_MODE=simulator)", () => {
  it("accepts a simulator-signed delivery as 'self': RSA-SHA256 over the CRC32, under the simulator's CA", async () => {
    const s = simSigned();
    const outcome = await verifier({ simulator: simulatorTrust }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(outcome).toMatchObject({ mode: "self", reason: null, crc32: s.crc32, certSource: "network" });
    expect(fetches).toBe(1);
  });

  it("refuses PayPal's own cert URL: in simulator mode only the simulator's shape is trusted", async () => {
    const s = signWebhook({ body: event, webhookId: TEST_WEBHOOK_ID, privateKey: paypalLeaf.privateKey });
    const outcome = await verifier({ simulator: simulatorTrust }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED", detail: "HOST_NOT_ALLOWED" });
    expect(fetches).toBe(0);
  });

  it("refuses a look-alike leaf at the simulator's URL that another CA issued (CERT_UNTRUSTED)", async () => {
    const lookAlike = createCertificate({
      commonName: "Fair Split PayPal Simulator webhook signer (NOT PayPal)",
    });
    served.set(SIM_CERT_URL, lookAlike.pem);
    const s = simSigned({ privateKey: lookAlike.privateKey });
    const outcome = await verifier({ simulator: simulatorTrust }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_UNTRUSTED" });
  });

  it("still refuses a tampered body, a stale transmission and a replayed transmission id", async () => {
    const v = verifier({ simulator: simulatorTrust });
    const s = simSigned();
    const tampered = s.body.replace('"SUCCESS"', '"SUCCESZ"');
    expect((await v.verifyDetailed(tampered, s.headers, TEST_WEBHOOK_ID)).reason).toBe("SIGNATURE_MISMATCH");
    const stale = simSigned({ transmissionTime: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect((await v.verifyDetailed(stale.body, stale.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "TRANSMISSION_TIME_OUT_OF_WINDOW",
    );
    const once = simSigned();
    expect(await v.verifyPayPal(once.body, once.headers, TEST_WEBHOOK_ID)).toBe("self");
    expect((await v.verifyDetailed(once.body, once.headers, TEST_WEBHOOK_ID)).reason).toBe(
      "TRANSMISSION_REPLAYED",
    );
  });

  it("refuses a simulator trust without a CA to chain to", () => {
    expect(() => verifier({ simulator: { certUrlPattern: SIM_PATTERN, trustAnchors: [] } })).toThrow(
      /trust anchor/,
    );
  });
});

describe("verifyPayPal without the simulator's trust (PP_MODE=sandbox)", () => {
  it("refuses a simulator-signed delivery before any certificate fetch", async () => {
    const s = simSigned();
    const outcome = await verifier().verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID);
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED", detail: "HOST_NOT_PAYPAL" });
    expect(fetches).toBe(0);
  });

  it("refuses it even with the simulator's CA as a plain trust anchor: the cert URL shape is PayPal's alone", async () => {
    const s = simSigned();
    const outcome = await verifier({ trustAnchors: [simPki.ca.pem] }).verifyDetailed(
      s.body,
      s.headers,
      TEST_WEBHOOK_ID,
    );
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_URL_REJECTED" });
    expect(fetches).toBe(0);
  });
});
