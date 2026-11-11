// HD6c verifier probe: the whole exploit through public HTTP routes only (no direct limiter writes).
// One IPv6 /48 = 65,536 /64 networks. Fill the keyed cap with two public read rules, then guess.

import { createHash, randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import { MAX_GLOBAL_KEYS, MAX_KEYED_KEYS, MAX_KEYS, MAX_KEYS_PER_RULE } from "./rate-limit.js";

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const net = (n: number) => `2001:db8:77:${n.toString(16)}::1`;

it("one /48 flooding public reads cannot bypass login, judge-code or pairing-claim guards", async () => {
  t = await createTestApp({
    db: "postgres",
    env: { JUDGE_CODE_SHA256: createHash("sha256").update("real-code").digest("hex") },
  });
  const app = t;
  const hit = async (path: string, n: number) => {
    const r = await app.request(path, { headers: { "cf-connecting-ip": net(n) } });
    expect(r.status).toBe(200);
  };
  let n = 0;
  for (let i = 0; i < MAX_KEYS_PER_RULE; i += 200) {
    await Promise.all(Array.from({ length: 200 }, () => hit("/.well-known/fairsplit-keys.json", n++)));
  }
  // Replay the original 10,000 + 9,936 public requests, even once the smaller shared pool is full.
  for (let i = 0; i < MAX_KEYS - MAX_GLOBAL_KEYS - MAX_KEYS_PER_RULE; i += 200) {
    const batch = Math.min(200, MAX_KEYS - MAX_GLOBAL_KEYS - MAX_KEYS_PER_RULE - i);
    await Promise.all(Array.from({ length: batch }, () => hit("/v1/judge/lane", n++)));
  }
  expect(app.deps.rateLimits.size).toBe(MAX_KEYED_KEYS);
  const login: number[] = [];
  for (let i = 0; i < 30; i++) {
    const r = await app.json("/v1/ops/login", {
      method: "POST",
      body: { password: "guess" },
      headers: { "cf-connecting-ip": "2001:db8:99:1::1" },
    });
    login.push(r.status);
  }
  expect(login.slice(0, 5)).toEqual([403, 403, 403, 403, 403]);
  expect(login.slice(5)).toEqual(Array(25).fill(429));
  const { workspaceId: ws } = await app.fixture({
    kind: "judge",
    expiresAt: new Date(app.clock.nowMs() + 3_600_000),
  });
  const as = app.credentials.judge(app.credentials.judgeCookie({ workspaceId: ws, sessionId: randomUUID() }));
  for (const [path, body, limit] of [
    ["/v1/ops/login", { password: "guess" }, 5],
    ["/v1/judge/code", { code: "nope" }, 5],
    ["/v1/pairing/claim", { code6: "123456" }, 10],
  ] as const) {
    let response: Awaited<ReturnType<typeof app.json>> | undefined;
    for (let i = 0; i <= limit; i++) {
      response = await app.json(path, {
        method: "POST",
        body,
        as,
        headers: { "cf-connecting-ip": net(50_000 + limit + path.length) },
      });
      if (i < limit) expect(response.status).not.toBe(429);
    }
    expect(response?.status, path).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
  }
}, 300_000);
