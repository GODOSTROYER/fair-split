import { afterEach, describe, expect, it } from "vitest";
import type { Simulator } from "../src/simulator.js";
import { call, newSim, token } from "./helpers.js";

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

describe("sandbox-style throttle (per client address, like the sandbox's per-IP block)", () => {
  let sim: Simulator;
  afterEach(async () => {
    expect(sim.violations).toEqual([]);
    await sim.close();
  });

  it("allows 50 requests a minute per address, answers 429 RATE_LIMIT_REACHED, then blocks for 5 minutes", async () => {
    sim = await newSim();
    const ip = "198.51.100.7";
    const judgeTok = await token(sim, "fs-judge", ip); // request 1
    const tok = await token(sim, "fs-dev", ip); // request 2
    for (let i = 0; i < 48; i++) {
      const res = await call(sim, "GET", "/v1/notifications/webhooks", { token: tok, remote: ip });
      expect(res.status, `request ${i + 3}`).toBe(200);
    }
    const blocked = await call(sim, "GET", "/v1/notifications/webhooks", { token: tok, remote: ip });
    expect(blocked.status).toBe(429);
    expect(blocked.json.name).toBe("RATE_LIMIT_REACHED");
    expect(blocked.json.message).toBe("Too many requests. Blocked due to rate limiting.");
    expect(blocked.json.details[0].issue).toBe("TOO_MANY_REQUESTS");
    expect(blocked.headers.get("retry-after")).toBe("300");
    expect(blocked.headers.get("x-fairsplit-simulated")).toBe("true");

    // Same address, other REST app: the sandbox counts per IP, so both apps share the block.
    const judge = await call(sim, "GET", "/v1/notifications/webhooks", { token: judgeTok, remote: ip });
    expect(judge.status).toBe(429);
    // Another address is unaffected.
    const elsewhere = await token(sim, "fs-judge", "203.0.113.20");
    expect(
      (await call(sim, "GET", "/v1/notifications/webhooks", { token: elsewhere, remote: "203.0.113.20" }))
        .status,
    ).toBe(200);

    sim.clock.advance(4 * 60_000);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok, remote: ip })).status).toBe(
      429,
    );
    sim.clock.advance(61_000);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok, remote: ip })).status).toBe(
      200,
    );
  });

  it("a caller who knows the public client id cannot lock that client out with wrong secrets", async () => {
    sim = await newSim();
    const app = sim.registry.apps[0];
    if (!app) throw new Error("no app");
    const attacker = "203.0.113.66";
    for (let i = 0; i < 51; i++) {
      const res = await sim.fetch(
        new Request("https://api-m.sandbox.paypal.com/v1/oauth2/token", {
          method: "POST",
          headers: {
            authorization: basic(app.client_id, "wrong-secret"),
            "content-type": "application/x-www-form-urlencoded",
          },
          body: "grant_type=client_credentials",
        }),
        { incoming: { socket: { remoteAddress: attacker } } },
      );
      expect(res.status, `attempt ${i + 1}`).toBe(i < 50 ? 401 : 429);
    }
    // The real client, from its own address, still gets a token and can call the API.
    const victim = "198.51.100.80";
    const tok = await token(sim, "fs-dev", victim);
    expect(tok).toMatch(/^SIM\./);
    expect(
      (await call(sim, "GET", "/v1/notifications/webhooks", { token: tok, remote: victim })).status,
    ).toBe(200);
  });

  it("ignores a spoofed X-Forwarded-For by default; behind one trusted proxy it keys on the right-most hop", async () => {
    sim = await newSim({ rateLimit: { perMinute: 3, blockSeconds: 60 } });
    const tok = await token(sim, "fs-dev", "198.51.100.1");
    const spoof = (n: number) => ({ "x-forwarded-for": `10.9.8.${n}` });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (
          await call(sim, "GET", "/v1/notifications/webhooks", {
            token: tok,
            remote: "198.51.100.1",
            headers: spoof(i),
          })
        ).status,
      );
    // The token request was the first of three; rotating X-Forwarded-For does not open new budgets.
    expect(statuses).toEqual([200, 200, 429, 429]);

    const proxied = await newSim({ rateLimit: { perMinute: 2, blockSeconds: 60 }, trustProxy: true });
    const t2 = await token(proxied, "fs-dev", "10.0.0.2");
    const via = (client: string) =>
      call(proxied, "GET", "/v1/notifications/webhooks", {
        token: t2,
        remote: "10.0.0.2", // the proxy
        headers: { "x-forwarded-for": `6.6.6.6, ${client}` }, // a forged left entry, then what the proxy saw
      });
    expect((await via("198.51.100.10")).status).toBe(200);
    expect((await via("198.51.100.10")).status).toBe(200);
    expect((await via("198.51.100.10")).status).toBe(429);
    expect((await via("198.51.100.11")).status).toBe(200);
    await proxied.close();
  });

  it("keeps the address table bounded when callers rotate addresses", async () => {
    sim = await newSim({ rateLimit: { perMinute: 50, blockSeconds: 300, maxKeys: 100 } });
    for (let i = 0; i < 1_000; i++)
      await call(sim, "GET", "/v1/notifications/webhooks", { remote: `2001:db8::${i.toString(16)}` });
    expect(sim.rateLimiter.size).toBeLessThanOrEqual(100);
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
