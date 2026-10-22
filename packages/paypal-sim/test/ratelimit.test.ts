import { afterEach, describe, expect, it } from "vitest";
import type { Simulator } from "../src/simulator.js";
import { call, newSim, token } from "./helpers.js";

describe("sandbox-style throttle", () => {
  let sim: Simulator;
  afterEach(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  it("allows 50 requests a minute per client, answers 429 RATE_LIMIT_REACHED, then blocks for 5 minutes", async () => {
    sim = await newSim();
    const tok = await token(sim); // request 1
    for (let i = 0; i < 49; i++) {
      const res = await call(sim, "GET", "/v1/notifications/webhooks", { token: tok });
      expect(res.status, `request ${i + 2}`).toBe(200);
    }
    const blocked = await call(sim, "GET", "/v1/notifications/webhooks", { token: tok });
    expect(blocked.status).toBe(429);
    expect(blocked.json.name).toBe("RATE_LIMIT_REACHED");
    expect(blocked.json.message).toBe("Too many requests. Blocked due to rate limiting.");
    expect(blocked.json.details[0].issue).toBe("TOO_MANY_REQUESTS");
    expect(blocked.headers.get("retry-after")).toBe("300");
    expect(blocked.headers.get("x-fairsplit-simulated")).toBe("true");

    // Another app is unaffected (the limit is per client).
    const judge = await token(sim, "fs-judge");
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: judge })).status).toBe(200);

    sim.clock.advance(4 * 60_000);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(429);
    sim.clock.advance(61_000);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(200);
  });

  it("counts a rolling minute", async () => {
    sim = await newSim({ rateLimit: { perMinute: 3, blockSeconds: 10 } });
    const tok = await token(sim);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(200);
    sim.clock.advance(61_000);
    for (let i = 0; i < 3; i++)
      expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(200);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(429);
    sim.clock.advance(10_001);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(200);
  });

  it("can be disabled, and injects latency when asked", async () => {
    sim = await newSim({ rateLimit: false, latencyMs: 25 });
    const tok = await token(sim);
    const t0 = performance.now();
    for (let i = 0; i < 60; i++)
      expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(200);
    expect(performance.now() - t0).toBeGreaterThanOrEqual(60 * 20);
  });
});
