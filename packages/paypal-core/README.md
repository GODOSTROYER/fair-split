# @fairsplit/paypal-core

IC-05 for Fair Split: one OAuth token cache, one door to PayPal's REST APIs, offline webhook
verification and the payout-item status rules. zod 3.25.76 (`catalog:zod3`), like every `paypal-*` package.

| Export                                             | What it does                                                                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createPayPalAuth()` → `PayPalAuth`                | Client-credentials OAuth. Single-flight across concurrent callers; refresh 5 min before `expires_in`; serves the old token if an early refresh fails; `invalidate(token)` after a 401. Token value non-enumerable. |
| `checkScopes()` / `assertScopes()`                 | Boot check: invoicing, payouts (`…/payments/payouts`) and webhooks are required; Transaction Search missing reads as `lagging`.                                                                                    |
| `createPayPalHttp()` → `request()`                 | Limiter token → OAuth → `PayPal-Request-Id` → 15 s timeout → one `paypal_calls` record per attempt. Never throws; returns `PayPalResult` (always with `debugId`, plus `kind`, `delivery`, `retryable`).            |
| `createMemoryLimiter()`                            | Reference limiter: 40/min, 20 background, 6-min circuit after a 429. Production injects WS-DATA's Postgres limiter through the same `PayPalLimiter` interface.                                                     |
| `verifyPayPal()` / `createPayPalWebhookVerifier()` | `'self' \| 'postback' \| 'dev_mock' \| false`. CRC32 of the raw bytes + RSA-SHA256 with the cert at `paypal-cert-url`, cert cache, postback only after a successful self-check.                                    |
| `toItemStatus()` / `decideItemStatus()`            | SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED; apply only if the rank is higher; RETURNED only after our own cancel.                                                                                           |
| `ensureWebhook()` and friends                      | Idempotent registration (list → patch or create), lookup, drift check, catch-up listing, resend. `runSetupWebhooks()` backs `tools/setup-webhooks.ts`.                                                             |
| `@fairsplit/paypal-core/testing`                   | Throwaway CA and leaf certificates built with `node:crypto` only (a small DER encoder), and a PayPal-style webhook signer. Test code only.                                                                         |

## Retries and delivery

Idempotent calls (GET, or anything with a `PayPal-Request-Id`) retry 5xx, timeouts and network errors at
1 s, 3 s and 9 s with the same id. A POST without a request id is never retried. A 401 refreshes the token
once. A 429 opens the circuit and returns at once. `delivery` tells money code what it may assume:
`not_sent` (limiter, circuit, OAuth or a refused URL: PayPal saw nothing), `unknown` (sent, no answer) or
`received`. Absolute HATEOAS links are followed only on this environment's PayPal API hosts, so the bearer
token cannot be sent anywhere else.

## Webhook trust model

1. `paypal-cert-url` must be `https://api.sandbox.paypal.com` or `https://api-m.sandbox.paypal.com` (any
   configured host must be a `*.paypal.com` host), path `/v1/notifications/certs/<id>`, no port,
   credentials, query or fragment. Refused before any fetch.
2. The PEM is fetched over TLS with redirects refused, at most 64 KB, cached per URL (24 h, LRU),
   single-flight per URL, and at most 6 unknown URLs a minute, so forged requests cannot burn the
   sandbox's per-IP budget. Failed URLs are not retried for a minute.
3. On every use the leaf must be inside its validity window, carry the subject
   `messageverificationcerts.sandbox.paypal.com`, hold an RSA key of 2048 bits or more, and not be a CA.
   Optional `trustAnchors` also require a signature chain (used with the test CA; available for pinning).
4. Signature: RSA-SHA256 over `transmissionId|transmissionTime|webhookId|crc32(raw)`, CRC as unsigned
   decimal. Simulator events (signed with the literal `WEBHOOK_ID`) are accepted only with dev mocks on
   (`PP_DEV_MOCKS=1`, refused when `NODE_ENV=production`) and labelled `dev_mock`.

## Spike results (22 Oct 2026)

- **Real PayPal signatures.** The production verifier, run against five public PayPal-signed simulator
  deliveries with PayPal's live certificate fetched over TLS and the clock pinned to each transmission time:
  3 of 3 byte-exact bodies verified (`dev_mock`, signed with `WEBHOOK_ID`); 2 of 2 re-serialized bodies
  were refused (`SIGNATURE_MISMATCH`). First verification 315–460 ms (certificate fetch), cached ≈0.3 ms.
- **Certificates.** PayPal serves one leaf PEM with CRLF endings and no intermediates, issued by
  "DigiCert SHA2 Extended Validation Server CA"; old cert URLs keep serving expired certificates. A real
  sandbox certificate is pinned in `src/webhook/__fixtures__` and tested.
- **Scopes.** PayPal issues the payouts scope as `https://uri.paypal.com/payments/payouts` (no `services/`).

## Not yet done

- Live OAuth, postback and webhook registration against the sandbox: waiting for S1 credentials
  (`PP_CLIENT_ID`, `PP_CLIENT_SECRET`), then `tools/setup-webhooks.ts` and spike S5 with the user.
- `processWebhook` (resolution, re-GET, state transitions) and the hourly catch-up task.
- Shims to swap after WS-CORE / WS-DATA merge: `src/_shims/{contracts,domain}.ts`,
  `apps/api/src/webhooks/_shims/{contracts,persistence}.ts`. Until WS-API scaffolds `apps/api`, the webhook
  route is typechecked by `tsconfig.consumers.json` and tested by the `api-webhooks` vitest project here.
