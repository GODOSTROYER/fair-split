import { createApiClient, isApiClientError } from "@fairsplit/api-client";
import { afterEach, expect, it, vi } from "vitest";
import { hashedClientIp } from "../lib/client-ip.js";
import { RATE_RULES } from "../lib/rate-limit.js";
import { createTestApp, type TestApp } from "../test/index.js";
import * as pool from "./pool.js";
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

it("HD6 r6: preparation hints scale with a clamped client attempt and jitter", async () => {
  app = await createTestApp({ db: "postgres", clock: new Date() });
  vi.spyOn(judgeRuntime(app.deps), "refillSoon").mockImplementation(() => {});
  vi.spyOn(judgeRuntime(app.deps), "tryEnterClone").mockReturnValue(false);
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  for (const [attempt, expected] of [
    ["1", 225],
    ["2", 450],
    ["8", 1800],
    ["99999999", 1800],
    ["-1", 225],
    ["NaN", 225],
  ]) {
    const response = await app.json("/v1/judge/sessions", {
      method: "POST",
      body: {},
      headers: { "x-fs-judge-attempt": String(attempt) },
    });
    expect(response.body).toMatchObject({
      code: "QUEUED",
      retryAfterMs: expected,
      details: { reason: "PREPARING_WORKSPACE" },
    });
  }
});

it("HD6 r6: 60 judges behind one NAT all start with clones slowed by 150 ms", async () => {
  app = await createTestApp({ db: "postgres", clock: new Date() });
  const t = app;
  vi.spyOn(judgeRuntime(t.deps), "refillSoon").mockImplementation(() => {});
  const clone = pool.cloneWorkspace;
  vi.spyOn(pool, "cloneWorkspace").mockImplementation(async (tx) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return clone(tx);
  });
  const ip = "198.18.17.1";
  const counts: number[] = [];
  const codes = await Promise.all(
    Array.from({ length: 60 }, async (_, index) => {
      const client = createApiClient({
        fetch: async (_url, init) => {
          counts[index] = (counts[index] ?? 0) + 1;
          const response = await t.json("/v1/judge/sessions", {
            method: "POST",
            body: {},
            headers: { ...Object.fromEntries(new Headers(init?.headers)), "cf-connecting-ip": ip },
          });
          return new Response(JSON.stringify(response.body), {
            status: response.status,
            headers: response.headers,
          });
        },
      });
      const deadline = Date.now() + 150_000;
      for (;;) {
        const result = await client.result("createJudgeSession", { body: {} });
        if (result.ok) return "started";
        if (!isApiClientError(result.error, "QUEUED") || Date.now() >= deadline) return result.error.name;
        const wait = "retryAfterMs" in result.error ? result.error.retryAfterMs : null;
        await new Promise((resolve) => setTimeout(resolve, wait ?? 250));
      }
    }),
  );
  expect(codes.filter((code) => code === "started")).toHaveLength(60);
  const key = hashedClientIp(t.deps.credentials.keys, ip, t.clock.now());
  expect(t.deps.rateLimits.peek(RATE_RULES.judgeSessionPerNetworkDay, key)).toMatchObject({ ok: false });
  const attempts = counts.reduce((a, b) => a + b, 0);
  expect(attempts).toBeLessThan(RATE_RULES.judgeSessionContendedAttempts.limit);
  // Even a client lying about its attempt cannot evade the finite, nonrefundable guard.
  const rule = RATE_RULES.judgeSessionContendedAttempts;
  expect(rule.limit).toBeLessThanOrEqual(2400);
  for (let i = attempts; i < rule.limit; i++) expect(t.deps.rateLimits.take(rule, key).ok).toBe(true);
  expect(t.deps.rateLimits.take(rule, key).ok).toBe(false);
}, 180_000);
