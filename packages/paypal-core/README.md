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

0. Before anything else: bodies over 64 KB, malformed `paypal-transmission-id` values, and a
   `paypal-transmission-time` that is not a strict ISO 8601 instant or is more than 5 minutes from our
   clock (either way; the clock is injectable) are refused without touching the network.
1. `paypal-cert-url` must be `https://api.sandbox.paypal.com` or `https://api-m.sandbox.paypal.com` (any
   configured host must be a `*.paypal.com` host), path `/v1/notifications/certs/CERT-xxxxxxxx-xxxxxxxx-xxxxxxxx`
   (PayPal's id shape, lowercase hex), no port, credentials, query or fragment. Refused before any fetch.
2. Certificate fetches are PayPal calls: each takes a background token from the shared limiter (so it
   counts toward the 40/min budget), is written to `paypal_calls` (`webhooks.cert`), and a 429 opens the
   6-minute circuit. Before that, local budgets (`DEFAULT_CERT_FETCH_BUDGET`, per hour, by cert id so
   `api` and `api-m` count once) decide whether an unauthenticated request may cause a fetch at all:
   - **one hard cap over everything: at most 3 certificate fetches in any 60 minutes** (`totalPerHour`, a
     sliding window), of any id, known or not, `prewarm` included (S3.6.7 "at most 3 an hour"; plan:
     1,000 forged deliveries, at most 3 fetches). Nothing below adds to it;
   - a certificate that signed a verified delivery, was pre-warmed or is pinned (`PP_CERT_ALLOW`, or
     `knownCertIds`) is kept as **last-known-good**, outside the cache's TTL and LRU, and is never
     fetched again (validity is still checked on every use);
   - known ids not loaded yet (pinned, pre-warmed, or seen before a restart) may make 2 fetches in any
     hour (`knownPerHour`), **held back out of the 3**: an unknown id may fetch only while one stays free
     for each known id not loaded yet. They go first and **without** the per-IP budget, so neither a
     flood of unknown ids nor one that shares PayPal's client key (no `X-Forwarded-For`, a miscounted
     proxy hop) can keep them out; once their 2 are spent they continue as below;
   - **per client IP** next (2 an hour; IPv6 by /64; IPv4-mapped as IPv4; no address = one shared budget);
   - then **shared**: unknown ids with PayPal's shape (`CERT-360caa42-…`, `PAYPAL_CERT_ID_PATTERN`) 2 an
     hour, every other well-formed id 1 an hour;
   - a delivery refused by a budget is `CERT_FETCH_THROTTLED` with `retryable: true`: the route answers
     **503** with `Retry-After` (PayPal retries 25 times over 3 days) and stores nothing. So are a limiter
     refusal, a timeout, a network error and a PayPal 5xx/429 on the fetch; a 404 or junk PEM stays a 400;
   - the bound for a burst of forged deliveries of any size, **whatever is pinned: 3 certificate
     fetches**, and no other PayPal call (tested as an exact count for 0 to 5 pins not loaded yet, and
     as a property: no 60 minutes ever hold a 4th fetch). Sustained: at most 3 in any 60 minutes;
   - starvation: a sustained flood keeps the shared buckets empty, so a genuine certificate nobody has
     verified yet (fresh deploy, PayPal's yearly rotation) waits (503s, PayPal retries) while it lasts.
     `PP_CERT_ALLOW` (comma or space separated ids or sandbox cert URLs, at most 8) pins ids so they draw
     on the fetches held back for known ids instead: list the current signing certificate and, once
     PayPal publishes it, the next one. Call `prewarm` at boot, before serving: an id that becomes known
     only after a flood spent the hour's 3 waits for the hour like any other. Pinning does not narrow
     (S3.6.5 says "narrows": that would turn an unannounced rotation into 400s; see Deviations).
     `health()` raises `CERT_FETCH_THROTTLED` once throttling persists (more than 5 throttled deliveries
     in 15 min; `certFetchThrottleAlert`). A fetch is charged before its status is known, 404s included:
     a budget only 200s spend would let a flood of random PayPal-shaped ids (all 404) fetch without bound;
   - PEMs are fetched over TLS with redirects refused, at most 64 KB, cached (24 h, LRU) and
     single-flighted; failed ids are not retried for a minute. `prewarm(urls)` loads the certificate of
     the newest stored verified event at boot (`prewarmWebhookCertificates` in `apps/api/src/webhooks`).
3. On every use the leaf must carry the subject `messageverificationcerts.sandbox.paypal.com`, hold an
   RSA key of 2048 bits or more, not be a CA, and (with optional `trustAnchors`) chain to a pinned
   certificate. Its validity window is checked separately, after the signature:
   - in date: accepted;
   - expired, signature valid (`expiredCertPolicy`): never `self`, and one delivery never vouches for
     another (nothing is cached per certificate or shared between concurrent deliveries). `postback`
     (default) claims the transmission id, then asks PayPal about **this** transmission (one call, 6 s,
     at most `expiredCertPostbacksPerHour` = 20 an hour): SUCCESS is accepted as `postback` with
     `certWarning: CERT_EXPIRED`; FAILURE is a 400 (the id stays claimed, so a copy is a replay);
     ERROR, TIMEOUT or no budget left is retryable (503, the id is released). `reject` 400s. There is
     no `accept`. Every such delivery is logged and turns `health()` degraded;
   - expired, signature invalid: `SIGNATURE_MISMATCH` (junk pointing at an old PayPal cert URL).
4. Signature: RSA-SHA256 over `transmissionId|transmissionTime|webhookId|crc32(raw)`, CRC as unsigned
   decimal. Simulator events (signed with the literal `WEBHOOK_ID`) are accepted only with dev mocks on
   (`PP_DEV_MOCKS=1`, refused at boot when `RENDER=true` or `NODE_ENV=production`, S3.6.5) and labelled
   `dev_mock`.
5. Replay: once the signature verifies, the transmission id is recorded through the injected
   `TransmissionStore` (unique; kept until transmission time + 6 min) and a repeat is
   `TRANSMISSION_REPLAYED` (400). A store failure is `REPLAY_CHECK_FAILED`, retryable (503). This is
   separate from event-id dedupe: PayPal's resend has a new transmission id and lands as a duplicate.
   The route releases the id when it could not store the event, so PayPal's retry is not a "replay".
   A claim that reports an error may still have committed (a lost reply), so the verifier releases it
   too, by the claim's own token (`claim(id, expiresAt, now, claimToken)`, `release(id, claimToken)`):
   never a record a concurrent copy holds. A release that fails is retried once, then raised as
   `TRANSMISSION_RELEASE_FAILED` in `health()`.
   UNVERIFIED until spike S5: whether PayPal's retries after a non-2xx carry new transmission headers;
   if they reuse the first ones, retries later than 5 minutes are refused and catch-up recovers the event.
6. The webhook route never asks for the badge postback: processWebhook calls `confirmWebhookByPostback`
   (`apps/api/src/webhooks/postback.ts`) after the 200, from the transmission headers kept in the row.
   A delivery's only in-request PayPal calls are a certificate fetch (step 2: at most 3 in any hour,
   all deliveries together) and the expired-certificate check of step 3 (one per such delivery, at most
   20 an hour; none for forged or replayed copies).
7. Applying events (`apps/api/src/webhooks/apply.ts`, re-exported by the route; pass it the stored row):
   only a signature-verified (`self`/`postback`) PAYOUTS-ITEM.SUCCEEDED under an in-date certificate
   applies at once (MM-1), corroborated by the settle GETs at +25 s (Judge) / +90 s; a GET that disagrees
   wins and raises `WEBHOOK_GET_MISMATCH` on `/ops` (a lower rank is written as a correction, the one
   sanctioned exception to forward-only); every other status, a SUCCEEDED labelled `dev_mock` or
   `fetched`, any row whose `delivery.certWarning` is set (`CERT_EXPIRED`, even when PayPal's postback
   confirmed it: state comes from PayPal's GET, never from an expired-certificate body) and a verified
   row whose `delivery` is missing or lacks the `certWarning` key (`DELIVERY_NOT_RECORDED`) change state
   only after a fresh GET. Only an explicit `certWarning: null` lets a SUCCEEDED apply at once, so
   **MM-1 needs `delivery` stored as written, null keys included** (shim-swap notes below).
8. Rejections (forged, stale, replayed, malformed): 400 and a `rejected` `webhook_events` row (body
   truncated to 8 KB), **rate-limited over a sliding hour**: at most 10 rows per client address (IPv6 by
   /64; no address = one shared count) and 100 overall in any 60 minutes (`DEFAULT_REJECTED_ROW_LIMITS`;
   S3 "≤ 100 rows an hour", E-18 "at most 100 stored rejects"). A row counts for an hour after it was
   stored, whatever the clock hour, so a burst across the top of the hour cannot store twice the cap.
   The rest are only counted in `handler.health()` (counters for the last hour, never a body or an
   address) and logged at most once an hour. A rejection that writes no row (identical junk, failed
   insert) gives its slot back. Memory stays flat: at most 100 rows' times and address keys, and 60
   refusal counters. Tested: 1,000 forged deliveries store at most 100 rows (10 from one address), also
   in 1.5 s across the top of the hour, and make no PayPal call; a property test checks the sliding hour
   against a model for random arrivals.

`verifier.health()` reports `ok | degraded` with plain-language `problems` and their codes in `alerts`:
`CERT_FETCH_THROTTLED` (persistent throttling, above), `SIGNED_WITH_EXPIRED_CERT`, `KNOWN_CERT_FETCH_FAILED`
(a known certificate URL that can no longer be fetched), `SIGNING_CERT_EXPIRED` and `SIGNING_CERT_EXPIRING`
(fewer than 14 days left). `certFetchThrottled` and `rejected` count throttled deliveries below the
threshold. The route's `handler.health()` reports rejected rows stored and not stored in the last hour
(degraded while any were not stored). WS-API: put both
in the `/readyz` body (`webhooks`, `webhookRoute`), but never fail readiness on them (Render's health
check would restart a healthy process); show them on `/ops`.

## Deviations from the specs (for an ADR; `docs/spec` is not ours to edit)

1. **`PP_CERT_ALLOW` pins; it does not narrow** (S3.6.5 says "narrows"). Narrowing would turn an
   unannounced certificate rotation into 400s; pinning only holds certificate fetches back for the listed
   ids and keeps them once loaded. Every check still runs on every use.
2. **Expired-certificate confirmations are PayPal calls outside S3.6.7's list.** A delivery whose
   signature verifies under an expired PayPal certificate costs one `verify-webhook-signature` call
   during the request (step 3), at most 20 an hour (`expiredCertPostbacksPerHour`). None unless PayPal
   signs with an expired certificate (or its expired key leaked); forged and replayed copies cost none.
   Proposed S3.6.7 line: "expired-certificate confirmations: at most 20 an hour (normally none)".
   Certificate fetches stay within S3.6.7's "at most 3 an hour", pins included (step 2).

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

- [ ] Answer one real delivery 503 once and log the retry's headers: does PayPal re-sign a retry with a new
  transmission id and time (replay and freshness rules hold as built), or resend the first headers
  (then retries after 5 minutes are refused and catch-up recovers the event)?
- [ ] On Render, log `X-Forwarded-For` for one real delivery and confirm the rightmost entry is PayPal's
  address (the per-IP budget's key); otherwise pass `clientIp` to `honoPayPalWebhook`.

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
- **Required from WS-DATA (for MM-1):** one nullable column `webhook_events.delivery jsonb` (transmission
  headers, reject reason, certificate warning; type `WebhookDelivery`) instead of four new columns.
  Arrival time is the row's created-at default; resource type is in `raw`. It must keep null-valued keys
  (jsonb does; never `jsonb_strip_nulls`): `webhookApplyRule` applies an in-date signed SUCCEEDED at once
  only when the stored `delivery.certWarning` is an explicit `null`. Without the column (or with null keys
  stripped) the route still stores events, but every SUCCEEDED is `DELIVERY_NOT_RECORDED` and waits for
  the settle GET at +25 s / +90 s, so **MM-1 never fires** (fails closed: no money risk); the deferred
  postback, the boot pre-warm and `/ops` reject reasons stop working too. A dedicated `cert_warning`
  column is no substitute on its own: it restores none of those three, and its NULL would mean both "in
  date" and "never written".
- **Proposed to WS-CORE before the 24 Oct freeze:** widen the `webhook.received` run event's `verified`
  from `"self" | "postback"` (architecture §5) to also allow `"dev_mock"` and `"fetched"`, so simulator
  and catch-up events keep their label (I8). Until then `webhookRunEvent()` returns null for them rather
  than relabelling.
- **Proposed to WS-DATA:** table `webhook_transmissions (transmission_id text PRIMARY KEY, expires_at
  timestamptz NOT NULL, claim_token uuid)` behind `TransmissionStore` (SQL in
  `src/webhook/transmission.ts`), injected as `createPayPalCore({ webhookTransmissionStore })`. `claim`
  stores the claim token it is handed; `release(id, token)` deletes only the row with that token (any row
  when no token is given). Until then the in-memory store (one fs-api instance) applies; a restart
  forgets ids, and event-id dedupe still stops a second apply.
- **For WS-DATA (record only; theirs to build):** the production `TransmissionStore` must compare
  `expires_at` against the app-supplied timestamp, the `now` argument of `claim(id, expiresAt, now)`
  (`… WHERE webhook_transmissions.expires_at <= $3`), never the database's `now()`: freshness (the
  5-minute window) is judged by the app clock, so a database clock running ahead would treat a live id
  as expired and let a replayed copy through. The hourly purge takes an app-supplied time too.
- **For WS-API:** mount `honoPayPalWebhook(handler)`; it takes the client address from the rightmost
  `X-Forwarded-For` entry (Render appends the connecting address; UNVERIFIED, confirm at S5 and pass
  `clientIp` if there is a second proxy). Wire `releaseTransmission: core.verifier.releaseTransmission`
  and `now` (the app clock), and report `handler.health()`. In `insertWebhookEvent`, persist
  `row.delivery` as it is, into `webhook_events.delivery` (not only its `rejectReason` into `error`), and
  hand the stored `delivery` back to `webhookApplyRule` in processWebhook: that is what MM-1 runs on.
- Until WS-API scaffolds `apps/api`, the webhook route is typechecked by `tsconfig.consumers.json` and
  tested by the `api-webhooks` vitest project here.

## Not yet done

- Live OAuth, postback and webhook registration against the sandbox: waiting for S1 credentials, then
  `tools/setup-webhooks.ts` and spike S5 with the user (checklist above).
- `processWebhook` (resolution, re-GET, state transitions); its postback step exists
  (`confirmWebhookByPostback`) and the rules it must follow are code (`apply.ts`: `webhookApplyRule`,
  `corroborateWithSettleGet`, `openForSettleGets`). Catch-up exists (`apps/api/src/webhooks/catchup.ts`, rows labelled
  `fetched`); WS-OPS schedules it in `reconcile{catchup}` and persists `resume` between passes.

## `tools/setup-webhooks.ts`

`--app dev|judge` (or `fs-dev|fs-judge`) picks the credentials: `PP_CLIENT_ID_<APP>` /
`PP_CLIENT_SECRET_<APP>` (APP = DEV or JUDGE), else the shared `PP_CLIENT_ID` / `PP_CLIENT_SECRET`. The
token's `app_id` must equal `PP_APP_ID_<APP>` when set and must not be the other app's; `--app judge`
with the shared pair needs `PP_APP_ID_JUDGE` or `--force`. Mismatches are refused even with `--force`.
