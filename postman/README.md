# Postman collection (local keyless stack only)

`fair-split.postman_collection.json` is a Postman v2.1 collection with `pm.test` assertions for fs-api. It scripts
what the console and the Chair's frame send, in the same order as the e2e API specs (`e2e/specs/api`). It runs
against a **local** fs-api on the simulated PayPal sandbox (`PP_MODE=simulator`) with no keys: every PayPal value is
the simulator's, labelled, and the reading is the seed's labelled stand-in, never a live Claude read. It is not meant
for a hosted demo, and the runner refuses one.

| File                                 | What it is                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `fair-split.postman_collection.json` | the collection; **generated** by `build.mjs`, so edit `build.mjs` and rebuild                    |
| `localhost.postman_environment.json` | the environment: `baseUrl` (loopback) and the standalone simulator's URL and fictional app       |
| `build.mjs`                          | builds the collection; `node postman/build.mjs --check` fails when the JSON is stale             |
| `lib.cjs`                            | the sandbox library: Ed25519, JCS, OpenAPI schema checks, the simulated-label scan, Proof verify |
| `run.mjs`                            | the runner: `npx --yes newman@6.2.3`, plus the standalone simulator for the ERRPYO005 path       |

## Run it

From the repository root, start the stack in one terminal and run the collection in another:

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0                 # PowerShell: $env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"
corepack pnpm --filter @fairsplit/e2e stack              # prints "fs-api up at http://127.0.0.1:<port>"
node postman/run.mjs --base-url http://127.0.0.1:<port>
```

`run.mjs` checks that the origin is loopback http and that `/healthz` reads rail `simulated`, and that the collection
is fresh. It then starts `tools/paypal-sim.ts` on a free loopback port (in memory, with a temporary data directory),
runs newman 6.2.3 (published 9 Oct 2026) with the CLI and JSON reporters, prints the summary and exits with
newman's code. The JSON report goes to `.codex-scratch/postman/`, which is gitignored. It holds the run's short-lived
local tokens, so keep it local. Flags: `--no-sim` skips the ERRPYO005 path, `--out <dir>` moves the report, and
anything after `--` goes to newman (for example `-- --bail`).

In the Postman app: import the collection and the environment, set `baseUrl` to the stack's origin, and run the
collection in order with the runner. The pre-request scripts clear the judge cookie the app's jar keeps, so each run
starts a fresh judge session. For folder 3a, start the simulator yourself (`corepack pnpm exec tsx tools/paypal-sim.ts
--port 4010 --fresh`), set `simBaseUrl` to `http://127.0.0.1:4010`, and copy the `fs-judge` app's `client_id` and
`client_secret` from `packages/paypal-sim/data/accounts.json`. They are fictional, and only the simulator accepts them.
With `simBaseUrl` empty, 3a's requests are skipped.

## What it checks

Every response gets the collection-level checks:
- `X-FS-Rail: simulated` on every `/v1` and `/webhooks` answer;
- the body is validated against the schema that fs-api's own OpenAPI document (`/v1/openapi.json`, fetched in 0.2)
  gives for that path, method and status. The document is JSON Schema 2020-12; `lib.cjs` maps it to the sandbox's
  draft-07 Ajv;
- the simulated label on every PayPal-derived value: invoice ids `INV2-SIM…`, payout items and batches `SIM…`,
  webhook events `WH-SIM…`, debug ids `sim-` plus 12 hex digits, and `provenance` `simulated_rail` (or a labelled
  `replay`) on every object that carries a PayPal id. The simulator's own answers must carry
  `x-fairsplit-simulated: true`.

| Folder                       | Requests                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Setup                      | health, the OpenAPI document, the public lane                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 1 The judge's 60-second loop | first press (201, HttpOnly judge cookie), rail and quota decision, INVOICED, Mark paid and its idempotent replay, the reading to IN_REVIEW, slip 0462 by hand (idempotent replay, then 422 `IDEMPOTENCY_KEY_REUSED`), H1 to H3, both demo keys and both signatures, the payout POST within 60 s of the press, Rhea's parked line to cash, SETTLED with the posted batch equal to the signed batch, Proof metrics and fs-api's verification, Reset within 10 s, the old token refused                                                                                       |
| 2 Proof verify               | the published keys, then the public Proof bundle recomputed in the collection: 64 line hashes, the lines root, both Ed25519 approvals, the batch against the signed payload, the hash chain from genesis and the signed checkpoint. A copy with one cent moved on one line must fail, and re-hashing that line must break both signed roots                                                                                                                                                                                                                                |
| 3 Labelled failure paths     | **3a** PayPal's ERRPYO005 test value (422 `INSUFFICIENT_FUNDS`, `sim-` debug id, balance unchanged). **3b** a second press, the review again, `change_payout` armed before key 2: both keys sign, the POST refuses, the run goes back to review and both approvals are void. **3c** a stored webhook event posted again without PayPal's signature, twice with one transmission id: both 400, the event is stored once and unchanged. **3d** a pairing claimed once, then the same token, its code and a never-issued token, each refused with 410 `PAIRING_TOKEN_INVALID` |

Polling steps (waiting for a run state, for Proof's PayPal-verified count) re-run themselves every 0.5 to 1 s
through `pm.execution.setNextRequest` until their condition holds or their limit passes, and only then assert. They
poll fs-api, never PayPal. The request and assertion counts therefore vary a little from run to run. A Mark paid that
PayPal's window paces (429 `QUEUED`) waits the `retryAfterMs` it names and asks again with a new Idempotency-Key.

## How the officers sign

Approvals are Ed25519 signatures over the JCS form of the approval payload fs-api hands out. Postman's sandbox has
no Ed25519 and no `node:crypto`, so `lib.cjs` implements RFC 8032 Ed25519 with BigInt, hashing with the sandbox's
CryptoJS SHA-512. Each run makes two throwaway browser demo keys (CryptoJS's secure random seed, kept only in
collection variables), registers them with proof of possession (`POST /v1/judge/keys`, signing the
`fs.register-demo-key` statement), and signs the payloads. Nothing is precomputed and no key is committed: the
collection stays runnable with newman alone. The library also checks that its own JCS of each payload equals the
`jcs` string fs-api returns. `packages/test-kit/test/postman-collection.test.mjs` checks the library byte for byte
against `node:crypto` and the domain's `canonicalize`, verifies a Proof bundle built in the test, and checks that the
committed collection is what `build.mjs` builds.

## Limits, stated plainly

- **ERRPYO005 is sent to the simulator directly.** fs-api has no route that sends PayPal's insufficient-funds test
  value (the console dropped that "Try to break it" control), so 3a calls the standalone simulator. That proves the
  simulator's contract, not fs-api's handling of the refusal, which its unit tests cover
  (`apps/api/src/money/reroute-rejected.test.ts`).
- **A duplicate delivery is only shown being refused.** A real duplicate needs the simulator's webhook signing key,
  which lives inside fs-api's process. The in-process simulator does deliver every event twice. 3c checks that each
  event is stored once and that an unsigned copy changes nothing. It does not assert the `duplicates` counter on
  `/ops` (see `docs/reports/cloud-postman.md`).
- **Expiry is not waited for.** A pairing lives 10 minutes. 3d tests the reused, code-reused and never-issued cases,
  which answer the same 410 that an expired pairing gets.
- **Quotas.** Each run posts one live (simulated) payout and refuses a second. The stack's hourly cap is 24, but a
  public judge session draws on a daily third (13 on the e2e stack). Past that, fs-api replays the run, labelled. The
  collection reads the rail decision at each press and then expects `replay` provenance, Proof status `replay` and no
  PayPal-verified member: a replayed payout never reads as paid. Restarting the stack gives a fresh database and fresh
  quotas.
