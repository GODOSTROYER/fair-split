// HTTP surface, as three handlers over the same routes:
//  • api   — PayPal's REST routes behind one wrapper (marker headers, latency, per-address throttle, OAuth,
//            PayPal-Request-Id idempotency where the spec declares it, request and response validation
//            against the vendored spec). The in-process interceptor answers the sandbox hosts with it.
//  • pages — the simulator's public pages: certificate chain, labelled invoice and pay pages, health.
//            This is the only handler a host app should mount publicly (Simulator.publicFetch).
//  • app   — both, plus the fail-closed /sim/admin API (the standalone server).
import { createHash, timingSafeEqual } from "node:crypto";
import { type Context, Hono } from "hono";
import { SIMULATED_HEADER } from "../constants.js";
import {
  forbidden,
  invalidRequest,
  malformedJson,
  SimHttpError,
  unauthorized,
  v1Error,
  v2Error,
} from "../errors.js";
import { isLoopbackHostname, isLoopbackIp, normalizeIp } from "../net.js";
import type { Simulator } from "../simulator.js";
import type { Json, JsonObject } from "../state.js";
import { newDebugId } from "../util/ids.js";
import { DAY_MS } from "../util/time.js";
import { escapeHtml, renderPayPage } from "./pages.js";
import { basicClient, buildRoutes, type Route, type RouteResult } from "./routes.js";

const IDEMPOTENCY_TTL_MS = 30 * DAY_MS;

/** Marks a request made by code in this process (the interceptor): one client address, like one server IP. */
export const IN_PROCESS: unique symbol = Symbol("paypal-sim.in-process");

/** What a Node adapter (or the interceptor) passes as the fetch handler's second argument. */
export type SimEnv = {
  incoming?: { socket?: { remoteAddress?: string } };
  [IN_PROCESS]?: true;
};

export const IN_PROCESS_ENV: SimEnv = Object.freeze({ [IN_PROCESS]: true as const });

type Ctx = Context<{ Bindings: SimEnv }>;

export interface SimHandlers {
  /** REST + public pages + admin (standalone server). */
  app: Hono;
  /** PayPal REST routes only (the interceptor). */
  api: Hono;
  /** Public pages only (Simulator.publicFetch). */
  pages: Hono;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function prefixOf(sim: Simulator, path: string): string {
  const base = sim.options.basePath;
  return base && (path === base || path.startsWith(`${base}/`)) ? base : "";
}

/** The origin the caller used (host-agnostic HATEOAS links), honouring X-Forwarded-* from tunnels. */
export function originOf(sim: Simulator, c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
  return `${proto}://${host}${prefixOf(sim, url.pathname)}`;
}

/**
 * The address the throttle counts against, as the sandbox counts per IP: the socket's remote address, or one
 * shared key for in-process callers. X-Forwarded-For is client-controlled and ignored unless `trustProxy`
 * says exactly one trusted proxy appends it; then its right-most entry is the address that proxy saw.
 */
export function clientAddress(sim: Simulator, c: Ctx): string {
  const env = c.env as SimEnv | undefined;
  if (env?.[IN_PROCESS]) return "in-process";
  if (sim.options.trustProxy) {
    const hops = (c.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((h) => h.trim())
      .filter((h) => h !== "");
    const last = hops[hops.length - 1];
    if (last) return `ip:${normalizeIp(last)}`;
  }
  const socket = env?.incoming?.socket?.remoteAddress;
  return socket ? `ip:${normalizeIp(socket)}` : "in-process";
}

function simHeaders(debugId?: string): Headers {
  const h = new Headers({ [SIMULATED_HEADER]: "true" });
  if (debugId) h.set("paypal-debug-id", debugId);
  return h;
}

function internalError(route: Route, debugId: string, description: string): SimHttpError {
  if (route.family === "invoicing" || route.family === "reporting")
    return v2Error(route.family, 500, debugId, [{ issue: "SIMULATOR_ERROR", description }]);
  if (route.family === "oauth")
    return new SimHttpError(500, { error: "server_error", error_description: description });
  return v1Error(route.family, 500, "INTERNAL_SERVER_ERROR", "An internal server error occurred.", debugId, [
    { issue: "SIMULATOR_ERROR", description },
  ]);
}

function rateLimited(route: Route, debugId: string, retryAfter: number): SimHttpError {
  const body: JsonObject =
    route.family === "oauth"
      ? { error: "rate_limit_reached", error_description: "Too many requests. Blocked due to rate limiting." }
      : {
          name: "RATE_LIMIT_REACHED",
          message: "Too many requests. Blocked due to rate limiting.",
          debug_id: debugId,
          details: [{ issue: "TOO_MANY_REQUESTS", description: "Too many requests." }],
          links: [
            {
              href: "https://developer.paypal.com/api/rest/reference/rate-limiting/",
              rel: "information_link",
              method: "GET",
            },
          ],
        };
  return new SimHttpError(429, body, { "retry-after": String(retryAfter) });
}

function sameSecret(given: string, expected: string): boolean {
  // Hash both sides first: equal-length inputs for timingSafeEqual, and no early exit on a length mismatch.
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

/**
 * The admin gate, fail-closed. With SIM_ADMIN_TOKEN: the `x-sim-admin-token` header must match (constant
 * time). Without it: refused outright unless publicBaseUrl is a loopback URL; and then only for a loopback
 * socket, a loopback Host (DNS-rebinding guard) and, when a browser sends one, a loopback Origin (CSRF guard).
 */
export function adminRefusal(sim: Simulator, c: Ctx): { status: 401 | 403; error: string } | null {
  const token = sim.options.adminToken;
  if (token !== null)
    return sameSecret(c.req.header("x-sim-admin-token") ?? "", token)
      ? null
      : { status: 401, error: "admin token required (x-sim-admin-token)" };
  if (!sim.localOnly)
    return {
      status: 403,
      error:
        "The simulator admin API is disabled: publicBaseUrl is not a loopback URL and SIM_ADMIN_TOKEN is not set.",
    };
  const remote = (c.env as SimEnv | undefined)?.incoming?.socket?.remoteAddress;
  if (remote !== undefined && !isLoopbackIp(remote))
    return { status: 403, error: "Without SIM_ADMIN_TOKEN the admin API answers loopback callers only." };
  if (!isLoopbackHostname(new URL(c.req.url).hostname))
    return { status: 403, error: "Without SIM_ADMIN_TOKEN the admin API answers loopback host names only." };
  const origin = c.req.header("origin");
  if (origin !== undefined) {
    let host = "";
    try {
      host = new URL(origin).hostname;
    } catch {
      host = "";
    }
    if (!isLoopbackHostname(host)) return { status: 403, error: "Cross-origin admin requests are refused." };
  }
  return null;
}

function json(status: number, body: Json): Response {
  const headers = simHeaders();
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status, headers });
}

function notFound(): Response {
  const debugId = newDebugId();
  const headers = simHeaders(debugId);
  headers.set("content-type", "application/json");
  return new Response(
    JSON.stringify({
      name: "RESOURCE_NOT_FOUND",
      message: "The Fair Split PayPal simulator does not implement this endpoint.",
      debug_id: debugId,
    }),
    { status: 404, headers },
  );
}

/** PayPal's REST routes. */
function restRoutes(sim: Simulator): Hono<{ Bindings: SimEnv }> {
  const api = new Hono<{ Bindings: SimEnv }>();
  const routes = buildRoutes(sim);
  /** Requests carrying the same PayPal-Request-Id are serialised so a concurrent retry replays the first. */
  const inflight = new Map<string, Promise<void>>();

  const finish = (
    route: Route,
    result: RouteResult,
    debugId: string,
    idempotency: { key: string; hash: string } | null,
  ): Response => {
    let status = result.status;
    let body: Json | undefined = result.body;
    const headers = simHeaders(debugId);
    const issues = sim.contract.validateResponse(route.op, status, body ?? null, result.responseSchema);
    if (issues.length > 0) {
      sim.recordViolation(`${route.op} ${status}: ${JSON.stringify(issues)}`);
      headers.set("x-fairsplit-sim-contract", "violated");
      if (sim.options.strict) {
        const err = internalError(
          route,
          debugId,
          `Simulator response violated the spec: ${JSON.stringify(issues).slice(0, 900)}`,
        );
        status = err.status;
        body = err.body;
      }
    }
    for (const [k, v] of Object.entries(result.headers ?? {})) headers.set(k, v);
    const text = body === undefined || status === 204 ? null : JSON.stringify(body);
    if (text !== null) headers.set("content-type", "application/json");
    if (idempotency && status < 500 && status !== 429 && status !== 401 && status !== 403) {
      const now = sim.clock.now();
      for (const [k, v] of Object.entries(sim.state.idempotency))
        if (now - v.at >= IDEMPOTENCY_TTL_MS) delete sim.state.idempotency[k];
      sim.state.idempotency[idempotency.key] = {
        bodyHash: idempotency.hash,
        status,
        body: text,
        contentType: text === null ? null : "application/json",
        at: sim.clock.now(),
      };
      sim.markDirty();
    }
    return new Response(text, { status, headers });
  };

  const latency = (): number => {
    const l = sim.options.latencyMs;
    if (Array.isArray(l)) return l[0] + Math.random() * Math.max(0, l[1] - l[0]);
    return l;
  };

  for (const route of routes) {
    const op = sim.contract.op(route.op);
    // PayPal: "Not all APIs support this header" — honour it only where the vendored spec declares it.
    const replays =
      route.method === "POST" &&
      route.auth === "bearer" &&
      (sim.options.idempotency === "all-posts" || op.headers.includes("paypal-request-id"));
    api.on(route.method, route.path, async (c) => {
      const debugId = newDebugId();
      let idempotency: { key: string; hash: string } | null = null;
      let releaseInflight: (() => void) | null = null;
      try {
        const delay = latency();
        if (delay > 0) await sleep(delay);

        // Throttle per client address, as the sandbox blocks per IP, before anything else is looked at.
        const decision = sim.rateLimiter.check(clientAddress(sim, c));
        if (!decision.allowed) throw rateLimited(route, debugId, decision.retryAfterSeconds);

        const authz = c.req.header("authorization") ?? "";
        const raw = route.method === "GET" || route.method === "DELETE" ? "" : await c.req.text();
        let body: JsonObject = route.form ? (Object.fromEntries(new URLSearchParams(raw)) as JsonObject) : {};

        // Authentication comes before body parsing, as on PayPal.
        let clientId: string;
        if (route.auth === "basic") {
          const id = basicClient(sim, c.req.raw.headers, body);
          if (!id) throw unauthorized("oauth", debugId);
          clientId = id;
        } else {
          if (!authz.toLowerCase().startsWith("bearer ")) throw unauthorized(route.family, debugId);
          const token = sim.state.tokens[authz.slice(7).trim()];
          if (!token || token.expiresAt <= sim.clock.now()) throw unauthorized(route.family, debugId);
          if (route.scope && !token.scopes.includes(route.scope))
            throw forbidden(route.family, debugId, route.scope);
          clientId = token.clientId;
        }

        if (!route.form && raw.trim() !== "") {
          let parsed: Json;
          try {
            parsed = JSON.parse(raw) as Json;
          } catch {
            throw malformedJson(route.family, debugId);
          }
          if (typeof parsed !== "object" || parsed === null) throw malformedJson(route.family, debugId);
          body = parsed as JsonObject;
        }

        // PayPal-Request-Id: an identical retry within 30 days replays the stored response.
        const requestId = c.req.header("paypal-request-id");
        if (requestId && replays) {
          const url = new URL(c.req.url);
          const key = `${clientId}|${route.method}|${url.pathname.slice(prefixOf(sim, url.pathname).length)}|${requestId}`;
          const hash = createHash("sha256").update(raw).digest("hex");
          const running = inflight.get(key);
          if (running) await running;
          const prior = sim.state.idempotency[key];
          if (prior && prior.bodyHash === hash && sim.clock.now() - prior.at < IDEMPOTENCY_TTL_MS) {
            const headers = simHeaders(debugId);
            headers.set("paypal-idempotent-replay", "true");
            if (prior.contentType) headers.set("content-type", prior.contentType);
            return new Response(prior.body, { status: prior.status, headers });
          }
          idempotency = { key, hash };
          let release: () => void = () => {};
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          inflight.set(key, gate);
          releaseInflight = () => {
            if (inflight.get(key) === gate) inflight.delete(key);
            release();
          };
        }

        // Request validation against the vendored spec.
        if (op.request) {
          const subject = route.method === "PATCH" ? (JSON.parse(raw || "[]") as Json) : body;
          const issues = sim.contract.validateRequest(route.op, subject);
          if (issues.length > 0) throw invalidRequest(route.family, debugId, issues);
        } else {
          sim.contract.validateRequest(route.op, body);
        }

        const account = sim.accountForClient(clientId);
        const result = await route.handler({
          sim,
          clientId,
          account,
          origin: originOf(sim, c),
          debugId,
          body,
          raw,
          query: new URL(c.req.url).searchParams,
          params: c.req.param() as Record<string, string>,
          headers: c.req.raw.headers,
        });
        return finish(route, result, debugId, idempotency);
      } catch (err) {
        if (err instanceof SimHttpError)
          return finish(
            route,
            { status: err.status, body: err.body, headers: err.headers },
            debugId,
            idempotency,
          );
        sim.logLine(
          `unhandled error in ${route.op}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
        );
        const e = internalError(route, debugId, "Unhandled simulator error.");
        return finish(route, { status: e.status, body: e.body }, debugId, null);
      } finally {
        releaseInflight?.();
      }
    });
  }
  return api;
}

/** The simulator's own public pages: certificate chain, labelled invoice and pay pages, health. */
function publicPages(sim: Simulator): Hono<{ Bindings: SimEnv }> {
  const pages = new Hono<{ Bindings: SimEnv }>();
  const html = (status: number, markup: string): Response => {
    const headers = simHeaders();
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set(
      "content-security-policy",
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'self'",
    );
    headers.set("x-robots-tag", "noindex");
    return new Response(markup, { status, headers });
  };

  pages.get("/sim/health", () => json(200, { ok: true, simulated: true, cert_url: sim.certUrl }));

  pages.get("/sim/certs/:file", (c) => {
    if (c.req.param("file") !== `${sim.signing.certId}.pem`)
      return json(404, { error: "unknown certificate", simulated: true });
    const headers = simHeaders();
    headers.set("content-type", "application/x-pem-file");
    headers.set("cache-control", "public, max-age=3600");
    return new Response(sim.signing.chainPem, { status: 200, headers });
  });

  const payable = (status: string) => ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(status);

  pages.get("/sim/invoice/:id", (c) => {
    const rec = sim.state.invoices[c.req.param("id")];
    if (!rec || rec.deleted)
      return html(404, "<!doctype html><title>Not found</title><p>Simulated invoice not found.</p>");
    return html(200, renderPayPage(rec, { payable: false, action: "" }));
  });

  pages.get("/sim/invoice/:id/pay", (c) => {
    sim.invoicing.sweepAutoCancel();
    const rec = sim.state.invoices[c.req.param("id")];
    if (!rec || rec.deleted)
      return html(404, "<!doctype html><title>Not found</title><p>Simulated invoice not found.</p>");
    const url = new URL(c.req.url);
    return html(
      200,
      renderPayPage(rec, { payable: payable(String(rec.invoice.status)), action: url.pathname }),
    );
  });

  pages.post("/sim/invoice/:id/pay", async (c) => {
    const id = c.req.param("id");
    const wantsJson = (c.req.header("accept") ?? "").includes("application/json");
    const form = new URLSearchParams(await c.req.text());
    try {
      const rec = sim.invoicing.payOnPage(id, form.get("payer") ?? undefined);
      if (wantsJson) return json(200, { id, status: String(rec.invoice.status), simulated: true });
      return html(
        200,
        renderPayPage(rec, { payable: false, action: "", message: "Paid (simulated PayPal payment)." }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (wantsJson) return json(422, { error: message, simulated: true });
      return html(422, `<!doctype html><title>Cannot pay</title><p>${escapeHtml(message)}</p>`);
    }
  });
  return pages;
}

/** Judge Mode reset, toggles and clock — never public: see adminRefusal. */
function adminRoutes(sim: Simulator): Hono<{ Bindings: SimEnv }> {
  const admin = new Hono<{ Bindings: SimEnv }>();
  admin.use("/sim/admin/*", async (c, next) => {
    const refusal = adminRefusal(sim, c);
    if (refusal) return json(refusal.status, { error: refusal.error, simulated: true });
    await next();
  });
  admin.get("/sim/admin/state", () => json(200, sim.summary()));
  admin.get("/sim/admin/accounts", () =>
    json(200, {
      simulated: true,
      accounts: sim.registry.accounts.map((a) => ({
        key: a.key,
        role: a.role,
        type: a.type,
        email: a.email,
        payer_id: a.payer_id,
        ...(a.member_no ? { member_no: a.member_no } : {}),
      })),
      apps: sim.registry.apps.map((a) => ({ name: a.name, client_id: a.client_id, account: a.account })),
      unregistered_receivers: sim.registry.unregistered_receivers,
    } as unknown as Json),
  );
  admin.get("/sim/admin/deliveries", () =>
    json(200, {
      deliveries: Object.values(sim.state.deliveries).map((d) => ({
        transmission_id: d.transmissionId,
        event_id: d.eventId,
        event_type: sim.state.events[d.eventId]?.eventType ?? null,
        webhook_id: d.webhookId,
        url: d.url,
        status: d.status,
        attempts: d.attempts,
        last_status_code: d.lastStatusCode,
      })),
    } as unknown as Json),
  );
  admin.post("/sim/admin/reset", () => {
    sim.reset();
    return json(200, { ok: true, reset: true });
  });
  admin.post("/sim/admin/snapshot", () => {
    sim.flush();
    return json(200, { ok: true, persisted: sim.options.persist });
  });
  admin.post("/sim/admin/delivery", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as JsonObject;
    if (typeof body.out_of_order === "boolean") sim.state.delivery.outOfOrder = body.out_of_order;
    if (typeof body.duplicate === "boolean") sim.state.delivery.duplicate = body.duplicate;
    return json(200, { ok: true, delivery: { ...sim.state.delivery } });
  });
  admin.post("/sim/admin/clock", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as JsonObject;
    if (typeof body.advance_seconds === "number") sim.clock.advance(body.advance_seconds * 1000);
    sim.sweep();
    return json(200, { ok: true, now: new Date(sim.clock.now()).toISOString() });
  });
  admin.post("/sim/admin/deny-next-batch", () => {
    sim.state.denyNextBatch = true;
    return json(200, { ok: true });
  });
  return admin;
}

export function buildApp(sim: Simulator): SimHandlers {
  const rest = restRoutes(sim);
  const pages = publicPages(sim);
  const admin = adminRoutes(sim);
  const compose = (...parts: Hono<{ Bindings: SimEnv }>[]): Hono => {
    const inner = new Hono<{ Bindings: SimEnv }>();
    for (const part of parts) inner.route("/", part);
    inner.notFound(() => notFound());
    if (!sim.options.basePath) return inner as unknown as Hono;
    const root = new Hono<{ Bindings: SimEnv }>();
    root.route(sim.options.basePath, inner);
    root.route("/", inner);
    root.notFound(() => notFound());
    return root as unknown as Hono;
  };
  return { app: compose(rest, pages, admin), api: compose(rest), pages: compose(pages) };
}
