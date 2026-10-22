// Finding 2 (security review, MEDIUM) at the route: unauthenticated requests cannot spend the
// certificate-fetch budget a genuine delivery needs, a delivery that cannot be checked now is a
// retryable 503 (PayPal retries), and with every known certificate loaded, 1,000 forged deliveries cost
// at most 3 certificate fetches and no other PayPal call (plan, Verification). The general bound, with
// known ids not loaded yet, is 3 + min(unloaded known ids, knownPerHour): verify.budget.test.ts.

import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  createMemoryLimiter,
  createPayPalCore,
  createPayPalWebhookVerifier,
  type FetchLike,
  type VerifyOutcome,
} from "@fairsplit/paypal-core";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_WEBHOOK_ID,
} from "@fairsplit/paypal-core/testing";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { ProcessWebhookArgs, TaskName } from "./_shims/contracts.js";
import type { RunInTransaction } from "./_shims/persistence.js";
import {
  clientIpFromForwardedFor,
  createPayPalWebhookHandler,
  honoPayPalWebhook,
  type PayPalWebhookDeps,
  RETRY_AFTER_SECONDS,
  type WebhookEventInsert,
  type WebhookResponse,
} from "./paypal.js";

const HOUR = 3_600_000;
const pki = createTestPki();
const leaf = pki.issueLeaf();
const forgerKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const CERTS = "https://api.sandbox.paypal.com/v1/notifications/certs/";
const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
/** Synthetic, but shaped like PayPal's own cert ids (CERT-360caa42-…). */
const GENUINE_CERT = `${CERTS}CERT-360caa42-fca2a594-0000f00d`;
const ROTATED_CERT = `${CERTS}CERT-360caa42-fca2a594-0000beef`;
const PAYPAL_IP = "173.0.82.126";

function fakeDb() {
  interface Tx {
    rows: Map<string, WebhookEventInsert & { id: string }>;
    outbox: { name: TaskName; args: ProcessWebhookArgs; dedupeKey: string }[];
  }
  const committed = new Map<string, WebhookEventInsert & { id: string }>();
  const outbox: Tx["outbox"] = [];
  let nextId = 1;
  const transaction: RunInTransaction<Tx> = async (fn) => {
    const tx: Tx = { rows: new Map(), outbox: [] };
    const result = await fn(tx);
    for (const [key, row] of tx.rows) committed.set(key, row);
    outbox.push(...tx.outbox);
    return result;
  };
  const deps = {
    transaction,
    insertWebhookEvent: async (tx: Tx, row: WebhookEventInsert) => {
      if (committed.has(row.paypalEventId) || tx.rows.has(row.paypalEventId)) return null;
      const id = `row-${nextId++}`;
      tx.rows.set(row.paypalEventId, { ...row, id });
      return { id };
    },
    enqueue: async (tx: Tx, name: TaskName, args: ProcessWebhookArgs, dedupeKey: string) => {
      tx.outbox.push({ name, args, dedupeKey });
    },
  } satisfies Omit<PayPalWebhookDeps<Tx>, "verify">;
  return { committed, outbox, deps };
}

/** Every request this process sends to PayPal; certificate URLs answer from `pems`, anything else 404s. */
function paypalHost(pems: Record<string, string>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const pem = pems[url];
    return pem
      ? new Response(pem, { headers: { "content-type": "application/x-pem-file" } })
      : Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
  };
  return { fetch, calls };
}

const itemEvent = (n: number) =>
  syntheticEvent(
    "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
    payoutItemResource({
      senderItemId: `r37-M-${String(n).padStart(3, "0")}`,
      payoutItemId: `5KX${n}`,
      payoutBatchId: "CR9VS",
      transactionStatus: "SUCCESS",
    }),
    `item-${n}`,
  );

const request = (s: { body: string; headers: Record<string, string> }, clientIp: string | null) => ({
  rawBody: Buffer.from(s.body, "utf8"),
  headers: s.headers,
  clientIp,
});

describe("POST /webhooks/paypal under 1,000 forged deliveries", () => {
  it("with PayPal's certificate loaded, costs at most 3 certificate fetches and no other PayPal call; PayPal's own deliveries still land", async () => {
    let t = Date.now();
    const now = () => t;
    const host = paypalHost({ [GENUINE_CERT]: leaf.pem, [ROTATED_CERT]: leaf.pem });
    const core = createPayPalCore({
      config: {
        clientId: "fs-test-client",
        clientSecret: ["fs", "test", "secret"].join("-"),
        devMocks: false,
      },
      limiter: createMemoryLimiter({ now }),
      fetch: host.fetch,
      now,
    });
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: (raw, headers, context) =>
        core.verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID, { clientIp: context.clientIp }),
      releaseTransmission: (id) => core.verifier.releaseTransmission(id),
    });
    const genuine = (n: number, certUrl = GENUINE_CERT) =>
      signWebhook({
        body: itemEvent(n),
        webhookId: TEST_WEBHOOK_ID,
        privateKey: leaf.privateKey,
        certUrl,
        transmissionTime: new Date(t).toISOString(),
      });

    // PayPal's first delivery: one certificate fetch, stored, one task.
    const first = genuine(1);
    expect(await handler(request(first, PAYPAL_IP))).toMatchObject({ status: 200, outcome: "accepted" });
    const fetchesBeforeFlood = host.calls.length;
    expect(fetchesBeforeFlood).toBe(1);

    const forgedBase = signWebhook({
      body: itemEvent(999),
      webhookId: TEST_WEBHOOK_ID,
      privateKey: forgerKey,
    });
    const forged = (certUrl: string) => ({
      ...forgedBase,
      headers: {
        ...forgedBase.headers,
        "paypal-cert-url": certUrl,
        "paypal-transmission-id": randomUUID(),
        "paypal-transmission-time": new Date(t).toISOString(),
      },
    });
    const responses: WebhookResponse[] = [];
    for (let i = 0; i < 1_000; i++) {
      const ip = `198.51.${(i >> 8) & 255}.${i & 255}`;
      let attempt: { body: string; headers: Record<string, string> };
      if (i % 4 === 0)
        attempt = forged(`${CERTS}CERT-360caa42-${hex8(i)}-${hex8(i * 7)}`); // PayPal-shaped ids
      else if (i % 4 === 1)
        attempt = forged(`${CERTS}CERT-${hex8(i)}-${hex8(i)}-${hex8(i)}`); // other ids
      else if (i % 4 === 2)
        attempt = forged(GENUINE_CERT); // PayPal's real certificate, a signature it never made
      else attempt = first; // byte-identical replays of PayPal's own delivery
      responses.push(await handler(request(attempt, i % 8 === 1 ? "203.0.113.66" : ip)));
    }

    const flood = host.calls.slice(fetchesBeforeFlood);
    expect(flood.length).toBeLessThanOrEqual(3);
    expect(flood.every((url) => url.startsWith(CERTS))).toBe(true);
    // No OAuth token, no postback, no GET: nothing but certificate fetches ever left the process.
    expect(host.calls.filter((url) => !url.startsWith(CERTS))).toEqual([]);
    expect(responses.every((r) => r.status === 400 || r.status === 503)).toBe(true);
    expect(responses.filter((r) => r.status === 503).length).toBeGreaterThan(0);
    expect(responses.filter((r) => r.reason === "TRANSMISSION_REPLAYED")).toHaveLength(250);
    expect(db.outbox).toHaveLength(1);

    // PayPal again, from the address it always uses: its known certificate needs no fetch.
    expect(await handler(request(genuine(2), PAYPAL_IP))).toMatchObject({ status: 200, outcome: "accepted" });
    // A rotated certificate PayPal has not used before: refused only for now (503, PayPal retries) …
    const rotated = await handler(request(genuine(3, ROTATED_CERT), PAYPAL_IP));
    expect(rotated).toMatchObject({ status: 503, outcome: "unavailable", reason: "CERT_FETCH_THROTTLED" });
    // … and accepted when PayPal's retry comes after the budget has refilled.
    t += HOUR;
    expect(await handler(request(genuine(3, ROTATED_CERT), PAYPAL_IP))).toMatchObject({
      status: 200,
      outcome: "accepted",
    });
    expect(db.outbox).toHaveLength(3);
    expect(host.calls.filter((url) => !url.startsWith(CERTS))).toEqual([]);
  });
});

describe("a delivery that cannot be checked now", () => {
  it("is answered 503 with Retry-After, stores no 'rejected' row and enqueues nothing", async () => {
    const db = fakeDb();
    const throttled: VerifyOutcome = {
      mode: false,
      reason: "CERT_FETCH_THROTTLED",
      detail: "global budget",
      retryable: true,
      transmissionId: "8f1c2a90-6c33-11f1-9f2b-1b2c3d4e5f60",
      certUrl: GENUINE_CERT,
      crc32: 1,
      postback: null,
      certSource: null,
      certWarning: null,
    };
    const handler = createPayPalWebhookHandler({ ...db.deps, verify: async () => throttled });
    const s = signWebhook({ body: itemEvent(1), webhookId: TEST_WEBHOOK_ID, privateKey: leaf.privateKey });
    expect(await handler(request(s, PAYPAL_IP))).toEqual({
      status: 503,
      outcome: "unavailable",
      paypalEventId: null,
      reason: "CERT_FETCH_THROTTLED",
    });
    expect(db.committed.size).toBe(0);
    expect(db.outbox).toEqual([]);

    const hono = new Hono();
    hono.post("/webhooks/paypal", honoPayPalWebhook(handler));
    const res = await hono.request("/webhooks/paypal", { method: "POST", body: s.body, headers: s.headers });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(RETRY_AFTER_SECONDS));
  });

  it("a forged signature is still a 400 verdict, not a 503", async () => {
    const db = fakeDb();
    const host = paypalHost({ [GENUINE_CERT]: leaf.pem });
    const verifier = createPayPalWebhookVerifier({ fetch: host.fetch });
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: (raw, headers, context) =>
        verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID, { clientIp: context.clientIp }),
    });
    const s = signWebhook({
      body: itemEvent(1),
      webhookId: TEST_WEBHOOK_ID,
      privateKey: forgerKey,
      certUrl: GENUINE_CERT,
    });
    expect(await handler(request(s, "198.51.100.1"))).toMatchObject({
      status: 400,
      reason: "SIGNATURE_MISMATCH",
    });
  });
});

describe("client address for the per-IP budget", () => {
  it.each([
    [null, null],
    ["", null],
    ["198.51.100.9", "198.51.100.9"],
    // A client can prepend anything; only the hop our proxy appended (the rightmost) is trusted.
    ["1.2.3.4, 198.51.100.9", "198.51.100.9"],
    ["1.2.3.4,198.51.100.9 , 203.0.113.5", "203.0.113.5"],
    ["2001:db8::1", "2001:db8::1"],
    ["junk, not-an-ip", null],
  ])("X-Forwarded-For %j → %j", (header, expected) => {
    expect(clientIpFromForwardedFor(header)).toBe(expected);
  });

  it("trusts more hops only when configured (a second proxy in front)", () => {
    expect(clientIpFromForwardedFor("1.2.3.4, 198.51.100.9, 10.0.0.2", 2)).toBe("198.51.100.9");
    expect(clientIpFromForwardedFor("198.51.100.9", 2)).toBe(null);
  });

  it("the Hono adapter hands the derived address to verification", async () => {
    const seen: (string | null)[] = [];
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: async (_raw, _headers, context) => {
        seen.push(context.clientIp);
        throw new Error("stop here");
      },
    });
    const hono = new Hono();
    hono.post("/webhooks/paypal", honoPayPalWebhook(handler));
    await hono.request("/webhooks/paypal", {
      method: "POST",
      body: "{}",
      headers: { "x-forwarded-for": "6.6.6.6, 198.51.100.9" },
    });
    await hono.request("/webhooks/paypal", { method: "POST", body: "{}" });
    const custom = new Hono();
    custom.post("/webhooks/paypal", honoPayPalWebhook(handler, { clientIp: () => "203.0.113.1" }));
    await custom.request("/webhooks/paypal", { method: "POST", body: "{}" });
    expect(seen).toEqual(["198.51.100.9", null, "203.0.113.1"]);
  });
});
