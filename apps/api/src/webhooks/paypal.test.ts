import { createHash } from "node:crypto";
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
import * as applyModule from "./apply.js";
import {
  corroborateWithSettleGet,
  createPayPalWebhookHandler,
  type DuplicateDelivery,
  honoPayPalWebhook,
  MAX_REJECTED_HEADER_CHARS,
  MAX_WEBHOOK_BODY_BYTES,
  type PayPalWebhookDeps,
  prewarmWebhookCertificates,
  readBodyWithLimit,
  SETTLE_GET_DELAYS_MS,
  type WebhookEventInsert,
  webhookApplyRule,
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

/** The route's verifier wiring, as apps/api does it: verify with the client IP, release on a failed store. */
function realVerifier(
  options: {
    devMocks?: boolean;
    postback?: PostbackFn;
    pems?: Record<string, string>;
    now?: () => number;
  } = {},
): Pick<PayPalWebhookDeps<unknown>, "verify" | "releaseTransmission"> {
  const verifier = createPayPalWebhookVerifier({
    ...(options.devMocks ? { devMocks: true } : {}),
    ...(options.postback ? { postback: options.postback } : {}),
    ...(options.now ? { now: options.now } : {}),
    fetch: pemServer({ [TEST_CERT_URL]: leaf.pem, ...options.pems }),
  });
  return {
    verify: (raw, headers, context) =>
      verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID, { clientIp: context.clientIp }),
    releaseTransmission: (transmissionId) => verifier.releaseTransmission(transmissionId),
  };
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
    ...(options.verify
      ? { verify: options.verify }
      : realVerifier(options.devMocks ? { devMocks: true } : {})),
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

  it("dedupes on paypal_event_id: PayPal's resend (new transmission id) is 200 with no second task", async () => {
    const { handler, committed, outbox, duplicates } = setup();
    const first = sign();
    expect((await handler(request(first))).outcome).toBe("accepted");
    const resent = sign(); // PayPal's resend: same event id, new transmission id and signature
    const again = sign();
    expect(await handler(request(resent))).toMatchObject({ status: 200, outcome: "duplicate" });
    expect(await handler(request(again))).toMatchObject({ status: 200, outcome: "duplicate" });
    expect(committed.size).toBe(1);
    expect(outbox).toHaveLength(1);
    expect(duplicates.map((d) => d.transmissionId)).toEqual([
      resent.headers["paypal-transmission-id"],
      again.headers["paypal-transmission-id"],
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

  it("refuses a byte-identical replay of an accepted delivery (same transmission id): 400, no second task, no duplicate beat", async () => {
    const { handler, committed, outbox, duplicates } = setup();
    const first = sign();
    expect((await handler(request(first))).outcome).toBe("accepted");
    expect(await handler(request(first))).toEqual({
      status: 400,
      outcome: "rejected",
      paypalEventId: null,
      reason: "TRANSMISSION_REPLAYED",
    });
    expect(outbox).toHaveLength(1);
    expect(duplicates).toEqual([]);
    expect(committed.get(`rejected:${first.headers["paypal-transmission-id"]}`)?.delivery?.rejectReason).toBe(
      "TRANSMISSION_REPLAYED",
    );
  });

  it("refuses a correctly signed delivery transmitted more than 5 minutes ago, before fetching a certificate", async () => {
    let fetches = 0;
    const db = fakeDb();
    const verifier = createPayPalWebhookVerifier({
      fetch: async (input) => {
        fetches += 1;
        return pemServer({ [TEST_CERT_URL]: leaf.pem })(input);
      },
    });
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: (raw, headers, context) =>
        verifier.verifyDetailed(raw, headers, TEST_WEBHOOK_ID, { clientIp: context.clientIp }),
    });
    const stale = signWebhook({
      body: itemEvent,
      webhookId: TEST_WEBHOOK_ID,
      privateKey: leaf.privateKey,
      transmissionTime: new Date(Date.now() - 6 * 60_000).toISOString(),
    });
    expect(await handler(request(stale))).toMatchObject({
      status: 400,
      outcome: "rejected",
      reason: "TRANSMISSION_TIME_OUT_OF_WINDOW",
    });
    expect(fetches).toBe(0);
    expect(db.outbox).toEqual([]);
  });

  it("caps bodies at 64 KB: 413 before verification", async () => {
    expect(MAX_WEBHOOK_BODY_BYTES).toBe(64 * 1024);
    const verify = vi.fn(async (): Promise<VerifyOutcome> => {
      throw new Error("must not be called");
    });
    const { handler } = setup({ verify });
    const res = await handler({ rawBody: new Uint8Array(64 * 1024 + 1), headers: {} });
    expect(res).toMatchObject({ status: 413, outcome: "too_large" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("a verification that finishes after the route timed out frees its transmission id, so PayPal's retry is judged afresh", async () => {
    const released: string[] = [];
    let finish: (o: VerifyOutcome) => void = () => undefined;
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      verify: () =>
        new Promise<VerifyOutcome>((resolve) => {
          finish = resolve;
        }),
      releaseTransmission: async (id) => void released.push(id),
      verifyTimeoutMs: 20,
    });
    expect(await handler(request(sign()))).toMatchObject({ status: 500, reason: "VERIFY_TIMEOUT" });
    finish({
      mode: "self",
      reason: null,
      detail: null,
      retryable: false,
      transmissionId: "tid-late",
      certUrl: TEST_CERT_URL,
      crc32: 1,
      postback: null,
      certSource: "network",
      certWarning: null,
    });
    await vi.waitFor(() => expect(released).toEqual(["tid-late"]));
  });

  it("exposes the apply contract processWebhook follows (./apply.ts); the route itself changes no state", () => {
    expect(webhookApplyRule).toBe(applyModule.webhookApplyRule);
    expect(corroborateWithSettleGet).toBe(applyModule.corroborateWithSettleGet);
    expect(SETTLE_GET_DELAYS_MS).toBe(applyModule.SETTLE_GET_DELAYS_MS);
    expect(
      webhookApplyRule({
        eventType: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
        verified: "self",
        delivery: { certWarning: null },
      }).action,
    ).toBe("fresh_get_first");
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

  // Verifier follow-up (regress, minor): S3.4, S3.6.5 and review resolution 18 keep rejects "as hashes
  // only" (raw_sha256, bytes, five PayPal headers of at most 256 characters). The route stored up to 8 KB
  // of every forged body, plus a 2,048-character signature, in rows the app cannot delete.
  it("keeps no rejected body: only its sha256 and size (S3.4: rejects stored as hashes only)", async () => {
    const { handler, committed } = setup();
    const junk = JSON.stringify({ event_type: "X", pad: "x".repeat(20_000) });
    const res = await handler({
      rawBody: Buffer.from(junk),
      headers: { "paypal-transmission-id": "t-junk" },
    });
    expect(res).toMatchObject({ status: 400, reason: "MISSING_HEADER" });
    const row = committed.get("rejected:t-junk");
    expect(JSON.parse(row?.raw ?? "null")).toEqual({
      raw_sha256: createHash("sha256").update(junk).digest("hex"),
      bytes: Buffer.byteLength(junk),
    });
    expect(row?.raw).not.toContain("xxx");
    expect(row?.eventType).toBe("X");
    expect(row?.delivery?.rejectReason).toBe("MISSING_HEADER:paypal-transmission-time");
  });

  it("a replayed copy of a genuine delivery leaves none of its contents (receiver, amount) in the rejected row", async () => {
    const { handler, committed } = setup();
    const first = sign();
    expect((await handler(request(first))).outcome).toBe("accepted");
    expect((await handler(request(first))).reason).toBe("TRANSMISSION_REPLAYED");
    const row = committed.get(`rejected:${first.headers["paypal-transmission-id"]}`);
    expect(row?.status).toBe("rejected");
    for (const secret of ["member@example.test", "1.00", "r37-M-014", "5KX9"]) {
      expect(JSON.stringify(row)).not.toContain(secret);
    }
    expect(JSON.parse(row?.raw ?? "null")).toEqual({
      raw_sha256: createHash("sha256").update(first.body).digest("hex"),
      bytes: Buffer.byteLength(first.body),
    });
  });

  it("clips the five PayPal headers of a rejected row to 256 characters; an accepted row keeps the whole signature", async () => {
    expect(MAX_REJECTED_HEADER_CHARS).toBe(256);
    const { handler, committed } = setup();
    const s = sign();
    const long = "A".repeat(4_000);
    const res = await handler({
      rawBody: Buffer.from(s.body),
      headers: {
        ...s.headers,
        "paypal-transmission-sig": `${s.headers["paypal-transmission-sig"]}${long}`,
        "paypal-auth-algo": `SHA256withRSA${long}`,
        "paypal-transmission-time": `${s.headers["paypal-transmission-time"]}${long}`,
        "paypal-cert-url": `${s.headers["paypal-cert-url"]}${long}`,
      },
    });
    expect(res.status).toBe(400);
    const row = committed.get(`rejected:${s.headers["paypal-transmission-id"]}`);
    const d = row?.delivery;
    expect(d).toBeDefined();
    for (const value of [d?.transmissionSig, d?.authAlgo, d?.transmissionTime, d?.certUrl]) {
      expect(value?.length ?? 0).toBeGreaterThan(0);
      expect(value?.length ?? 0).toBeLessThanOrEqual(256);
    }
    // An accepted row needs the whole signature: processWebhook's postback replays it to PayPal.
    const ok = sign();
    expect((await handler(request(ok))).outcome).toBe("accepted");
    const stored = [...committed.values()].find((r) => r.status === "received");
    expect(stored?.delivery?.transmissionSig).toBe(ok.headers["paypal-transmission-sig"]);
    expect((stored?.delivery?.transmissionSig ?? "").length).toBeGreaterThan(256);
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
    const { handler, committed, outbox } = setup({ verify: realVerifier({ postback }).verify });
    const paid = syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } });
    const started = performance.now();
    const res = await handler(request(sign(paid)));
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(res).toMatchObject({ status: 200, outcome: "accepted" });
    expect(postback).not.toHaveBeenCalled();
    expect([...committed.values()][0]).toMatchObject({ verified: "self", resourceKey: "invoice:INV2-A" });
    expect(outbox).toHaveLength(1);
  });

  it("an expired-certificate SUCCEEDED is stored labelled CERT_EXPIRED and changes no state before a GET; an in-date one still applies at once (MM-1)", async () => {
    const expired = pki.issueLeaf({
      notBefore: new Date(Date.now() - 400 * DAY),
      notAfter: new Date(Date.now() - DAY),
    });
    const url = testCertUrl("route-expired");
    const answers = new Map<string, "SUCCESS" | "FAILURE">();
    const postback = vi.fn<PostbackFn>(async (input) => answers.get(input.transmissionId) ?? "FAILURE");
    const warn = vi.fn();
    const db = fakeDb();
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      ...realVerifier({ postback, pems: { [url]: expired.pem } }),
      logger: { warn },
    });
    const signedExpired = (body: object) =>
      signWebhook({ body, webhookId: TEST_WEBHOOK_ID, privateKey: expired.privateKey, certUrl: url });

    // PayPal confirms this very transmission: stored, but labelled, so processWebhook GETs first.
    const confirmed = signedExpired(itemEvent);
    answers.set(confirmed.headers["paypal-transmission-id"] ?? "", "SUCCESS");
    expect(await handler(request(confirmed))).toMatchObject({ status: 200, outcome: "accepted" });
    const row = db.committed.get((itemEvent as { id: string }).id);
    expect(row).toMatchObject({
      verified: "postback",
      delivery: { certUrl: url, certWarning: "CERT_EXPIRED" },
    });
    expect(row && webhookApplyRule(row)).toEqual({ action: "fresh_get_first", reason: "CERT_EXPIRED" });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ certWarning: "CERT_EXPIRED" }),
      "paypal webhook accepted with an expired certificate",
    );

    // The next delivery under the same certificate gets no credit from the first: PayPal says FAILURE, 400.
    const other = syntheticEvent(
      "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      payoutItemResource({
        senderItemId: "r37-M-015",
        payoutItemId: "5KY0",
        payoutBatchId: "CR9VS",
        transactionStatus: "SUCCESS",
      }),
      "expired-second",
    );
    expect(await handler(request(signedExpired(other)))).toMatchObject({
      status: 400,
      outcome: "rejected",
      reason: "CERT_EXPIRED",
    });
    expect(postback).toHaveBeenCalledTimes(2);
    expect(db.outbox).toHaveLength(1);

    // An in-date certificate: verified 'self', no warning, applies at once as before.
    const fresh = fakeDb();
    const freshHandler = createPayPalWebhookHandler({ ...fresh.deps, ...realVerifier() });
    expect((await freshHandler(request(sign()))).status).toBe(200);
    const freshRow = fresh.committed.get((itemEvent as { id: string }).id);
    expect(freshRow).toMatchObject({ verified: "self", delivery: { certWarning: null } });
    expect(freshRow && webhookApplyRule(freshRow)).toEqual({
      action: "apply_now",
      status: "SUCCESS",
      corroboration: "settle_get",
    });
  });

  it("MM-1 needs `delivery` back exactly as the route wrote it, null keys included; without it every SUCCEEDED waits for the settle GET", async () => {
    const { handler, committed } = setup();
    expect((await handler(request(sign()))).status).toBe(200);
    const row = committed.get((itemEvent as { id: string }).id);
    if (!row) throw new Error("the event was not stored");
    // A jsonb column keeps null-valued keys, so the round trip changes nothing and MM-1 fires.
    const readBack = JSON.parse(JSON.stringify(row.delivery));
    expect(readBack).toEqual(row.delivery);
    expect(readBack).toHaveProperty("certWarning", null);
    expect(webhookApplyRule({ ...row, delivery: readBack })).toEqual({
      action: "apply_now",
      status: "SUCCESS",
      corroboration: "settle_get",
    });
    // A repository that drops the column, or strips null keys on the way in: fails closed, MM-1 is off.
    const stripped = Object.fromEntries(Object.entries(readBack).filter(([, value]) => value !== null));
    const { delivery: _dropped, ...withoutColumn } = row;
    for (const stored of [{ ...row, delivery: null }, { ...row, delivery: stripped }, withoutColumn]) {
      expect(webhookApplyRule(stored as typeof row)).toEqual({
        action: "fresh_get_first",
        reason: "DELIVERY_NOT_RECORDED",
      });
    }
  });

  it("inv.i7.outbox: if enqueue fails, nothing is committed and a retry stores the event once", async () => {
    const db = fakeDb();
    let failEnqueue = true;
    const handler = createPayPalWebhookHandler({
      ...db.deps,
      ...realVerifier(),
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
    await dev.handler(request(sign(itemEvent, "WEBHOOK_ID")));
    expect((await dev.handler(request(sign(itemEvent, "WEBHOOK_ID")))).outcome).toBe("duplicate");
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
    const handler = createPayPalWebhookHandler({ ...db.deps, ...realVerifier() });
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
