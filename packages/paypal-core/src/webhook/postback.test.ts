import { HttpResponse, http } from "msw/http";
import { describe, expect, it, vi } from "vitest";
import { createPayPalAuth } from "../auth.js";
import { createPayPalHttp } from "../http.js";
import { unlimitedLimiter } from "../limiter.js";
import type { PayPalCallRecord } from "../recorder.js";
import {
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "../test-support.js";
import { buildPostbackBody, createPostbackVerifier, postbackWithDeadline } from "./postback.js";
import type { PostbackFn, PostbackInput } from "./verify.js";

useMswServer();

// Deliberately odd spacing and key order: PayPal needs the event exactly as received.
const RAW = '{"id":"WH-1",  "event_type":"INVOICING.INVOICE.PAID","resource":{"z":1,"a":"\\u00e9"}}';
const input: PostbackInput = {
  authAlgo: "SHA256withRSA",
  certUrl: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596",
  transmissionId: "69cd13f0-d67a-11e5-baa3-778b53f4ae55",
  transmissionSig: "c2lnbmF0dXJl",
  transmissionTime: "2026-10-29T09:12:44Z",
  webhookId: "8PT597110X687430LKGECATA",
  rawEvent: RAW,
};
const VERIFY_URL = `${SANDBOX}/v1/notifications/verify-webhook-signature`;

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
  const client = (records: PayPalCallRecord[] = []) => {
    server.use(oauthHandler().handler);
    const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
    const sleeper = recordingSleep();
    const http = createPayPalHttp({
      auth,
      limiter: unlimitedLimiter,
      sleep: sleeper.sleep,
      recorder: { record: (r) => void records.push(r) },
    });
    return { http, delays: sleeper.delays };
  };

  it("POSTs the spliced body and maps SUCCESS / FAILURE", async () => {
    const bodies: string[] = [];
    let answer = "SUCCESS";
    server.use(
      http.post(VERIFY_URL, async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({ verification_status: answer });
      }),
    );
    const postback = createPostbackVerifier(client().http);
    expect(await postback(input)).toBe("SUCCESS");
    answer = "FAILURE";
    expect(await postback(input)).toBe("FAILURE");
    expect(bodies[0]).toBe(buildPostbackBody(input));
  });

  it("makes exactly one PayPal call on a 503: never retried, answered ERROR", async () => {
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, () => {
        calls += 1;
        return HttpResponse.json({ name: "SERVICE_UNAVAILABLE" }, { status: 503 });
      }),
    );
    const records: PayPalCallRecord[] = [];
    const { http: paypal, delays } = client(records);
    expect(await createPostbackVerifier(paypal)(input)).toBe("ERROR");
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
    expect(records.filter((r) => r.purpose === "webhooks.verify")).toEqual([
      expect.objectContaining({ status: 503, attempt: 1, priority: "live" }),
    ]);
  });

  it("gives up after its per-attempt timeout when PayPal hangs, with exactly one call", async () => {
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const started = performance.now();
    expect(await createPostbackVerifier(client().http, { timeoutMs: 100 })(input)).toBe("ERROR");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(calls).toBe(1);
  });

  it("sends nothing when the caller's deadline has already passed", async () => {
    let calls = 0;
    server.use(
      http.post(VERIFY_URL, () => {
        calls += 1;
        return HttpResponse.json({ verification_status: "SUCCESS" });
      }),
    );
    const postback = createPostbackVerifier(client().http);
    expect(await postback(input, { signal: AbortSignal.abort() })).toBe("ERROR");
    expect(calls).toBe(0);
  });

  it("returns ERROR for HTTP failures, odd answers and unusable input", async () => {
    server.use(
      http.post(VERIFY_URL, () => HttpResponse.json({ name: "INTERNAL_SERVER_ERROR" }, { status: 500 })),
    );
    const postback = createPostbackVerifier(client().http);
    expect(await postback(input)).toBe("ERROR");
    server.use(http.post(VERIFY_URL, () => HttpResponse.json({ verification_status: "MAYBE" })));
    expect(await postback(input)).toBe("ERROR");
    expect(await postback({ ...input, rawEvent: "not json" })).toBe("ERROR");
  });
});

describe("postbackWithDeadline", () => {
  it("passes PayPal's answer through", async () => {
    expect(await postbackWithDeadline(async () => "SUCCESS", input)).toBe("SUCCESS");
    expect(await postbackWithDeadline(async () => "FAILURE", input)).toBe("FAILURE");
  });

  it("answers TIMEOUT at the deadline and aborts the call in flight", async () => {
    let signal: AbortSignal | undefined;
    const hang: PostbackFn = (_input, options) => {
      signal = options?.signal;
      return new Promise(() => undefined);
    };
    const started = performance.now();
    expect(await postbackWithDeadline(hang, input, { deadlineMs: 30 })).toBe("TIMEOUT");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(signal?.aborted).toBe(true);
    expect((signal?.reason as DOMException | undefined)?.name).toBe("TimeoutError");
  });

  it("turns a thrown error into ERROR and logs it", async () => {
    const warn = vi.fn();
    const answer = await postbackWithDeadline(
      async () => {
        throw new Error("socket hang up");
      },
      input,
      { logger: { warn } },
    );
    expect(answer).toBe("ERROR");
    expect(warn).toHaveBeenCalledWith(
      { error: "socket hang up" },
      "paypal webhook postback verification failed",
    );
  });
});
