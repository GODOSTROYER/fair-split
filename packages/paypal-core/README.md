# @fairsplit/paypal-core

IC-05 for Fair Split: one OAuth token cache, one door to PayPal's REST APIs, offline webhook
verification and the payout-item status rules. zod 3.25.76 (`catalog:zod3`), like every `paypal-*` package.

| Export                                                | What it does                                                                                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createPayPalAuth()` → `PayPalAuth`                   | Client-credentials OAuth. Single-flight across concurrent callers; refresh 5 min before `expires_in`; serves the old token if an early refresh fails; `invalidate(token)` after a 401. Token value non-enumerable.                           |
| `checkScopes()` / `assertScopes()`                    | Boot check: invoicing, payouts (`…/payments/payouts`) and webhooks are required; Transaction Search missing reads as `lagging`.                                                                                                              |
| `createPayPalHttp()` → `request()`                    | Limiter token → OAuth → `PayPal-Request-Id` → 15 s timeout → one `paypal_calls` record per attempt. Never throws; returns `PayPalResult` (always with `debugId`, plus `kind`, `delivery`, `retryable`). Optional caller deadline (`signal`). |
| `createMemoryLimiter()`                               | Reference limiter: 40/min, 20 background, 6-min circuit after a 429. Production injects WS-DATA's Postgres limiter through the same `PayPalLimiter` interface.                                                                               |
| `createPayPalCore()`                                  | Composition root: one auth, http, verifier and bounded `postback` per process, all on the injected limiter and recorder.                                                                                                                     |
| `verifyPayPal()` / `createPayPalWebhookVerifier()`    | `'self' \| 'postback' \| 'dev_mock' \| false`. CRC32 of the raw bytes + RSA-SHA256 with the cert at `paypal-cert-url`; `prewarm(certUrls)`; `health()` for `/readyz` and `/ops`.                                                             |
| `createPostbackVerifier()` / `postbackWithDeadline()` | `verify-webhook-signature` with the raw event spliced in: one attempt (never retried), 5 s per attempt, 6 s overall.                                                                                                                         |
| `toItemStatus()` / `decideItemStatus()`               | SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED; apply only if the rank is higher; RETURNED only after our own cancel.                                                                                                                     |
| `ensureWebhook()` and friends                         | Idempotent registration (list → patch or create), lookup, drift check, catch-up listing (`next` cursor), resend. `runSetupWebhooks()` backs `tools/setup-webhooks.ts`.                                                                       |
| `@fairsplit/paypal-core/testing`                      | Throwaway CA and leaf certificates built with `node:crypto` only (a small DER encoder), and a PayPal-style webhook signer. Test code only.                                                                                                   |

## Retries and delivery

Idempotent calls (GET, or anything with a `PayPal-Request-Id`) retry 5xx, timeouts and network errors at
1 s, 3 s and 9 s with the same id. A POST without a request id is never retried, and neither is the
postback verify (it is marked non-idempotent so it costs exactly one call). A 401 refreshes the token
once. A 429 opens the circuit and returns at once. A caller `signal` is a deadline over the whole call:
once it aborts nothing more is sent (`FS_ABORTED`). `delivery` tells money code what it may assume:
`not_sent` (limiter, circuit, OAuth, deadline or a refused URL: PayPal saw nothing), `unknown` (sent, no
answer) or `received`. Absolute HATEOAS links are followed only on this environment's PayPal API hosts,
so the bearer token cannot be sent anywhere else.

## Webhook trust model

1. `paypal-cert-url` must be `https://api.sandbox.paypal.com` or `https://api-m.sandbox.paypal.com` (any
   configured host must be a `*.paypal.com` host), path `/v1/notifications/certs/CERT-xxxxxxxx-xxxxxxxx-xxxxxxxx`
   (PayPal's id shape, lowercase hex), no port, credentials, query or fragment. Refused before any fetch.
2. Certificate fetches are PayPal calls: each takes a background token from the shared limiter (so it
   counts toward the 40/min budget), is written to `paypal_calls` (`webhooks.cert`), and a 429 opens the
   6-minute circuit. Before that, a local budget allows 6 unknown URLs a minute, plus one reserved slot a
   minute for URLs that already signed a verified delivery, so forged requests cannot starve a genuine
   one. PEMs are fetched over TLS with redirects refused, at most 64 KB, cached per URL (24 h, LRU) and
   single-flighted; failed URLs are not retried for a minute. `prewarm(urls)` loads the certificate of
   the newest stored verified event at boot (`prewarmWebhookCertificates` in `apps/api/src/webhooks`).
3. On every use the leaf must carry the subject `messageverificationcerts.sandbox.paypal.com`, hold an
   RSA key of 2048 bits or more, not be a CA, and (with optional `trustAnchors`) chain to a pinned
   certificate. Its validity window is checked separately, after the signature:
   - in date: accepted;
   - expired, signature valid (`expiredCertPolicy`): `postback` (default) asks PayPal once per
     certificate (bounded, one call) and on SUCCESS accepts, remembering the certificate for 24 h with
     `certWarning: CERT_EXPIRED_CONFIRMED`; `accept` accepts with `CERT_EXPIRED_ACCEPTED`; `reject` 400s.
     Every such delivery is logged and turns `health()` degraded;
   - expired, signature invalid: `SIGNATURE_MISMATCH` (junk pointing at an old PayPal cert URL).
4. Signature: RSA-SHA256 over `transmissionId|transmissionTime|webhookId|crc32(raw)`, CRC as unsigned
   decimal. Simulator events (signed with the literal `WEBHOOK_ID`) are accepted only with dev mocks on
   (`PP_DEV_MOCKS=1`, refused when `NODE_ENV=production`) and labelled `dev_mock`.
5. The webhook route never asks for a postback: processWebhook calls `confirmWebhookByPostback`
   (`apps/api/src/webhooks/postback.ts`) after the 200, from the transmission headers kept in the row.

`verifier.health()` reports `ok | degraded` with plain-language problems: deliveries signed with an
expired certificate, a known certificate URL that can no longer be fetched, or a signing certificate
with fewer than 14 days left. WS-API: put it in the `/readyz` body as `webhooks`, but never fail
readiness on it (Render's health check would restart a healthy process); show it on `/ops`.

## Spike results

- **22 Oct 2026, real PayPal signatures.** The production verifier, run against five public PayPal-signed
  simulator deliveries with PayPal's certificate fetched over TLS and the clock pinned to each
  transmission time: 3 of 3 byte-exact bodies verified (`dev_mock`, signed with `WEBHOOK_ID`); 2 of 2
  re-serialized bodies were refused (`SIGNATURE_MISMATCH`). First verification 315–460 ms (certificate
  fetch), cached ≈0.3 ms.
- **22 Oct 2026 (UTC), certificates with the real clock.** PayPal's sandbox signing certificates, fetched from
  PayPal: …a5cafa77 (2015–2017), …aecacc47 (2017–2019), …1d93a270 (2019–2021), …7a8abba8 (2021–2022),
  …5a29e601 (2022–2023), …ab66f33d (Mar 2024–7 Mar 2025), …90621ecd (29 Jan 2025–1 Mar 2026) and
  **…bf9ab596 (27 Jan 2026–26 Jan 2027)**: yearly rotation with weeks of overlap. A real sandbox delivery
  transmitted 19 Oct 2026 (public, found by code search) carried `CERT-360caa42-fca2a594-bf9ab596`, its
  signature opens under that key (PKCS#1 v1.5, SHA-256), and PayPal's postback answered SUCCESS for it.
  With today's clock that certificate passes every check, and it stays valid past the 12 Nov deadline
  and the 1–15 Dec freeze. It is pinned in `src/webhook/__fixtures__` and tested. The live sandbox
  delivery to _our_ app is still S5's job (below).
- **Certificates.** PayPal serves one leaf PEM with CRLF endings and no intermediates; the issuer changed
  from "DigiCert SHA2 Extended Validation Server CA" to "DigiCert EV RSA CA G2" in 2026. Old cert URLs
  keep serving expired certificates. All 13 cert ids seen match `CERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}`.
- **Listing order.** `GET /v1/notifications/webhooks-events` documents inclusive `start_time`/`end_time`
  but no order; its `next` links carry `move_to=next&index_time=…&index_id=…`, walking back from
  `end_time`. Catch-up therefore resumes by window, not by repeating the pass (`resume` cursor).
- **Scopes.** PayPal issues the payouts scope as `https://uri.paypal.com/payments/payouts` (no `services/`).

## S5 / G2 checklist (hard items for WS-PPCORE with the user)

- [ ] With `fs-dev` registered (`tools/setup-webhooks.ts --app dev`), capture one real sandbox delivery
  (the S5 hosted-page INVOICE.PAID) and verify it **with the real clock**: expect `self`, note the
  `paypal-cert-url` and its expiry, and that `verifier.health().signingCert.daysLeft` is positive.
- [ ] Run the postback step on that row once: expect `confirmed` (row `verified = 'postback'`).
- [ ] Record `PP_APP_ID_DEV` / `PP_APP_ID_JUDGE` (printed by the tool) in `.env` and on Render.

## Shim-swap notes (for the builder)

- `src/_shims/{contracts,domain}.ts` → `@fairsplit/contracts` / `@fairsplit/domain` (item statuses, ranks).
- `apps/api/src/webhooks/_shims/contracts.ts` → `@fairsplit/contracts` (TaskName `processWebhook`, the
  webhook_events vocabulary, `webhook.received`).
- `apps/api/src/webhooks/_shims/persistence.ts` → `@fairsplit/outbox` / `@fairsplit/db`.
- **Proposed to WS-DATA:** one nullable column `webhook_events.delivery jsonb` (transmission headers,
  reject reason, certificate warning; type `WebhookDelivery`) instead of four new columns. Arrival time is
  the row's created-at default; resource type is in `raw`. Without it the route still works, but the
  deferred postback, the boot pre-warm and `/ops` reject reasons do not.
- **Proposed to WS-CORE before the 24 Oct freeze:** widen the `webhook.received` run event's `verified`
  from `"self" | "postback"` (architecture §5) to also allow `"dev_mock"` and `"fetched"`, so simulator
  and catch-up events keep their label (I8). Until then `webhookRunEvent()` returns null for them rather
  than relabelling.
- Until WS-API scaffolds `apps/api`, the webhook route is typechecked by `tsconfig.consumers.json` and
  tested by the `api-webhooks` vitest project here.

## Not yet done

- Live OAuth, postback and webhook registration against the sandbox: waiting for S1 credentials, then
  `tools/setup-webhooks.ts` and spike S5 with the user (checklist above).
- `processWebhook` (resolution, re-GET, state transitions); its postback step exists
  (`confirmWebhookByPostback`). Catch-up exists (`apps/api/src/webhooks/catchup.ts`, rows labelled
  `fetched`); WS-OPS schedules it in `reconcile{catchup}` and persists `resume` between passes.

## `tools/setup-webhooks.ts`

`--app dev|judge` (or `fs-dev|fs-judge`) picks the credentials: `PP_CLIENT_ID_<APP>` /
`PP_CLIENT_SECRET_<APP>` (APP = DEV or JUDGE), else the shared `PP_CLIENT_ID` / `PP_CLIENT_SECRET`. The
token's `app_id` must equal `PP_APP_ID_<APP>` when set and must not be the other app's; `--app judge`
with the shared pair needs `PP_APP_ID_JUDGE` or `--force`. Mismatches are refused even with `--force`.
