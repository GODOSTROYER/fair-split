// msw for PayPal in tests (zero live API calls): a server that answers PayPal's sandbox hosts from handlers
// and fails the test on any unhandled request. Use it with `createTestApp({ env: { PP_MODE: "sandbox", … } })`
// or with the simulator stub left in place (simulator mode never reaches the network).
import { type HttpHandler, HttpResponse, http } from "msw";
import { type SetupServer, setupServer } from "msw/node";

export const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";

/** OAuth2 client-credentials token with the scopes Fair Split asserts at boot. */
export function paypalTokenHandler(scopes: readonly string[] = DEFAULT_SCOPES): HttpHandler {
  return http.post(`${PAYPAL_SANDBOX}/v1/oauth2/token`, () =>
    HttpResponse.json({
      scope: scopes.join(" "),
      access_token: "A21AA-test-token-REDACTED",
      token_type: "Bearer",
      app_id: "APP-TEST",
      expires_in: 32400,
      nonce: "test-nonce",
    }),
  );
}

export const DEFAULT_SCOPES = [
  "https://uri.paypal.com/services/invoicing",
  "https://uri.paypal.com/services/payments/payouts",
  "https://uri.paypal.com/services/applications/webhooks",
  "https://uri.paypal.com/services/reporting/search/read",
] as const;

/** PayPal's error shape (name, message, debug_id, details, links). */
export function paypalError(
  status: number,
  name: string,
  message = name,
  debugId = "f0e1d2c3b4a59",
): Response {
  return HttpResponse.json(
    { name, message, debug_id: debugId, details: [], links: [] },
    { status, headers: { "paypal-debug-id": debugId } },
  );
}

export interface PayPalMock {
  readonly server: SetupServer;
  /** Start intercepting; any request no handler answers fails the test. */
  start(): void;
  stop(): void;
  use(...handlers: HttpHandler[]): void;
  reset(): void;
}

export function createPayPalMock(handlers: HttpHandler[] = []): PayPalMock {
  const server = setupServer(paypalTokenHandler(), ...handlers);
  return {
    server,
    start: () => server.listen({ onUnhandledFrame: "error" }),
    stop: () => server.close(),
    use: (...h) => server.use(...h),
    reset: () => server.resetHandlers(),
  };
}
