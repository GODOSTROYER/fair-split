import { createPayPalWebhookVerifier, type VerifyOutcome } from "@fairsplit/paypal-core";
import {
  createTestPki,
  payoutItemResource,
  signWebhook,
  syntheticEvent,
  TEST_WEBHOOK_ID,
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
  readBodyWithLimit,
  type WebhookEventInsert,
} from "./paypal.js";

const pki = createTestPki();
const leaf = pki.issueLeaf();

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

function realVerifier(devMocks = false) {
  const verifier = createPayPalWebhookVerifier({
    devMocks,
    fetch: async () => new Response(leaf.pem, { headers: { "content-type": "application/x-pem-file" } }),
  });
  return (raw: Uint8Array, headers: Parameters<typeof verifier.verifyDetailed>[1]) =>
    verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID);
}

function setup(options: { devMocks?: boolean; verify?: PayPalWebhookDeps<unknown>["verify"] } = {}) {
  const db = fakeDb();
  const handler = createPayPalWebhookHandler({
    ...db.deps,
    verify: options.verify ?? realVerifier(options.devMocks),
    now: () => new Date("2026-10-29T09:12:45Z"),
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
const sign = (body: string | object = itemEvent, webhookId = TEST_WEBHOOK_ID) =>
  signWebhook({ body, webhookId, privateKey: leaf.privateKey });
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
      resourceType: "payouts_item",
      resourceKey: "item:r37-M-014",
      verified: "self",
      status: "received",
      raw: s.body,
      transmissionId: s.headers["paypal-transmission-id"],
      rejectReason: null,
    });
    expect(outbox).toEqual([
      { name: "processWebhook", args: { webhookEventId: row?.id }, dedupeKey: `wh:${eventId}` },
    ]);
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
  });

  it("rejects a tampered body with 400, stores a 'rejected' row and enqueues nothing", async () => {
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
    expect(row).toMatchObject({ status: "rejected", verified: null, rejectReason: "SIGNATURE_MISMATCH" });
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
    expect(row?.rejectReason).toBe("MISSING_HEADER:paypal-transmission-time");
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
    expect(committed.get(keys[0] ?? "")?.transmissionId).toBeNull();
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

  it("hands the (unverified) event type to verify as a hint for the postback decision", async () => {
    const seen: (string | null)[] = [];
    const inner = realVerifier();
    const { handler } = setup({
      verify: async (raw, headers, hint) => {
        seen.push(hint.eventType);
        return inner(raw, headers);
      },
    });
    await handler(request(sign(syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } }))));
    expect(seen).toEqual(["INVOICING.INVOICE.PAID"]);
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
