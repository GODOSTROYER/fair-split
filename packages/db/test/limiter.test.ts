import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/client.js";
import { createLimiter, LIMITER_DEFAULTS } from "../src/limiter.js";
import { paypalCalls } from "../src/schema/index.js";
import { openTestDb, type TestDb } from "../src/testing/index.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 12 });
});
beforeEach(async () => {
  await t.owner.db.delete(paypalCalls);
});
afterAll(async () => {
  await t?.close();
});

const live = { purpose: "toolkit:get_invoice", priority: "live" as const };
const bg = { purpose: "reconcile:batch", priority: "background" as const };

/** Occupy n slots that were granted `agoMs` ago. */
async function occupy(
  n: number,
  agoMs: number,
  priority: "live" | "background" = "live",
  status: number | null = 200,
) {
  await t.owner.db.insert(paypalCalls).values(
    Array.from({ length: n }, () => ({
      purpose: "seed",
      priority,
      status,
      at: sql`clock_timestamp() - make_interval(secs => ${agoMs / 1000})`,
      respondedAt: sql`clock_timestamp() - make_interval(secs => ${agoMs / 1000})`,
    })),
  );
}

describe("limiter.take: 40 calls a minute across all services (register §8)", () => {
  it("uses the register's numbers", () => {
    expect(LIMITER_DEFAULTS).toEqual({
      perWindow: 40,
      backgroundPerWindow: 20,
      windowMs: 60_000,
      circuitMs: 360_000,
    });
  });

  it("grants 40 calls in a window, then refuses with the time until the oldest call leaves it", async () => {
    const limiter = createLimiter(t.app.db);
    await occupy(1, 30_000); // the oldest call in the window, 30 s ago
    for (let i = 0; i < 39; i++) expect((await limiter.take(live)).ok).toBe(true);
    const denied = await limiter.take(live);
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.reason).toBe("WINDOW_FULL");
      expect(denied.retryAfterMs).toBeGreaterThan(25_000);
      expect(denied.retryAfterMs).toBeLessThanOrEqual(30_000);
    }
    const s = await limiter.state();
    expect(s.inWindow).toBe(40);
  });

  it("the window slides: calls older than 60 s no longer count", async () => {
    const limiter = createLimiter(t.app.db);
    await occupy(40, 61_000);
    expect((await limiter.take(live)).ok).toBe(true);
  });

  it("caps background work at 20 a window so live judges always keep 20", async () => {
    const limiter = createLimiter(t.app.db);
    for (let i = 0; i < 20; i++) expect((await limiter.take(bg)).ok).toBe(true);
    const denied = await limiter.take(bg);
    expect(denied).toMatchObject({ ok: false, reason: "BACKGROUND_FULL" });
    for (let i = 0; i < 20; i++) expect((await limiter.take(live)).ok).toBe(true);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "WINDOW_FULL" });
  });

  it("holds the global cap under concurrency from many processes: exactly 40 of 60 are granted", async () => {
    const pools = Array.from({ length: 6 }, () => createDb(t.url, { role: "fs_app", max: 2 }));
    const limiters = pools.map((p) => createLimiter(p.db));
    try {
      const results = await Promise.all(
        Array.from({ length: 60 }, (_, i) => limiters[i % limiters.length]?.take(live)),
      );
      expect(results.filter((r) => r?.ok)).toHaveLength(40);
    } finally {
      await Promise.all(pools.map((p) => p.close()));
    }
  });

  it("record() completes the call row with status, debug id and latency", async () => {
    const limiter = createLimiter(t.app.db);
    const g = await limiter.take({
      ...live,
      workspaceId: null,
      method: "GET",
      path: "/v2/invoicing/invoices/x",
    });
    if (!g.ok) throw new Error("expected a grant");
    await limiter.record(g.callId, { status: 200, debugId: "f00dbabe", ms: 321 });
    const [row] = await t.app.db.select().from(paypalCalls).where(sql`${paypalCalls.id} = ${g.callId}`);
    expect(row).toMatchObject({ status: 200, debugId: "f00dbabe", ms: 321, method: "GET" });
    expect(row?.respondedAt).toBeInstanceOf(Date);
  });
});

describe("the 429 circuit (6 minutes, derived from paypal_calls)", () => {
  it("a recorded 429 refuses every priority until 6 minutes after it arrived", async () => {
    const limiter = createLimiter(t.app.db);
    const g = await limiter.take(live);
    if (!g.ok) throw new Error("expected a grant");
    await limiter.record(g.callId, { status: 429, ms: 40 });
    for (const req of [live, bg]) {
      const r = await limiter.take(req);
      expect(r).toMatchObject({ ok: false, reason: "CIRCUIT_OPEN" });
      if (!r.ok) {
        expect(r.retryAfterMs).toBeGreaterThan(355_000);
        expect(r.retryAfterMs).toBeLessThanOrEqual(360_000);
      }
    }
    expect((await limiter.state()).circuitOpenUntil).toBeInstanceOf(Date);
    // acquire() never waits out an open circuit
    const t0 = Date.now();
    expect(await limiter.acquire(live, { maxWaitMs: 5_000 })).toMatchObject({
      ok: false,
      reason: "CIRCUIT_OPEN",
    });
    expect(Date.now() - t0).toBeLessThan(1_000);
  });

  it("closes once the 429 is more than 6 minutes old", async () => {
    const limiter = createLimiter(t.app.db);
    await occupy(1, 361_000, "live", 429);
    expect((await limiter.take(live)).ok).toBe(true);
    await occupy(1, 359_000, "live", 429);
    expect(await limiter.take(live)).toMatchObject({ ok: false, reason: "CIRCUIT_OPEN" });
  });
});

describe("limiter.acquire", () => {
  it("waits out a full window when allowed to, then takes the slot", async () => {
    const limiter = createLimiter(t.app.db, { perWindow: 2, windowMs: 1_000 });
    expect((await limiter.take(live)).ok).toBe(true);
    expect((await limiter.take(live)).ok).toBe(true);
    expect((await limiter.take(live)).ok).toBe(false);
    const t0 = Date.now();
    const r = await limiter.acquire(live, { maxWaitMs: 3_000 });
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeGreaterThan(300);
  });

  it("gives up with the denial when the wait would exceed maxWaitMs", async () => {
    const limiter = createLimiter(t.app.db, { perWindow: 1, windowMs: 10_000 });
    expect((await limiter.take(live)).ok).toBe(true);
    const r = await limiter.acquire(live, { maxWaitMs: 50 });
    expect(r).toMatchObject({ ok: false, reason: "WINDOW_FULL" });
  });
});
