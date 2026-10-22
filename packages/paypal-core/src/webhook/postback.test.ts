import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { createPayPalAuth } from "../auth.js";
import { createPayPalHttp } from "../http.js";
import { unlimitedLimiter } from "../limiter.js";
import {
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "../test-support.js";
import { buildPostbackBody, createPostbackVerifier } from "./postback.js";
import type { PostbackInput } from "./verify.js";

useMswServer();

// Deliberately odd spacing and key order: PayPal needs the event exactly as received.
const RAW = '{"id":"WH-1",  "event_type":"INVOICING.INVOICE.PAID","resource":{"z":1,"a":"\\u00e9"}}';
const input: PostbackInput = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
  transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  transmissionSig: "c2lnbmF0dXJl",
  transmissionTime: "2026-10-29T09:12:44Z",
  webhookId: "8PT597110X687430LKGECATA",
  rawEvent: RAW,
};

describe("buildPostbackBody", () => {
  it("splices the raw event in unchanged after webhook_event", () => {
    const body = buildPostbackBody(input);
    expect(body.endsWith(`"webhook_event":${RAW}}`)).toBe(true);
    expect(JSON.parse(body)).toEqual({
      auth_algo: "SHA256withRSA",
      cert_url: input.certUrl,
      transmission_id: input.transmissionId,
      transmission_sig: input.transmissionSig,
      transmission_time: input.transmissionTime,
      webhook_id: input.webhookId,
      webhook_event: JSON.parse(RAW),
    });
  });

  it("refuses a raw event that is not a JSON object", () => {
    expect(() => buildPostbackBody({ ...input, rawEvent: "[1]" })).toThrow(TypeError);
    expect(() => buildPostbackBody({ ...input, rawEvent: '{"a":1}, "x": 2' })).toThrow();
  });
});

describe("createPostbackVerifier", () => {
  const client = () => {
    server.use(oauthHandler().handler);
    const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
    return createPayPalHttp({ auth, limiter: unlimitedLimiter, sleep: recordingSleep().sleep });
  };

  it("POSTs the spliced body and maps SUCCESS / FAILURE", async () => {
    const bodies: string[] = [];
    let answer = "SUCCESS";
    server.use(
      http.post(`${SANDBOX}/v1/notifications/verify-webhook-signature`, async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ verification_status: answer });
      }),
    );
    const postback = createPostbackVerifier(client());
    expect(await postback(input)).toBe("SUCCESS");
    answer = "FAILURE";
    expect(await postback(input)).toBe("FAILURE");
    expect(bodies[0]).toBe(buildPostbackBody(input));
  });

  it("returns ERROR for HTTP failures, odd answers and unusable input", async () => {
    server.use(
      http.post(`${SANDBOX}/v1/notifications/verify-webhook-signature`, () =>
        HttpResponse.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 500 }),
      ),
    );
    const postback = createPostbackVerifier(client());
    expect(await postback(input)).toBe("ERROR");
    server.use(
      http.post(`${SANDBOX}/v1/notifications/verify-webhook-signature`, () =>
        HttpResponse.json({ verification_status: "MAYBE" }),
      ),
    );
    expect(await postback(input)).toBe("ERROR");
    expect(await postback({ ...input, rawEvent: "not json" })).toBe("ERROR");
  });
});
