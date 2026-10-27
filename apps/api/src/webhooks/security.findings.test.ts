// The automated security findings recorded for ws/ppcore (research/STATE.md), each proven closed end to
// end on the production composition: createPayPalCore (shared limiter, OAuth, postback through
// PayPalHttp) → createPayPalWebhookHandler → the stored row read back as jsonb returns it →
// webhookApplyRule. Every request that leaves the process is counted on a fake PayPal host, so "no
// PayPal call" means none, OAuth included. A regression fails here under the finding's name.
//
//   F1 Replay (MEDIUM): no freshness check on paypal-transmission-time, no transmission-id tracking, and
//      money-moving events must be re-read from PayPal before any state change. Closed: ±5 minutes; each
//      transmission id once, recorded only after the signature verifies (a forged copy cannot burn it);
//      PayPal's resend (new transmission id) is a duplicate, not a replay; and only an in-date,
//      signature-verified PAYOUTS-ITEM.SUCCEEDED applies at once (MM-1, approved plan), provisionally:
//      the settle GET has the last word. Everything else is GET-first.
//   F2 Certificate-fetch budget DoS (MEDIUM): unauthenticated requests could spend the global fetch
//      budget before any signature check. Closed: per-IP before global, fetches held back for known
//      (pinned, pre-warmed, seen) ids, last-known-good certificates, at most 3 fetches in any hour, and
//      a throttled delivery is a retryable 503, never a 400 verdict.
//   F3 Expired-certificate acceptance cached per certificate (MEDIUM): one delivery PayPal confirmed
//      vouched for others signed with the same expired certificate. Closed: each delivery gets its own
//      postback, after its transmission id is claimed; it is never 'self'; and it goes to a GET first.

import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  createMemoryLimiter,
  createPayPalCore,
  type FetchLike,
  WEBHOOK_EVENT_TYPES,
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
  corroborateWithSettleGet,
  createPayPalWebhookHandler,
  honoPayPalWebhook,
  RETRY_AFTER_SECONDS,
  type WebhookApplyRule,
  type WebhookEventInsert,
  webhookApplyRule,
} from "./paypal.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SANDBOX = "https://api-m.sandbox.paypal.com";
const CERTS = "https://api.sandbox.paypal.com/v1/notifications/certs/";
const PAYPAL_IP = "173.0.82.126";
const hex8 = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
const idOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);
/** Synthetic, but shaped like PayPal's own cert ids (CERT-360caa42-…). */
const GENUINE = `${CERTS}CERT-360caa42-fca2a594-0000f00d`;
const ROTATED = `${CERTS}CERT-360caa42-fca2a594-0000beef`;
const EXPIRED = `${CERTS}CERT-360caa42-fca2a594-0000dead`;

const pki = createTestPki();
const leaf = pki.issueLeaf();
const expiredLeaf = pki.issueLeaf({
  notBefore: new Date(Date.now() - 400 * DAY),
  notAfter: new Date(Date.now() - DAY),
});
/** Forgers do not hold PayPal's key. */
const forgerKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

const itemEvent = (n: number, type = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") =>
  syntheticEvent(
    type,
    payoutItemResource({
      senderItemId: `r37-M-${String(n).padStart(3, "0")}`,
      payoutItemId: `5KX${n}`,
      payoutBatchId: "CR9VS",
      transactionStatus: type.endsWith("SUCCEEDED") ? "SUCCESS" : type.slice(type.lastIndexOf(".") + 1),
    }),
    `sec-${n}`,
  ) as { id: string };

/** PayPal: certificates from `pems`, an OAuth token, and verify-webhook-signature answers by transmission id. */
function paypalHost(pems: Record<string, string>, answers: Map<string, "SUCCESS" | "FAILURE">) {
  const calls: { kind: "cert" | "oauth" | "postback" | "other"; url: string; transmissionId?: string }[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    if (url.startsWith(CERTS)) {
      calls.push({ kind: "cert", url });
      const pem = pems[url];
      return pem
        ? new Response(pem, { headers: { "content-type": "application/x-pem-file" } })
        : Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
    }
    if (url === `${SANDBOX}/v1/oauth2/token`) {
      calls.push({ kind: "oauth", url });
      return Response.json({ access_token: "tok-sec", token_type: "Bearer", expires_in: 32_400 });
    }
    if (url === `${SANDBOX}/v1/notifications/verify-webhook-signature`) {
      const transmissionId = String(JSON.parse(String(init?.body ?? "{}")).transmission_id);
      calls.push({ kind: "postback", url, transmissionId });
      return Response.json({ verification_status: answers.get(transmissionId) ?? "FAILURE" });
    }
    calls.push({ kind: "other", url });
    return Response.json({ name: "NOT_FOUND" }, { status: 404 });
  };
  const count = (kind: (typeof calls)[number]["kind"]) => calls.filter((c) => c.kind === kind).length;
  return { fetch, calls, count };
}

/** Postgres stand-in: rows commit with the transaction and are read back through JSON, as jsonb returns them. */
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
  return {
    committed,
    outbox,
    readBack: (paypalEventId: string) => {
      const row = committed.get(paypalEventId);
      return row === undefined ? undefined : (JSON.parse(JSON.stringify(row)) as typeof row);
    },
    deps: {
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
    },
  };
}

/** The production wiring, as WS-API mounts it: one core per process, the route on its verifier. */
function world(options: { pins?: string[]; pems?: Record<string, string> } = {}) {
  let t = Date.now();
  const now = () => t;
  const answers = new Map<string, "SUCCESS" | "FAILURE">();
  const host = paypalHost(options.pems ?? { [GENUINE]: leaf.pem }, answers);
  const core = createPayPalCore({
    config: {
      clientId: "fs-security-client",
      clientSecret: ["fs", "security", "secret"].join("-"),
      devMocks: false,
      knownCertIds: (options.pins ?? []).map(idOf),
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
    now,
  });
  return {
    core,
    host,
    db,
    handler,
    answers,
    now,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

type Signed = { body: string; headers: Record<string, string> };
const signed = (
  body: object,
  at: number,
  options: { certUrl?: string; key?: typeof leaf.privateKey; transmissionId?: string } = {},
): Signed =>
  signWebhook({
    body,
    webhookId: TEST_WEBHOOK_ID,
    privateKey: options.key ?? leaf.privateKey,
    certUrl: options.certUrl ?? GENUINE,
    transmissionTime: new Date(at).toISOString(),
    ...(options.transmissionId ? { transmissionId: options.transmissionId } : {}),
  });
const request = (s: Signed, clientIp: string | null = PAYPAL_IP) => ({
  rawBody: Buffer.from(s.body, "utf8"),
  headers: s.headers,
  clientIp,
});
const tid = (s: Signed) => s.headers["paypal-transmission-id"] ?? "";

describe("F1 (replay, MEDIUM): freshness, one acceptance per transmission id, GET before any state change but MM-1", () => {
  it("a delivery transmitted more than 5 minutes from our clock, either way, is refused before any PayPal call; inside the window it lands", async () => {
    const w = world();
    for (const skew of [-(5 * MINUTE + 1_000), 5 * MINUTE + 1_000]) {
      expect(await w.handler(request(signed(itemEvent(1), w.now() + skew)))).toMatchObject({
        status: 400,
        reason: "TRANSMISSION_TIME_OUT_OF_WINDOW",
      });
    }
    expect(w.host.calls).toEqual([]);
    expect(w.db.outbox).toEqual([]);
    expect(await w.handler(request(signed(itemEvent(1), w.now() - 5 * MINUTE + 1_000)))).toMatchObject({
      status: 200,
      outcome: "accepted",
    });
  });

  it("a captured genuine delivery replayed byte for byte is refused, one after another or all at once; PayPal's own resend (new transmission id) is a duplicate", async () => {
    const w = world();
    const first = signed(itemEvent(1), w.now());
    expect(await w.handler(request(first))).toMatchObject({ status: 200, outcome: "accepted" });
    expect(await w.handler(request(first))).toMatchObject({ status: 400, reason: "TRANSMISSION_REPLAYED" });

    const second = signed(itemEvent(2), w.now());
    const copies = await Promise.all(Array.from({ length: 5 }, () => w.handler(request(second))));
    expect(copies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(copies.filter((r) => r.reason === "TRANSMISSION_REPLAYED")).toHaveLength(4);

    // PayPal's resend of event 1 carries a new transmission id, time and signature: stored as a duplicate.
    expect(await w.handler(request(signed(itemEvent(1), w.now())))).toMatchObject({
      status: 200,
      outcome: "duplicate",
    });
    expect(w.db.outbox).toHaveLength(2); // one processWebhook per event, never per delivery
    expect(w.host.count("cert")).toBe(1);
    expect(w.host.count("oauth") + w.host.count("postback") + w.host.count("other")).toBe(0);
  });

  it("a forged copy carrying a genuine delivery's transmission id cannot burn it: the genuine one still lands", async () => {
    const w = world();
    const genuine = signed(itemEvent(3), w.now());
    const forged = signed(itemEvent(3), w.now(), { key: forgerKey, transmissionId: tid(genuine) });
    forged.headers["paypal-transmission-time"] = genuine.headers["paypal-transmission-time"] ?? "";
    expect(await w.handler(request(forged, "198.51.100.7"))).toMatchObject({
      status: 400,
      reason: "SIGNATURE_MISMATCH",
    });
    expect(await w.handler(request(genuine))).toMatchObject({ status: 200, outcome: "accepted" });
  });

  it("of all 15 subscribed events, verified and stored, only PAYOUTS-ITEM.SUCCEEDED applies before a GET (MM-1), and the settle GET still has the last word", async () => {
    const w = world();
    const rules = new Map<string, WebhookApplyRule>();
    for (const [n, type] of WEBHOOK_EVENT_TYPES.entries()) {
      const event = type.startsWith("PAYMENT.PAYOUTS-ITEM.")
        ? itemEvent(n, type)
        : (syntheticEvent(type, {}, `sec-${n}`) as { id: string });
      expect(await w.handler(request(signed(event, w.now())))).toMatchObject({ status: 200 });
      const row = w.db.readBack(event.id);
      expect(row).toMatchObject({ verified: "self", delivery: { certWarning: null } });
      if (row) rules.set(type, webhookApplyRule(row));
    }
    expect(rules.size).toBe(15);
    for (const [type, rule] of rules) {
      expect(rule, type).toEqual(
        type === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED"
          ? { action: "apply_now", status: "SUCCESS", corroboration: "settle_get" }
          : { action: "fresh_get_first", reason: "NOT_A_PAYOUT_ITEM_SUCCESS" },
      );
    }
    // MM-1's SUCCESS is provisional: a settle GET that disagrees wins, with an /ops alert.
    expect(
      corroborateWithSettleGet(
        { paypalEventId: "WH-sec-7", payoutItemId: "5KX7", status: "SUCCESS" },
        "RETURNED",
      ),
    ).toMatchObject({
      verdict: "get_wins",
      status: "RETURNED",
      alert: { kind: "WEBHOOK_GET_MISMATCH", correction: true },
    });
  });
});

describe("F2 (certificate-fetch budget DoS, MEDIUM): forged deliveries cannot spend what PayPal's need", () => {
  it("1,000 forged deliveries at random certificate URLs, from many addresses, one, or none, with a pin not loaded yet: at most 3 certificate fetches in all and no other PayPal call; PayPal's deliveries still land, its rotated (pinned) certificate during the flood", async () => {
    const w = world({ pins: [GENUINE, ROTATED], pems: { [GENUINE]: leaf.pem, [ROTATED]: leaf.pem } });
    expect(await w.handler(request(signed(itemEvent(1), w.now())))).toMatchObject({ status: 200 });

    const base = signed(itemEvent(999), w.now(), { key: forgerKey });
    const statuses = new Map<string, number>();
    for (let i = 0; i < 1_000; i++) {
      const url =
        i % 3 === 0
          ? `${CERTS}CERT-360caa42-${hex8(i)}-${hex8(i * 7)}` // PayPal-shaped ids
          : i % 3 === 1
            ? `${CERTS}CERT-${hex8(i)}-${hex8(i)}-${hex8(i)}` // other ids
            : GENUINE; // PayPal's real certificate, with a signature PayPal never made
      const forged: Signed = {
        body: base.body,
        headers: {
          ...base.headers,
          "paypal-cert-url": url,
          "paypal-transmission-id": randomUUID(),
          "paypal-transmission-time": new Date(w.now()).toISOString(),
        },
      };
      const ip = i % 5 === 0 ? null : i % 5 === 1 ? "203.0.113.66" : `198.51.${(i >> 8) & 255}.${i & 255}`;
      const res = await w.handler(request(forged, ip));
      const key = `${res.status} ${res.reason}`;
      statuses.set(key, (statuses.get(key) ?? 0) + 1);
    }
    expect(w.host.count("cert")).toBeLessThanOrEqual(3);
    expect([...statuses.keys()].every((k) => k.startsWith("400 ") || k === "503 CERT_FETCH_THROTTLED")).toBe(
      true,
    );
    expect(statuses.get("503 CERT_FETCH_THROTTLED") ?? 0).toBeGreaterThan(0);

    // PayPal again: the certificate it signed with before needs no fetch; the rotated one it starts
    // signing with now was pinned, so it lands on a fetch held back for it.
    expect(await w.handler(request(signed(itemEvent(2), w.now())))).toMatchObject({ status: 200 });
    expect(await w.handler(request(signed(itemEvent(3), w.now(), { certUrl: ROTATED })))).toMatchObject({
      status: 200,
      outcome: "accepted",
    });
    expect(w.host.count("cert")).toBe(3);
    expect(w.host.count("oauth") + w.host.count("postback") + w.host.count("other")).toBe(0);
    expect(w.db.outbox).toHaveLength(3);
  });

  it("a flood from one address, or with no address at all, makes at most 2 fetches; PayPal's delivery from its own address still lands", async () => {
    for (const floodIp of ["203.0.113.66", null]) {
      const w = world();
      const base = signed(itemEvent(999), w.now(), { key: forgerKey });
      for (let i = 0; i < 200; i++) {
        await w.handler(
          request(
            {
              body: base.body,
              headers: {
                ...base.headers,
                "paypal-cert-url": `${CERTS}CERT-360caa42-${hex8(i)}-${hex8(i)}`,
                "paypal-transmission-id": randomUUID(),
              },
            },
            floodIp,
          ),
        );
      }
      expect(w.host.count("cert")).toBeLessThanOrEqual(2);
      expect(await w.handler(request(signed(itemEvent(1), w.now())))).toMatchObject({ status: 200 });
    }
  });

  it("a delivery that cannot be checked now is a 503 with Retry-After that stores nothing, and lands on PayPal's retry once the hour has passed", async () => {
    const w = world();
    const base = signed(itemEvent(999), w.now(), { key: forgerKey });
    for (let i = 0; i < 50; i++) {
      await w.handler(
        request(
          {
            body: base.body,
            headers: {
              ...base.headers,
              "paypal-cert-url": `${CERTS}CERT-360caa42-${hex8(i)}-${hex8(i)}`,
              "paypal-transmission-id": randomUUID(),
            },
          },
          `198.51.100.${i}`,
        ),
      );
    }
    expect(w.host.count("cert")).toBe(3);
    const hono = new Hono();
    hono.post("/webhooks/paypal", honoPayPalWebhook(w.handler, { clientIp: () => PAYPAL_IP }));
    const delivery = signed(itemEvent(1), w.now());
    const res = await hono.request("/webhooks/paypal", {
      method: "POST",
      body: delivery.body,
      headers: delivery.headers,
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(String(RETRY_AFTER_SECONDS));
    expect(w.db.committed.has(itemEvent(1).id)).toBe(false);
    w.advance(HOUR);
    expect(await w.handler(request(signed(itemEvent(1), w.now())))).toMatchObject({ status: 200 });
  });
});

describe("F3 (expired certificate cached per certificate, MEDIUM): each delivery is judged on its own", () => {
  const expiredWorld = () => world({ pems: { [EXPIRED]: expiredLeaf.pem } });
  const underExpired = (n: number, at: number) =>
    signed(itemEvent(n), at, { certUrl: EXPIRED, key: expiredLeaf.privateKey });

  it("PayPal confirming one delivery vouches for no other: each costs its own postback, a FAILURE is a 400, none is 'self', and the accepted one goes to a GET first", async () => {
    const w = expiredWorld();
    const confirmed = underExpired(1, w.now());
    w.answers.set(tid(confirmed), "SUCCESS");
    const denied = underExpired(2, w.now()); // PayPal answers FAILURE for this one

    expect(await w.handler(request(confirmed))).toMatchObject({ status: 200, outcome: "accepted" });
    expect(await w.handler(request(denied))).toMatchObject({ status: 400, reason: "CERT_EXPIRED" });
    expect(w.host.calls.filter((c) => c.kind === "postback").map((c) => c.transmissionId)).toEqual([
      tid(confirmed),
      tid(denied),
    ]);

    const row = w.db.readBack(itemEvent(1).id);
    expect(row).toMatchObject({ verified: "postback", delivery: { certWarning: "CERT_EXPIRED" } });
    expect(row && webhookApplyRule(row)).toEqual({ action: "fresh_get_first", reason: "CERT_EXPIRED" });

    // A replayed copy of the confirmed delivery costs no PayPal call: its id was claimed first.
    expect(await w.handler(request(confirmed))).toMatchObject({
      status: 400,
      reason: "TRANSMISSION_REPLAYED",
    });
    expect(w.host.count("postback")).toBe(2);
    // Three deliveries carried a valid signature under the expired certificate (the replay too); one was accepted.
    expect(w.core.verifier.health()).toMatchObject({
      status: "degraded",
      signedWithExpiredCert: 3,
      acceptedWithExpiredCert: 1,
    });
  });

  it("deliveries in flight together share nothing: each waits for PayPal's answer about itself", async () => {
    const w = expiredWorld();
    const a = underExpired(1, w.now());
    const b = underExpired(2, w.now());
    const c = underExpired(3, w.now());
    w.answers.set(tid(a), "SUCCESS");
    w.answers.set(tid(c), "SUCCESS");
    const [ra, rb, rc] = await Promise.all([a, b, c].map((s) => w.handler(request(s))));
    expect(ra).toMatchObject({ status: 200 });
    expect(rb).toMatchObject({ status: 400, reason: "CERT_EXPIRED" });
    expect(rc).toMatchObject({ status: 200 });
    expect(w.host.count("postback")).toBe(3);
    for (const n of [1, 3]) {
      expect(w.db.readBack(itemEvent(n).id)).toMatchObject({
        verified: "postback",
        delivery: { certWarning: "CERT_EXPIRED" },
      });
    }
  });
});
