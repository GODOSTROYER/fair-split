import { createMemoryLimiter, createPayPalAuth, createPayPalHttp } from "@fairsplit/paypal-core";
import { payoutItemResource, syntheticEvent } from "@fairsplit/paypal-core/testing";
import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ProcessWebhookArgs, TaskName } from "./_shims/contracts.js";
import type { RunInTransaction } from "./_shims/persistence.js";
import {
  CATCH_UP_DEFAULT_LOOKBACK_MS,
  CATCH_UP_OVERLAP_MS,
  type CatchUpCursor,
  type CatchUpResult,
  catchUpWebhookEvents,
} from "./catchup.js";
import type { WebhookEventInsert } from "./paypal.js";

const SANDBOX = "https://api-m.sandbox.paypal.com";
const LIST_URL = `${SANDBOX}/v1/notifications/webhooks-events`;
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
const LAST_APPLIED = new Date("2026-10-29T11:00:00Z");

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
    /** An event that reached us another way (a delivery): already on file. */
    markStored: (id: string) => ids.add(id),
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

const deps = (db: ReturnType<typeof fakeDb>, logger?: { warn: () => void }) => ({
  http: paypalHttp(),
  transaction: db.transaction,
  insertWebhookEvent: db.insertWebhookEvent,
  enqueue: db.enqueue,
  now: () => NOW,
  ...(logger ? { logger } : {}),
});

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

type Listed = { id: string; event_type: string; create_time: string };

/** `count` item events, one every `stepMs`, starting at `from`. */
function events(count: number, from: string, stepMs = 60_000): Listed[] {
  return Array.from({ length: count }, (_, i) => ({
    ...(syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {}, `e${i}`) as Listed),
    create_time: new Date(Date.parse(from) + i * stepMs).toISOString(),
  }));
}

/**
 * PayPal's listing as it behaves: inclusive start_time/end_time, `page_size`, and `next` links with a
 * keyset-style cursor (`move_to=next&index_time=…&index_id=…`). `order` is the sort we pretend PayPal uses.
 */
function fakeListing(all: Listed[], order: "newest_first" | "oldest_first" | "as_given") {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(LIST_URL, ({ request }) => {
      const q = new URL(request.url).searchParams;
      calls.push(q);
      const start = Date.parse(q.get("start_time") ?? "");
      const end = Date.parse(q.get("end_time") ?? "");
      const size = Number(q.get("page_size") ?? "10");
      const offset = Number(q.get("index_id") ?? "0");
      const inWindow = all.filter((e) => {
        const t = Date.parse(e.create_time);
        return t >= start && t <= end;
      });
      if (order !== "as_given") {
        const sign = order === "newest_first" ? -1 : 1;
        inWindow.sort((a, b) => sign * (Date.parse(a.create_time) - Date.parse(b.create_time)));
      }
      const page = inWindow.slice(offset, offset + size);
      const last = page.at(-1);
      const links =
        last && offset + size < inWindow.length
          ? [
              {
                href: `${LIST_URL}?start_time=${q.get("start_time")}&end_time=${q.get("end_time")}&page_size=${size}&move_to=next&index_time=${last.create_time}&index_id=${offset + size}`,
                rel: "next",
                method: "GET",
              },
            ]
          : [];
      return HttpResponse.json({ events: page, count: page.length, links });
    }),
  );
  return calls;
}

/** Run passes the way WS-OPS will: carry `resume` forward until a pass returns null. */
async function catchUpUntilDone(
  db: ReturnType<typeof fakeDb>,
  options: { maxPages: number; pageSize: number },
) {
  const passes: CatchUpResult[] = [];
  let resume: CatchUpCursor | null = null;
  do {
    const result: CatchUpResult = await catchUpWebhookEvents(deps(db), {
      lastAppliedAt: LAST_APPLIED,
      resume,
      ...options,
    });
    passes.push(result);
    resume = result.resume;
  } while (resume !== null && passes.length < 20);
  return passes;
}

describe("catchUpWebhookEvents", () => {
  it("stores missed events as 'fetched', enqueues processWebhook, and skips known and foreign ones", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(LIST_URL, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ events: [item, paid, foreign], count: 3, links: [] });
      }),
    );
    const db = fakeDb([paid.id]);
    const result = await catchUpWebhookEvents(deps(db), { lastAppliedAt: LAST_APPLIED });
    expect(result).toMatchObject({
      listed: 3,
      inserted: 1,
      alreadyStored: 1,
      skipped: 1,
      truncated: false,
      resume: null,
    });
    expect(result.window.start.toISOString()).toBe(
      new Date(LAST_APPLIED.getTime() - CATCH_UP_OVERLAP_MS).toISOString(),
    );
    expect(queries[0]?.get("start_time")).toBe("2026-10-29T10:50:00.000Z");
    expect(queries[0]?.get("end_time")).toBe("2026-10-29T12:00:00.000Z");
    expect(db.rows).toEqual([
      {
        paypalEventId: item.id,
        eventType: "PAYMENT.PAYOUTS-ITEM.UNCLAIMED",
        resourceKey: "item:r37-M-031",
        verified: "fetched",
        status: "received",
        raw: expect.any(String),
        delivery: null,
      },
    ]);
    expect(JSON.parse(db.rows[0]?.raw ?? "{}")).toEqual(item);
    expect(db.outbox).toEqual([
      { name: "processWebhook", args: { webhookEventId: `row-${item.id}` }, key: `wh:${item.id}` },
    ]);
  });

  it("looks back a day when nothing has been applied yet, and hands back PayPal's next link when order is unknowable", async () => {
    let page = 0;
    server.use(
      http.get(LIST_URL, () => {
        page += 1;
        return HttpResponse.json({
          events: [],
          links: [{ href: `${LIST_URL}?page=${page + 1}`, rel: "next", method: "GET" }],
        });
      }),
    );
    const result = await catchUpWebhookEvents(deps(fakeDb()), { lastAppliedAt: null, maxPages: 2 });
    expect(result.window.start.getTime()).toBe(
      NOW.getTime() - CATCH_UP_DEFAULT_LOOKBACK_MS - CATCH_UP_OVERLAP_MS,
    );
    expect(result.truncated).toBe(true);
    expect(page).toBe(2);
    expect(result.resume).toEqual({
      start: result.window.start.toISOString(),
      end: NOW.toISOString(),
      next: `${LIST_URL}?page=3`,
      through: NOW.toISOString(),
    });
    expect(result.completedThrough).toBeNull();
  });

  it("repeating a truncated pass without its cursor never gets past PayPal's newest page", async () => {
    const all = events(12, "2026-10-29T10:51:00Z");
    fakeListing(all, "newest_first");
    const db = fakeDb();
    for (let i = 0; i < 3; i++) {
      await catchUpWebhookEvents(deps(db), { lastAppliedAt: LAST_APPLIED, maxPages: 1, pageSize: 4 });
    }
    expect(db.rows).toHaveLength(4);
  });

  it("converges: a 3-page newest-first listing with maxPages 1 is fully recovered within 4 passes of 1 call", async () => {
    const all = events(12, "2026-10-29T10:51:00Z");
    const calls = fakeListing(all, "newest_first");
    const db = fakeDb();
    const passes = await catchUpUntilDone(db, { maxPages: 1, pageSize: 4 });
    // Bounds are inclusive, so each resumed page re-reads its boundary event (deduped): 4 + 3 + 3 + 2.
    expect(passes).toHaveLength(4);
    expect(calls).toHaveLength(4);
    expect(new Set(db.rows.map((r) => r.paypalEventId))).toEqual(new Set(all.map((e) => e.id)));
    expect(db.outbox).toHaveLength(12);
    // Each pass narrows end_time to the oldest create_time already read (inclusive, so nothing is skipped).
    expect(passes.map((p) => p.window.end.toISOString())).toEqual([
      "2026-10-29T12:00:00.000Z",
      "2026-10-29T10:59:00.000Z",
      "2026-10-29T10:56:00.000Z",
      "2026-10-29T10:53:00.000Z",
    ]);
    expect(passes.map((p) => [p.inserted, p.alreadyStored])).toEqual([
      [4, 0],
      [3, 1],
      [3, 1],
      [2, 1],
    ]);
    expect(passes.at(-1)?.resume).toBeNull();
  });

  it("converges for an oldest-first listing too, by moving start_time forward", async () => {
    const all = events(12, "2026-10-29T10:51:00Z");
    fakeListing(all, "oldest_first");
    const db = fakeDb();
    const passes = await catchUpUntilDone(db, { maxPages: 1, pageSize: 4 });
    expect(passes).toHaveLength(4);
    expect(new Set(db.rows.map((r) => r.paypalEventId)).size).toBe(12);
    expect(passes.map((p) => p.window.start.toISOString())).toEqual([
      "2026-10-29T10:50:00.000Z",
      "2026-10-29T10:54:00.000Z",
      "2026-10-29T10:57:00.000Z",
      "2026-10-29T11:00:00.000Z",
    ]);
  });

  it("never skips events that share a second across a page boundary", async () => {
    const all = events(9, "2026-10-29T10:58:30.100Z", 150); // 9 events inside 1.2 s, ms apart
    fakeListing(all, "newest_first");
    const db = fakeDb();
    const passes = await catchUpUntilDone(db, { maxPages: 1, pageSize: 3 });
    expect(new Set(db.rows.map((r) => r.paypalEventId)).size).toBe(9);
    expect(passes.length).toBeLessThanOrEqual(6);
  });

  it("follows PayPal's next link when the events do not show an order (identical create_time)", async () => {
    const all = events(9, "2026-10-29T10:58:00Z", 0);
    const calls = fakeListing(all, "as_given");
    const db = fakeDb();
    const passes = await catchUpUntilDone(db, { maxPages: 1, pageSize: 4 });
    expect(passes).toHaveLength(3);
    expect(passes[0]?.resume?.next).toContain("move_to=next");
    expect(calls.map((q) => q.get("index_id"))).toEqual([null, "4", "8"]);
    expect(new Set(db.rows.map((r) => r.paypalEventId)).size).toBe(9);
  });

  // Verifier probe (trust, minor): transmission.ts and the README promise that a delivery refused for
  // good (PayPal's retries reusing the first headers) is recovered by catch-up. A pass that starts at the
  // newest applied event minus 10 minutes never lists an older refused event once anything newer has
  // been applied: an UNCLAIMED created 09:00:05 was refused, a SUCCEEDED applied at 09:20, and the
  // 10:07 pass queried from 09:10 and inserted nothing.
  it("recovers an older refused event after a newer one was applied: a pass starts from the previous pass's completedThrough, not the newest applied event", async () => {
    const refused = {
      ...(syntheticEvent("PAYMENT.PAYOUTS-ITEM.UNCLAIMED", {}, "refused") as Listed),
      create_time: "2026-10-29T09:00:05Z",
    };
    const applied = {
      ...(syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {}, "applied") as Listed),
      create_time: "2026-10-29T09:20:00Z",
    };
    const calls = fakeListing([refused, applied], "newest_first");
    const db = fakeDb([applied.id]);
    const at = new Date("2026-10-29T10:07:00Z");
    const result = await catchUpWebhookEvents(
      { ...deps(db), now: () => at },
      {
        lastAppliedAt: new Date("2026-10-29T09:20:00Z"),
        // The previous pass (at boot, 08:57) finished its window.
        completedThrough: new Date("2026-10-29T08:57:00Z"),
      },
    );
    expect(calls[0]?.get("start_time")).toBe("2026-10-29T08:47:00.000Z");
    expect(db.rows.map((r) => r.paypalEventId)).toEqual([refused.id]);
    expect(result).toMatchObject({ inserted: 1, alreadyStored: 1, truncated: false, resume: null });
    // The next pass starts from here.
    expect(result.completedThrough?.toISOString()).toBe(at.toISOString());
  });

  it.each(["newest_first", "oldest_first"] as const)(
    "reports completedThrough only once the window is finished (%s): null while a resume is pending, then the window's own end",
    async (order) => {
      fakeListing(events(12, "2026-10-29T10:51:00Z"), order);
      const passes = await catchUpUntilDone(fakeDb(), { maxPages: 1, pageSize: 4 });
      expect(passes).toHaveLength(4);
      expect(passes.map((p) => p.completedThrough?.toISOString() ?? null)).toEqual([
        null,
        null,
        null,
        NOW.toISOString(),
      ]);
      expect(passes.slice(0, -1).every((p) => p.resume?.through === NOW.toISOString())).toBe(true);
    },
  );

  it("passes chained the way WS-OPS runs them lose nothing between them, whatever is applied in between", async () => {
    // Pass 1 at 10:00 finishes; then E (10:05) is refused for good and F (10:30) is applied; pass 2 at
    // 11:00 starts from pass 1's completedThrough and recovers E.
    const e = {
      ...(syntheticEvent("PAYMENT.PAYOUTS-ITEM.HELD", {}, "e") as Listed),
      create_time: "2026-10-29T10:05:00Z",
    };
    const f = {
      ...(syntheticEvent("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", {}, "f") as Listed),
      create_time: "2026-10-29T10:30:00Z",
    };
    const all: Listed[] = [];
    fakeListing(all, "newest_first");
    const db = fakeDb();
    let at = new Date("2026-10-29T10:00:00Z");
    const pass = (completedThrough: Date | null, lastAppliedAt: Date | null) =>
      catchUpWebhookEvents({ ...deps(db), now: () => at }, { lastAppliedAt, completedThrough });
    const first = await pass(null, new Date("2026-10-29T09:00:00Z"));
    expect(first.completedThrough?.toISOString()).toBe("2026-10-29T10:00:00.000Z");
    all.push(e, f);
    db.markStored(f.id); // F was delivered and applied; E never got in
    at = new Date("2026-10-29T11:00:00Z");
    const second = await pass(first.completedThrough, new Date(f.create_time));
    expect(second.window.start.toISOString()).toBe("2026-10-29T09:50:00.000Z");
    expect(db.rows.map((r) => r.paypalEventId)).toEqual([e.id]);
    expect(second.completedThrough?.toISOString()).toBe("2026-10-29T11:00:00.000Z");
  });

  it("ignores an unreadable completedThrough (warns) and starts from the newest applied event", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(LIST_URL, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ events: [], links: [] });
      }),
    );
    const warn = vi.fn();
    await catchUpWebhookEvents(deps(fakeDb(), { warn }), {
      lastAppliedAt: LAST_APPLIED,
      completedThrough: new Date(Number.NaN),
    });
    expect(queries[0]?.get("start_time")).toBe("2026-10-29T10:50:00.000Z");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("ignores an unreadable cursor and starts the window over", async () => {
    const queries: URLSearchParams[] = [];
    server.use(
      http.get(LIST_URL, ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json({ events: [], links: [] });
      }),
    );
    const warn = vi.fn();
    const result = await catchUpWebhookEvents(deps(fakeDb(), { warn }), {
      lastAppliedAt: LAST_APPLIED,
      resume: { start: "yesterday", end: "today", next: null },
    });
    expect(result.window.start.toISOString()).toBe("2026-10-29T10:50:00.000Z");
    expect(queries[0]?.get("start_time")).toBe("2026-10-29T10:50:00.000Z");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
