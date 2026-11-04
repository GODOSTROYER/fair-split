import { afterEach, expect, it, vi } from "vitest";
import { hashedClientIp } from "../lib/client-ip.js";
import { RATE_RULES } from "../lib/rate-limit.js";
import { createTestApp, type TestApp } from "../test/index.js";
import * as quota from "./quota.js";
import { judgeRuntime } from "./runtime.js";

let app: TestApp | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (app) {
    await judgeRuntime(app.deps).idle();
    await app.close();
    app = undefined;
  }
});

it("HD6 R4: contended starts retain a per-network budget before expensive rail reads", async () => {
  app = await createTestApp({ db: "postgres", clock: new Date() });
  const t = app;
  if (!t.pg) throw new Error("Postgres required");
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  const rail = vi.spyOn(quota, "judgeRail");
  const rule = RATE_RULES.judgeSessionContendedAttempts;
  const ip = "198.18.15.1";
  const key = hashedClientIp(t.deps.credentials.keys, ip, t.clock.now());
  // Leave ten attempts for a 30-request burst: the guard must reserve synchronously and survive refunds.
  for (let i = 0; i < rule.limit - 10; i++) expect(t.deps.rateLimits.take(rule, key).ok).toBe(true);
  const start = (network = ip) =>
    t.json<{ code?: string; retryAfterMs?: number }>("/v1/judge/sessions", {
      method: "POST",
      body: {},
      headers: { "cf-connecting-ip": network },
    });
  const lock = await t.pg.owner.sql.reserve();
  try {
    await lock`begin`;
    await lock`select pg_advisory_xact_lock(hashtextextended('fs:judge-admission',0))`;
    const responses = await Promise.all(Array.from({ length: 30 }, () => start()));
    expect(responses.filter((response) => response.body.code === "QUEUED")).toHaveLength(10);
    const refused = responses.filter(
      (response) => response.status === 429 && response.body.code === "RATE_LIMITED",
    );
    expect(refused).toHaveLength(20);
    for (const response of refused) {
      expect(response.body.retryAfterMs).toBeGreaterThan(0);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    expect(rail).toHaveBeenCalledTimes(10);
    expect(t.deps.rateLimits.peek(rule, key)).toMatchObject({ ok: false });
    expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionPerIp, key)).toEqual({
      ok: true,
      remaining: RATE_RULES.judgeSessionPerIp.limit,
    });
    expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionAttempts, "all")).toEqual({
      ok: true,
      remaining: RATE_RULES.judgeSessionAttempts.limit,
    });
    expect((await start("198.18.16.1")).body).toMatchObject({ code: "QUEUED" });
    expect(rail).toHaveBeenCalledTimes(11);
  } finally {
    await lock`commit`;
    lock.release();
  }
  expect((await start("198.18.16.1")).status).toBe(201);
}, 120_000);
