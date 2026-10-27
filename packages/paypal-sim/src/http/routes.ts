// The PayPal REST routes the simulator implements, each bound to its operation in the vendored spec.
import { timingSafeEqual } from "node:crypto";
import { SCOPES } from "../constants.js";
import { EVENT_TYPES, isKnownEventType } from "../domain/webhooks.js";
import { type ApiFamily, oauthError, v1Error } from "../errors.js";
import { checkWebhookTarget } from "../net.js";
import type { Simulator } from "../simulator.js";
import type { Account, Json, JsonObject, WebhookRecord } from "../state.js";
import { newAccessToken, newLookupId, newNonce, newWebhookId } from "../util/ids.js";

export interface RouteCtx {
  sim: Simulator;
  clientId: string;
  account: Account;
  origin: string;
  debugId: string;
  body: JsonObject;
  raw: string;
  query: URLSearchParams;
  params: Record<string, string>;
  headers: Headers;
}

export interface RouteResult {
  status: number;
  body?: Json;
  headers?: Record<string, string>;
  /** Validate a 2xx body against this definition instead of the operation's documented one. */
  responseSchema?: string;
}

export interface Route {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  op: string;
  family: ApiFamily;
  auth: "bearer" | "basic";
  scope?: string;
  form?: boolean;
  handler: (x: RouteCtx) => RouteResult | Promise<RouteResult>;
}

const TOKEN_TTL_S = 32_400;
const MAX_WEBHOOKS_PER_APP = 10;

function obj(v: Json | undefined): JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? v : {};
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Resolves `Authorization: Basic …` (or form fields) to a registered app; null when invalid. */
export function basicClient(sim: Simulator, headers: Headers, form?: JsonObject): string | null {
  const auth = headers.get("authorization") ?? "";
  let id: string | undefined;
  let secret: string | undefined;
  if (auth.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0) {
      id = decoded.slice(0, i);
      secret = decoded.slice(i + 1);
    }
  } else if (form && typeof form.client_id === "string" && typeof form.client_secret === "string") {
    id = form.client_id;
    secret = form.client_secret;
  }
  if (!id || secret === undefined) return null;
  const app = sim.appByClientId(id);
  return app && safeEqual(app.client_secret, secret) ? app.client_id : null;
}

function webhookJson(w: WebhookRecord, origin: string): JsonObject {
  const href = `${origin}/v1/notifications/webhooks/${w.id}`;
  return {
    id: w.id,
    url: w.url,
    event_types: w.eventTypes.map((name) => ({
      name,
      description: EVENT_TYPES.find((e) => e.name === name)?.description ?? "ALL",
    })),
    links: [
      { href, rel: "self", method: "GET" },
      { href, rel: "update", method: "PATCH" },
      { href, rel: "delete", method: "DELETE" },
    ],
  };
}

function eventTypeNames(x: RouteCtx, value: Json | undefined): string[] {
  const list = Array.isArray(value) ? value : [];
  const names = list.map((e) => obj(e).name).filter((n): n is string => typeof n === "string");
  if (names.length === 0)
    throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
      { field: "event_types", location: "body", issue: "At least one event type is required." },
    ]);
  const unknown = names.find((n) => !isKnownEventType(n));
  if (unknown)
    throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
      {
        field: "event_types",
        value: unknown,
        location: "body",
        issue: `Event type ${unknown} is not supported.`,
      },
    ]);
  return [...new Set(names)];
}

/**
 * A webhook (or simulate-event) URL must pass the simulator's target policy (see net.ts). The refusal uses
 * the body the sandbox returns for a bad webhook URL — VALIDATION_ERROR, issue "Not a valid webhook URL" —
 * plus a description saying why the simulator refused it.
 */
function checkUrl(x: RouteCtx, url: unknown, field = "url"): string {
  const verdict = checkWebhookTarget(x.sim.options.webhookTargets, url);
  if (!verdict.ok)
    throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
      { field, location: "body", issue: "Not a valid webhook URL", description: verdict.description },
    ]);
  return url as string;
}

function ownedWebhook(x: RouteCtx, id: string): WebhookRecord {
  const w = x.sim.state.webhooks[id];
  if (!w || w.clientId !== x.clientId)
    throw v1Error("webhooks", 404, "INVALID_RESOURCE_ID", "Resource id is invalid.", x.debugId);
  return w;
}

export function buildRoutes(sim: Simulator): Route[] {
  const invoicing = sim.invoicing;
  const reporting = sim.reporting;
  const inv = (x: RouteCtx) => ({
    clientId: x.clientId,
    account: x.account,
    origin: x.origin,
    debugId: x.debugId,
  });
  const p = (x: RouteCtx, name: string) => x.params[name] ?? "";

  const routes: Route[] = [
    // ── OAuth ──────────────────────────────────────────────────────────────────────────────────────
    {
      method: "POST",
      path: "/v1/oauth2/token",
      op: "oauth:oauth2.token",
      family: "oauth",
      auth: "basic",
      form: true,
      handler: (x) => {
        const app = sim.appByClientId(x.clientId);
        if (!app) throw oauthError(401, "invalid_client", "Client Authentication failed");
        const token = newAccessToken();
        const now = sim.clock.now();
        for (const [k, v] of Object.entries(sim.state.tokens))
          if (v.expiresAt <= now) delete sim.state.tokens[k];
        sim.state.tokens[token] = {
          clientId: app.client_id,
          scopes: app.scopes,
          expiresAt: now + TOKEN_TTL_S * 1000,
        };
        sim.markDirty();
        return {
          status: 200,
          body: {
            scope: app.scopes.join(" "),
            access_token: token,
            token_type: "Bearer",
            app_id: app.app_id,
            expires_in: TOKEN_TTL_S,
            nonce: newNonce(now),
          },
        };
      },
    },

    // ── Invoicing v2 ───────────────────────────────────────────────────────────────────────────────
    {
      method: "POST",
      path: "/v2/invoicing/invoices",
      op: "invoicing:invoices.create",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.create(inv(x), x.body, x.headers.get("prefer")),
    },
    {
      method: "GET",
      path: "/v2/invoicing/invoices",
      op: "invoicing:invoices.list",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.list(inv(x), x.query),
    },
    {
      method: "POST",
      path: "/v2/invoicing/search-invoices",
      op: "invoicing:invoices.search-invoices",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.search(inv(x), x.body, x.query),
    },
    {
      method: "POST",
      path: "/v2/invoicing/generate-next-invoice-number",
      op: "invoicing:invoicing.generate-next-invoice-number",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.generateNextNumber(inv(x)),
    },
    {
      method: "GET",
      path: "/v2/invoicing/invoices/:invoice_id",
      op: "invoicing:invoices.get",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.get(inv(x), p(x, "invoice_id")),
    },
    {
      method: "PUT",
      path: "/v2/invoicing/invoices/:invoice_id",
      op: "invoicing:invoices.update",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.update(inv(x), p(x, "invoice_id"), x.body),
    },
    {
      method: "DELETE",
      path: "/v2/invoicing/invoices/:invoice_id",
      op: "invoicing:invoices.delete",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.remove(inv(x), p(x, "invoice_id")),
    },
    {
      method: "POST",
      path: "/v2/invoicing/invoices/:invoice_id/send",
      op: "invoicing:invoices.send",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.send(inv(x), p(x, "invoice_id"), x.body),
    },
    {
      method: "POST",
      path: "/v2/invoicing/invoices/:invoice_id/remind",
      op: "invoicing:invoices.remind",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.remind(inv(x), p(x, "invoice_id")),
    },
    {
      method: "POST",
      path: "/v2/invoicing/invoices/:invoice_id/cancel",
      op: "invoicing:invoices.cancel",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.cancel(inv(x), p(x, "invoice_id")),
    },
    {
      method: "POST",
      path: "/v2/invoicing/invoices/:invoice_id/payments",
      op: "invoicing:invoices.payments",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.recordPayment(inv(x), p(x, "invoice_id"), x.body),
    },
    {
      method: "DELETE",
      path: "/v2/invoicing/invoices/:invoice_id/payments/:transaction_id",
      op: "invoicing:invoices.payments-delete",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.deletePayment(inv(x), p(x, "invoice_id"), p(x, "transaction_id")),
    },
    {
      method: "POST",
      path: "/v2/invoicing/invoices/:invoice_id/conditional-rules",
      op: "conditional_rules:conditional-rules.create",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.createRules(inv(x), p(x, "invoice_id"), x.body),
    },
    {
      method: "GET",
      path: "/v2/invoicing/invoices/:invoice_id/conditional-rules",
      op: "conditional_rules:conditional-rules.list",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.listRules(inv(x), p(x, "invoice_id")),
    },
    {
      method: "GET",
      path: "/v2/invoicing/invoices/:invoice_id/conditional-rules/:rule_id",
      op: "conditional_rules:conditional-rules.get",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.getRule(inv(x), p(x, "invoice_id"), p(x, "rule_id")),
    },
    {
      method: "PUT",
      path: "/v2/invoicing/invoices/:invoice_id/conditional-rules/:rule_id",
      op: "conditional_rules:conditional-rules.update",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.updateRule(inv(x), p(x, "invoice_id"), p(x, "rule_id"), x.body),
    },
    {
      method: "DELETE",
      path: "/v2/invoicing/invoices/:invoice_id/conditional-rules/:rule_id",
      op: "conditional_rules:conditional-rules.delete",
      family: "invoicing",
      auth: "bearer",
      scope: SCOPES.invoicing,
      handler: (x) => invoicing.deleteRule(inv(x), p(x, "invoice_id"), p(x, "rule_id")),
    },

    // ── Payouts v1 ─────────────────────────────────────────────────────────────────────────────────
    {
      method: "POST",
      path: "/v1/payments/payouts",
      op: "payouts:payouts.post",
      family: "payouts",
      auth: "bearer",
      scope: SCOPES.payouts,
      handler: (x) => sim.payouts.create(inv(x), x.body),
    },
    {
      method: "GET",
      path: "/v1/payments/payouts/:id",
      op: "payouts:payouts.get",
      family: "payouts",
      auth: "bearer",
      scope: SCOPES.payouts,
      handler: (x) => sim.payouts.getBatch(inv(x), p(x, "id"), x.query),
    },
    {
      method: "GET",
      path: "/v1/payments/payouts-item/:payout_item_id",
      op: "payouts:payouts-item.get",
      family: "payouts",
      auth: "bearer",
      scope: SCOPES.payouts,
      handler: (x) => sim.payouts.getItem(inv(x), p(x, "payout_item_id")),
    },
    {
      method: "POST",
      path: "/v1/payments/payouts-item/:payout_item_id/cancel",
      op: "payouts:payouts-item.cancel",
      family: "payouts",
      auth: "bearer",
      scope: SCOPES.payouts,
      handler: (x) => sim.payouts.cancelItem(inv(x), p(x, "payout_item_id")),
    },

    // ── Webhooks v1 ────────────────────────────────────────────────────────────────────────────────
    {
      method: "POST",
      path: "/v1/notifications/webhooks",
      op: "webhooks:webhooks.post",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const url = checkUrl(x, x.body.url);
        const eventTypes = eventTypeNames(x, x.body.event_types);
        const mine = Object.values(sim.state.webhooks).filter((w) => w.clientId === x.clientId);
        if (mine.some((w) => w.url === url))
          throw v1Error(
            "webhooks",
            400,
            "WEBHOOK_URL_ALREADY_EXISTS",
            "Webhook URL already exists",
            x.debugId,
          );
        if (mine.length >= MAX_WEBHOOKS_PER_APP)
          throw v1Error(
            "webhooks",
            400,
            "WEBHOOK_NUMBER_LIMIT_EXCEEDED",
            "Maximum number of webhooks exceeded",
            x.debugId,
          );
        const w: WebhookRecord = {
          id: newWebhookId(),
          clientId: x.clientId,
          url,
          eventTypes,
          createdAt: sim.clock.now(),
        };
        sim.state.webhooks[w.id] = w;
        sim.markDirty();
        return { status: 201, body: webhookJson(w, x.origin) };
      },
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks",
      op: "webhooks:webhooks.list",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => ({
        status: 200,
        body: {
          webhooks: Object.values(sim.state.webhooks)
            .filter((w) => w.clientId === x.clientId)
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((w) => webhookJson(w, x.origin)),
        },
      }),
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks/:webhook_id",
      op: "webhooks:webhooks.get",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => ({ status: 200, body: webhookJson(ownedWebhook(x, p(x, "webhook_id")), x.origin) }),
    },
    {
      method: "PATCH",
      path: "/v1/notifications/webhooks/:webhook_id",
      op: "webhooks:webhooks.update",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const w = ownedWebhook(x, p(x, "webhook_id"));
        const ops = JSON.parse(x.raw || "[]") as Json[];
        let url = w.url;
        let eventTypes = w.eventTypes;
        for (const o of ops) {
          const op = obj(o);
          if (op.op !== "replace" && op.op !== "add")
            throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
              { field: "op", location: "body", issue: `Unsupported patch operation ${String(op.op)}.` },
            ]);
          if (op.path === "/url") url = checkUrl(x, op.value);
          else if (op.path === "/event_types") eventTypes = eventTypeNames(x, op.value);
          else
            throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
              { field: "path", location: "body", issue: `Unsupported patch path ${String(op.path)}.` },
            ]);
        }
        if (
          url !== w.url &&
          Object.values(sim.state.webhooks).some((o) => o.clientId === x.clientId && o.url === url)
        )
          throw v1Error(
            "webhooks",
            400,
            "WEBHOOK_URL_ALREADY_EXISTS",
            "Webhook URL already exists",
            x.debugId,
          );
        w.url = url;
        w.eventTypes = eventTypes;
        sim.markDirty();
        return { status: 200, body: webhookJson(w, x.origin) };
      },
    },
    {
      method: "DELETE",
      path: "/v1/notifications/webhooks/:webhook_id",
      op: "webhooks:webhooks.delete",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const w = ownedWebhook(x, p(x, "webhook_id"));
        delete sim.state.webhooks[w.id];
        sim.markDirty();
        return { status: 204 };
      },
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks/:webhook_id/event-types",
      op: "webhooks:event-types.list",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const w = ownedWebhook(x, p(x, "webhook_id"));
        return {
          status: 200,
          body: {
            event_types: w.eventTypes.map((name) => ({
              name,
              description: EVENT_TYPES.find((e) => e.name === name)?.description ?? "ALL",
              status: "ENABLED",
            })),
          },
        };
      },
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks-event-types",
      op: "webhooks:webhooks-event-types.list",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: () => ({
        status: 200,
        body: {
          event_types: EVENT_TYPES.map((e) => ({
            name: e.name,
            description: e.description,
            status: "ENABLED",
            resource_versions: [e.name.startsWith("INVOICING") ? "2.0" : "1.0"],
          })),
        },
      }),
    },
    {
      method: "POST",
      path: "/v1/notifications/webhooks-lookup",
      op: "webhooks:webhooks-lookup.post",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const existing = Object.values(sim.state.lookups).find((l) => l.clientId === x.clientId);
        const l = existing ?? { id: newLookupId(), clientId: x.clientId };
        sim.state.lookups[l.id] = l;
        sim.markDirty();
        return { status: 201, body: lookupJson(l.id, x.clientId, x.origin) };
      },
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks-lookup",
      op: "webhooks:webhooks-lookup.list",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => ({
        status: 200,
        body: {
          webhooks_lookups: Object.values(sim.state.lookups)
            .filter((l) => l.clientId === x.clientId)
            .map((l) => lookupJson(l.id, l.clientId, x.origin)),
        },
      }),
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks-lookup/:webhook_lookup_id",
      op: "webhooks:webhooks-lookup.get",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const l = sim.state.lookups[p(x, "webhook_lookup_id")];
        if (!l || l.clientId !== x.clientId)
          throw v1Error("webhooks", 404, "INVALID_RESOURCE_ID", "Resource id is invalid.", x.debugId);
        return { status: 200, body: lookupJson(l.id, l.clientId, x.origin) };
      },
    },
    {
      method: "DELETE",
      path: "/v1/notifications/webhooks-lookup/:webhook_lookup_id",
      op: "webhooks:webhooks-lookup.delete",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const l = sim.state.lookups[p(x, "webhook_lookup_id")];
        if (!l || l.clientId !== x.clientId)
          throw v1Error("webhooks", 404, "INVALID_RESOURCE_ID", "Resource id is invalid.", x.debugId);
        delete sim.state.lookups[l.id];
        sim.markDirty();
        return { status: 204 };
      },
    },
    {
      method: "POST",
      path: "/v1/notifications/verify-webhook-signature",
      op: "webhooks:verify-webhook-signature.post",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => ({
        status: 200,
        body: { verification_status: sim.webhooks.verify(x.clientId, x.raw, x.body) },
      }),
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks-events",
      op: "webhooks:webhooks-events.list",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const pageSize = Number(x.query.get("page_size") ?? "10");
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 300)
          throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
            { field: "page_size", location: "query", issue: "page_size must be between 1 and 300." },
          ]);
        const t = (name: string): number | null => {
          const v = x.query.get(name);
          if (v === null) return null;
          const ms = Date.parse(v);
          if (Number.isNaN(ms))
            throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
              { field: name, value: v, location: "query", issue: "Invalid date-time." },
            ]);
          return ms;
        };
        const start = t("start_time");
        const end = t("end_time");
        const type = x.query.get("event_type");
        const txn = x.query.get("transaction_id");
        const events = sim.state.eventOrder
          .map((id) => sim.state.events[id])
          .filter((e): e is NonNullable<typeof e> => Boolean(e))
          .filter((e) => e.clientId === x.clientId && !e.mock)
          .filter((e) => (start === null || e.createdAt >= start) && (end === null || e.createdAt <= end))
          .filter((e) => type === null || e.eventType === type)
          .filter((e) => txn === null || e.resourceIds.includes(txn))
          .sort((a, b) => b.createdAt - a.createdAt);
        const page = events.slice(0, pageSize).map((e) => JSON.parse(e.body) as JsonObject);
        return {
          status: 200,
          body: {
            events: page,
            count: page.length,
            links: [
              {
                href: `${x.origin}/v1/notifications/webhooks-events?${x.query.toString()}`,
                rel: "self",
                method: "GET",
              },
            ],
          },
        };
      },
    },
    {
      method: "GET",
      path: "/v1/notifications/webhooks-events/:event_id",
      op: "webhooks:webhooks-events.get",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const e = sim.state.events[p(x, "event_id")];
        if (!e || e.clientId !== x.clientId)
          throw v1Error("webhooks", 404, "INVALID_RESOURCE_ID", "Resource id is invalid.", x.debugId);
        return { status: 200, body: JSON.parse(e.body) as JsonObject };
      },
    },
    {
      method: "POST",
      path: "/v1/notifications/webhooks-events/:event_id/resend",
      op: "webhooks:webhooks-events.resend",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const e = sim.state.events[p(x, "event_id")];
        if (!e || e.clientId !== x.clientId)
          throw v1Error("webhooks", 404, "INVALID_RESOURCE_ID", "Resource id is invalid.", x.debugId);
        const ids = Array.isArray(x.body.webhook_ids)
          ? x.body.webhook_ids.filter((i): i is string => typeof i === "string")
          : undefined;
        const sent = sim.webhooks.resend(e, ids);
        if (sent.length === 0)
          throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
            { field: "webhook_ids", location: "body", issue: "No matching webhook to resend to." },
          ]);
        sim.markDirty();
        return { status: 202, body: JSON.parse(e.body) as JsonObject };
      },
    },
    {
      method: "POST",
      path: "/v1/notifications/simulate-event",
      op: "webhooks:simulate-event.post",
      family: "webhooks",
      auth: "bearer",
      scope: SCOPES.webhooks,
      handler: (x) => {
        const eventType = typeof x.body.event_type === "string" ? x.body.event_type : "";
        if (!isKnownEventType(eventType) || eventType === "*")
          throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
            { field: "event_type", location: "body", issue: "Unsupported event type." },
          ]);
        const byId = typeof x.body.webhook_id === "string" ? ownedWebhook(x, x.body.webhook_id) : undefined;
        const url = byId?.url ?? (typeof x.body.url === "string" ? checkUrl(x, x.body.url) : undefined);
        if (!url)
          throw v1Error("webhooks", 400, "VALIDATION_ERROR", "Invalid data provided", x.debugId, [
            { field: "url", location: "body", issue: "webhook_id or url is required." },
          ]);
        const resource: JsonObject = eventType.startsWith("INVOICING")
          ? { invoice: { id: "INV2-MOCK-MOCK-MOCK-MOCK", status: "PAID" } }
          : { payout_batch_id: "MOCKBATCH0001", transaction_status: "SUCCESS" };
        const e = sim.webhooks.simulate(
          x.clientId,
          url,
          eventType,
          resource,
          eventType.startsWith("INVOICING") ? "invoices" : "payouts",
        );
        return { status: 202, body: JSON.parse(e.body) as JsonObject };
      },
    },

    // ── Reporting ──────────────────────────────────────────────────────────────────────────────────
    {
      method: "GET",
      path: "/v1/reporting/transactions",
      op: "reporting:search.get",
      family: "reporting",
      auth: "bearer",
      scope: SCOPES.search,
      handler: (x) => reporting.search({ account: x.account, origin: x.origin, debugId: x.debugId }, x.query),
    },
    {
      method: "GET",
      path: "/v1/reporting/balances",
      op: "reporting:balances.get",
      family: "reporting",
      auth: "bearer",
      scope: SCOPES.balances,
      handler: (x) =>
        reporting.balances({ account: x.account, origin: x.origin, debugId: x.debugId }, x.query),
    },
  ];
  return routes;

  function lookupJson(id: string, clientId: string, origin: string): JsonObject {
    return {
      id,
      client_id: clientId,
      links: [{ href: `${origin}/v1/notifications/webhooks-lookup/${id}`, rel: "self", method: "GET" }],
    };
  }
}
