// Verifier follow-up 4: every forged or unverifiable delivery used to store a 'rejected' webhook_events
// row (up to 8 KB) with no limit. Now the route stores at most N per client address and M overall in
// any hour (S3: "≤ 100 rows an hour"; E-18: "at most 100 stored rejects") and only counts the rest, in
// health(): counters, never a body. The hour slides: fixed clock-hour windows let a burst across the top
// of the hour store 2 × M (verifier probe: 200 rows from 1,000 forged deliveries in 1.5 s).

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createPayPalWebhookVerifier, type FetchLike, type VerifyOutcome } from "@fairsplit/paypal-core";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_WEBHOOK_ID,
} from "@fairsplit/paypal-core/testing";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import type { RunInTransaction } from "./_shims/persistence.js";
import {
  createPayPalWebhookHandler,
  DEFAULT_REJECTED_ROW_LIMITS,
  type PayPalWebhookDeps,
  type RejectedRowLimits,
  type WebhookEventInsert,
} from "./paypal.js";

const MINUTE = 60_000;
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

/** Refuses every delivery without any crypto, so a test can drive the route's row limits alone, fast. */
const refuseAll: PayPalWebhookDeps<unknown>["verify"] = async (): Promise<VerifyOutcome> => ({
  mode: false,
  reason: "SIGNATURE_MISMATCH",
  detail: null,
  retryable: false,
  transmissionId: null,
  certUrl: null,
  crc32: null,
  postback: null,
  certSource: null,
  certWarning: null,
});

async function setup(limits?: Partial<RejectedRowLimits>, startAt = Date.now()) {
  let t = startAt;
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

  it("defaults: at most 10 per address and 100 overall in any hour (S3: at most 100 rejects an hour)", () => {
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

  it.each([
    ["from 1,000 addresses", (i: number) => `198.51.${(i >> 8) & 255}.${i & 255}`, M],
    ["from one address", () => "203.0.113.66", N],
  ])(
    "1,000 forged deliveries %s in 1.5 s across the top of the hour still store at most one hour's cap (E-18)",
    async (_label, ipOf, cap) => {
      // Verifier probe: fixed clock-hour windows stored 200 rows here (20 from one address).
      const topOfHour = Math.ceil(Date.now() / HOUR) * HOUR;
      const { handler, db, now, advance } = await setup(undefined, topOfHour - 1_000);
      for (let i = 0; i < 1_000; i++) {
        await handler({ ...forged(i, now()), clientIp: ipOf(i) });
        advance(1.5);
      }
      expect(now()).toBeGreaterThan(topOfHour + 400);
      expect(db.rejectedRows()).toHaveLength(cap);
      expect(handler.health().rejectedRows).toMatchObject({ stored: cap, notStoredTotal: 1_000 - cap });
    },
  );

  it("stores exactly what a sliding hour allows, however deliveries arrive: never more than the caps in any 60 minutes", async () => {
    const limits = { perIp: 3, global: 8, windowMs: HOUR };
    const gap = fc.oneof(
      fc.constantFrom(0, 1, 30 * MINUTE, 59 * MINUTE, HOUR - 1, HOUR, HOUR + 1),
      fc.integer({ min: 0, max: 2 * HOUR }),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 0, max: HOUR - 1 }),
        fc.array(fc.record({ gap, ip: fc.integer({ min: 0, max: 4 }) }), { maxLength: 120 }),
        async (offset, arrivals) => {
          let t = Math.floor(Date.now() / HOUR) * HOUR + offset;
          const db = fakeDb();
          const handler = createPayPalWebhookHandler({
            ...db.deps,
            verify: refuseAll,
            now: () => t,
            rejectedRowLimits: limits,
          });
          const kept: { at: number; ip: number }[] = [];
          for (const [i, arrival] of arrivals.entries()) {
            t += arrival.gap;
            const before = db.rejectedRows().length;
            await handler({
              rawBody: Buffer.from(`{"event_type":"X","n":${i}}`),
              headers: {},
              clientIp: `198.51.100.${arrival.ip}`,
            });
            const stored = db.rejectedRows().length > before;
            // The model: a row counts for one hour after it was stored, against its address and overall.
            const lastHour = kept.filter((k) => t - k.at < HOUR);
            const allowed =
              lastHour.length < limits.global &&
              lastHour.filter((k) => k.ip === arrival.ip).length < limits.perIp;
            if (stored !== allowed) return false;
            if (stored) kept.push({ at: t, ip: arrival.ip });
          }
          return handler.health().rejectedRows.stored === kept.filter((k) => t - k.at < HOUR).length;
        },
      ),
      { numRuns: 150 },
    );
  });

  it("keeps the first N per address and the first M overall, then starts afresh an hour later", async () => {
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

  it("logs rejections it does not store at most once an hour while they go on", async () => {
    const { handler, warn, now, advance } = await setup({ perIp: 1, global: 1, windowMs: HOUR });
    const flood = async (count: number) => {
      for (let i = 0; i < count; i++) await handler({ ...forged(i, now()), clientIp: "198.51.100.9" });
    };
    const lines = (text: string) => warn.mock.calls.filter((c) => String(c[1]).includes(text)).length;
    await flood(50);
    expect(lines("paypal webhook rejected")).toBe(1);
    expect(lines("not stored")).toBe(1);
    advance(59 * MINUTE); // the row stored at the start still counts: all refused, no new line
    await flood(10);
    expect(lines("paypal webhook rejected")).toBe(1);
    expect(lines("not stored")).toBe(1);
    advance(MINUTE); // an hour on: one row is stored again, and one more line covers the rest
    await flood(10);
    expect(lines("paypal webhook rejected")).toBe(2);
    expect(lines("not stored")).toBe(2);
  });

  it("health() covers the last hour, sliding: rows and refusals drop out an hour after they happened", async () => {
    const { handler, now, advance } = await setup({ perIp: 1, global: 2, windowMs: HOUR });
    const send = (i: number, ip: string) => handler({ ...forged(i, now()), clientIp: ip });
    await send(1, "198.51.100.1"); // stored
    await send(2, "198.51.100.1"); // refused: per address
    advance(30 * MINUTE);
    await send(3, "198.51.100.2"); // stored
    await send(4, "198.51.100.3"); // refused: overall
    expect(handler.health()).toMatchObject({
      status: "degraded",
      rejectedRows: { stored: 2, notStored: { perIp: 1, global: 1 }, notStoredTotal: 2 },
    });
    advance(30 * MINUTE); // the first row and the first refusal are an hour old
    expect(handler.health()).toMatchObject({
      status: "degraded",
      rejectedRows: { stored: 1, notStored: { perIp: 0, global: 1 }, notStoredTotal: 2 },
    });
    expect(handler.health().problems).toEqual([
      "1 rejected webhook delivery in the last 60 min not stored (limits: 1 per address, 2 overall); counted only",
    ]);
    advance(30 * MINUTE);
    expect(handler.health()).toMatchObject({
      status: "ok",
      problems: [],
      rejectedRows: { stored: 0, notStored: { perIp: 0, global: 0 }, notStoredTotal: 2 },
    });
  });

  it("an unset or undefined limit keeps its default; one that would lift the cap is refused when the handler is built", () => {
    const db = fakeDb();
    const build = (limits: Partial<RejectedRowLimits>) =>
      createPayPalWebhookHandler({ ...db.deps, verify: refuseAll, rejectedRowLimits: limits });
    expect(
      build({ perIp: undefined, global: undefined, windowMs: undefined }).health().rejectedRows,
    ).toMatchObject({ perIpLimit: N, globalLimit: M, windowMs: HOUR });
    expect(build({ global: 5 }).health().rejectedRows).toMatchObject({
      perIpLimit: N,
      globalLimit: 5,
      windowMs: HOUR,
    });
    for (const bad of [
      { windowMs: 0 },
      { windowMs: -HOUR },
      { windowMs: Number.NaN },
      { windowMs: Number.POSITIVE_INFINITY },
      { global: -1 },
      { global: Number.NaN },
      { global: Number.POSITIVE_INFINITY },
      { perIp: 1.5 },
    ]) {
      expect(() => build(bad), JSON.stringify(bad)).toThrow(/rejectedRowLimits/);
    }
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
