import { createPayPalWebhookVerifier, type PostbackFn, type VerifyOutcome } from "@fairsplit/paypal-core";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_CERT_URL,
  TEST_WEBHOOK_ID,
  testCertUrl,
} from "@fairsplit/paypal-core/testing";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import type { ProcessWebhookArgs, TaskName } from "./_shims/contracts.js";
import type { RunInTransaction } from "./_shims/persistence.js";
import {
  createPayPalWebhookHandler,
  type DuplicateDelivery,
  honoPayPalWebhook,
  MAX_REJECTED_RAW_BYTES,
  type PayPalWebhookDeps,
  prewarmWebhookCertificates,
  readBodyWithLimit,
  type WebhookEventInsert,
  webhookRunEvent,
} from "./paypal.js";

const pki = createTestPki();
const leaf = pki.issueLeaf();
const DAY = 86_400_000;

/** In-memory stand-in for Postgres: rows and outbox entries become visible only when the callback resolves. */
function fakeDb() {
  interface Tx {
    rows: Map<string, WebhookEventInsert & { id: string }>;
    outbox: { name: TaskName; args: ProcessWebhookArgs; dedupeKey: string }[];
    duplicates: DuplicateDelivery[];
  }
  const committed = new Map<string, WebhookEventInsert & { id: string }>();
  const outbox: Tx["outbox"] = [];
  const duplicates: DuplicateDelivery[] = [];
  let nextId = 1;
  const transaction: RunInTransaction<Tx> = async (fn) => {
    const tx: Tx = { rows: new Map(), outbox: [], duplicates: [] };
    const result = await fn(tx);
    for (const [key, row] of tx.rows) committed.set(key, row);
    outbox.push(...tx.outbox);
    duplicates.push(...tx.duplicates);
    return result;
  };
  const deps = {
    transaction,
    // ON CONFLICT (paypal_event_id) DO NOTHING RETURNING id
    insertWebhookEvent: async (tx: Tx, row: WebhookEventInsert) => {
      if (committed.has(row.paypalEventId) || tx.rows.has(row.paypalEventId)) return null;
      const id = `0192f0c4-0000-7000-8000-${String(nextId++).padStart(12, "0")}`;
      tx.rows.set(row.paypalEventId, { ...row, id });
      return { id };
    },
    enqueue: async (tx: Tx, name: TaskName, args: ProcessWebhookArgs, dedupeKey: string) => {
      tx.outbox.push({ name, args, dedupeKey });
    },
    onDuplicate: async (tx: Tx, delivery: DuplicateDelivery) => {
      tx.duplicates.push(delivery);
    },
  } satisfies Omit<PayPalWebhookDeps<Tx>, "verify">;
  return { committed, outbox, duplicates, deps };
}

const pemServer = (pems: Record<string, string>) => async (input: string | URL) => {
  const pem = pems[String(input)];
  return pem
    ? new Response(pem, { headers: { "content-type": "application/x-pem-file" } })
    : new Response(null, { status: 404 });
};

function realVerifier(
  options: { devMocks?: boolean; postback?: PostbackFn; pems?: Record<string, string> } = {},
) {
  const verifier = createPayPalWebhookVerifier({
    ...(options.devMocks ? { devMocks: true } : {}),
    ...(options.postback ? { postback: options.postback } : {}),
    expiredCertPolicy: "accept",
    fetch: pemServer({ [TEST_CERT_URL]: leaf.pem, ...options.pems }),
  });
  return (raw: Uint8Array, headers: Parameters<typeof verifier.verifyDetailed>[1]) =>
    verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID);
}

function setup(
  options: {
    devMocks?: boolean;
    verify?: PayPalWebhookDeps<unknown>["verify"];
    verifyTimeoutMs?: number;
  } = {},
) {
  const db = fakeDb();
  const handler = createPayPalWebhookHandler({
    ...db.deps,
    verify: options.verify ?? realVerifier(options.devMocks ? { devMocks: true } : {}),
    ...(options.verifyTimeoutMs ? { verifyTimeoutMs: options.verifyTimeoutMs } : {}),
  });
  return { ...db, handler };
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
const sign = (body: string | object = itemEvent, webhookId = TEST_WEBHOOK_ID, privateKey = leaf.privateKey) =>
  signWebhook({ body, webhookId, privateKey });
const request = (s: { body: string; headers: Record<string, string> }) => ({
  rawBody: Buffer.from(s.body, "utf8"),
  headers: s.headers,
});

describe("POST /webhooks/paypal handler", () => {
  it("stores a verified event, enqueues processWebhook in the same transaction and returns 200", async () => {
    const { handler, committed, outbox } = setup();
    const s = sign();
    const res = await handler(request(s));
    const eventId = (itemEvent as { id: string }).id;
    expect(res).toEqual({ status: 200, outcome: "accepted", paypalEventId: eventId, reason: null });
    const row = committed.get(eventId);
    expect(row).toMatchObject({
      eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      resourceKey: "item:r37-M-014",
      verified: "self",
      status: "received",
      raw: s.body,
    });
    expect(outbox).toEqual([
      { name: "processWebhook", args: { webhookEventId: row?.id }, dedupeKey: `wh:${eventId}` },
    ]);
  });

  it("writes only the columns of architecture §3 / S3.4, plus the proposed `delivery` jsonb", async () => {
    const { handler, committed } = setup();
    const s = sign();
    await handler(request(s));
    const row = [...committed.values()][0];
    const { id: _id, ...columns } = row ?? ({} as WebhookEventInsert & { id: string });
    expect(Object.keys(columns).sort()).toEqual([
      "delivery",
      "eventType",
      "paypalEventId",
      "raw",
      "resourceKey",
      "status",
      "verified",
    ]);
    // Everything processWebhook's postback needs, and nothing secret: PayPal's own public header values.
    expect(row?.delivery).toEqual({
      transmissionId: s.headers["paypal-transmission-id"],
      transmissionTime: s.headers["paypal-transmission-time"],
      transmissionSig: s.headers["paypal-transmission-sig"],
      certUrl: TEST_CERT_URL,
      authAlgo: "SHA256withRSA",
      rejectReason: null,
      certWarning: null,
    });
  });

  it("dedupes on paypal_event_id: a repeated or resent delivery is 200 with no second task", async () => {
    const { handler, committed, outbox, duplicates } = setup();
    const first = sign();
    expect((await handler(request(first))).outcome).toBe("accepted");
    expect((await handler(request(first))).outcome).toBe("duplicate");
    const resent = sign(); // PayPal's resend: same event id, new transmission id and signature
    const res = await handler(request(resent));
    expect(res).toMatchObject({ status: 200, outcome: "duplicate" });
    expect(committed.size).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(duplicates.map((d) => d.transmissionId)).toEqual([
      first.headers["paypal-transmission-id"],
      resent.headers["paypal-transmission-id"],
    ]);
    expect(duplicates.map((d) => webhookRunEvent(d, true))).toEqual([
      {
        type: "webhook.received",
        eventId: (itemEvent as { id: string }).id,
        eventType: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        verified: "self",
        duplicate: true,
      },
      expect.objectContaining({ verified: "self", duplicate: true }),
    ]);
  });

  it("rejects a tampered body with 400, stores a 'rejected' row with its reason and enqueues nothing", async () => {
    const { handler, committed, outbox } = setup();
    const s = sign();
    const res = await handler({
      rawBody: Buffer.from(s.body.replace("SUCCESS", "FAILED!")),
      headers: s.headers,
    });
    expect(res).toEqual({
      status: 400,
      outcome: "rejected",
      paypalEventId: null,
      reason: "SIGNATURE_MISMATCH",
    });
    const row = committed.get(`rejected:${s.headers["paypal-transmission-id"]}`);
    expect(row).toMatchObject({
      status: "rejected",
      verified: null,
      delivery: { rejectReason: "SIGNATURE_MISMATCH", transmissionId: s.headers["paypal-transmission-id"] },
    });
    expect(outbox).toEqual([]);
  });

  it("keeps only the first 8 KB of a rejected body", async () => {
    const { handler, committed } = setup();
    const junk = JSON.stringify({ event_type: "X", pad: "x".repeat(20_000) });
    const res = await handler({
      rawBody: Buffer.from(junk),
      headers: { "paypal-transmission-id": "t-junk" },
    });
    expect(res).toMatchObject({ status: 400, reason: "MISSING_HEADER" });
    const row = committed.get("rejected:t-junk");
    expect(row?.raw.length).toBe(MAX_REJECTED_RAW_BYTES);
    expect(row?.eventType).toBe("X");
    expect(row?.delivery?.rejectReason).toBe("MISSING_HEADER:paypal-transmission-time");
  });

  it("never uses an odd transmission id as a key: junk dedupes on its body hash instead", async () => {
    const { handler, committed } = setup();
    const junk = Buffer.from('{"event_type":"PAYMENT.PAYOUTS-ITEM.SUCCEEDED"}');
    const headers = { "paypal-transmission-id": `x'; DROP TABLE webhook_events; --${"a".repeat(500)}` };
    expect((await handler({ rawBody: junk, headers })).status).toBe(400);
    expect((await handler({ rawBody: junk, headers })).status).toBe(400);
    const keys = [...committed.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^rejected:sha256-[0-9a-f]{32}$/);
    expect(committed.get(keys[0] ?? "")?.delivery?.transmissionId).toBeNull();
  });

  it("rejects a correctly signed body that is not a PayPal event envelope", async () => {
    const { handler, outbox } = setup();
    const s = sign({ hello: "world" });
    expect(await handler(request(s))).toMatchObject({ status: 400, reason: "MALFORMED_EVENT" });
    expect(outbox).toEqual([]);
  });

  it("refuses oversized bodies before verifying them", async () => {
    const verify = vi.fn(async (): Promise<VerifyOutcome> => {
      throw new Error("must not be called");
    });
    const { handler } = setup({ verify });
    const res = await handler({ rawBody: new Uint8Array(300 * 1024), headers: {} });
    expect(res).toMatchObject({ status: 413, outcome: "too_large" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 500 (PayPal retries) when verification itself errors", async () => {
    const { handler } = setup({
      verify: async () => {
        throw new Error("cert cache exploded");
      },
    });
    expect(await handler(request(sign()))).toMatchObject({
      status: 500,
      outcome: "error",
      reason: "VERIFY_ERROR",
    });
  });

  it("caps verification time: a hung verifier gets a 500 (PayPal retries) well before PayPal's 30 s", async () => {
    const { handler, committed } = setup({ verify: () => new Promise(() => undefined), verifyTimeoutMs: 50 });
    const started = performance.now();
    expect(await handler(request(sign()))).toMatchObject({ status: 500, reason: "VERIFY_TIMEOUT" });
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(committed.size).toBe(0);
  });

  it("never spends a postback in the request: INVOICE.PAID gets its 200 at once while the postback would hang", async () => {
    const postback = vi.fn<PostbackFn>(() => new Promise(() => undefined));
    const { handler, committed, outbox } = setup({ verify: realVerifier({ postback }) });
    const paid = syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } });
    const started = performance.now();
    const res = await handler(request(sign(paid)));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(res).toMatchObject({ status: 200, outcome: "accepted" });
    expect(postback).not.toHaveBeenCalled();
    expect([...committed.values()][0]).toMatchObject({ verified: "self", resourceKey: "invoice:INV2-A" });
    expect(outbox).toHaveLength(1);
  });

  it("stores the certificate warning when a delivery was accepted under an expired certificate", async () => {
    const expired = pki.issueLeaf({
      notBefore: new Date(Date.now() - 400 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    const url = testCertUrl("route-expired");
    const warn = vi.fn();
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: realVerifier({ pems: { [url]: expired.pem } }),
      logger: { warn },
    });
    const s = signWebhook({
      body: itemEvent,
      webhookId: TEST_WEBHOOK_ID,
      privateKey: expired.privateKey,
      certUrl: url,
    });
    expect(await handler(request(s))).toMatchObject({ status: 200, outcome: "accepted" });
    expect([...db.committed.values()][0]?.delivery).toMatchObject({
      certUrl: url,
      certWarning: "CERT_EXPIRED_ACCEPTED",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ certWarning: "CERT_EXPIRED_ACCEPTED" }),
      "paypal webhook accepted with an expired certificate",
    );
  });

  it("inv.i7.outbox: if enqueue fails, nothing is committed and a retry stores the event once", async () => {
    const db = fakeDb();
    let failEnqueue = true;
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: realVerifier(),
      enqueue: async (tx, name, args, key) => {
        if (failEnqueue) throw new Error("outbox insert failed");
        return db.deps.enqueue(tx, name, args, key);
      },
    });
    const s = sign();
    expect(await handler(request(s))).toMatchObject({
      status: 500,
      outcome: "error",
      reason: "STORE_FAILED",
    });
    expect(db.committed.size).toBe(0);
    expect(db.outbox).toHaveLength(0);
    failEnqueue = false;
    expect(await handler(request(s))).toMatchObject({ status: 200, outcome: "accepted" });
    expect(db.committed.size).toBe(1);
    expect(db.outbox).toHaveLength(1);
  });

  it("inv.i8.labels: simulator events are stored labelled 'dev_mock' (dev only) and rejected otherwise", async () => {
    const dev = setup({ devMocks: true });
    const simulated = sign(itemEvent, "WEBHOOK_ID");
    expect((await dev.handler(request(simulated))).outcome).toBe("accepted");
    expect([...dev.committed.values()][0]?.verified).toBe("dev_mock");
    const judge = setup();
    expect(await judge.handler(request(simulated))).toMatchObject({
      status: 400,
      reason: "SIGNATURE_MISMATCH",
    });
  });

  it("inv.i8.labels: a repeated simulator delivery is never reported as a 'self' or 'postback' run event", async () => {
    const dev = setup({ devMocks: true });
    const simulated = sign(itemEvent, "WEBHOOK_ID");
    await dev.handler(request(simulated));
    expect((await dev.handler(request(simulated))).outcome).toBe("duplicate");
    expect(dev.duplicates.map((d) => d.verified)).toEqual(["dev_mock"]);
    // The frozen contract (architecture §5) has no 'dev_mock' or 'fetched': refuse rather than relabel.
    expect(dev.duplicates.map((d) => webhookRunEvent(d, true))).toEqual([null]);
    expect(webhookRunEvent({ paypalEventId: "WH-F", eventType: "X", verified: "fetched" }, false)).toBeNull();
    expect(webhookRunEvent({ paypalEventId: "WH-P", eventType: "X", verified: "postback" }, false)).toEqual({
      type: "webhook.received",
      eventId: "WH-P",
      eventType: "X",
      verified: "postback",
      duplicate: false,
    });
  });
});

describe("prewarmWebhookCertificates (boot / warmCaches)", () => {
  it("loads the certificate of the newest stored delivery, so the first delivery after a deploy is a cache hit", async () => {
    // Store one delivery, as before the deploy, and read its delivery.certUrl back.
    const before = setup();
    await before.handler(request(sign()));
    const stored = [...before.committed.values()].map((r) => r.delivery?.certUrl ?? "");

    let fetches = 0;
    const verifier = createPayPalWebhookVerifier({
      fetch: async (input) => {
        fetches += 1;
        return pemServer({ [TEST_CERT_URL]: leaf.pem })(input);
      },
    });
    const results = await prewarmWebhookCertificates({
      verifier,
      latestVerifiedCertUrls: async () => stored,
    });
    expect(results).toEqual([
      expect.objectContaining({ certUrl: TEST_CERT_URL, ok: true, source: "network" }),
    ]);
    const s = sign();
    expect(await verifier.verifyDetailed(Buffer.from(s.body), s.headers, TEST_WEBHOOK_ID)).toMatchObject({
      mode: "self",
      certSource: "cache",
    });
    expect(fetches).toBe(1);
  });

  it("never throws: a failing lookup is logged and boot carries on", async () => {
    const warn = vi.fn();
    const verifier = createPayPalWebhookVerifier({ fetch: pemServer({}) });
    const results = await prewarmWebhookCertificates({
      verifier,
      latestVerifiedCertUrls: async () => {
        throw new Error("db not ready");
      },
      logger: { warn },
    });
    expect(results).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      { error: "db not ready" },
      "paypal webhook certificate pre-warm failed",
    );
  });
});

describe("Hono adapter", () => {
  function app(options: { consumeBodyFirst?: boolean } = {}) {
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({ ...db.deps, verify: realVerifier() });
    const hono = new Hono();
    if (options.consumeBodyFirst) {
      hono.use("/webhooks/paypal", async (c, next) => {
        await c.req.text();
        await next();
      });
    }
    hono.post("/webhooks/paypal", honoPayPalWebhook(handler));
    return { hono, db };
  }

  it("verifies the exact raw bytes, before any parse (odd whitespace survives)", async () => {
    const { hono, db } = app();
    const body = `{ "id" : "WH-SPACED-1",\n  "event_type":"PAYMENT.PAYOUTSBATCH.SUCCESS", "resource": {"batch_header":{"payout_batch_id":"CR9VS"}} }`;
    const s = sign(body);
    const res = await hono.request("/webhooks/paypal", { method: "POST", body: s.body, headers: s.headers });
    expect(res.status).toBe(200);
    expect(db.committed.get("WH-SPACED-1")?.raw).toBe(body);
    expect(db.committed.get("WH-SPACED-1")?.resourceKey).toBe("batch:CR9VS");
  });

  it("returns 400 for a forged delivery", async () => {
    const { hono } = app();
    const s = sign();
    const res = await hono.request("/webhooks/paypal", {
      method: "POST",
      body: s.body.replace("r37-M-014", "r37-M-999"),
      headers: s.headers,
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 for an oversized body, declared or streamed", async () => {
    const { hono } = app();
    const big = "x".repeat(300 * 1024);
    expect((await hono.request("/webhooks/paypal", { method: "POST", body: big })).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 40; i++) controller.enqueue(new Uint8Array(10 * 1024));
        controller.close();
      },
    });
    const res = await hono.request("/webhooks/paypal", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  it("still sees the raw bytes when an earlier middleware read the body as text", async () => {
    const { hono, db } = app({ consumeBodyFirst: true });
    const s = sign();
    const res = await hono.request("/webhooks/paypal", { method: "POST", body: s.body, headers: s.headers });
    expect(res.status).toBe(200);
    expect(db.committed.size).toBe(1);
  });
});

describe("readBodyWithLimit", () => {
  it("returns the bytes under the limit and null over it", async () => {
    const small = new Request("https://x.test/", { method: "POST", body: "abc" });
    expect(Buffer.from((await readBodyWithLimit(small, 10)) ?? []).toString()).toBe("abc");
    const large = new Request("https://x.test/", { method: "POST", body: "abcdefghijk" });
    expect(await readBodyWithLimit(large, 10)).toBeNull();
    expect((await readBodyWithLimit(new Request("https://x.test/"), 10))?.byteLength).toBe(0);
  });
});
