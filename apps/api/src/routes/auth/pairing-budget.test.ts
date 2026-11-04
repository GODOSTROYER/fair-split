import { expect, it } from "vitest";
import { JUDGE_RATE_RULES } from "../../judge/runtime.js";
import { hashedClientIp } from "../../lib/client-ip.js";
import { RATE_RULES } from "../../lib/rate-limit.js";
import { createTestApp } from "../../test/index.js";

it("HD6-O3: global six-digit refusal consumes no network pairing slot", async () => {
  const t = await createTestApp();
  try {
    const key = hashedClientIp(t.deps.credentials.keys, "192.0.2.145", t.clock.now());
    for (let i = 0; i < JUDGE_RATE_RULES.pairingCode6Global.limit; i++)
      t.deps.rateLimits.take(JUDGE_RATE_RULES.pairingCode6Global, "all");
    const before = t.deps.rateLimits.peek(RATE_RULES.pairingClaim, key);
    const r = await t.json("/v1/pairing/claim", {
      method: "POST",
      body: { code6: "123456" },
      headers: { "cf-connecting-ip": "192.0.2.145" },
    });
    expect(r.status).toBe(429);
    expect(t.deps.rateLimits.peek(RATE_RULES.pairingClaim, key)).toEqual(before);
  } finally {
    await t.close();
  }
});
