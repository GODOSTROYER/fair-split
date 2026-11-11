// Regression coverage from the HD6c independent verifier's public-route saturation probe.
import { createHash, randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { JUDGE_RATE_RULES } from "../judge/runtime.js";
import { credentialResult } from "../middleware/credential.js";
import { onError } from "../middleware/errors.js";
import { requestContext } from "../middleware/request.js";
import { PROOF_RATE_RULES } from "../proof/limits.js";
import { FUND_CHECK_RULE } from "../runs/invoice.js";
import { createTestApp, type TestApp, type TestAuth } from "../test/index.js";
import { hashedClientIp } from "./client-ip.js";
import { createFakeClock } from "./clock.js";
import type { AppEnv } from "./context.js";
import { LINK_READ_RULES } from "./link-read.js";
import {
  CRITICAL_KEYS_PER_RULE,
  createKeyedRateLimiter,
  type KeyedRateLimiter,
  MAX_GLOBAL_KEYS,
  MAX_KEYED_KEYS,
  MAX_KEYS,
  MAX_KEYS_PER_RULE,
  RATE_RULES,
  type RateRule,
  RESERVED_PER_RULE,
} from "./rate-limit.js";

const ALL: RateRule[] = [
  ...Object.values(RATE_RULES),
  ...Object.values(JUDGE_RATE_RULES),
  ...Object.values(PROOF_RATE_RULES),
  ...Object.values(LINK_READ_RULES),
  FUND_CHECK_RULE,
];
const CRITICAL = new Set(["opsLoginPerIp", "judgeCodePerIp", "judgeCodePerSession", "pairingClaim"]);
const NON_CRITICAL = ALL.filter((r) => !r.global && !CRITICAL.has(r.name));

it("the complete rule inventory marks exactly the four guess guards critical and fits every floor", () => {
  expect(
    ALL.filter((rule) => rule.critical)
      .map((rule) => rule.name)
      .sort(),
  ).toEqual([...CRITICAL].sort());
  expect(
    CRITICAL.size * CRITICAL_KEYS_PER_RULE + MAX_GLOBAL_KEYS + NON_CRITICAL.length * RESERVED_PER_RULE,
  ).toBeLessThanOrEqual(MAX_KEYS);
});

/** Round-robin every non-critical keyed partition until the keyed cap is reached (the attacker's flood). */
function fillEveryNonCritical(limiter: KeyedRateLimiter, globalsAlreadyHeld = 0) {
  // Pre-held critical/global entries occupy separate reservations, not the shared keyed pool.
  const held = limiter.size;
  expect(held).toBeGreaterThanOrEqual(globalsAlreadyHeld);
  for (let i = 0; i < MAX_KEYED_KEYS; i++) {
    const rule = NON_CRITICAL[i % NON_CRITICAL.length] as RateRule;
    limiter.take(rule, `flood:${i}`);
  }
  expect(limiter.size).toBe(MAX_KEYED_KEYS + held);
}

/** Fill the keyed cap with only two big non-critical partitions. */
function fillTwo(limiter: KeyedRateLimiter) {
  for (let i = 0; i < MAX_KEYS_PER_RULE; i++) limiter.take(JUDGE_RATE_RULES.publicLane, `lane:${i}`);
  for (let i = 0; limiter.size < MAX_KEYED_KEYS; i++) limiter.take(PROOF_RATE_RULES.publicRead, `proof:${i}`);
  expect(limiter.size).toBe(MAX_KEYED_KEYS);
}

function judgeGuess(l: KeyedRateLimiter, session: string, net: string) {
  return l.takeAll([
    [JUDGE_RATE_RULES.judgeCodePerSession, session],
    [JUDGE_RATE_RULES.judgeCodePerIp, net],
    [JUDGE_RATE_RULES.judgeCodeGlobal, "all"],
  ]);
}

describe("point 1 + tests (a)(b)(c): every non-critical partition filled to the global cap", () => {
  it("(a) a judge-code guess from a new network is counted (per-IP remaining drops)", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    expect(judgeGuess(l, "sess-a", "net-a").ok).toBe(true);
    expect(l.peek(JUDGE_RATE_RULES.judgeCodePerIp, "net-a")).toEqual({ ok: true, remaining: 4 });
    expect(l.peek(JUDGE_RATE_RULES.judgeCodePerSession, "sess-a")).toEqual({ ok: true, remaining: 4 });
  });
  it("(a) the per-IP judge-code limit trips (one network, six fresh sessions)", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    const results = Array.from({ length: 6 }, (_, i) => judgeGuess(l, `s-${i}`, "net-b").ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
  it("(a) the per-session judge-code limit trips (one session, six fresh networks)", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    const results = Array.from({ length: 6 }, (_, i) => judgeGuess(l, "sess-c", `n-${i}`).ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
  it("(b) an honest member-link read still passes", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    const d = l.takeAll([
      [LINK_READ_RULES.link, "link:ws:honest"],
      [LINK_READ_RULES.network, "classroom"],
    ]);
    expect(d.ok).toBe(true);
  });
  it("(c) the ops-login per-IP limit trips", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    const results = Array.from({ length: 6 }, () => l.take(JUDGE_RATE_RULES.opsLoginPerIp, "ops-net").ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
  it("(c') the pairing-claim per-IP limit trips (6-digit and token claims)", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    const results = Array.from({ length: 11 }, () => l.take(RATE_RULES.pairingClaim, "pair-net").ok);
    expect(results.at(-1)).toBe(false);
  });
  it("point 1: a critical rule that cannot record refuses with retryAfterMs, never admits unrecorded", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    // the critical partition is itself full of in-window keys AND the keyed cap is full
    for (let i = 0; i < MAX_KEYS_PER_RULE; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, `guesser:${i}`);
    for (let i = 0; l.size < MAX_KEYED_KEYS; i++) l.take(JUDGE_RATE_RULES.publicLane, `lane:${i}`);
    const d = l.take(JUDGE_RATE_RULES.opsLoginPerIp, "new-guesser");
    if (d.ok) {
      // admitted: then it must have been recorded
      expect(l.peek(JUDGE_RATE_RULES.opsLoginPerIp, "new-guesser")).toEqual({ ok: true, remaining: 4 });
    } else {
      expect(d.retryAfterMs).toBeGreaterThan(0);
    }
  });
});

describe("point 2: in-window entries of critical rules are never evicted", () => {
  it("a full opsLoginPerIp partition does not evict an exhausted in-window key", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < 5; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, "victim");
    expect(l.take(JUDGE_RATE_RULES.opsLoginPerIp, "victim").ok).toBe(false);
    for (let i = 1; i < MAX_KEYS_PER_RULE; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, `other:${i}`);
    l.take(JUDGE_RATE_RULES.opsLoginPerIp, "one-more"); // the (10,001)th network
    expect(l.take(JUDGE_RATE_RULES.opsLoginPerIp, "victim").ok).toBe(false);
  });
  it("at the keyed cap, two networks alternating cannot reset each other's ops-login window", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < 5; i++) l.take(JUDGE_RATE_RULES.opsLoginPerIp, "A");
    fillEveryNonCritical(l);
    // Network B appears, then A comes back: A must still be at its limit.
    l.take(JUDGE_RATE_RULES.opsLoginPerIp, "B");
    expect(l.take(JUDGE_RATE_RULES.opsLoginPerIp, "A").ok).toBe(false);
  });
  it("judgeCodePerSession: an exhausted session stays exhausted after another session's guess at the cap", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < 5; i++) judgeGuess(l, "S", `n${i}`);
    fillEveryNonCritical(l, 1); // judgeCodeGlobal "all" is held
    judgeGuess(l, "S2", "fresh");
    expect(judgeGuess(l, "S", "fresh2").ok).toBe(false);
  });
});

describe("point 3: a guaranteed per-rule minimum inside MAX_KEYED_KEYS", () => {
  it("two big partitions cannot crowd out a third (non-critical) rule", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillTwo(l);
    const results = Array.from({ length: 11 }, () => l.take(JUDGE_RATE_RULES.tamper, "my-session").ok);
    expect(results.at(-1), "judgeTamper limit (10) must still trip").toBe(false);
  });
  it("two big partitions cannot crowd out a critical rule", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillTwo(l);
    const results = Array.from({ length: 6 }, () => l.take(JUDGE_RATE_RULES.opsLoginPerIp, "net").ok);
    expect(results).toEqual([true, true, true, true, true, false]);
  });
});

describe("point 4: at the global keyed cap evict LRU from the LARGEST non-critical partition", () => {
  it("a new key in an empty partition evicts publicLane's oldest key (the largest)", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillTwo(l);
    l.take(JUDGE_RATE_RULES.keys, "k-new");
    expect(l.peek(JUDGE_RATE_RULES.keys, "k-new")).toEqual({ ok: true, remaining: 9 });
    expect(l.peek(JUDGE_RATE_RULES.publicLane, "lane:0")).toEqual({
      ok: true,
      remaining: JUDGE_RATE_RULES.publicLane.limit,
    });
    expect(l.size).toBeLessThanOrEqual(MAX_KEYED_KEYS);
  });
  it("a new key in a small partition evicts from the largest partition, not its own in-window key", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    l.take(JUDGE_RATE_RULES.keys, "mine-old");
    l.take(JUDGE_RATE_RULES.keys, "mine-old");
    fillTwo(l);
    l.take(JUDGE_RATE_RULES.keys, "mine-new");
    expect(l.peek(JUDGE_RATE_RULES.keys, "mine-old")).toEqual({ ok: true, remaining: 8 });
  });
});

describe("point 5 + R1: non-critical rules never lock out", () => {
  it.each([
    LINK_READ_RULES.link,
    LINK_READ_RULES.network,
    JUDGE_RATE_RULES.resume,
    RATE_RULES.judgeSessionPerIp,
    RATE_RULES.judgeSessionPerNetworkDay,
    JUDGE_RATE_RULES.publicLane,
    PROOF_RATE_RULES.publicRead,
  ])("R1: a full $name partition admits a fresh caller", (rule) => {
    const l = createKeyedRateLimiter(createFakeClock());
    for (let i = 0; i < MAX_KEYS_PER_RULE; i++) l.take(rule, `attacker:${i}`);
    expect(l.take(rule, "fresh").ok).toBe(true);
    expect(l.size).toBeLessThanOrEqual(MAX_KEYS);
  });
  it("point 5: at the keyed cap a fresh judgeResume caller is admitted", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    fillEveryNonCritical(l);
    expect(l.take(JUDGE_RATE_RULES.resume, "fresh-session").ok).toBe(true);
  });
});

describe("memory bound under a flood", () => {
  it("100k distinct keys across every keyed rule never exceed MAX_KEYS and globals still take", () => {
    const l = createKeyedRateLimiter(createFakeClock());
    const keyed = ALL.filter((r) => !r.global);
    let max = 0;
    for (let i = 0; i < 100_000; i++) {
      l.take(keyed[i % keyed.length] as RateRule, `f:${i}`);
      if (l.size > max) max = l.size;
    }
    expect(max).toBeLessThanOrEqual(MAX_KEYS);
    for (const g of ALL.filter((r) => r.global)) expect(l.take(g, "all").ok).toBe(true);
    expect(l.size).toBeLessThanOrEqual(MAX_KEYS);
  });
  it("one free IPv6 /48 yields 20,000 distinct throttle keys (the flood is cheap)", () => {
    const keys = { hmacKey: () => Buffer.alloc(32, 7) } as unknown as Parameters<typeof hashedClientIp>[0];
    const now = new Date("2026-11-05T00:00:00Z");
    const seen = new Set<string>();
    for (let n = 0; n < 20_000; n++) seen.add(hashedClientIp(keys, `2001:db8:1:${n.toString(16)}::1`, now));
    expect(seen.size).toBe(20_000);
    // and the host part of a /64 collapses (no per-address rotation)
    expect(hashedClientIp(keys, "2001:db8:1:2:aaaa::1", now)).toBe(
      hashedClientIp(keys, "2001:db8:1:2:bbbb::9", now),
    );
  });
});

// ---------- HTTP level (no database) ----------
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("HTTP: routes after the keyed cap is full", () => {
  it("(c) POST /v1/ops/login from a fresh network answers 429 on the 6th try", async () => {
    t = await createTestApp();
    fillEveryNonCritical(t.deps.rateLimits);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await t.json("/v1/ops/login", {
        method: "POST",
        body: { password: "guess" },
        headers: { "cf-connecting-ip": "203.0.113.77" },
      });
      statuses.push(r.status);
    }
    expect(statuses.at(-1), `statuses ${statuses.join(",")}`).toBe(429);
  });
  it("(a) POST /v1/judge/code: 6th guess from a fresh network and session answers 429", async () => {
    const code = "the-real-judge-code";
    t = await createTestApp({ env: { JUDGE_CODE_SHA256: createHash("sha256").update(code).digest("hex") } });
    const ws = t.credentials.workspace();
    const as = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: ws, sessionId: randomUUID() }));
    fillEveryNonCritical(t.deps.rateLimits);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await t.json("/v1/judge/code", {
        method: "POST",
        body: { code: "nope" },
        as,
        headers: { "cf-connecting-ip": "203.0.113.88" },
      });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 5), `statuses ${statuses.join(",")}`).toEqual([403, 403, 403, 403, 403]);
    expect(statuses.at(-1), `statuses ${statuses.join(",")}`).toBe(429);
  });
  it("(b) an honest member-link read passes", async () => {
    t = await createTestApp();
    const app = new Hono<AppEnv>();
    const deps = t.deps;
    app.use("*", requestContext(deps));
    app.onError(onError);
    app.get("/v1/credential", async (c) => c.json(await credentialResult(c)));
    const ws = t.credentials.workspace();
    const as: TestAuth = t.credentials.bearer(
      t.credentials.memberLink({ workspaceId: ws, lineId: randomUUID() }),
    );
    fillEveryNonCritical(deps.rateLimits);
    const r = await app.request("/v1/credential", { headers: { ...as, "cf-connecting-ip": "198.51.100.5" } });
    expect(r.status).toBe(200);
  });
});
