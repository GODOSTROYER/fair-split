// Finding 2 (security review, MEDIUM): unauthenticated requests must not be able to spend the
// certificate-fetch budget a genuine delivery needs. A per-IP budget comes before the global one; the
// global budget reserves room for PayPal's own cert ids and for certificates that already signed a
// verified delivery; those stay cached; a throttled delivery is retryable (the route answers 503).

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { LimiterRequest, PayPalLimiter } from "../limiter.js";
import { createTestPki, signWebhook, syntheticEvent, TEST_WEBHOOK_ID } from "../testing/index.js";
import type { FetchLike } from "../types.js";
import { createMemoryCertCache } from "./certs.js";
import {
  createPayPalWebhookVerifier,
  DEFAULT_CERT_FETCH_BUDGET,
  PAYPAL_CERT_ID_PATTERN,
  type PostbackFn,
  type VerifyOutcome,
  type WebhookVerifierConfig,
} from "./verify.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const pki = createTestPki();
const leaf = pki.issueLeaf();
/** Forgers do not hold PayPal's key. */
const forgerKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

const certUrl = (id: string) => `https://api.sandbox.paypal.com/v1/notifications/certs/${id}`;
const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
/** Shaped like PayPal's own ids (CERT-360caa42-…), which every real PayPal cert id has carried since 2015. */
const paypalShaped = (n: number) => certUrl(`CERT-360caa42-fca2a594-${hex8(n)}`);
/** Well-formed, but not one of PayPal's (passes the structural URL check, gets no reserved budget). */
const otherShaped = (n: number) => certUrl(`CERT-00000000-${hex8(n)}-00000000`);
/** The certificate PayPal really signs with in these tests (served with the test leaf). */
const GENUINE = paypalShaped(0xbf9ab596);

const event = syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {
  payout_item_id: "5KX",
  transaction_status: "SUCCESS",
});

/** A PayPal cert endpoint: serves the PEMs it knows, 404 otherwise. Counts every request it sees. */
function certHost(pems: Record<string, string> = { [GENUINE]: leaf.pem }) {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const pem = pems[url];
    return pem
      ? new Response(pem, { headers: { "content-type": "application/x-pem-file" } })
      : Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
  };
  return { fetch, calls, pems };
}

const genuine = (at: number) =>
  signWebhook({
    body: event,
    webhookId: TEST_WEBHOOK_ID,
    privateKey: leaf.privateKey,
    certUrl: GENUINE,
    transmissionTime: new Date(at).toISOString(),
  });
/** One forger signature (RSA signing is the slow part); each forged delivery gets fresh headers around it. */
const forgedBase = signWebhook({ body: event, webhookId: TEST_WEBHOOK_ID, privateKey: forgerKey });
const forged = (url: string, at: number): ReturnType<typeof genuine> => ({
  ...forgedBase,
  headers: {
    ...forgedBase.headers,
    "paypal-cert-url": url,
    "paypal-transmission-id": randomUUID(),
    "paypal-transmission-time": new Date(at).toISOString(),
  },
});

function setup(config: WebhookVerifierConfig = {}, pems?: Record<string, string>) {
  let t = Date.now();
  const host = certHost(pems);
  const takes: LimiterRequest[] = [];
  const limiter: PayPalLimiter = {
    take: async (req) => {
      takes.push(req);
      return { ok: true };
    },
  };
  const postback = vi.fn<PostbackFn>(async () => "SUCCESS");
  const v = createPayPalWebhookVerifier({
    fetch: host.fetch,
    limiter,
    postback,
    now: () => t,
    ...config,
  });
  const verify = (s: ReturnType<typeof genuine>, clientIp: string | null) =>
    v.verifyDetailed(s.body, s.headers, TEST_WEBHOOK_ID, { clientIp });
  return {
    v,
    verify,
    host,
    takes,
    postback,
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("certificate fetch budget: defaults", () => {
  it("allow at most 3 fetches an hour for certificates nobody has verified yet (S3.6.7)", () => {
    expect(DEFAULT_CERT_FETCH_BUDGET.expectedPerHour + DEFAULT_CERT_FETCH_BUDGET.otherPerHour).toBe(3);
    expect(DEFAULT_CERT_FETCH_BUDGET.perIpPerHour).toBeLessThanOrEqual(3);
    expect(PAYPAL_CERT_ID_PATTERN.test("CERT-360caa42-fca2a594-bf9ab596")).toBe(true);
    expect(PAYPAL_CERT_ID_PATTERN.test("CERT-360caa42-fca2a784-5edc0ebc")).toBe(true);
    expect(PAYPAL_CERT_ID_PATTERN.test("CERT-00000000-00000000-00000001")).toBe(false);
  });
});

describe("1,000 forged deliveries", () => {
  it.each([
    ["from 1,000 addresses", (i: number) => `198.51.${(i >> 8) & 255}.${i & 255}`],
    ["from one address", () => "203.0.113.66"],
    ["with no address at all", () => null],
  ])("%s: at most 3 certificate fetches, no other PayPal call, every one refused", async (_label, ipOf) => {
    const { verify, host, takes, postback, now } = setup();
    const outcomes: VerifyOutcome[] = [];
    for (let i = 0; i < 1_000; i++) {
      // A third point at random PayPal-shaped ids, a third at other well-formed ids, a third at the
      // genuine certificate URL (with a signature PayPal never made).
      const url = i % 3 === 0 ? paypalShaped(i) : i % 3 === 1 ? otherShaped(i) : GENUINE;
      outcomes.push(await verify(forged(url, now()), ipOf(i)));
    }
    expect(host.calls.length).toBeLessThanOrEqual(3);
    expect(
      host.calls.every((u) => u.startsWith("https://api.sandbox.paypal.com/v1/notifications/certs/")),
    ).toBe(true);
    expect(takes).toHaveLength(host.calls.length);
    expect(postback).not.toHaveBeenCalled();
    expect(outcomes.every((o) => o.mode === false)).toBe(true);
    const reasons = new Set(outcomes.map((o) => o.reason));
    expect(
      [...reasons].every((r) =>
        ["SIGNATURE_MISMATCH", "CERT_FETCH_FAILED", "CERT_FETCH_THROTTLED"].includes(r ?? ""),
      ),
    ).toBe(true);
    const throttled = outcomes.filter((o) => o.reason === "CERT_FETCH_THROTTLED");
    expect(throttled.length).toBeGreaterThan(0);
    // Throttled means "could not check it now": PayPal is asked to retry (503), never told it was forged.
    expect(throttled.every((o) => o.retryable)).toBe(true);
  });

  it("after the flood, a certificate that signed a verified delivery before it still verifies without a fetch", async () => {
    const { verify, host, now } = setup();
    expect((await verify(genuine(now()), "173.0.82.126")).mode).toBe("self");
    for (let i = 0; i < 1_000; i++) {
      await verify(
        forged(i % 2 ? paypalShaped(i) : otherShaped(i), now()),
        `198.51.${(i >> 8) & 255}.${i & 255}`,
      );
    }
    expect(host.calls.length).toBeLessThanOrEqual(1 + 3);
    const fetchesBefore = host.calls.length;
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({ mode: "self", certSource: "cache" });
    expect(host.calls.length).toBe(fetchesBefore);
  });
});

describe("certificate fetch budget: per IP before global", () => {
  it("one address runs out of its own budget long before it can spend the global one", async () => {
    const { verify, host, now } = setup({
      certFetchBudget: { perIpPerHour: 1, expectedPerHour: 5, otherPerHour: 0 },
    });
    const outcomes = [];
    for (let i = 0; i < 10; i++) outcomes.push(await verify(forged(paypalShaped(i), now()), "203.0.113.9"));
    expect(host.calls).toHaveLength(1);
    expect(
      outcomes.slice(1).every((o) => o.reason === "CERT_FETCH_THROTTLED" && o.detail === "per-ip budget"),
    ).toBe(true);
    // Another address still finds the global budget untouched.
    expect((await verify(forged(paypalShaped(99), now()), "198.51.100.4")).reason).toBe("CERT_FETCH_FAILED");
    expect(host.calls).toHaveLength(2);
  });

  it("counts an IPv6 /64 as one address, and an IPv4-mapped address as its IPv4 address", async () => {
    const { verify, host, now } = setup({
      certFetchBudget: { perIpPerHour: 1, expectedPerHour: 10, otherPerHour: 0 },
    });
    expect((await verify(forged(paypalShaped(1), now()), "2001:db8:1:2::1")).reason).toBe(
      "CERT_FETCH_FAILED",
    );
    expect(await verify(forged(paypalShaped(2), now()), "2001:db8:1:2:ffff:ffff:ffff:9")).toMatchObject({
      reason: "CERT_FETCH_THROTTLED",
      detail: "per-ip budget",
    });
    expect((await verify(forged(paypalShaped(3), now()), "203.0.113.9")).reason).toBe("CERT_FETCH_FAILED");
    expect(await verify(forged(paypalShaped(4), now()), "::ffff:203.0.113.9")).toMatchObject({
      reason: "CERT_FETCH_THROTTLED",
      detail: "per-ip budget",
    });
    expect(host.calls).toHaveLength(2);
  });

  it("refills over the hour", async () => {
    const { verify, host, now, advance } = setup({
      certFetchBudget: { perIpPerHour: 2, expectedPerHour: 10, otherPerHour: 0 },
    });
    for (let i = 0; i < 4; i++) await verify(forged(paypalShaped(i), now()), "203.0.113.9");
    expect(host.calls).toHaveLength(2);
    advance(HOUR / 2);
    for (let i = 10; i < 14; i++) await verify(forged(paypalShaped(i), now()), "203.0.113.9");
    expect(host.calls).toHaveLength(3);
  });
});

describe("certificate fetch budget: global, with room reserved for PayPal's ids and known certificates", () => {
  it("a flood of other-shaped ids gets one fetch an hour, and PayPal-shaped ids keep their reserved budget", async () => {
    const { verify, host, now } = setup();
    for (let i = 0; i < 50; i++) await verify(forged(otherShaped(i), now()), `198.51.100.${i}`);
    expect(host.calls).toHaveLength(DEFAULT_CERT_FETCH_BUDGET.otherPerHour);
    // PayPal's first delivery signed with a certificate we have never seen (a rotation) still gets through.
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({
      mode: "self",
      certSource: "network",
    });
  });

  it("once the whole budget is spent, an unknown certificate is retryable, not rejected", async () => {
    const { verify, host, now, advance } = setup();
    for (let i = 0; i < 50; i++) await verify(forged(paypalShaped(i), now()), `198.51.100.${i}`);
    expect(host.calls).toHaveLength(3);
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({
      mode: false,
      reason: "CERT_FETCH_THROTTLED",
      detail: "global budget",
      retryable: true,
    });
    advance(HOUR);
    expect((await verify(genuine(now()), "173.0.82.126")).mode).toBe("self");
  });

  it("keeps a certificate that signed a verified delivery after the cache drops it, with no new fetch", async () => {
    let t = Date.now();
    const now = () => t;
    const { verify, host } = setup({ now, certCache: createMemoryCertCache({ now, ttlMs: MINUTE }) });
    expect((await verify(genuine(t), "173.0.82.126")).certSource).toBe("network");
    t += 2 * HOUR; // the cache entry is long gone
    expect(await verify(genuine(t), "173.0.82.126")).toMatchObject({ mode: "self", certSource: "cache" });
    expect(host.calls).toHaveLength(1);
  });

  it("prewarm() of a stored certificate uses the budget reserved for known certificates, whatever forged traffic did", async () => {
    const { v, verify, host, now } = setup();
    for (let i = 0; i < 100; i++) await verify(forged(paypalShaped(i), now()), `198.51.100.${i % 50}`);
    expect(host.calls).toHaveLength(3);
    const [warm] = await v.prewarm([GENUINE]);
    expect(warm).toMatchObject({ ok: true, source: "network" });
    expect(host.calls).toHaveLength(4);
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({ mode: "self", certSource: "cache" });
  });
});

describe("certificate fetch failures: retryable or not", () => {
  const failing = (respond: () => Promise<Response>): WebhookVerifierConfig => ({ fetch: respond });

  it.each([
    {
      label: "PayPal answers 503",
      retryable: true,
      respond: async () => new Response(null, { status: 503 }),
    },
    {
      label: "PayPal answers 429",
      retryable: true,
      respond: async () => new Response(null, { status: 429 }),
    },
    {
      label: "the fetch times out",
      retryable: true,
      respond: async (): Promise<Response> => {
        throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      },
    },
    {
      label: "the network fails",
      retryable: true,
      respond: async (): Promise<Response> => {
        throw new TypeError("fetch failed");
      },
    },
    {
      label: "PayPal answers 404 (no such certificate)",
      retryable: false,
      respond: async () => Response.json({}, { status: 404 }),
    },
  ])("$label: retryable $retryable", async ({ respond, retryable }) => {
    const { verify, now } = setup(failing(respond));
    const outcome = await verify(genuine(now()), "173.0.82.126");
    expect(outcome).toMatchObject({ mode: false, reason: "CERT_FETCH_FAILED", retryable });
    // The negative cache keeps the same answer for the URL while it lasts.
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({
      detail: "recently failed",
      retryable,
    });
  });

  it("a limiter that says no is retryable", async () => {
    const { verify, now } = setup({
      limiter: { take: async () => ({ ok: false, reason: "CIRCUIT_OPEN", retryAfterMs: 1_000 }) },
    });
    expect(await verify(genuine(now()), "173.0.82.126")).toMatchObject({
      reason: "CERT_FETCH_THROTTLED",
      detail: "limiter CIRCUIT_OPEN",
      retryable: true,
    });
  });
});
