// Verifier follow-up 4: every forged or unverifiable delivery used to store a 'rejected' webhook_events
// row (up to 8 KB) with no limit. Now the route keeps the first N per client address and the first M
// overall in each window (S3: "≤ 100 rows an hour"; E-18: "at most 100 stored rejects") and only
// counts the rest, in health(): counters, never a body.

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createPayPalWebhookVerifier, type FetchLike } from "@fairsplit/paypal-core";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_WEBHOOK_ID,
} from "@fairsplit/paypal-core/testing";
import { describe, expect, it, vi } from "vitest";
import type { RunInTransaction } from "./_shims/persistence.js";
import {
  createPayPalWebhookHandler,
  DEFAULT_REJECTED_ROW_LIMITS,
  type PayPalWebhookDeps,
  type WebhookEventInsert,
} from "./paypal.js";

const HOUR = 3_600_000;
const pki = createTestPki();
const leaf = pki.issueLeaf();
const forgerKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const GENUINE_CERT = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-0000f00d";

function fakeDb() {
  type Tx = { rows: Map<string, WebhookEventInsert> };
  const committed = new Map<string, WebhookEventInsert>();
  let failInserts = false;
  const transaction: RunInTransaction<Tx> = async (fn) => {
    const tx: Tx = { rows: new Map() };
    const result = await fn(tx);
    for (const [key, row] of tx.rows) committed.set(key, row);
    return result;
  };
  const deps = {
    transaction,
    insertWebhookEvent: async (tx: Tx, row: WebhookEventInsert) => {
      if (failInserts) throw new Error("database unavailable");
      if (committed.has(row.paypalEventId) || tx.rows.has(row.paypalEventId)) return null;
      tx.rows.set(row.paypalEventId, row);
      return { id: `row-${committed.size + tx.rows.size}` };
    },
    enqueue: async () => undefined,
  } satisfies Omit<PayPalWebhookDeps<Tx>, "verify">;
  const rejectedRows = () => [...committed.values()].filter((r) => r.status === "rejected");
  return {
    deps,
    committed,
    rejectedRows,
    failInserts: (on: boolean) => {
      failInserts = on;
    },
  };
}

/** PayPal: serves the genuine certificate and counts every request this process makes to it. */
function paypal() {
  const calls: string[] = [];
  const fetch: FetchLike = async (input) => {
    calls.push(String(input));
    return String(input) === GENUINE_CERT
      ? new Response(leaf.pem, { headers: { "content-type": "application/x-pem-file" } })
      : Response.json({ name: "RESOURCE_NOT_FOUND" }, { status: 404 });
  };
  return { fetch, calls };
}

const itemEvent = syntheticEvent(
  "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
  payoutItemResource({
    senderItemId: "r37-M-014",
    payoutItemId: "5KX9",
    payoutBatchId: "CR9VS",
    transactionStatus: "SUCCESS",
  }),
);

/** One forger signature; each forged delivery gets its own transmission id and a body up to 8 KB. */
const forgedBase = signWebhook({
  body: itemEvent,
  webhookId: TEST_WEBHOOK_ID,
  privateKey: forgerKey,
  certUrl: GENUINE_CERT,
});
const forged = (i: number, at: number) => ({
  rawBody: Buffer.from(JSON.stringify({ ...itemEvent, pad: "x".repeat(8_000), n: i })),
  headers: {
    ...forgedBase.headers,
    "paypal-transmission-id": randomUUID(),
    "paypal-transmission-time": new Date(at).toISOString(),
  },
});

async function setup(limits?: Partial<typeof DEFAULT_REJECTED_ROW_LIMITS>) {
  let t = Date.now();
  const now = () => t;
  const host = paypal();
  const verifier = createPayPalWebhookVerifier({ fetch: host.fetch, now });
  // PayPal's certificate is loaded (boot pre-warm), so nothing below needs a certificate fetch.
  expect((await verifier.prewarm([GENUINE_CERT]))[0]?.ok).toBe(true);
  const db = fakeDb();
  const warn = vi.fn();
  const handler = createPayPalWebhookHandler({
    ...db.deps,
    verify: (raw, headers, context) =>
      verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID, { clientIp: context.clientIp }),
    now,
    logger: { warn },
    ...(limits ? { rejectedRowLimits: limits } : {}),
  });
  const callsBefore = host.calls.length;
  return {
    handler,
    db,
    warn,
    now,
    advance: (ms: number) => {
      t += ms;
    },
    paypalCallsSinceBoot: () => host.calls.length - callsBefore,
  };
}

describe("rejected rows are rate-limited", () => {
  const { perIp: N, global: M } = DEFAULT_REJECTED_ROW_LIMITS;

  it("defaults: the first 10 per address and the first 100 overall each hour (S3: at most 100 rejects an hour)", () => {
    expect(DEFAULT_REJECTED_ROW_LIMITS).toEqual({ perIp: 10, global: 100, windowMs: HOUR });
  });

  it.each([
    ["from 1,000 addresses", (i: number) => `198.51.${(i >> 8) & 255}.${i & 255}`, M],
    ["from one address", () => "203.0.113.66", N],
    ["from one IPv6 /64", (i: number) => `2001:db8:1:2::${(i + 1).toString(16)}`, N],
    ["with no address", () => null, N],
  ])(
    "1,000 forged deliveries %s store at most N+M rows and make 0 PayPal calls",
    async (_label, ipOf, kept) => {
      const { handler, db, now, paypalCallsSinceBoot } = await setup();
      const statuses = new Set<number>();
      for (let i = 0; i < 1_000; i++)
        statuses.add((await handler({ ...forged(i, now()), clientIp: ipOf(i) })).status);
      expect([...statuses]).toEqual([400]);
      expect(db.rejectedRows().length).toBeLessThanOrEqual(N + M);
      expect(db.rejectedRows()).toHaveLength(kept);
      expect(db.rejectedRows().every((r) => r.raw.length <= 8 * 1024)).toBe(true);
      expect(paypalCallsSinceBoot()).toBe(0);
      const health = handler.health();
      expect(health.rejectedRows).toMatchObject({
        stored: kept,
        perIpLimit: N,
        globalLimit: M,
        windowMs: HOUR,
        notStoredTotal: 1_000 - kept,
      });
      expect(health.rejectedRows.notStored.perIp + health.rejectedRows.notStored.global).toBe(1_000 - kept);
      expect(health.status).toBe("degraded");
      // Counters only: nothing from a body, a header or an address reaches health().
      const text = JSON.stringify(health);
      expect(text).not.toMatch(/xxxx|PAYOUTS|198\.51|203\.0|2001:db8|CERT-/);
    },
  );

  it("keeps the first N per address and the first M overall, then starts afresh in the next window", async () => {
    const { handler, db, now, advance } = await setup({ perIp: 2, global: 5, windowMs: HOUR });
    const send = async (i: number, ip: string) => handler({ ...forged(i, now()), clientIp: ip });
    for (let i = 0; i < 4; i++) await send(i, "198.51.100.1");
    expect(db.rejectedRows()).toHaveLength(2);
    expect(handler.health().rejectedRows.notStored).toEqual({ perIp: 2, global: 0 });
    for (let i = 10; i < 20; i++) await send(i, `198.51.100.${i}`);
    expect(db.rejectedRows()).toHaveLength(5);
    expect(handler.health().rejectedRows).toMatchObject({ stored: 5, notStored: { perIp: 2, global: 7 } });

    advance(HOUR);
    await send(100, "198.51.100.1");
    expect(db.rejectedRows()).toHaveLength(6);
    expect(handler.health().rejectedRows).toMatchObject({
      stored: 1,
      notStored: { perIp: 0, global: 0 },
      notStoredTotal: 9,
    });
    expect(handler.health().status).toBe("ok");
  });

  it("a rejection that stores no row (identical junk deduped, or the insert failed) gives its slot back", async () => {
    const { handler, db } = await setup({ perIp: 1, global: 1, windowMs: HOUR });
    const junk = { rawBody: Buffer.from('{"event_type":"X"}'), headers: {}, clientIp: "198.51.100.7" };
    db.failInserts(true);
    expect((await handler(junk)).status).toBe(400);
    db.failInserts(false);
    expect((await handler(junk)).status).toBe(400);
    expect(db.rejectedRows()).toHaveLength(1);
    expect(await handler(junk)).toMatchObject({ status: 400 }); // same body hash: ON CONFLICT DO NOTHING
    expect(handler.health().rejectedRows).toMatchObject({ stored: 1, notStored: { perIp: 1, global: 0 } });
  });

  it("logs a rejection it does not store only once per window, as a count", async () => {
    const { handler, warn, now } = await setup({ perIp: 1, global: 1, windowMs: HOUR });
    for (let i = 0; i < 50; i++) await handler({ ...forged(i, now()), clientIp: "198.51.100.9" });
    const rejectedLogs = warn.mock.calls.filter((c) => c[1] === "paypal webhook rejected");
    const overLimit = warn.mock.calls.filter((c) => String(c[1]).includes("not stored"));
    expect(rejectedLogs).toHaveLength(1);
    expect(overLimit).toHaveLength(1);
  });

  it("an accepted delivery is never limited", async () => {
    const { handler, db, now } = await setup({ perIp: 0, global: 0, windowMs: HOUR });
    await handler({ ...forged(1, now()), clientIp: "173.0.82.126" });
    const genuine = signWebhook({
      body: itemEvent,
      webhookId: TEST_WEBHOOK_ID,
      privateKey: leaf.privateKey,
      certUrl: GENUINE_CERT,
      transmissionTime: new Date(now()).toISOString(),
    });
    expect(
      await handler({
        rawBody: Buffer.from(genuine.body),
        headers: genuine.headers,
        clientIp: "173.0.82.126",
      }),
    ).toMatchObject({ status: 200, outcome: "accepted" });
    expect(db.rejectedRows()).toHaveLength(0);
    expect(db.committed.size).toBe(1);
  });
});
