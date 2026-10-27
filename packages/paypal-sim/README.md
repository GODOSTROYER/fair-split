# @fairsplit/paypal-sim — simulated PayPal sandbox

> **This is a simulator. It is not PayPal.** It imitates the subset of PayPal's REST API that Fair Split uses so
> the whole product runs end to end without PayPal credentials (ADR-0002: the developer cannot open the US
> PayPal accounts the sandbox plan assumed). It moves no money, never contacts PayPal and uses no PayPal accounts.
> Product copy calls it **"Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)"**
> (`SIMULATED_RAIL_LABEL`).

**How its output is marked.** IDs, JSON shapes and links deliberately follow PayPal's documented formats, so
PayPal's own SDK and toolkit code runs unmodified; the markers are therefore added _inside_ those formats:
- every response and every webhook delivery carries the header `x-fairsplit-simulated: true`;
- every `debug_id` has the simulator's own shape (`sim-` + 12 hex characters; PayPal's are 13 hex characters);
- every resource ID it mints starts with `SIM` inside PayPal's format: invoices `INV2-SIMx-…`, payout batches
  and items `SIM…` (13), transactions and webhooks `SIM…` (17), events `WH-SIM…-…`, rules `CR-SIM…`, recorded
  payments `EXTR-SIM…` (`isSimulatedId()`). A real PayPal ID can start with `SIM` by chance (about 1 in 46,656),
  so this is a label, not proof;
- the certificate that signs webhooks is issued by a CA named "Fair Split PayPal Simulator Test CA (NOT PayPal)",
  served from the host app, never from a PayPal host.

Headers and `debug_id`s are lost once a body is parsed into a database, so **provenance comes from the rail, not
from responses**: `setupPayPalRail()` returns `provenance: "simulated_rail"` in simulator mode (`"live"` on the real
sandbox), and paypal-core stamps that value on every PayPal-derived row (invariant I8). HATEOAS links follow the
host the caller used: through the in-process interceptor that is `https://api-m.sandbox.paypal.com`, so a stored
link alone does not prove anything either — show it only with the label.

The real sandbox stays one environment variable away: `PP_MODE=sandbox` turns the simulator off and the same
`@paypal/agent-toolkit` 1.11.0 and `@paypal/paypal-server-sdk` 2.5.0 code talks to `api-m.sandbox.paypal.com`.

## What it covers

| Area              | Endpoints (same paths, methods, headers and JSON shapes as PayPal)                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth 2.0         | `POST /v1/oauth2/token` (client credentials, Basic auth; per-client tokens with scopes, `expires_in` 32400; bad credentials → 401 `invalid_client`)                                                                                                                                                                                                           |
| Invoicing v2      | create (draft; minimal `self` link, or the invoice with `Prefer: return=representation`), get, list, `search-invoices`, full update, delete (draft/scheduled), send (`send_to_recipient:false` → UNPAID, a future `invoice_date` → 202 SCHEDULED), remind, cancel, record payment (→ MARKED_AS_PAID), delete external payment, `generate-next-invoice-number` |
| Conditional rules | `POST/GET /v2/invoicing/invoices/{id}/conditional-rules`, `GET/PUT/DELETE …/conditional-rules/{rule_id}`; AUTO_CANCEL with `SPECIFIC_DATE` cancels an unpaid invoice (status AUTO_CANCELLED) after that merchant-time date                                                                                                                                    |
| Pay page          | `recipient_view_url` → `GET /sim/invoice/{id}/pay` (a plain, clearly labelled page, no credentials asked); `POST` pays it → PAID, a PayPal-type payment, balance credited less PayPal's published fee                                                                                                                                                         |
| Payouts v1        | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` (paging, `fields=batch_header`), `GET /v1/payments/payouts-item/{id}`, `POST /v1/payments/payouts-item/{id}/cancel` (UNCLAIMED → RETURNED only)                                                                                                                                                  |
| Reporting         | `GET /v1/reporting/transactions` (Transaction Search over simulator activity), `GET /v1/reporting/balances`                                                                                                                                                                                                                                                   |
| Webhooks v1       | webhooks create/list/get/patch/delete, `…/{id}/event-types`, `webhooks-event-types`, `webhooks-lookup` CRUD, `verify-webhook-signature`, `webhooks-events` list (with `start_time`, `end_time`, `event_type`, `transaction_id`), get, `…/resend`, `simulate-event`                                                                                            |
| Simulator-only    | public: `GET /sim/health`, `GET /sim/certs/{id}.pem`, `GET /sim/invoice/{id}`, `GET/POST /sim/invoice/{id}/pay`; admin (fail-closed, below): `GET /sim/admin/state`, `…/accounts`, `…/deliveries`, `POST /sim/admin/reset`, `…/snapshot`, `…/delivery`, `…/clock`, `…/deny-next-batch`                                                                        |

### Behaviour worth knowing

- **Payout lifecycle.** A batch is accepted as `PENDING` (funds plus fees held: available ↓, withheld ↑), turns
  `PROCESSING` after `timing.batchProcessingS`, processes items one by one every `timing.itemS`, then becomes
  `SUCCESS`. A receiver with a simulator account gets `SUCCESS`; any other address becomes `UNCLAIMED` with
  `errors.name = RECEIVER_UNREGISTERED` (Rhea, M-031, has no account on purpose). Paying yourself fails with
  `SELF_PAY_NOT_ALLOWED`. Cancelling an UNCLAIMED item returns amount and fee and emits
  `PAYMENT.PAYOUTS-ITEM.CANCELED`; after 30 days (simulator clock) an UNCLAIMED item returns by itself with
  `PAYMENT.PAYOUTS-ITEM.RETURNED`. `POST /sim/admin/deny-next-batch` makes the next batch `DENIED`.
- **Synchronous rejections.** A duplicate `sender_batch_id` within 30 days → `400 USER_BUSINESS_ERROR` whose
  `details[0].link[0].href` is the original batch (adopt by GET). `recipient_type` `PHONE` (or Venmo) →
  `400 VALIDATION_ERROR`, as the sandbox does not support it. Not enough balance → `422 INSUFFICIENT_FUNDS`.
- **Test values.** PayPal's "Test and go live" values in `items[0].note` reject the whole POST before anything is
  held: ERRPYO001/002/003/005/006/010/011/012/014/035–040, plus ERRPYO013 in `items[0].sender_batch_id`; the cancel
  values `ERRPOI001`, `ERRPYO004/007/008/009` work as path parameters. `POSPYO001` is an ordinary 201. The bodies
  follow PayPal's one published sample (ERRPYO002: exactly `name`, `message` "Authorization error occurred",
  `debug_id` and the relative `information_link` `/api/payments.payouts-batch/v1/errors`). **PayPal publishes no
  HTTP status for any test value: every status (403 for ERRPYO002, 422 for ERRPYO005, …) is the simulator's
  reading.**
- **Fees and balance.** `payout_item_fee` is the published US rate the register uses, US$0.25 per item
  (`SIM_PAYOUT_FEE_CENTS`). An invoice paid on the pay page credits the amount less PayPal's published US rate for
  invoices paid with PayPal, 3.49% + US$0.49, rounded half up (US$151.73 on US$4,333.50; `SIM_INVOICE_FEE_BPS`,
  `SIM_INVOICE_FEE_CENTS`, `0` and `0` turn it off); Transaction Search shows it as the `T0000` row's `fee_amount`.
  Balances are kept in integer cents in a ledger; payouts debit the co-op and returns credit it back. A recorded
  payment (MARKED_AS_PAID) moves no money inside PayPal, so it carries no fee and creates no transaction — exactly
  what the reconciliation spec expects. Seeded balances: co-op and Lantern Bay US$100,000.00 each.
- **Transaction Search.** Payout items appear as `T0001` (status `S`, or `P` while unclaimed, `V` once returned),
  returns as `T1115`, pay-page invoice payments as `T0000` with `invoice_id` = invoice number. `custom_field`
  carries the `sender_item_id`. `SIM_REPORTING_LAG_S` imitates PayPal's reporting lag (default 0).
- **Idempotency.** PayPal's reference says not every API supports `PayPal-Request-Id`; of the vendored specs only
  Payouts' `POST /v1/payments/payouts` declares it ("The server stores keys for 30 days"). So by default the
  simulator honours it there only: the same id with the same body within 30 days replays the stored response
  (`paypal-idempotent-replay: true`), and concurrent duplicates are serialised. On every other POST the header is
  ignored — a retried invoice create meets `DUPLICATE_INVOICE_NUMBER`, a retried AUTO_CANCEL rule meets
  `CONDITIONAL_RULE_ALREADY_EXISTS` — so the app's own de-duplication (search by `invoice_number`, list the rules)
  is what gets exercised. `SIM_IDEMPOTENCY=all-posts` restores replay on every bearer POST. A reused id with a
  _different_ body is processed normally; that is what a third party reported for the real sandbox
  (paypal/agent-toolkit PR #107, by rushabhT3, for a different request body), not something Fair Split has verified.
- **Throttle and latency.** 50 requests a minute per client address, like the sandbox's per-IP block, then `429
  RATE_LIMIT_REACHED` for 5 minutes (`SIM_RATE_LIMIT_PER_MIN`, `SIM_RATE_LIMIT_BLOCK_S`; 0 disables). The address is
  the socket's; in-process calls (the interceptor) share one address, as all of a server's calls share one IP, so
  both REST apps on one server share one budget. `X-Forwarded-For` is ignored unless `SIM_TRUST_PROXY=1` (exactly
  one trusted proxy; then its right-most entry counts). The counter table is capped (10,000 addresses).
  `SIM_LATENCY_MS` adds a fixed or ranged delay to every API response.

## Webhooks, signed like PayPal

For every state change the simulator emits PayPal's event types (`INVOICING.INVOICE.CREATED/UPDATED/SCHEDULED/
PAID/CANCELLED`, `PAYMENT.PAYOUTSBATCH.PROCESSING/SUCCESS/DENIED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/UNCLAIMED/
FAILED/CANCELED/RETURNED`) in PayPal's envelope (`id` `WH-SIM…`, `event_version` `1.0`, `create_time`,
`resource_type`, `resource_version`, `event_type`, `summary`, `resource`, `links` self/resend, the links on
`apiBaseUrl`) and POSTs it to every subscribed webhook of the REST app that owns the resource, with PayPal's
headers: `paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`, `paypal-cert-url`,
`paypal-auth-algo: SHA256withRSA`, `paypal-auth-version`, `correlation-id`.
- **Signature.** RSA-SHA256 over `transmissionId|transmissionTime|webhookId|crc32(rawBody)` (CRC32 of the exact
  bytes, in decimal) — PayPal's documented self-verification algorithm. The key is a leaf certificate issued by a
  simulator CA, both generated with `node:crypto` at first start and stored in `packages/paypal-sim/.data/certs`
  (git-ignored). `paypal-cert-url` is `{publicBaseUrl}{basePath}/sim/certs/SIMCERT-xxxxxxxx-xxxxxxxx-xxxxxxxx.pem`
  and serves the chain (leaf, then CA). It never points at a PayPal host, so a verifier must allow-list it **only**
  in simulator mode (`rail.certUrlPattern`).
- **Postback.** `verify-webhook-signature` answers `SUCCESS` only when the posted values verify with the
  simulator's certificate over the CRC32 of the `webhook_event` bytes exactly as posted, the cert URL is the
  simulator's, the webhook belongs to the calling app and the event is one the simulator delivered; otherwise
  `FAILURE`. Mock events from `simulate-event` are signed with the literal `WEBHOOK_ID` and always `FAILURE`, as
  PayPal documents for its own mock events.
- **Where it delivers (SSRF guard).** PayPal accepts any public https listener; the simulator is stricter on
  purpose, because its client credentials are public. It delivers only to the origin of `publicBaseUrl` (the host
  app, whose `/webhooks/paypal` receives them) and any origins in `SIM_WEBHOOK_ORIGINS`; webhook create/patch and
  `simulate-event` refuse every other URL with the sandbox's own refusal (`400 VALIDATION_ERROR`, `details[0]`
  `{field: "url", issue: "Not a valid webhook URL"}`, plus a `description` saying why). Like PayPal it refuses plain
  `http` except for loopback hosts; URLs with credentials are refused. Each attempt re-checks the target, redirects
  are never followed (a 3xx is a failed attempt) and answers are never read. `SIM_ALLOW_LOOPBACK_WEBHOOKS=1` (local
  development only; refused unless `publicBaseUrl` is loopback) also allows loopback hosts on any port.
- **Delivery.** Non-2xx answers are retried as PayPal documents — "up to 25 times over the course of 3 days": 25
  waits from 5 s growing to about 8 h that add up to exactly 259,200 s (`RETRY_BACKOFF_S`), so 26 attempts in all,
  scaled by `SIM_SPEED`. `POST …/webhooks-events/{id}/resend` sends the same event bytes under a new transmission
  id. Toggles for tests and the "repeats change nothing" beat: duplicate delivery (every event twice, distinct
  transmissions) and out-of-order delivery (events of a burst released newest first), via options,
  `SIM_DUPLICATE_DELIVERY` / `SIM_OUT_OF_ORDER`, or `POST /sim/admin/delivery {"duplicate":true}`.

## How it is validated

- **PayPal's own specs.** `spec/` vendors, unmodified and checksum-pinned, PayPal's Apache-2.0 OpenAPI files for
  Invoicing v2 (2.6), Payouts v1 (1.9), Webhooks v1 (1.11) and Transaction Search (1.9) from
  github.com/paypal/paypal-rest-api-specifications (see `spec/README.md`). Two operations missing from that
  repository — conditional rules and the OAuth token — are validated against small **hand-written supplements**
  (`spec/supplements/`), labelled as such, not against PayPal files.
- **Every request body** is validated (ajv 8 + ajv-formats, draft-07 conversion of the OpenAPI 3.0 schemas;
  `readOnly` fields are not required in requests). A violation gets PayPal's documented `400 INVALID_REQUEST`
  with `details[]` (`field` as a JSON pointer, `location`, `issue` such as `MISSING_REQUIRED_PARAMETER`,
  `INVALID_STRING_MAX_LENGTH`, `INVALID_PARAMETER_VALUE`, `INVALID_PARAMETER_SYNTAX`, `INVALID_ARRAY_MAX_ITEMS`;
  unparsable JSON → `MALFORMED_REQUEST_JSON`).
- **Every response body and webhook event** the simulator produces is validated against the same specs — an
  event's envelope against Webhooks' `event`, and its free-form `resource` against its own API schema (Invoicing's
  `invoice`, Payouts' `payout_batch` or `payout_item`). In strict mode (default) a violation becomes a 500 with
  `x-fairsplit-sim-contract: violated`, and every test asserts that `simulator.violations` stays empty.
- **No invented fields.** PayPal's schemas almost never say `additionalProperties: false`, so a schema validator
  accepts made-up properties. `SIM_STRICT_PROPERTIES` (on in the whole test suite) also records, as violations,
  response and event properties the specs never declare. Two exceptions carry published evidence: `encType` on
  Payouts links (PayPal's Payouts samples) and `link` in a duplicate `sender_batch_id` error's `details[]` (the
  spec's own description of that error). The check is why the batch header echo no longer carries the request's
  `note`: PayPal's response-side `sender_batch_header` has no such field.
- **Published samples.** `test/golden.test.ts` pins shapes to what PayPal publishes — the ERRPYO002 sample body,
  the sandbox's "Not a valid webhook URL" refusal, the webhook envelope, PayPal's own request examples from the
  specs (its verify example fails only on its placeholder `cert_url`), and the three-day retry schedule.
- **Tests (Vitest):** the full money loop (token → create → send → AUTO_CANCEL rule → record payment →
  signed `INVOICING.INVOICE.PAID` → payout batch → PROCESSING → SUCCESS, Rhea UNCLAIMED → cancel → RETURNED,
  balance in cents, Transaction Search), a contract tour that calls every implemented operation, valid and invalid
  payloads per endpoint, duplicate-batch adoption, `PayPal-Request-Id` replay and serialisation where declared,
  ERRPYO002/005, signatures verified with `node:crypto` against the served certificate, postback SUCCESS/FAILURE,
  retries, duplicate and out-of-order delivery, resend, the 429 block and its lock-out and spoofing cases, the
  webhook target policy and the admin gate (`test/security.test.ts`), `setupPayPalRail()` mounted in a real host
  app with a webhook verified end to end (`test/rail.test.ts`), persistence and reset, the X.509 writer, and
  **`@paypal/agent-toolkit` 1.11.0** (`create_invoice`, `get_invoice`, `send_invoice`,
  `create_conditional_rules_for_invoice`, `record_payment_for_invoice`, `search_invoicing`, its own token fetch)
  plus **`@paypal/paypal-server-sdk` 2.5.0** `TransactionSearchController` running unmodified through the
  interceptor. Both PayPal packages are test-only dependencies. No test contacts a PayPal host.

## Running it

**Standalone server** (Hono on `@hono/node-server`):

```sh
corepack pnpm --filter @fairsplit/paypal-sim start      # http://127.0.0.1:4010
corepack pnpm exec tsx tools/paypal-sim.ts --port 4010 --speed 1 [--public-url https://…] [--fresh] \
  [--webhook-origin http://localhost:8787] [--allow-loopback-webhooks]
```

Point a client at `http://127.0.0.1:4010` instead of `https://api-m.sandbox.paypal.com`; HATEOAS links follow the
host you called (and honour `X-Forwarded-Proto/Host`, e.g. behind a tunnel). Webhooks go only to the server's own
origin unless you add your receiver's origin (`--webhook-origin`, `SIM_WEBHOOK_ORIGINS`). State is snapshotted to
`packages/paypal-sim/.data/state.json`; `POST /sim/admin/reset` restores the seeded world. The standalone server
serves everything, admin included: keep it on loopback, or set `SIM_ADMIN_TOKEN` before exposing it.

**In process** (no port for API calls):

```ts
import { createSimulator, installSandboxInterceptor, createSandboxDispatcher } from "@fairsplit/paypal-sim";

const sim = await createSimulator({ speed: 0 }); // sim.fetch(request) is a fetch-compatible handler
const interceptor = await installSandboxInterceptor(sim); // routes api-m.sandbox / api.sandbox.paypal.com here
// … or, for one call only: fetch(url, { dispatcher: createSandboxDispatcher(sim) })
await interceptor.uninstall();
```

`installSandboxInterceptor` wraps the global undici dispatcher (global `fetch`) and `node:http`/`node:https`
`request`/`get` (axios, which both PayPal packages use) **for the two sandbox hosts only**; live PayPal hosts and
every other host pass through untouched (tested). It answers with the REST routes only (`sim.apiFetch`).
`sim.idle()` waits for queued processing and deliveries; `sim.reset()`, `sim.snapshot()`, `sim.restore()` and
`sim.close()` do what they say.

**Three handlers, one simulator.** `sim.fetch` serves everything (the standalone server). `sim.apiFetch` serves
PayPal's REST routes (the interceptor). `sim.publicFetch` serves only the public pages — certificate chain, invoice
and pay pages, health — and is **the only one a host app may mount publicly**.

| Variable                                           | Default                    | Meaning                                                                       |
| -------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------- |
| `PP_MODE`                                          | `simulator`                | `simulator` or `sandbox` (read by `setupPayPalRail`)                          |
| `SIM_PORT`, `SIM_HOST`                             | `4010`, `127.0.0.1`        | Standalone server address                                                     |
| `SIM_PUBLIC_URL`                                   | the bound address          | Base URL of what serves `/sim/*` (pay page, certs), **without** the base path |
| `SIM_BASE_PATH`                                    | none                       | Prefix the host app mounts the simulator under, e.g. `/paypal-sim`            |
| `SIM_API_BASE_URL`                                 | `{public URL}{base path}`  | Base for links inside webhook events (`setupPayPalRail`: PayPal's sandbox)    |
| `SIM_SPEED`                                        | `1`                        | Processing delays × speed; `0` runs everything on the next tick               |
| `SIM_DATA_DIR`, `SIM_PERSIST`                      | `.data`, on (server)       | Keys and snapshot location; snapshot on/off                                   |
| `SIM_RATE_LIMIT_PER_MIN`, `SIM_RATE_LIMIT_BLOCK_S` | `50`, `300`                | Throttle per client address; `0` disables                                     |
| `SIM_TRUST_PROXY`                                  | off                        | Key the throttle on the right-most `X-Forwarded-For` entry (one proxy)        |
| `SIM_LATENCY_MS`                                   | `0`                        | `120` or a range `80-250`                                                     |
| `SIM_STRICT`                                       | on                         | Spec violations become 500s                                                   |
| `SIM_STRICT_PROPERTIES`                            | off (on in tests)          | Also record properties the specs never declare as violations                  |
| `SIM_IDEMPOTENCY`                                  | `declared`                 | `declared` (Payouts POST only) or `all-posts`                                 |
| `SIM_DUPLICATE_DELIVERY`, `SIM_OUT_OF_ORDER`       | off                        | Delivery toggles                                                              |
| `SIM_WEBHOOK_ORIGINS`                              | none                       | Extra origins webhooks may go to (comma-separated); own origin always allowed |
| `SIM_ALLOW_LOOPBACK_WEBHOOKS`                      | off                        | Dev only: loopback receivers on any port (needs a loopback public URL)        |
| `SIM_PAYOUT_FEE_CENTS`, `SIM_REPORTING_LAG_S`      | `25`, `0`                  | Fee per payout item; Transaction Search lag                                   |
| `SIM_INVOICE_FEE_BPS`, `SIM_INVOICE_FEE_CENTS`     | `349`, `49`                | Pay-page receiving fee (PayPal's published US rate); `0`, `0` turns it off    |
| `SIM_ACCOUNTS_FILE`, `SIM_ADMIN_TOKEN`             | `data/accounts.json`, none | Seed registry; admin token (below)                                            |

**Admin API (fail-closed).** With `SIM_ADMIN_TOKEN` set, `/sim/admin/*` needs the header `x-sim-admin-token`,
compared in constant time. Without it, admin is refused outright (403) unless `publicBaseUrl` is a loopback URL,
and then answers only callers whose socket is loopback, whose `Host` is a loopback name (a DNS-rebinding guard)
and whose `Origin`, if a browser sent one, is loopback too (a CSRF guard). `publicFetch` never serves admin.

## Accounts (all fictional, simulator-only)

`data/accounts.json` seeds one US business account for the co-op (`bulawanon.coop@example.org`, invoicer and payout
sender), Lantern Bay's payer account (`lantern.bay.payables@example.org`) and seven member receivers on the reserved
`example.org` domain: M-014 `consolacion.bacus@`, M-007 `dionisio.lapinig@`, M-060 `arnel.sumampao@`, M-018
`teodoro.pacana@`, M-039 `jonathan.ripalda@`, M-022 `pedro.ompad@`, M-002 `florencia.ybanez@`. **Rhea Jumawan
(M-031, `rhea.jumawan@example.org`) deliberately has no account**, so her item is UNCLAIMED. Two REST apps sit on
the co-op account, `fs-dev` (`SIM-fs-dev-client`) and `fs-judge` (`SIM-fs-judge-client`); their client secrets are
in the same file. They are public simulator values that only this simulator accepts — they are not PayPal
credentials and must never be used as such. Because they are public, the REST API is never exposed publicly (in
process only), webhook targets are allow-listed and admin fails closed.

## Wiring it into paypal-core and apps/api (the integration hook)

`paypal-core` is owned by WS-PPCORE and `apps/api` by WS-API; neither is edited here. Select the rail with one call
at boot. `publicBaseUrl` is the host app's own public base URL — **without** the prefix, which `basePath` adds once:

```ts
import { setupPayPalRail } from "@fairsplit/paypal-sim";
export const rail = await setupPayPalRail(process.env, {
  publicBaseUrl: env.PUBLIC_BASE_URL, // e.g. https://fs-api.onrender.com — NOT …/paypal-sim
  basePath: "/paypal-sim",
});
const certAllow = rail.certUrlPattern ?? SANDBOX_CERT_PATTERN; // verifyPayPal's paypal-cert-url allow-list
const provenance = rail.provenance; // "simulated_rail" | "live": stamp it on every PayPal-derived row (I8)

// apps/api (Hono): mount the public pages only — never rail.simulator.fetch
if (rail.publicFetch) app.all("/paypal-sim/*", (c) => rail.publicFetch!(c.req.raw));
```

- The certificate is then at `{PUBLIC_BASE_URL}/paypal-sim/sim/certs/SIMCERT-….pem` and invoices' `recipient_view_url`
  at `{PUBLIC_BASE_URL}/paypal-sim/sim/invoice/{id}/pay`, both served by that mount (tested end to end in
  `test/rail.test.ts`). A `publicBaseUrl` that already ends in the base path is refused at boot.
- `PP_MODE=simulator` (default until credentials exist): `setupPayPalRail` creates the simulator and installs the
  interceptor, so `PayPalHttp` (fetch), `tk()` (Agent Toolkit, axios) and the server SDK keep their hard-coded
  `https://api-m.sandbox.paypal.com` and reach the simulator in process. Event links use
  `https://api.sandbox.paypal.com`, as PayPal's do, and the interceptor answers them. `rail.certUrlPattern` is the
  only cert URL shape `verifyPayPal` should accept in this mode; paypal-core's structural check (https, a PayPal
  host, `/v1/notifications/certs/CERT-…`) must take this simulator-mode branch, since the simulator's certificate is
  never on a PayPal host.
- Webhooks: register `{PUBLIC_BASE_URL}/webhooks/paypal` (`tools/setup-webhooks.ts` against the simulator). That
  origin is allowed by default; no other is.
- `PP_MODE=sandbox`: `setupPayPalRail` returns `{ mode: "sandbox", provenance: "live", simulator: null,
  publicFetch: null, certUrlPattern: null }` and changes nothing; the existing `PP_ENV=sandbox` boot guard and
  PayPal cert pattern apply.
- A `PP_CLIENT_ID` from the other mode fails at boot: a `SIM-…` id in sandbox mode, or a client id the simulator
  does not know in simulator mode (instead of every call failing later with 401 `invalid_client`).
- If the dependency rule should keep `paypal-core` free of `paypal-sim`, make the same call from `apps/api` before
  `paypal-core` is first used.
- If `PayPalHttp` passes its own undici `dispatcher` to `fetch` (for timeouts or keep-alive), that bypasses the
  global hook; wrap it instead: `createSandboxDispatcher(rail.simulator, { fallback: agent })`.
- In simulator mode set `PP_CLIENT_ID=SIM-fs-dev-client`, `PP_CLIENT_SECRET` from `data/accounts.json`,
  `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS` and `PP_UNCLAIMED_RECEIVER` from the table above, and
  `PP_WEBHOOK_ID` from `tools/setup-webhooks.ts` run against the simulator.

## Switching to the real sandbox

Create sandbox credentials on developer.paypal.com (sandbox test accounts are fictitious accounts created from the
dashboard), then set `PP_MODE=sandbox` and the real `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID` and account
emails. No code changes: the interceptor is not installed, requests go to `api-m.sandbox.paypal.com`, and webhook
verification falls back to PayPal's certificate pattern. `rail.provenance` becomes `live`; labels change from
"simulated rail" to sandbox. The real sandbox needs an https webhook URL, which the simulator already insists on
outside loopback.

## Known gaps versus real PayPal

- Only the endpoints above. No Orders, Payments, Subscriptions, templates, refunds, QR codes, recurring invoices,
  reminder settings, the GET-path test values (POSPYO002, POSPOI001/002, ERRPYO015–034/041–061, ERRPYOB…) or
  POSPYO003: PayPal lists only their names, with no payload, so any canned body would be invented. Unknown paths
  return a 404 that says the simulator does not implement them.
- Shapes not in PayPal's published specs are best readings, documented in code: the `DUPLICATE_INVOICE_NUMBER`
  422 (S3.6.3 already says never to parse it), the HTTP status of every test value, the PHONE rejection body,
  webhook-management errors, conditional-rule business errors, and several issue codes for business-rule 422s.
  Invoice status after a send with `send_to_recipient:false` is UNPAID (PayPal's quickstart); the live sandbox may
  show SENT or SHARED.
- Only these payout outcomes occur: SUCCESS, UNCLAIMED, FAILED (self-pay), RETURNED, and a DENIED batch on request;
  ONHOLD, BLOCKED, REFUNDED and REVERSED never happen. Batch/item timing is illustrative, not PayPal's.
- No emails are sent, there is no hosted PayPal checkout, and the reporting lag defaults to zero. Transaction event
  codes are limited to T0000, T0001 and T1115.
- Webhooks go only to allow-listed origins (PayPal: any public https listener), and only the event types above can
  be subscribed. The simulator is single-process (in-memory state with an optional JSON snapshot) — not safe to
  run as several instances behind a load balancer.
- The spec is followed even where it is stricter than PayPal probably is: `simulate-event` rejects hyphenated
  event types (its `event_type` pattern), and empty Transaction Search results omit `transaction_details`
  (`minItems: 1`).
- Time-based transitions (AUTO_CANCEL, scheduled sends, 30-day returns) run on the simulator clock, lazily on reads
  and every 30 s.
- ADR-0002's wording predates these notes: its "every request and response is validated against PayPal's published
  OpenAPI specifications" holds for the four vendored specs only (conditional rules and OAuth use the supplements),
  and its 50 requests/min/IP throttle is now implemented per client address.
