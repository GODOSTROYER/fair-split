import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { loadFixture } from "../src/fixtures.js";
import {
  createMockServer,
  fixtureHandler,
  installMockServer,
  PAYPAL_SANDBOX_BASE,
  paypalTokenHandler,
} from "../src/msw.js";

const server = installMockServer(createMockServer(fixtureHandler(loadFixture("paypal/oauth-token"))), {
  beforeAll,
  afterEach,
  afterAll,
});

describe("msw helpers", () => {
  it("replays a recorded fixture", async () => {
    const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token_type: string; access_token: string };
    expect(body.token_type).toBe("Bearer");
    expect(body.access_token).toBe("REDACTED");
  });

  it("lets a test override handlers, and resets them afterwards", async () => {
    server.use(paypalTokenHandler({ expiresIn: 60 }));
    const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, { method: "POST" });
    expect(((await res.json()) as { expires_in: number }).expires_in).toBe(60);
  });

  it("uses the recorded handler again after the reset", async () => {
    const res = await fetch(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, { method: "POST" });
    expect(((await res.json()) as { expires_in: number }).expires_in).toBe(32400);
  });

  it("fails an unhandled request instead of reaching the network", async () => {
    await expect(fetch(`${PAYPAL_SANDBOX_BASE}/v1/payments/payouts`, { method: "POST" })).rejects.toThrow();
  });

  it("rejects a fixture with an unsupported method", () => {
    const f = loadFixture("paypal/oauth-token");
    expect(() => fixtureHandler({ ...f, request: { ...f.request, method: "TRACE" } })).toThrow(/Unsupported/);
  });
});
