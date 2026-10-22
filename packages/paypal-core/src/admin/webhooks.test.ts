import { HttpResponse, http } from "msw/http";
import { describe, expect, it } from "vitest";
import { createPayPalAuth } from "../auth.js";
import { PayPalHttpError } from "../errors.js";
import { createPayPalHttp } from "../http.js";
import { unlimitedLimiter } from "../limiter.js";
import {
  fakeWebhooksApi,
  oauthHandler,
  recordingSleep,
  SANDBOX,
  server,
  TEST_CLIENT_ID,
  TEST_CLIENT_SECRET,
  useMswServer,
} from "../test-support.js";
import { WEBHOOK_EVENT_TYPES } from "../webhook/event.js";
import {
  checkWebhookRegistration,
  ensureWebhook,
  ensureWebhookLookup,
  listWebhookEvents,
  resendWebhookEvent,
} from "./webhooks.js";

useMswServer();

const URL_A = "https://quiet-river-1234.trycloudflare.com/webhooks/paypal";
const URL_B = "https://brave-lake-5678.trycloudflare.com/webhooks/paypal";
const ALL = WEBHOOK_EVENT_TYPES.map((name) => ({ name }));

function client() {
  server.use(oauthHandler().handler);
  const auth = createPayPalAuth({ clientId: TEST_CLIENT_ID, clientSecret: TEST_CLIENT_SECRET });
  return createPayPalHttp({ auth, limiter: unlimitedLimiter, sleep: recordingSleep().sleep });
}

describe("ensureWebhook (idempotent registration)", () => {
  it("creates the webhook with exactly the register's 15 events, then a re-run changes nothing", async () => {
    const api = fakeWebhooksApi();
    const http = client();
    const first = await ensureWebhook(http, { url: URL_A });
    expect(first).toMatchObject({ action: "created", webhookId: "WH0001", url: URL_A, staleWebhookIds: [] });
    expect(api.webhooks[0]?.event_types.map((e) => e.name)).toEqual([...WEBHOOK_EVENT_TYPES]);
    const second = await ensureWebhook(http, { url: URL_A });
    expect(second).toMatchObject({ action: "unchanged", webhookId: "WH0001" });
    expect(api.writes).toEqual([`POST ${URL_A}`]);
  });

  it("replaces only /event_types when the URL matches but the set differs", async () => {
    const api = fakeWebhooksApi([
      { id: "WH9", url: URL_A, event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
    ]);
    const result = await ensureWebhook(client(), { url: URL_A });
    expect(result).toMatchObject({ action: "updated_event_types", webhookId: "WH9" });
    expect(api.writes).toEqual(["PATCH WH9 replace:/event_types"]);
    expect(api.webhooks[0]?.event_types).toHaveLength(15);
  });

  it("moves our webhook to a new tunnel URL with one PATCH, keeping its id (PP_WEBHOOK_ID survives)", async () => {
    const api = fakeWebhooksApi([
      { id: "WH7", url: URL_A, event_types: ALL },
      { id: "WH8", url: "https://old-1.trycloudflare.com/webhooks/paypal", event_types: ALL },
      { id: "OTHER", url: "https://example.com/other-hook", event_types: [{ name: "*" }] },
    ]);
    const result = await ensureWebhook(client(), { url: URL_B });
    expect(result).toMatchObject({
      action: "updated_url",
      webhookId: "WH7",
      previousUrl: URL_A,
      staleWebhookIds: ["WH8"],
    });
    expect(api.writes).toEqual(["PATCH WH7 replace:/url,replace:/event_types"]);
    expect(api.webhooks.find((w) => w.id === "OTHER")?.url).toBe("https://example.com/other-hook");
  });

  it("plans without writing in a dry run", async () => {
    const api = fakeWebhooksApi([{ id: "WH7", url: URL_A, event_types: ALL }]);
    const http = client();
    expect(await ensureWebhook(http, { url: URL_B, dryRun: true })).toMatchObject({
      action: "updated_url",
      dryRun: true,
    });
    expect(
      await ensureWebhook(http, { url: "https://x.onrender.com/hooks/other", dryRun: true }),
    ).toMatchObject({
      action: "created",
      webhookId: null,
    });
    expect(api.writes).toEqual([]);
  });

  it("converges when another run registered the URL between our list and create", async () => {
    const api = fakeWebhooksApi();
    let lists = 0;
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks`, () => {
        lists += 1;
        return HttpResponse.json({ webhooks: lists === 1 ? [] : api.webhooks });
      }),
    );
    api.webhooks.push({ id: "WH5", url: URL_A, event_types: ALL });
    const result = await ensureWebhook(client(), { url: URL_A });
    expect(result).toMatchObject({ action: "unchanged", webhookId: "WH5" });
    expect(lists).toBe(2);
  });

  it("surfaces PayPal errors with name and debug_id", async () => {
    fakeWebhooksApi();
    server.use(
      http.post(`${SANDBOX}/v1/notifications/webhooks`, () =>
        HttpResponse.json({ name: "WEBHOOK_NUMBER_LIMIT_EXCEEDED", debug_id: "dbg-limit" }, { status: 400 }),
      ),
    );
    const err = await ensureWebhook(client(), { url: URL_A }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayPalHttpError);
    expect(err).toMatchObject({ paypalName: "WEBHOOK_NUMBER_LIMIT_EXCEEDED", debugId: "dbg-limit" });
  });
});

describe("ensureWebhookLookup", () => {
  it("creates a lookup once and reuses it afterwards", async () => {
    const api = fakeWebhooksApi();
    const http = client();
    expect(await ensureWebhookLookup(http)).toEqual({ action: "created", dryRun: false, lookupId: "WL-1" });
    expect(await ensureWebhookLookup(http)).toEqual({ action: "exists", dryRun: false, lookupId: "WL-1" });
    expect(api.writes).toEqual(["POST lookup"]);
  });
});

describe("checkWebhookRegistration (drift check for /readyz)", () => {
  it("is ok for a matching registration and lists every problem otherwise", async () => {
    fakeWebhooksApi([{ id: "WH7", url: URL_A, event_types: ALL.slice(0, 3) }]);
    const http = client();
    expect(await checkWebhookRegistration(http, { url: URL_B })).toEqual({
      ok: false,
      webhookId: null,
      problems: ["no webhook registered for this URL"],
    });
    expect(await checkWebhookRegistration(http, { url: URL_A, webhookId: "WH1" })).toEqual({
      ok: false,
      webhookId: "WH7",
      problems: ["registered id differs from PP_WEBHOOK_ID", "event types differ from the register's 15"],
    });
    await ensureWebhook(http, { url: URL_A });
    expect(await checkWebhookRegistration(http, { url: URL_A, webhookId: "WH7" })).toEqual({
      ok: true,
      webhookId: "WH7",
      problems: [],
    });
  });

  it("never throws", async () => {
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks`, () => HttpResponse.json({}, { status: 500 })),
    );
    const result = await checkWebhookRegistration(client(), { url: URL_A });
    expect(result.ok).toBe(false);
    expect(result.problems[0]).toContain("list failed");
  });
});

describe("catch-up and resend", () => {
  it("pages through webhooks-events with start_time/end_time, following next links up to maxPages", async () => {
    const seen: string[] = [];
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks-events`, ({ request }) => {
        const url = new URL(request.url);
        seen.push(url.search);
        const page = Number(url.searchParams.get("page") ?? "1");
        return HttpResponse.json({
          events: [{ id: `WH-E${page}`, event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED" }],
          count: 1,
          links: [
            {
              href: `https://api.sandbox.paypal.com/v1/notifications/webhooks-events?page=${page + 1}`,
              rel: "next",
              method: "GET",
            },
          ],
        });
      }),
    );
    const result = await listWebhookEvents(client(), {
      startTime: new Date("2026-10-29T08:00:00Z"),
      endTime: new Date("2026-10-29T09:00:00Z"),
      maxPages: 3,
    });
    expect(result.events.map((e) => e.id)).toEqual(["WH-E1", "WH-E2", "WH-E3"]);
    expect(result.truncated).toBe(true);
    expect(seen[0]).toBe(
      "?page_size=50&start_time=2026-10-29T08%3A00%3A00.000Z&end_time=2026-10-29T09%3A00%3A00.000Z",
    );
    expect(seen[1]).toBe("?page=2");
    expect(result.next).toBe("https://api.sandbox.paypal.com/v1/notifications/webhooks-events?page=4");

    // Resuming from that link continues where the listing stopped instead of starting over.
    const resumed = await listWebhookEvents(client(), {
      startTime: new Date("2026-10-29T08:00:00Z"),
      endTime: new Date("2026-10-29T09:00:00Z"),
      maxPages: 1,
      from: result.next,
    });
    expect(resumed.events.map((e) => e.id)).toEqual(["WH-E4"]);
    expect(seen.at(-1)).toBe("?page=4");
  });

  it("reports next as null when the listing reached its end", async () => {
    server.use(
      http.get(`${SANDBOX}/v1/notifications/webhooks-events`, () =>
        HttpResponse.json({ events: [{ id: "WH-ONLY", event_type: "INVOICING.INVOICE.PAID" }], links: [] }),
      ),
    );
    const result = await listWebhookEvents(client(), {
      startTime: new Date("2026-10-29T08:00:00Z"),
      endTime: new Date("2026-10-29T09:00:00Z"),
    });
    expect(result).toMatchObject({ truncated: false, next: null });
  });

  it("resends one event to our webhook", async () => {
    let body: unknown;
    server.use(
      http.post(`${SANDBOX}/v1/notifications/webhooks-events/:id/resend`, async ({ request, params }) => {
        body = { id: params.id, ...((await request.json()) as object) };
        return HttpResponse.json({ id: params.id }, { status: 202 });
      }),
    );
    const result = await resendWebhookEvent(client(), "WH-77", ["WH7"]);
    expect(result.ok && result.status).toBe(202);
    expect(body).toEqual({ id: "WH-77", webhook_ids: ["WH7"] });
  });
});
