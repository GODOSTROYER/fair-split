// msw 3 set-up helpers. Tests run with no network: an unhandled request is an error, so a missing
// mock fails loudly instead of reaching the PayPal sandbox (50 requests/min/IP) or Claude.
import { type AnyHandler, HttpResponse, http } from "msw";
import { type SetupServer, setupServer } from "msw/node";
import type { RecordedFixture } from "./fixtures.js";

export const PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
export const ANTHROPIC_BASE = "https://api.anthropic.com";

/** Lifecycle hooks from the test runner (vitest's `beforeAll`, `afterEach`, `afterAll`). */
export interface TestHooks {
  beforeAll: (fn: () => void) => void;
  afterEach: (fn: () => void) => void;
  afterAll: (fn: () => void) => void;
}

/** A node msw server with the given handlers. Call `listen` yourself, or use `installMockServer`. */
export function createMockServer(...handlers: AnyHandler[]): SetupServer {
  return setupServer(...handlers);
}

/**
 * Starts `server` before the suite, resets runtime handlers after each test and closes it after the
 * suite. Unhandled requests are errors.
 */
export function installMockServer(server: SetupServer, hooks: TestHooks): SetupServer {
  hooks.beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
  hooks.afterEach(() => server.resetHandlers());
  hooks.afterAll(() => server.close());
  return server;
}

const METHODS = {
  GET: http.get,
  POST: http.post,
  PUT: http.put,
  PATCH: http.patch,
  DELETE: http.delete,
  HEAD: http.head,
  OPTIONS: http.options,
} as const;

/** Replays a recorded fixture: same method and URL (query ignored), same status, headers and body. */
export function fixtureHandler(fixture: RecordedFixture, options: { once?: boolean } = {}): AnyHandler {
  const method = fixture.request.method.toUpperCase();
  if (!(method in METHODS)) {
    throw new Error(`Unsupported method in fixture ${fixture.name}: ${fixture.request.method}`);
  }
  const make = METHODS[method as keyof typeof METHODS];
  const url = fixture.request.url.split("?")[0] ?? fixture.request.url;
  const { status, headers = {}, body } = fixture.response;
  return make(
    url,
    () =>
      body === undefined || body === null
        ? new HttpResponse(null, { status, headers })
        : HttpResponse.json(body as never, { status, headers }),
    { once: options.once ?? false },
  );
}

/** A PayPal OAuth token endpoint mock. The token is the literal REDACTED, never a real value. */
export function paypalTokenHandler(options: { expiresIn?: number; scope?: string } = {}): AnyHandler {
  return http.post(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, () =>
    HttpResponse.json({
      scope:
        options.scope ??
        "https://uri.paypal.com/services/invoicing https://uri.paypal.com/services/payments/payouts",
      access_token: "REDACTED",
      token_type: "Bearer",
      app_id: "APP-REDACTED",
      expires_in: options.expiresIn ?? 32400,
      nonce: "REDACTED",
    }),
  );
}
