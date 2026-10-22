// HTTP surface: PayPal's routes behind one wrapper (marker headers, latency, throttle, OAuth, PayPal-Request-Id
// idempotency, request and response validation against the vendored spec) plus the simulator's own /sim pages.
import { createHash } from "node:crypto";
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
import type { Simulator } from "../simulator.js";
import type { Json, JsonObject } from "../state.js";
import { newDebugId } from "../util/ids.js";
import { DAY_MS } from "../util/time.js";
import { escapeHtml, renderPayPage } from "./pages.js";
import { basicClient, buildRoutes, type Route, type RouteResult } from "./routes.js";

const IDEMPOTENCY_TTL_MS = 30 * DAY_MS;

type Env = { incoming?: { socket?: { remoteAddress?: string } } };

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

function remoteKey(c: Context<{ Bindings: Env }>): string {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const addr = fwd || c.env?.incoming?.socket?.remoteAddress;
  return addr ? `ip:${addr}` : "ip:in-process";
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

export function buildApp(sim: Simulator): Hono {
  const api = new Hono<{ Bindings: Env }>();
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
    api.on(route.method, route.path, async (c) => {
      const debugId = newDebugId();
      let idempotency: { key: string; hash: string } | null = null;
      let releaseInflight: (() => void) | null = null;
      try {
        const delay = latency();
        if (delay > 0) await sleep(delay);

        // Throttle per client (resolved without validating credentials), like the sandbox's per-IP block.
        const authz = c.req.header("authorization") ?? "";
        let rateKey = remoteKey(c);
        if (authz.toLowerCase().startsWith("bearer ")) {
          const t = sim.state.tokens[authz.slice(7).trim()];
          if (t) rateKey = `client:${t.clientId}`;
        } else if (authz.toLowerCase().startsWith("basic ")) {
          const decoded = Buffer.from(authz.slice(6).trim(), "base64").toString("utf8");
          const id = decoded.split(":")[0];
          if (id) rateKey = `client:${id}`;
        }
        const decision = sim.rateLimiter.check(rateKey);
        if (!decision.allowed) throw rateLimited(route, debugId, decision.retryAfterSeconds);

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
        if (requestId && route.method === "POST" && route.auth === "bearer") {
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
        const op = sim.contract.op(route.op);
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

  // ── simulator-own pages ──────────────────────────────────────────────────────────────────────────
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
  const json = (status: number, body: Json): Response => {
    const headers = simHeaders();
    headers.set("content-type", "application/json");
    return new Response(JSON.stringify(body), { status, headers });
  };

  api.get("/sim/health", () => json(200, { ok: true, simulated: true, cert_url: sim.certUrl }));

  api.get("/sim/certs/:file", (c) => {
    if (c.req.param("file") !== `${sim.signing.certId}.pem`)
      return json(404, { error: "unknown certificate" });
    const headers = simHeaders();
    headers.set("content-type", "application/x-pem-file");
    headers.set("cache-control", "public, max-age=3600");
    return new Response(sim.signing.chainPem, { status: 200, headers });
  });

  const payable = (status: string) => ["SENT", "UNPAID", "PARTIALLY_PAID"].includes(status);

  api.get("/sim/invoice/:id", (c) => {
    const rec = sim.state.invoices[c.req.param("id")];
    if (!rec || rec.deleted)
      return html(404, "<!doctype html><title>Not found</title><p>Simulated invoice not found.</p>");
    return html(200, renderPayPage(rec, { payable: false, action: "" }));
  });

  api.get("/sim/invoice/:id/pay", (c) => {
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

  api.post("/sim/invoice/:id/pay", async (c) => {
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

  // ── admin (Judge Mode reset, toggles, clock) ─────────────────────────────────────────────────────
  api.use("/sim/admin/*", async (c, next) => {
    const token = sim.options.adminToken;
    if (token && c.req.header("x-sim-admin-token") !== token)
      return json(401, { error: "admin token required" });
    await next();
  });
  api.get("/sim/admin/state", () => json(200, sim.summary()));
  api.get("/sim/admin/accounts", () =>
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
  api.get("/sim/admin/deliveries", () =>
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
  api.post("/sim/admin/reset", () => {
    sim.reset();
    return json(200, { ok: true, reset: true });
  });
  api.post("/sim/admin/snapshot", () => {
    sim.flush();
    return json(200, { ok: true, persisted: sim.options.persist });
  });
  api.post("/sim/admin/delivery", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as JsonObject;
    if (typeof body.out_of_order === "boolean") sim.state.delivery.outOfOrder = body.out_of_order;
    if (typeof body.duplicate === "boolean") sim.state.delivery.duplicate = body.duplicate;
    return json(200, { ok: true, delivery: { ...sim.state.delivery } });
  });
  api.post("/sim/admin/clock", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as JsonObject;
    if (typeof body.advance_seconds === "number") sim.clock.advance(body.advance_seconds * 1000);
    sim.sweep();
    return json(200, { ok: true, now: new Date(sim.clock.now()).toISOString() });
  });
  api.post("/sim/admin/deny-next-batch", () => {
    sim.state.denyNextBatch = true;
    return json(200, { ok: true });
  });

  api.notFound(() => {
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
  });

  if (!sim.options.basePath) return api as unknown as Hono;
  const root = new Hono<{ Bindings: Env }>();
  root.route(sim.options.basePath, api);
  root.route("/", api);
  return root as unknown as Hono;
}
