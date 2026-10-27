// The automated security findings on ws/ppsim (STATE.md) and the review's public-mount blocker:
//  (1) SSRF: webhook create/patch and simulate-event accepted any http(s) URL, so the simulator would POST
//      anywhere, internal addresses included;
//  (2) the /sim/admin/* gate was fail-open when no admin token was configured, and (27 Oct 17:0x) still was
//      when the caller's socket address was unknown: the Host header alone decided;
//  (3) self-SSRF: the standalone server's own origin was an allowed webhook target, so a non-loopback peer
//      could have the simulator deliver into its own /sim/admin and run admin actions on itself.
// Every test here fails against the code before the fix.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { getRequestListener } from "@hono/node-server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IN_PROCESS_ENV, type SimEnv } from "../src/http/app.js";
import { checkWebhookTarget } from "../src/net.js";
import { startServer } from "../src/server.js";
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

  it("refuses a caller whose socket address is unknown, whatever its Host says (STATE 27 Oct 17:0x)", async () => {
    const sim = await newSim(); // loopback publicBaseUrl, no token
    open.push(sim);
    const tok = await token(sim);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-UNKNOWN") });
    const status = (method: string, url: string, env?: SimEnv) =>
      sim.fetch(new Request(url, { method }), env).then((r) => r.status);
    // No env (a host app wiring `(c) => sim.fetch(c.req.raw)`, a Bun or Deno handler), or one without a socket.
    const unknown: (SimEnv | undefined)[] = [undefined, {}, { incoming: {} }, { incoming: { socket: {} } }];
    for (const env of unknown) {
      expect(await status("POST", "http://localhost:4010/sim/admin/deny-next-batch", env)).toBe(403);
      expect(await status("POST", "http://127.0.0.1:4010/sim/admin/reset", env)).toBe(403);
      expect(await status("GET", "http://[::1]:4010/sim/admin/accounts", env)).toBe(403);
    }
    expect(sim.state.denyNextBatch).toBe(false);
    expect(Object.keys(sim.state.invoices)).toHaveLength(1);
  });

  it("refuses an unknown socket over real HTTP too: a loopback server that forwards to sim.fetch without its env", async () => {
    const sim = await newSim();
    open.push(sim);
    const tok = await token(sim);
    await call(sim, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-FORWARD") });
    const host = createServer(getRequestListener((req) => sim.fetch(req), { overrideGlobalObjects: false }));
    await new Promise<void>((r) => host.listen(0, "127.0.0.1", () => r()));
    try {
      const origin = `http://127.0.0.1:${(host.address() as AddressInfo).port}`;
      expect((await fetch(`${origin}/sim/admin/reset`, { method: "POST" })).status).toBe(403);
      expect((await fetch(`${origin}/sim/admin/accounts`)).status).toBe(403);
      expect(Object.keys(sim.state.invoices)).toHaveLength(1);
    } finally {
      host.closeAllConnections();
      await new Promise<void>((r) => host.close(() => r()));
    }
  });

  it("admits a known loopback socket or the in-process marker; with SIM_ADMIN_TOKEN every caller needs the token", async () => {
    const sim = await newSim();
    open.push(sim);
    const post = (env?: SimEnv) =>
      sim
        .fetch(new Request("http://localhost:4010/sim/admin/deny-next-batch", { method: "POST" }), env)
        .then((r) => r.status);
    for (const remote of ["192.168.1.20", "0.0.0.0", "::", "", "localhost"])
      expect(await post({ incoming: { socket: { remoteAddress: remote } } }), remote).toBe(403);
    expect(sim.state.denyNextBatch).toBe(false);
    expect(await post(IN_PROCESS_ENV)).toBe(200); // set only by code in this process, never by an HTTP adapter
    expect(sim.state.denyNextBatch).toBe(true);

    const secret = "test-admin-token-in-process-0001";
    const guarded = await newSim({ adminToken: secret });
    open.push(guarded);
    const state = (env: SimEnv | undefined, headers: Record<string, string> = {}) =>
      guarded
        .fetch(new Request("http://localhost:4010/sim/admin/state", { headers }), env)
        .then((r) => r.status);
    expect(await state(IN_PROCESS_ENV)).toBe(401);
    expect(await state({ incoming: { socket: { remoteAddress: "127.0.0.1" } } })).toBe(401);
    safeCompares.count = 0;
    expect(await state(undefined, { "x-sim-admin-token": secret })).toBe(200);
    expect(safeCompares.count).toBeGreaterThan(0);
  });

  it("never admits a webhook delivery: PayPal's transmission headers or the simulator's marker are refused", async () => {
    const sim = await newSim();
    open.push(sim);
    const loopback: SimEnv = { incoming: { socket: { remoteAddress: "127.0.0.1" } } };
    const markers: Record<string, string>[] = [
      { "paypal-transmission-id": "6f3e0c80-0000-0000-0000-000000000000" },
      { "paypal-transmission-sig": "c2lnbmF0dXJl" },
      { "x-fairsplit-simulated": "true" },
    ];
    for (const headers of markers) {
      const res = await sim.fetch(
        new Request("http://127.0.0.1:4010/sim/admin/deny-next-batch", { method: "POST", headers }),
        loopback,
      );
      expect(res.status, JSON.stringify(headers)).toBe(403);
    }
    expect(sim.state.denyNextBatch).toBe(false);
  });

  it("bound to a non-loopback address, the standalone server's admin needs SIM_ADMIN_TOKEN, and loopback webhooks are refused", async () => {
    // What startServer({ host: "0.0.0.0" }) passes, without binding a public interface in a test.
    const exposed = { url: "http://127.0.0.1:4010", host: "0.0.0.0" };
    const sim = await createSimulator({ ...quiet, standalone: exposed });
    open.push(sim);
    const res = await sim.fetch(
      new Request("http://127.0.0.1:4010/sim/admin/deny-next-batch", { method: "POST" }),
      {
        incoming: { socket: { remoteAddress: "127.0.0.1" } },
      },
    );
    expect(res.status).toBe(403);
    expect(sim.state.denyNextBatch).toBe(false);
    await expect(
      createSimulator({ ...quiet, standalone: exposed, allowLoopbackWebhooks: true }),
    ).rejects.toThrow(/local development only/);
    const withToken = await createSimulator({
      ...quiet,
      standalone: exposed,
      adminToken: "exposed-admin-token-01",
    });
    open.push(withToken);
    const ok = await withToken.fetch(
      new Request("http://127.0.0.1:4010/sim/admin/state", {
        headers: { "x-sim-admin-token": "exposed-admin-token-01" },
      }),
    );
    expect(ok.status).toBe(200);
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

describe("self-SSRF: webhooks never reach the simulator's own admin or pages (finding 3)", () => {
  const LAN: SimEnv = { incoming: { socket: { remoteAddress: "192.168.1.20" } } };
  const closers: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of closers.splice(0)) await close();
  });

  /** A caller on another machine: every request arrives from a LAN address, as the verifier's probe sent them. */
  const peerOf =
    (sim: Simulator, base: string) => async (method: string, path: string, body?: unknown, tok?: string) => {
      const res = await sim.fetch(
        new Request(`${base}${path}`, {
          method,
          headers: {
            ...(tok ? { authorization: `Bearer ${tok}` } : {}),
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }),
        LAN,
      );
      const text = await res.text();
      // biome-ignore lint/suspicious/noExplicitAny: test convenience for JSON bodies
      return { status: res.status, json: (text.startsWith("{") ? JSON.parse(text) : null) as any };
    };

  it("a non-loopback peer cannot aim a webhook (create, PATCH, simulate-event, stored) at the standalone server itself", async () => {
    const rx = await receiver(); // a receiver the operator allowed with --webhook-origin
    const server = await startServer({ host: "127.0.0.1", port: 0, ...quiet, webhookOrigins: [rx.origin] });
    closers.push(
      () => server.close(),
      () => rx.close(),
    );
    const sim = server.simulator;
    const peer = peerOf(sim, server.url);
    expect((await peer("POST", "/sim/admin/deny-next-batch")).status).toBe(403); // direct admin: refused
    const tok = await token(sim, "fs-dev", "192.168.1.20"); // the committed simulator credentials
    expect((await peer("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-SELF-1"), tok)).status).toBe(
      201,
    );

    const port = server.port;
    const self = [
      `${server.url}/sim/admin/deny-next-batch`,
      `${server.url}/sim/admin/reset`,
      `http://localhost:${port}/sim/admin/reset`,
      `http://[::1]:${port}/sim/admin/reset`,
      `http://[::ffff:127.0.0.1]:${port}/sim/admin/reset`,
      `${server.url}/s%69m/admin/reset`,
      `${server.url}/webhooks/paypal`, // the standalone server is the simulator, not a receiver
    ];
    for (const url of self) {
      const created = await peer(
        "POST",
        "/v1/notifications/webhooks",
        { url, event_types: [{ name: "*" }] },
        tok,
      );
      expect(created.status, url).toBe(400);
      expect(created.json?.details?.[0]?.issue, url).toBe("Not a valid webhook URL");
      const mock = await peer(
        "POST",
        "/v1/notifications/simulate-event",
        { url, event_type: "INVOICING.INVOICE.PAID" },
        tok,
      );
      expect(mock.status, url).toBe(400);
    }
    const hook = await peer(
      "POST",
      "/v1/notifications/webhooks",
      { url: rx.url, event_types: [{ name: "*" }] },
      tok,
    );
    expect(hook.status).toBe(201);
    const patched = await peer(
      "PATCH",
      `/v1/notifications/webhooks/${hook.json.id}`,
      [{ op: "replace", path: "/url", value: `${server.url}/sim/admin/reset` }],
      tok,
    );
    expect(patched.status).toBe(400);

    // A target stored before this policy (an old snapshot) gets no POST: every attempt re-checks it.
    const clientId = sim.registry.apps[0]?.client_id as string;
    sim.state.webhooks.SIMLEGACYSELF0001 = {
      id: "SIMLEGACYSELF0001",
      clientId,
      url: `${server.url}/sim/admin/deny-next-batch`,
      eventTypes: ["*"],
      createdAt: sim.clock.now(),
    };
    expect((await peer("POST", "/v2/invoicing/invoices", canonicalInvoice("FS-SELF-2"), tok)).status).toBe(
      201,
    );
    await sim.idle();
    const legacy = Object.values(sim.state.deliveries).filter((d) => d.webhookId === "SIMLEGACYSELF0001");
    expect(legacy.length).toBeGreaterThan(0);
    for (const d of legacy) expect(d).toMatchObject({ status: "FAILED", attempts: 0 });
    expect(sim.state.denyNextBatch).toBe(false);
    expect(Object.keys(sim.state.invoices)).toHaveLength(2);
    expect(Object.keys(sim.state.webhooks)).toContain(hook.json.id);
    expect(rx.deliveries.length).toBeGreaterThan(0); // the allowed receiver still gets its events
  });

  it("with --allow-loopback-webhooks the standalone server still refuses its own port, not other loopback receivers", async () => {
    const rx = await receiver();
    const server = await startServer({ host: "127.0.0.1", port: 0, ...quiet, allowLoopbackWebhooks: true });
    closers.push(
      () => server.close(),
      () => rx.close(),
    );
    const peer = peerOf(server.simulator, server.url);
    const tok = await token(server.simulator, "fs-dev", "192.168.1.20");
    for (const url of [
      `${server.url}/sim/admin/reset`,
      `http://localhost:${server.port}/sim/admin/reset`,
      `http://127.0.0.1:${server.port}/webhooks/paypal`,
    ]) {
      const res = await peer(
        "POST",
        "/v1/notifications/webhooks",
        { url, event_types: [{ name: "*" }] },
        tok,
      );
      expect(res.status, url).toBe(400);
    }
    const ok = await peer(
      "POST",
      "/v1/notifications/webhooks",
      { url: rx.url, event_types: [{ name: "*" }] },
      tok,
    );
    expect(ok.status).toBe(201);
  });

  it("on the host app's origin, the simulator's own /sim pages are never targets (decoded, any case); /webhooks/paypal is", async () => {
    const sim = await createSimulator({ ...quiet, publicBaseUrl: PUBLIC, basePath: "/paypal-sim" });
    closers.push(() => sim.close());
    const tok = await token(sim);
    const hook = (url: string) =>
      call(sim, "POST", "/v1/notifications/webhooks", {
        token: tok,
        body: { url, event_types: [{ name: "INVOICING.INVOICE.PAID" }] },
      }).then((r) => `${r.status} ${r.json?.details?.[0]?.description ?? ""}`);
    const ownPages = "400 The simulator never delivers webhooks to its own /sim pages.";
    for (const url of [
      `${PUBLIC}/paypal-sim/sim/invoice/INV2-SIMA-AAAA-BBBB-CCCC/pay`,
      `${PUBLIC}/paypal-sim/sim/admin/reset`,
      `${PUBLIC}/PAYPAL-SIM/SIM/admin/reset`,
      `${PUBLIC}/paypal-sim/s%69m/admin/reset`,
      `${PUBLIC}/paypal-sim/%2573im/admin/reset`,
      `${PUBLIC}/paypal-sim//sim/health`,
      `${PUBLIC}/paypal-sim%2Fsim/admin/reset`,
      `${PUBLIC}/webhooks/..%2F..%2Fpaypal-sim/sim/admin/reset`,
      `${PUBLIC}/sim/admin/reset`,
    ])
      expect(await hook(url), url).toBe(ownPages);
    expect(await hook(`${PUBLIC}/webhooks/paypal`)).toBe("201 ");
    expect(await hook(`${PUBLIC}/paypal-simulated/sim`)).toBe("201 "); // a different path, not the mount
    // A stored URL skips request validation (whose uri format refuses a stray %), so the delivery-time check
    // must decode around one, as Hono's router does.
    const stored = checkWebhookTarget(
      sim.options.webhookTargets,
      `${PUBLIC}/paypal-sim/s%69m/admin/invoice/x%/pay`,
    );
    expect(stored).toEqual({
      ok: false,
      description: "The simulator never delivers webhooks to its own /sim pages.",
    });
  });

  it("another simulator's delivery into this one's admin is refused by the gate itself (defence in depth)", async () => {
    const target = await startServer({ host: "127.0.0.1", port: 0, ...quiet });
    // A second simulator in dev mode may deliver to any loopback port, so its policy cannot know the target.
    const other = await newSim({ delivery: { maxAttempts: 1 } });
    closers.push(
      () => target.close(),
      () => other.close(),
    );
    const tok = await token(other);
    await subscribe(other, tok, `${target.url}/sim/admin/deny-next-batch`, ["INVOICING.INVOICE.CREATED"]);
    await call(other, "POST", "/v2/invoicing/invoices", { token: tok, body: canonicalInvoice("FS-CROSS") });
    await other.idle();
    const d = Object.values(other.state.deliveries)[0];
    expect(d).toMatchObject({ status: "FAILED", attempts: 1, lastStatusCode: 403 });
    expect(target.simulator.state.denyNextBatch).toBe(false);
  });
});
