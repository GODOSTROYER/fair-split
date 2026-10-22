// Shared msw helpers for this package's tests (not exported; msw is a dev dependency).

import { HttpResponse, http } from "msw/http";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll } from "vitest";
import { PAYPAL_SCOPES } from "./scopes.js";

export const SANDBOX = "https://api-m.sandbox.paypal.com";
export const TEST_CLIENT_ID = "fs-test-client";
// Built at runtime so no secret-looking literal lands in the repo.
export const TEST_CLIENT_SECRET = ["fs", "test", "secret"].join("-");
export const ALL_SCOPES = [
  PAYPAL_SCOPES.invoicing,
  PAYPAL_SCOPES.payouts,
  PAYPAL_SCOPES.webhooks,
  PAYPAL_SCOPES.reportingSearch,
  "openid",
].join(" ");

export const server = setupServer();

/** Install the msw server for the calling test file, failing on any unhandled request. */
export function useMswServer() {
  beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

export interface OAuthStub {
  calls: number;
  authorizations: string[];
  bodies: string[];
}

/** POST /v1/oauth2/token returning a fresh token per call (`tok-1`, `tok-2`, …). */
export function oauthHandler(
  options: { expiresIn?: number; scope?: string; delayMs?: number; status?: number; errorBody?: object } = {},
): { handler: ReturnType<typeof http.post>; stub: OAuthStub } {
  const stub: OAuthStub = { calls: 0, authorizations: [], bodies: [] };
  const handler = http.post(`${SANDBOX}/v1/oauth2/token`, async ({ request }) => {
    stub.calls += 1;
    stub.authorizations.push(request.headers.get("authorization") ?? "");
    stub.bodies.push(await request.text());
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.status && options.status !== 200) {
      return HttpResponse.json(options.errorBody ?? { error: "invalid_client" }, {
        status: options.status,
        headers: { "paypal-debug-id": "dbg-oauth-fail" },
      });
    }
    return HttpResponse.json(
      {
        scope: options.scope ?? ALL_SCOPES,
        access_token: `tok-${stub.calls}`,
        token_type: "Bearer",
        app_id: "APP-FSTEST",
        expires_in: options.expiresIn ?? 32_400,
        nonce: "2026-10-22T00:00:00Zabc",
      },
      { headers: { "paypal-debug-id": `dbg-oauth-${stub.calls}` } },
    );
  });
  return { handler, stub };
}

export interface FakeWebhook {
  id: string;
  url: string;
  event_types: { name: string; description?: string; status?: string }[];
}

/**
 * Stateful fake of the Webhooks Management API (list, create, patch, lookups) with PayPal's
 * documented semantics: PATCH accepts only `replace` on `/url` and `/event_types`; creating a
 * duplicate URL fails with WEBHOOK_URL_ALREADY_EXISTS. `writes` logs every mutating call.
 */
export function fakeWebhooksApi(initial: FakeWebhook[] = [], lookups: string[] = []) {
  const state = {
    webhooks: initial.map((w) => ({ ...w, event_types: [...w.event_types] })),
    lookups: [...lookups],
    writes: [] as string[],
    nextId: 1,
  };
  server.use(
    http.get(`${SANDBOX}/v1/notifications/webhooks`, ({ request }) => {
      if (new URL(request.url).searchParams.get("anchor_type") !== "APPLICATION") {
        return HttpResponse.json({ name: "INVALID_REQUEST" }, { status: 400 });
      }
      return HttpResponse.json({ webhooks: state.webhooks });
    }),
    http.post(`${SANDBOX}/v1/notifications/webhooks`, async ({ request }) => {
      const body = (await request.json()) as { url: string; event_types: { name: string }[] };
      state.writes.push(`POST ${body.url}`);
      if (state.webhooks.some((w) => w.url === body.url)) {
        return HttpResponse.json(
          { name: "WEBHOOK_URL_ALREADY_EXISTS", message: "Webhook URL already exists.", debug_id: "dbg-dup" },
          { status: 400 },
        );
      }
      const hook: FakeWebhook = {
        id: `WH${String(state.nextId++).padStart(4, "0")}`,
        url: body.url,
        event_types: body.event_types.map((e) => ({ name: e.name, description: "event", status: "ENABLED" })),
      };
      state.webhooks.push(hook);
      return HttpResponse.json(
        { ...hook, links: [] },
        { status: 201, headers: { "paypal-debug-id": "dbg-create" } },
      );
    }),
    http.patch(`${SANDBOX}/v1/notifications/webhooks/:id`, async ({ request, params }) => {
      const ops = (await request.json()) as { op: string; path: string; value: unknown }[];
      state.writes.push(`PATCH ${String(params.id)} ${ops.map((o) => `${o.op}:${o.path}`).join(",")}`);
      const hook = state.webhooks.find((w) => w.id === params.id);
      if (!hook) return HttpResponse.json({ name: "INVALID_RESOURCE_ID" }, { status: 404 });
      for (const op of ops) {
        if (op.op !== "replace") return HttpResponse.json({ name: "INVALID_REQUEST" }, { status: 400 });
        if (op.path === "/url") hook.url = op.value as string;
        else if (op.path === "/event_types") hook.event_types = op.value as FakeWebhook["event_types"];
        else return HttpResponse.json({ name: "INVALID_REQUEST" }, { status: 400 });
      }
      return HttpResponse.json(hook);
    }),
    http.get(`${SANDBOX}/v1/notifications/webhooks-lookup`, () =>
      HttpResponse.json({
        webhooks_lookups: state.lookups.map((id) => ({ id, client_id: "fs-test-client", links: [] })),
      }),
    ),
    http.post(`${SANDBOX}/v1/notifications/webhooks-lookup`, () => {
      const id = `WL-${state.lookups.length + 1}`;
      state.lookups.push(id);
      state.writes.push("POST lookup");
      return HttpResponse.json({ id, client_id: "fs-test-client", links: [] }, { status: 201 });
    }),
  );
  return state;
}

/** A manually advanced clock. */
export function manualClock(start = Date.parse("2026-10-29T09:00:00Z")) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    set(ms: number) {
      t = ms;
    },
  };
}

/** A sleep that records requested delays and returns immediately. */
export function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}
