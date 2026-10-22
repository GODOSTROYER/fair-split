# @fairsplit/paypal-sim — simulated PayPal sandbox

> **This is a simulator. It is not PayPal.** It imitates the subset of PayPal's REST API that Fair Split uses so
> the whole product runs end to end without PayPal credentials (ADR-0002: the developer cannot open the US
> PayPal accounts the sandbox plan assumed). It moves no money, never contacts PayPal and uses no PayPal accounts.
> Every response and every webhook delivery carries `x-fairsplit-simulated: true`, and every `debug_id` has the
> simulator's own shape (`sim-` + 12 hex characters; PayPal's are 13 hex characters), so nothing it produces can
> be mistaken for real PayPal output. Product copy calls it **"Simulated PayPal sandbox (contract-tested against
> PayPal's OpenAPI specs)"** and every value from it carries provenance `simulated_rail` (invariant I8).

The real sandbox stays one environment variable away: `PP_MODE=sandbox` turns the simulator off and the same
`@paypal/agent-toolkit` 1.11.0 and `@paypal/paypal-server-sdk` 2.5.0 code talks to `api-m.sandbox.paypal.com`.

## What it covers

| Area              | Endpoints (same paths, methods, headers and JSON shapes as PayPal)                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth 2.0         | `POST /v1/oauth2/token` (client credentials, Basic auth; per-client tokens with scopes, `expires_in` 32400; bad credentials → 401 `invalid_client`)                                                                                                                                                                                                           |
| Invoicing v2      | create (draft; minimal `self` link, or the invoice with `Prefer: return=representation`), get, list, `search-invoices`, full update, delete (draft/scheduled), send (`send_to_recipient:false` → UNPAID, a future `invoice_date` → 202 SCHEDULED), remind, cancel, record payment (→ MARKED_AS_PAID), delete external payment, `generate-next-invoice-number` |
| Conditional rules | `POST/GET /v2/invoicing/invoices/{id}/conditional-rules`, `GET/PUT/DELETE …/conditional-rules/{rule_id}`; AUTO_CANCEL with `SPECIFIC_DATE` cancels an unpaid invoice (status AUTO_CANCELLED) after that merchant-time date                                                                                                                                    |
| Pay page          | `recipient_view_url` → `GET /sim/invoice/{id}/pay` (a plain, clearly labelled page, no credentials asked); `POST` pays it → PAID, a PayPal-type payment, balance credited                                                                                                                                                                                     |
| Payouts v1        | `POST /v1/payments/payouts`, `GET /v1/payments/payouts/{id}` (paging, `fields=batch_header`), `GET /v1/payments/payouts-item/{id}`, `POST /v1/payments/payouts-item/{id}/cancel` (UNCLAIMED → RETURNED only)                                                                                                                                                  |
| Reporting         | `GET /v1/reporting/transactions` (Transaction Search over simulator activity), `GET /v1/reporting/balances`                                                                                                                                                                                                                                                   |
| Webhooks v1       | webhooks create/list/get/patch/delete, `…/{id}/event-types`, `webhooks-event-types`, `webhooks-lookup` CRUD, `verify-webhook-signature`, `webhooks-events` list (with `start_time`, `end_time`, `event_type`, `transaction_id`), get, `…/resend`, `simulate-event`                                                                                            |
| Simulator-only    | `GET /sim/health`, `GET /sim/certs/{id}.pem`, `GET /sim/invoice/{id}`, admin: `GET /sim/admin/state`, `…/accounts`, `…/deliveries`, `POST /sim/admin/reset`, `…/snapshot`, `…/delivery`, `…/clock`, `…/deny-next-batch`                                                                                                                                       |

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
  PayPal's "test and go live" values in `items[0].note` reject the whole POST before anything is held:
  `ERRPYO002` → `403 SENDER_EMAIL_UNCONFIRMED` ("Authorization error occurred", PayPal's example),
  `ERRPYO005` → `422 INSUFFICIENT_FUNDS`, plus ERRPYO001/003/006/010/011/012/014/035–040; the cancel test values
  `ERRPOI001`, `ERRPYO004/007/008/009` work as path parameters.
- **Fees and balance.** `payout_item_fee` is the published US rate the register uses, US$0.25 per item
  (`SIM_PAYOUT_FEE_CENTS`). Balances are kept in integer cents in a ledger: payouts debit the co-op (returns
  credit it back), invoices paid on the pay page credit it (optional receiving fee, off by default). A recorded
  payment (MARKED_AS_PAID) moves no money inside PayPal, so it creates no transaction — exactly what the
  reconciliation spec expects. Seeded balances: co-op and Lantern Bay US$100,000.00 each.
- **Transaction Search.** Payout items appear as `T0001` (status `S`, or `P` while unclaimed, `V` once returned),
  returns as `T1115`, pay-page invoice payments as `T0000` with `invoice_id` = invoice number. `custom_field`
  carries the `sender_item_id`. `SIM_REPORTING_LAG_S` imitates PayPal's reporting lag (default 0).
- **Idempotency.** A `POST` with `PayPal-Request-Id` and the same body within 30 days replays the stored response
  (`paypal-idempotent-replay: true`); concurrent duplicates are serialised. A reused id with a _different_ body is
  processed normally, as observed in the real sandbox (PR #107) — `sender_batch_id` is the real guard.
- **Throttle and latency.** 50 requests a minute per client (the sandbox blocks per IP), then `429
  RATE_LIMIT_REACHED` for 5 minutes (`SIM_RATE_LIMIT_PER_MIN`, `SIM_RATE_LIMIT_BLOCK_S`; 0 disables).
  `SIM_LATENCY_MS` adds a fixed or ranged delay to every API response.

## Webhooks, signed like PayPal

For every state change the simulator emits PayPal's event types (`INVOICING.INVOICE.CREATED/UPDATED/SCHEDULED/
PAID/CANCELLED`, `PAYMENT.PAYOUTSBATCH.PROCESSING/SUCCESS/DENIED`, `PAYMENT.PAYOUTS-ITEM.SUCCEEDED/UNCLAIMED/
FAILED/CANCELED/RETURNED`) in PayPal's envelope (`id` `WH-…`, `event_version` `1.0`, `create_time`,
`resource_type`, `resource_version`, `event_type`, `summary`, `resource`, `links` self/resend) and POSTs it to
every subscribed webhook of the REST app that owns the resource, with PayPal's headers:
`paypal-transmission-id`, `paypal-transmission-time`, `paypal-transmission-sig`, `paypal-cert-url`,
`paypal-auth-algo: SHA256withRSA`, `paypal-auth-version`, `correlation-id`.
- **Signature.** RSA-SHA256 over `transmissionId|transmissionTime|webhookId|crc32(rawBody)` (CRC32 of the exact
  bytes, in decimal) — PayPal's documented self-verification algorithm. The key is a leaf certificate issued by a
  simulator CA, both generated with `node:crypto` at first start and stored in `packages/paypal-sim/.data/certs`
  (git-ignored). `paypal-cert-url` is `{publicBaseUrl}/sim/certs/SIMCERT-xxxxxxxx-xxxxxxxx-xxxxxxxx.pem` and serves
  the chain (leaf, then CA). It never points at a PayPal host, so a verifier must allow-list it **only** in
  simulator mode (`simulator.certUrlPattern`).
- **Postback.** `verify-webhook-signature` answers `SUCCESS` only when the posted values verify with the
  simulator's certificate over the CRC32 of the `webhook_event` bytes exactly as posted, the cert URL is the
  simulator's, the webhook belongs to the calling app and the event is one the simulator delivered; otherwise
  `FAILURE`. Mock events from `simulate-event` are signed with the literal `WEBHOOK_ID` and always `FAILURE`, as
  PayPal documents for its own mock events.
- **Delivery.** Non-2xx answers are retried with backoff (5 s, 15 s, 30 s, … up to 25 attempts over about two
  days, scaled by `SIM_SPEED`). `POST …/webhooks-events/{id}/resend` sends the same event bytes under a new
  transmission id. Toggles for tests and the "repeats change nothing" beat: duplicate delivery (every event twice,
  distinct transmissions) and out-of-order delivery (events of a burst released newest first), via options,
  `SIM_DUPLICATE_DELIVERY` / `SIM_OUT_OF_ORDER`, or `POST /sim/admin/delivery {"duplicate":true}`.

## How it is validated

- **PayPal's own specs.** `spec/` vendors, unmodified and checksum-pinned, PayPal's Apache-2.0 OpenAPI files for
  Invoicing v2 (2.6), Payouts v1 (1.9), Webhooks v1 (1.11) and Transaction Search (1.9) from
  github.com/paypal/paypal-rest-api-specifications (see `spec/README.md`). Two operations missing from that
  repository (conditional rules and the OAuth token) are covered by small hand-written supplements, labelled as such.
- **Every request body** is validated (ajv 8 + ajv-formats, draft-07 conversion of the OpenAPI 3.0 schemas;
  `readOnly` fields are not required in requests). A violation gets PayPal's documented `400 INVALID_REQUEST`
  with `details[]` (`field` as a JSON pointer, `location`, `issue` such as `MISSING_REQUIRED_PARAMETER`,
  `INVALID_STRING_MAX_LENGTH`, `INVALID_PARAMETER_VALUE`, `INVALID_PARAMETER_SYNTAX`, `INVALID_ARRAY_MAX_ITEMS`;
  unparsable JSON → `MALFORMED_REQUEST_JSON`).
- **Every response body and webhook event** the simulator produces is validated against the same specs. In strict
  mode (default) a violation becomes a 500 with `x-fairsplit-sim-contract: violated`, and every test asserts that
  `simulator.violations` stays empty.
- **Tests (Vitest):** the full money loop (token → create → send → AUTO_CANCEL rule → record payment →
  signed `INVOICING.INVOICE.PAID` → payout batch → PROCESSING → SUCCESS, Rhea UNCLAIMED → cancel → RETURNED,
  balance in cents, Transaction Search), a contract tour that calls every implemented operation, valid and invalid
  payloads per endpoint, duplicate-batch adoption, `PayPal-Request-Id` replay and serialisation, ERRPYO002/005,
  signatures verified with `node:crypto` against the served certificate, postback SUCCESS/FAILURE, retries,
  duplicate and out-of-order delivery, resend, the 429 block, persistence and reset, the X.509 writer, and
  **`@paypal/agent-toolkit` 1.11.0** (`create_invoice`, `get_invoice`, `send_invoice`,
  `create_conditional_rules_for_invoice`, `record_payment_for_invoice`, `search_invoicing`, its own token fetch)
  plus **`@paypal/paypal-server-sdk` 2.5.0** `TransactionSearchController` running unmodified through the
  interceptor. Both PayPal packages are test-only dependencies.

## Running it

**Standalone server** (Hono on `@hono/node-server`):

```sh
corepack pnpm --filter @fairsplit/paypal-sim start      # http://127.0.0.1:4010
corepack pnpm exec tsx tools/paypal-sim.ts --port 4010 --speed 1 [--public-url https://…] [--fresh]
```

Point a client at `http://127.0.0.1:4010` instead of `https://api-m.sandbox.paypal.com`; HATEOAS links follow the
host you called (and honour `X-Forwarded-Proto/Host`, e.g. behind a tunnel). State is snapshotted to
`packages/paypal-sim/.data/state.json`; `POST /sim/admin/reset` restores the seeded world (Judge Mode).

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
every other host pass through untouched. `sim.idle()` waits for queued processing and deliveries;
`sim.reset()`, `sim.snapshot()`, `sim.restore()` and `sim.close()` do what they say.

| Variable                                           | Default                    | Meaning                                                           |
| -------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `PP_MODE`                                          | `simulator`                | `simulator` or `sandbox` (read by `setupPayPalRail`)              |
| `SIM_PORT`, `SIM_HOST`                             | `4010`, `127.0.0.1`        | Standalone server address                                         |
| `SIM_PUBLIC_URL`                                   | the bound address          | Where browsers and verifiers reach `/sim/*` (pay page, certs)     |
| `SIM_BASE_PATH`                                    | none                       | Prefix when mounted inside another app, e.g. `/paypal-sim`        |
| `SIM_API_BASE_URL`                                 | `SIM_PUBLIC_URL`           | Base for links inside webhook events                              |
| `SIM_SPEED`                                        | `1`                        | Processing delays × speed; `0` runs everything on the next tick   |
| `SIM_DATA_DIR`, `SIM_PERSIST`                      | `.data`, on (server)       | Keys and snapshot location; snapshot on/off                       |
| `SIM_RATE_LIMIT_PER_MIN`, `SIM_RATE_LIMIT_BLOCK_S` | `50`, `300`                | Throttle; `0` disables                                            |
| `SIM_LATENCY_MS`                                   | `0`                        | `120` or a range `80-250`                                         |
| `SIM_STRICT`                                       | on                         | Spec violations become 500s                                       |
| `SIM_DUPLICATE_DELIVERY`, `SIM_OUT_OF_ORDER`       | off                        | Delivery toggles                                                  |
| `SIM_PAYOUT_FEE_CENTS`, `SIM_REPORTING_LAG_S`      | `25`, `0`                  | Fee per payout item; Transaction Search lag                       |
| `SIM_ACCOUNTS_FILE`, `SIM_ADMIN_TOKEN`             | `data/accounts.json`, none | Seed registry; when set, `/sim/admin/*` needs `x-sim-admin-token` |

## Accounts (all fictional, simulator-only)

`data/accounts.json` seeds one US business account for the co-op (`bulawanon.coop@example.org`, invoicer and payout
sender), Lantern Bay's payer account (`lantern.bay.payables@example.org`) and seven member receivers on the reserved
`example.org` domain: M-014 `consolacion.bacus@`, M-007 `dionisio.lapinig@`, M-060 `arnel.sumampao@`, M-018
`teodoro.pacana@`, M-039 `jonathan.ripalda@`, M-022 `pedro.ompad@`, M-002 `florencia.ybanez@`. **Rhea Jumawan
(M-031, `rhea.jumawan@example.org`) deliberately has no account**, so her item is UNCLAIMED. Two REST apps sit on
the co-op account, `fs-dev` (`SIM-fs-dev-client`) and `fs-judge` (`SIM-fs-judge-client`); their client secrets are
in the same file. They are public simulator values that only this simulator accepts — they are not PayPal
credentials and must never be used as such.

## Wiring it into paypal-core (the integration hook)

`paypal-core` is owned by WS-PPCORE and is not edited here. It selects the rail with one call at boot:

```ts
import { setupPayPalRail } from "@fairsplit/paypal-sim";
export const rail = await setupPayPalRail(process.env, {
  publicBaseUrl: `${env.PUBLIC_BASE_URL}/paypal-sim`,
  basePath: "/paypal-sim",
});
const certAllow = rail.certUrlPattern ?? SANDBOX_CERT_PATTERN; // verifyPayPal's paypal-cert-url allow-list
```

- `PP_MODE=simulator` (default until credentials exist): `setupPayPalRail` creates the simulator and installs the
  interceptor, so `PayPalHttp` (fetch), `tk()` (Agent Toolkit, axios) and the server SDK keep their hard-coded
  `https://api-m.sandbox.paypal.com` and reach the simulator in process. `rail.certUrlPattern` is the only cert URL
  shape `verifyPayPal` should accept in this mode.
- `PP_MODE=sandbox`: `setupPayPalRail` returns `{ mode: "sandbox", simulator: null, certUrlPattern: null }` and
  changes nothing; the existing `PP_ENV=sandbox` boot guard and PayPal cert pattern apply.
- `apps/api` mounts the simulator's public pages (pay page and certificate) with
  `app.all("/paypal-sim/*", (c) => rail.simulator ? rail.simulator.fetch(c.req.raw) : c.notFound())`, and should
  set `SIM_ADMIN_TOKEN` (or not mount `/paypal-sim/sim/admin/*`) when deployed. If the dependency rule should keep
  `paypal-core` free of `paypal-sim`, make the same call from `apps/api` before `paypal-core` is first used.
- If `PayPalHttp` passes its own undici `dispatcher` to `fetch` (for timeouts or keep-alive), that bypasses the
  global hook; wrap it instead: `createSandboxDispatcher(rail.simulator, { fallback: agent })`.
- In simulator mode set `PP_CLIENT_ID=SIM-fs-dev-client`, `PP_CLIENT_SECRET` from `data/accounts.json`,
  `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS` and `PP_UNCLAIMED_RECEIVER` from the table above, and
  `PP_WEBHOOK_ID` from `tools/setup-webhooks.ts` run against the simulator.

## Switching to the real sandbox

Create sandbox credentials on developer.paypal.com (sandbox test accounts are fictitious accounts created from the
dashboard), then set `PP_MODE=sandbox` and the real `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID` and account
emails. No code changes: the interceptor is not installed, requests go to `api-m.sandbox.paypal.com`, and webhook
verification falls back to PayPal's certificate pattern. Labels must then change from "simulated rail" to sandbox.

## Known gaps versus real PayPal

- Only the endpoints above. No Orders, Payments, Subscriptions, templates, refunds, QR codes, recurring invoices,
  reminder settings or the ERRPYO/POSPYO GET-path test values; unknown paths return a 404 that says the simulator
  does not implement them.
- Shapes not in PayPal's published specs are best readings, documented in code: the `DUPLICATE_INVOICE_NUMBER`
  422 (S3.6.3 already says never to parse it), the HTTP status of ERRPYO values other than 002 and 005, the PHONE
  rejection body, webhook-management errors, conditional-rule business errors, and several issue codes for
  business-rule 422s. Invoice status after a send with `send_to_recipient:false` is UNPAID (PayPal's quickstart);
  the live sandbox may show SENT or SHARED.
- Only these payout outcomes occur: SUCCESS, UNCLAIMED, FAILED (self-pay), RETURNED, and a DENIED batch on request;
  ONHOLD, BLOCKED, REFUNDED and REVERSED never happen. Batch/item timing is illustrative, not PayPal's.
- No emails are sent, there is no hosted PayPal checkout, invoice receiving fees default to zero, and the reporting
  lag defaults to zero. Transaction event codes are limited to T0000, T0001 and T1115.
- The throttle is per client rather than per IP, and the simulator is single-process (in-memory state with an
  optional JSON snapshot) — not safe to run as several instances behind a load balancer.
- The spec is followed even where it is stricter than PayPal probably is: `simulate-event` rejects hyphenated
  event types (its `event_type` pattern), and empty Transaction Search results omit `transaction_details`
  (`minItems: 1`).
- Time-based transitions (AUTO_CANCEL, scheduled sends, 30-day returns) run on the simulator clock, lazily on reads
  and every 30 s.
