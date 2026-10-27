// The two automated security findings on ws/ppsim (STATE.md, MEDIUM ×2) and the review's public-mount blocker:
//  (1) SSRF: webhook create/patch and simulate-event accepted any http(s) URL, so the simulator would POST
//      anywhere, internal addresses included;
//  (2) the /sim/admin/* gate was fail-open when no admin token was configured.
// Every test here fails against the code before the fix.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulator, type Simulator } from "../src/simulator.js";
import { call, canonicalInvoice, newSim, type Receiver, receiver, subscribe, token } from "./helpers.js";

// Count constant-time comparisons (the admin token must be compared with timingSafeEqual).
const safeCompares = vi.hoisted(() => ({ count: 0 }));
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      safeCompares.count++;
      return real.timingSafeEqual(a, b);
    },
  };
});

const quiet = { speed: 0, logger: () => {} } as const;
const PUBLIC = "https://fs.example.org";

describe("SSRF: the simulator delivers only to its host app (finding 1)", () => {
  const open: (Receiver | Simulator)[] = [];
  afterEach(async () => {
    for (const x of open.splice(0)) await x.close();
  });

  it("refuses webhook, PATCH and simulate-event URLs outside its origin allow-list, and never connects to them", async () => {
    const internal = await receiver(); // stands for an internal service on the simulator's host
    const sim = await createSimulator({ ...quiet, publicBaseUrl: PUBLIC });
    open.push(internal, sim);
    const tok = await token(sim);
    // The host app's own origin, but with userinfo in the URL (built here so no credential literal is committed).
    const withUserinfo = new URL(`${PUBLIC}/webhooks/paypal`);
    withUserinfo.username = "someone";
    withUserinfo.password = "not-a-real-password";
    const refused = [
      internal.url,
      `http://localhost:${new URL(internal.url).port}/webhooks/paypal`,
      "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      "http://[::1]:6379/",
      "http://[::ffff:127.0.0.1]:6379/",
      "http://2130706433:6379/", // 127.0.0.1 as one number
      "https://10.0.0.5/webhooks/paypal",
      "https://192.168.1.10/webhooks/paypal",
      "http://fs.example.org/webhooks/paypal", // http on a public host
      "https://evil.example.com/webhooks/paypal",
      "https://fs.example.org.evil.example.com/webhooks/paypal",
      "https://fs.example.org@evil.example.com/webhooks/paypal",
      withUserinfo.href,
      "file:///etc/passwd",
      "gopher://127.0.0.1:25/_HELO",
    ];
    for (const url of refused) {
      const created = await call(sim, "POST", "/v1/notifications/webhooks", {
        token: tok,
        body: { url, event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
      });
      expect(created.status, url).toBe(400);
      expect(created.json.name, url).toBe("VALIDATION_ERROR");
      expect(created.json.details[0], url).toMatchObject({ field: "url", issue: "Not a valid webhook URL" });
      const mock = await call(sim, "POST", "/v1/notifications/simulate-event", {
        token: tok,
        body: { url, event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS" },
      });
      expect(mock.status, url).toBe(400);
    }
    // The host app's own origin is the one target allowed by default.
    const own = await call(sim, "POST", "/v1/notifications/webhooks", {
      token: tok,
      body: { url: `${PUBLIC}/webhooks/paypal`, event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
    });
    expect(own.status).toBe(201);
    const patched = await call(sim, "PATCH", `/v1/notifications/webhooks/${own.json.id}`, {
      token: tok,
      body: [{ op: "replace", path: "/url", value: internal.url }],
    });
    expect(patched.status).toBe(400);
    expect(patched.json.details[0].issue).toBe("Not a valid webhook URL");
    await sim.idle();
    expect(internal.hits).toBe(0);
    expect(Object.keys(sim.state.deliveries)).toHaveLength(0);
  });

  it("does not follow a redirect from an allowed receiver to an internal address", async () => {
    const internal = await receiver();
    const allowed = await receiver();
    allowed.redirectTo = internal.url; // 307 keeps the method and body
    const sim = await createSimulator({
      ...quiet,
      webhookOrigins: [allowed.origin],
      delivery: { maxAttempts: 2 },
    });
    open.push(internal, allowed, sim);
    const tok = await token(sim);
    await subscribe(sim, tok, allowed.url, ["INVOICING.INVOICE.CREATED"]);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-REDIRECT") });
    await sim.idle();
    expect(allowed.hits).toBe(2);
    expect(internal.hits).toBe(0);
    const d = Object.values(sim.state.deliveries)[0];
    expect(d).toMatchObject({ status: "FAILED", attempts: 2, lastStatusCode: 307 });
  });

  it("re-checks the target before every attempt (a stored internal URL gets no POST)", async () => {
    const internal = await receiver();
    const sim = await createSimulator({ ...quiet, publicBaseUrl: PUBLIC });
    open.push(internal, sim);
    const tok = await token(sim);
    const clientId = sim.registry.apps[0]?.client_id as string;
    // As if restored from an older snapshot, or registered before the policy existed.
    sim.state.webhooks.SIMLEGACY00000001 = {
      id: "SIMLEGACY00000001",
      clientId,
      url: internal.url,
      eventTypes: ["*"],
      createdAt: sim.clock.now(),
    };
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-STORED") });
    await sim.idle();
    expect(internal.hits).toBe(0);
    const d = Object.values(sim.state.deliveries)[0];
    expect(d?.status).toBe("FAILED");
    expect(d?.attempts).toBe(0);
    expect(d?.lastError).toMatch(/^not delivered: /);
  });

  it("keeps the loopback convenience for local development only", async () => {
    await expect(
      createSimulator({ ...quiet, publicBaseUrl: PUBLIC, allowLoopbackWebhooks: true }),
    ).rejects.toThrow(/local development only/);
    const local = await newSim(); // loopback publicBaseUrl + allowLoopbackWebhooks (tests' default)
    open.push(local);
    const tok = await token(local);
    const res = await call(local, "POST", "/v1/notifications/webhooks", {
      token: tok,
      body: { url: "http://10.1.2.3/webhooks/paypal", event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
    });
    expect(res.status).toBe(400); // loopback means this machine, not the private network
  });
});

describe("the admin API fails closed (finding 2)", () => {
  const open: Simulator[] = [];
  afterEach(async () => {
    for (const s of open.splice(0)) await s.close();
  });

  const ADMIN: [string, string][] = [
    ["POST", "/sim/admin/reset"],
    ["POST", "/sim/admin/clock"],
    ["POST", "/sim/admin/deny-next-batch"],
    ["POST", "/sim/admin/delivery"],
    ["POST", "/sim/admin/snapshot"],
    ["GET", "/sim/admin/state"],
    ["GET", "/sim/admin/accounts"],
    ["GET", "/sim/admin/deliveries"],
  ];

  it("refuses every admin route when publicBaseUrl is public and SIM_ADMIN_TOKEN is unset, changing nothing", async () => {
    const sim = await createSimulator({ ...quiet, publicBaseUrl: PUBLIC });
    open.push(sim);
    const tok = await token(sim);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-ADMIN") });
    const now = sim.clock.now();
    for (const [method, path] of ADMIN) {
      const res = await sim.fetch(
        new Request(`${PUBLIC}${path}`, {
          method,
          ...(method === "POST"
            ? { body: JSON.stringify({ advance_seconds: 40 * 86_400, duplicate: true }) }
            : {}),
        }),
        { incoming: { socket: { remoteAddress: "127.0.0.1" } } }, // even from loopback
      );
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.headers.get("x-fairsplit-simulated")).toBe("true");
    }
    expect(Object.keys(sim.state.invoices)).toHaveLength(1);
    expect(sim.state.denyNextBatch).toBe(false);
    expect(sim.state.delivery.duplicate).toBe(false);
    expect(sim.clock.now() - now).toBeLessThan(60_000);
  });

  it("with SIM_ADMIN_TOKEN, requires that exact token, compared in constant time", async () => {
    const secret = "test-admin-token-0123456789abcdef";
    const sim = await createSimulator({ ...quiet, publicBaseUrl: PUBLIC, adminToken: secret });
    open.push(sim);
    const state = (h: Record<string, string>) =>
      sim.fetch(new Request(`${PUBLIC}/sim/admin/state`, { headers: h })).then((r) => r.status);
    expect(await state({})).toBe(401);
    expect(await state({ "x-sim-admin-token": "test-admin-token-0123456789abcdeX" })).toBe(401); // same length
    expect(await state({ "x-sim-admin-token": "short" })).toBe(401);
    expect(await state({ "x-sim-admin-token": `${secret}-and-more` })).toBe(401);
    safeCompares.count = 0;
    expect(await state({ "x-sim-admin-token": secret })).toBe(200);
    expect(safeCompares.count).toBeGreaterThan(0);
  });

  it("without a token, answers loopback callers only: a LAN socket, a rebound Host or a foreign Origin is refused", async () => {
    const sim = await newSim(); // loopback publicBaseUrl (local development)
    open.push(sim);
    const admin = (url: string, remote: string, headers: Record<string, string> = {}) =>
      sim
        .fetch(new Request(url, { method: "POST", headers }), {
          incoming: { socket: { remoteAddress: remote } },
        })
        .then((r) => r.status);
    expect(await admin("http://127.0.0.1:4010/sim/admin/deny-next-batch", "192.168.1.20")).toBe(403);
    expect(await admin("http://attacker.example:4010/sim/admin/deny-next-batch", "127.0.0.1")).toBe(403);
    expect(
      await admin("http://127.0.0.1:4010/sim/admin/deny-next-batch", "127.0.0.1", {
        origin: "https://evil.example",
      }),
    ).toBe(403);
    expect(sim.state.denyNextBatch).toBe(false);
    expect(await admin("http://localhost:4010/sim/admin/deny-next-batch", "::ffff:127.0.0.1")).toBe(200);
    expect(sim.state.denyNextBatch).toBe(true);
  });

  it("publicFetch never serves admin or REST routes", async () => {
    const sim = await createSimulator({
      ...quiet,
      publicBaseUrl: PUBLIC,
      adminToken: "irrelevant-token-1234",
    });
    open.push(sim);
    const app = sim.registry.apps[0];
    const basic = Buffer.from(`${app?.client_id}:${app?.client_secret}`).toString("base64");
    const oauth = await sim.publicFetch(
      new Request(`${PUBLIC}/v1/oauth2/token`, {
        method: "POST",
        headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials",
      }),
    );
    expect(oauth.status).toBe(404);
    const reset = await sim.publicFetch(
      new Request(`${PUBLIC}/sim/admin/reset`, {
        method: "POST",
        headers: { "x-sim-admin-token": "irrelevant-token-1234" },
      }),
    );
    expect(reset.status).toBe(404);
    expect(Object.keys(sim.state.tokens)).toHaveLength(0);
    expect((await sim.publicFetch(new Request(sim.certUrl))).status).toBe(200);
  });
});
