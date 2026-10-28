# fs-api (`@fairsplit/api`)

Audited co-op payroll on PayPal: Claude reads handwritten slips, code computes every amount, two officers sign,
PayPal executes. This is the one always-on Render web service that serves all of it from one origin.

| Path                                                                                | What                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `/v1/*`                                                                             | Typed RPC generated from IC-01 `API_COMMANDS` (21 commands), plus the slices' extra routes             |
| `/v1/runs/:runSlug/events`, `/v1/workspaces/:ws/events`, `/v1/lines/:lineId/events` | Server-sent events (IC-01 `RunEvent`), replay from `Last-Event-ID`                                     |
| `/openapi.json`, `/v1/openapi.json`                                                 | OpenAPI 3.1, generated from the same specs the routes run (never hand-edited)                          |
| `/docs`, `/v1/docs`                                                                 | Scalar API reference (pinned, integrity-checked, sandboxed CSP)                                        |
| `/webhooks/paypal`                                                                  | WS-PPCORE's self-verifying webhook route (stored and enqueued in one transaction)                      |
| `/healthz`, `/readyz`                                                               | Liveness (`select 1` within 1 s) and readiness (LISTEN round-trip, dispatcher, role, flags, SSE, rail) |
| `/app/*`, `/media/*`, `/s/:token`, everything else                                  | Expo web export, immutable media, member-link redirect, the console SPA                                |

How the code is split between the shell and the three slices, and every shared API: **[SPLIT.md](SPLIT.md)**.

## Run it

```sh
corepack pnpm install
corepack pnpm --filter @fairsplit/api test          # embedded Postgres, no network, no live API calls
corepack pnpm --filter @fairsplit/api typecheck
corepack pnpm --filter @fairsplit/api openapi > openapi.json   # the document, no database needed
DATABASE_URL=postgres://… corepack pnpm --filter @fairsplit/api dev   # local server on :8787
corepack pnpm --filter @fairsplit/api smoke         # boot fs-api on embedded Postgres, smoke every route
corepack pnpm --filter @fairsplit/api smoke -- --dist   # the same against the bundle (after `build`)
```

**Smoke** (`src/smoke`): boots fs-api in its own process the way Render does (fresh migrated database,
`PP_MODE=simulator`, throwaway secrets made for the run and never printed), then drives it over HTTP: health and
readiness, the OpenAPI document and `/v1/docs`, `/.well-known/fairsplit-keys.json`, a judge session, every IC-01
command through the typed client (a success must parse with the contract, a refusal must be one of the command's
listed codes; a 501, a 500 or drift fails), the run, workspace, line and Proof streams (each event parsed as a
`RunEvent`), `/ops` sign-in, a brand link, the judge code and Reset. `--url <origin>` smokes a running server,
`--sim-url <origin>` points the rail at a running simulator, `--json <file>` writes the report.

`pnpm build` bundles `dist/index.js` (tsdown inlines the `@fairsplit/*` packages); Render starts
`node apps/api/dist/index.js` and binds `0.0.0.0:$PORT`. SIGTERM drains: streams end (clients replay from
`Last-Event-ID`), the outbox dispatcher finishes in-flight tasks, connections close.

## PayPal rail (ADR-0002)

`PP_MODE=simulator` (default) or `PP_MODE=sandbox`. The code above `src/paypal/mode.ts` is identical in both: same
OAuth, HTTP client, webhook verifier, toolkit and payouts code, same sandbox base URL. In simulator mode requests
for PayPal's sandbox hosts go to a running simulator (`PP_SIM_URL`, WS-PPSIM's `tools/paypal-sim.ts`) or, if none,
to a **labelled stub** that answers every call `503 SIMULATOR_NOT_RUNNING` (nothing pretends to pay). Placeholder
REST credentials are used, so simulator mode needs no secret. Every `/v1` response carries `X-FS-Rail: simulated`
or `sandbox`, and every PayPal-derived row and event carries `simulated_rail` or `live` provenance (I8).

Every PayPal attempt takes a slot of WS-DATA's shared Postgres limiter (`paypalCoreLimiter`, 40 a minute across
services, the 6-minute circuit after a 429) and completes its `paypal_calls` row; a verified webhook's transmission
id is claimed in `webhook_transmissions` (`createWebhookTransmissionStore`), so a replayed delivery is refused in
every process. Invoices are sent only as IC-02 `canonicalInvoiceCall(...).args`, the very object the policy lattice
decided (`money/policy.ts` `decideInvoiceCall`); payouts only through WS-PPMONEY's `PayoutsService` on
`money/payouts.ts`'s repository, whose compare-and-sets (`writeSubmitted` APPROVED → POSTING only under the
approvals checked, `voidApprovals` only while every live approval is named) are pinned on Postgres by
`money/posting-cas.pg.test.ts`.

## Configuration

Names only; values live in `.env` (gitignored) locally and per-service `sync: false` keys on Render. Never commit,
print or log a value. `src/env.ts` parses everything once with zod and lists every problem at once, naming the
variable and never its value.

**Boot refuses** when `PP_ENV` (or `PAYPAL_ENV`) is anything but `sandbox` (or is missing in production);
`PP_DEV_MOCKS` is on while `RENDER=true` or `NODE_ENV=production`; `PP_MODE=sandbox` lacks `PP_CLIENT_ID`,
`PP_CLIENT_SECRET` or `PP_WEBHOOK_ID`; production lacks `DATABASE_URL`, `FS_COOKIE_SECRET` or `FS_LINK_SIGNING_KEY`;
a key is malformed; a PayPal e-mail setting (`PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_UNCLAIMED_RECEIVER`, each
`PP_RECEIVERS` entry, and the brand allowlist built from them) is not a strict printable-ASCII address (domain
`requireAsciiEmail`); `PP_CERT_ALLOW` names something that is not a PayPal cert id; `EXECUTOR=workflow` lacks
`RENDER_API_KEY`; or the database role can UPDATE or DELETE
`run_events`, `ledger_entries` or `agent_sessions` (checked on connect; `FS_ALLOW_OWNER_ROLE=1` records the S6
owner-role fallback).

| Variable                                                                                         | Meaning                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `RENDER`, `PORT` (8787), `HOST`, `LOG_LEVEL`, `PUBLIC_ORIGIN` (or `PUBLIC_BASE_URL`) | Process basics; the public origin builds pairing URLs and decides `Secure` cookies and HSTS                 |
| `DATABASE_URL`, `LISTEN_DATABASE_URL`, `DB_POOL_MAX`, `FS_ALLOW_OWNER_ROLE`                      | The `fs_app` pool and the one direct LISTEN connection                                                      |
| `PP_ENV`, `PP_MODE`, `PP_SIM_URL`, `PP_DEV_MOCKS`                                                | PayPal environment (always `sandbox`) and rail mode                                                         |
| `PP_CERT_ALLOW` (or `PAYPAL_CERT_ALLOW`)                                                         | PayPal webhook cert ids (or sandbox cert URLs) the verifier pins, at most 8                                 |
| `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID` (secrets)                                    | Sandbox REST app and webhook id (`PAYPAL_*` spellings also read)                                            |
| `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS`, `PP_UNCLAIMED_RECEIVER`                   | Sandbox account addresses (`PAYPAL_BUSINESS_EMAIL`, `PAYPAL_BUYER_EMAIL`, `PAYPAL_MEMBER_EMAILS` also read) |
| `FS_COOKIE_SECRET` (secret, ≥ 32 chars)                                                          | Root of every HMAC subkey: judge cookie `fs_js`, operator cookie `fs_ops`, daily IP hashing                 |
| `FS_LINK_SIGNING_KEY` (secret, Ed25519 seed, 64 hex)                                             | Signs member links `/s/:token` and brand links `/b/:token`                                                  |
| `FS_LEDGER_SIGNING_KEY` (secret, Ed25519 seed, 64 hex)                                           | Signs ledger checkpoints; absent in dev → an ephemeral key published as `seeded`, so Proof reads "Sample"   |
| `FS_OPERATOR_PASSWORD_SCRYPT` (secret)                                                           | scrypt hash of the operator password for `/ops/login`                                                       |
| `JUDGE_CODE_SHA256`, `CRON_SECRET` (secrets)                                                     | Judge-code bucket; constant-time cron check                                                                 |
| `ANTHROPIC_API_KEY` (secret)                                                                     | Read only through `@fairsplit/ai`'s gateway (live only in dev; Judge Mode replays)                          |
| `EXECUTOR` (`inline` \| `workflow`), `RENDER_API_KEY` (secret), `FS_TASKS_SLUG`                  | Outbox executor; Workflows hand-off                                                                         |
| `FS_KILL` (`payouts,paypal_live,ai_live`), `KILL_PAYOUTS`, `KILL_PAYPAL_LIVE`, `KILL_AI_LIVE`    | Kill switches forced on everywhere (read fresh, never cached)                                               |
| `FS_REPO_ROOT`, `STATIC_CONSOLE_DIR`, `STATIC_APP_DIR`, `STATIC_MEDIA_DIR`                       | Static directories (default: `apps/console/dist`, `apps/mobile/dist`, `media/public`)                       |

Outside production a missing `FS_COOKIE_SECRET` or `FS_LINK_SIGNING_KEY` becomes an ephemeral key (sessions and
links end on restart) and boot logs a warning. `.env.example` belongs to WS-QA and should gain the four `FS_*`
names above.

## Security at the boundary

- The workspace always comes from the credential (frame/console token `fst_`, device token `fsd_`, judge cookie,
  member/brand link, operator cookie); bearer tokens are stored as sha256 and never travel in URLs, except the two
  signed links, which access logs redact.
- Every response: `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`, COOP/CORP same-origin,
  HSTS on https; HTML gets a same-origin CSP with `frame-ancestors 'self'` (the Judge stage frames its own phones);
  API responses get `default-src 'none'` and `Cache-Control: no-store`; `/judge`, `/p`, `/b`, `/s`, `/ops` are
  `noindex`.
- Errors are IC-01 `ApiError` bodies with the code's status, the request id, and `Retry-After` when there is one;
  an unexpected error is a 500 whose message is logged, never sent.
- pino JSON logs redact authorization, cookies, tokens, passwords, signatures and raw bodies.
