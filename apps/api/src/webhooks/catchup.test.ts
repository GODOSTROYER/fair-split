import { createMemoryLimiter, createPayPalAuth, createPayPalHttp } from "@fairsplit/paypal-core";
import { payoutItemResource, syntheticEvent } from "@fairsplit/paypal-core/testing";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ProcessWebhookArgs, TaskName } from "./_shims/contracts.js";
import type { RunInTransaction } from "./_shims/persistence.js";
import { CATCH_UP_DEFAULT_LOOKBACK_MS, CATCH_UP_OVERLAP_MS, catchUpWebhookEvents } from "./catchup.js";
import type { WebhookEventInsert } from "./paypal.js";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const server = setupServer(
  http.post(`${SANDBOX}/v1/oauth2/token`, () =>
    HttpResponse.json({
      access_token: "tok-catchup",
      token_type: "Bearer",
      expires_in: 32_400,
      scope: "https://uri.paypal.com/services/applications/webhooks",
    }),
  ),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOW = new Date("2026-10-29T12:00:00Z");

function fakeDb(preexisting: string[] = []) {
  type Tx = {
    rows: WebhookEventInsert[];
    outbox: { name: TaskName; args: ProcessWebhookArgs; key: string }[];
  };
  const ids = new Set(preexisting);
  const rows: WebhookEventInsert[] = [];
  const outbox: Tx["outbox"] = [];
  const transaction: RunInTransaction<Tx> = async (fn) => {
    const tx: Tx = { rows: [], outbox: [] };
    const result = await fn(tx);
    rows.push(...tx.rows);
    outbox.push(...tx.outbox);
    return result;
  };
  return {
    rows,
    outbox,
    transaction,
    insertWebhookEvent: async (tx: Tx, row: WebhookEventInsert) => {
      if (ids.has(row.paypalEventId)) return null;
      ids.add(row.paypalEventId);
      tx.rows.push(row);
      return { id: `row-${row.paypalEventId}` };
    },
    enqueue: async (tx: Tx, name: TaskName, args: ProcessWebhookArgs, key: string) => {
      tx.outbox.push({ name, args, key });
    },
  };
}

function paypalHttp() {
  const auth = createPayPalAuth({
    clientId: "catchup-client",
    clientSecret: ["catchup", "secret"].join("-"),
  });
  return createPayPalHttp({ auth, limiter: createMemoryLimiter() });
}

const item = syntheticEvent(
  "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
  payoutItemResource({
    senderItemId: "r37-M-031",
    payoutItemId: "7QX",
    payoutBatchId: "CR9VS",
    transactionStatus: "UNCLAIMED",
  }),
  "rhea",
) as { id: string };
const paid = syntheticEvent("INVOICING.INVOICE.PAID", { invoice: { id: "INV2-A" } }, "paid") as {
  id: string;
};
const foreign = syntheticEvent("PAYMENT.CAPTURE.COMPLETED", { id: "CAP" }, "capture") as { id: string };

describe("catchUpWebhookEvents", () => {
  it("stores missed events as 'fetched', enqueues processWebhook, and skips known and foreign ones", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks-events`, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ events: [item, paid, foreign], count: 3, links: [] });
      }),
    );
    const db = fakeDb([paid.id]);
    const result = await catchUpWebhookEvents(
      {
        http: paypalHttp(),
        transaction: db.transaction,
        insertWebhookEvent: db.insertWebhookEvent,
        enqueue: db.enqueue,
        now: () => NOW,
      },
      { lastAppliedAt: new Date("2026-10-29T11:00:00Z") },
    );
    expect(result).toMatchObject({ listed: 3, inserted: 1, alreadyStored: 1, skipped: 1, truncated: false });
    expect(result.window.start.toISOString()).toBe(
      new Date(Date.parse("2026-10-29T11:00:00Z") - CATCH_UP_OVERLAP_MS).toISOString(),
    );
    expect(queries[0]?.get("start_time")).toBe("2026-10-29T10:50:00.000Z");
    expect(queries[0]?.get("end_time")).toBe("2026-10-29T12:00:00.000Z");
    expect(db.rows).toEqual([
      expect.objectContaining({
        paypalEventId: item.id,
        eventType: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
        resourceKey: "item:r37-M-031",
        verified: "fetched",
        status: "received",
        transmissionId: null,
      }),
    ]);
    expect(JSON.parse(db.rows[0]?.raw ?? "{}")).toEqual(item);
    expect(db.outbox).toEqual([
      { name: "processWebhook", args: { webhookEventId: `row-${item.id}` }, key: `wh:${item.id}` },
    ]);
  });

  it("looks back a day when nothing has been applied yet, and reports truncation", async () => {
    let page = 0;
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks-events`, () => {
        page += 1;
        return HttpResponse.json({
          events: [],
          links: [
            {
              href: `${SANDBOX}/v1/notifications/webhooks-events?page=${page + 1}`,
              rel: "next",
              method: "GET",
            },
          ],
        });
      }),
    );
    const db = fakeDb();
    const result = await catchUpWebhookEvents(
      {
        http: paypalHttp(),
        transaction: db.transaction,
        insertWebhookEvent: db.insertWebhookEvent,
        enqueue: db.enqueue,
        now: () => NOW,
      },
      { lastAppliedAt: null, maxPages: 2 },
    );
    expect(result.window.start.getTime()).toBe(
      NOW.getTime() - CATCH_UP_DEFAULT_LOOKBACK_MS - CATCH_UP_OVERLAP_MS,
    );
    expect(result.truncated).toBe(true);
    expect(page).toBe(2);
  });
});
