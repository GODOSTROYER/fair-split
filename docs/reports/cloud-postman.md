# Cloud task T6: Postman collection with tests (`cloud/postman`)

Status: **done**. Newman passes locally against the keyless e2e stack: 4 green full runs, 0 failed assertions.

Base: `origin/main` at `3e1ec11`. Workstream: WS-QA (`postman/**`, `packages/test-kit`, `README.md`, `docs/**`).

## Result

The last two runs went back to back through `node postman/run.mjs`, on a shared machine with a load average of 27
to 28 on 4 cores:

| Run (4 Nov, UTC)  | Load (1 min) | Requests | Test scripts | Assertions | Failed | Duration | First press → payout POST |
| ----------------- | -----------: | -------: | -----------: | ---------: | -----: | -------: | ------------------------: |
| 22:01 (newman)    |        19.26 |      123 |          246 |        421 |      0 |   53.0 s |                    17.7 s |
| 22:03 (`run.mjs`) |        18.55 |      125 |          250 |        426 |      0 |   54.1 s |                    19.5 s |
| 22:14 (`run.mjs`) |        28.46 |      124 |          248 |        424 |      0 |   55.1 s |                    21.3 s |
| 22:15 (`run.mjs`) |        27.13 |      125 |          250 |        426 |      0 |   52.6 s |                    19.4 s |

Average response time was 64 to 74 ms; the slowest single response was 907 ms. Reset answered in 85 to 153 ms against a
10 s budget. Request and assertion counts vary by a few between runs because the wait steps poll fs-api until their
condition holds. The collection has 74 distinct requests.

Replay check: I filled the hourly quota with 24 explicitly labelled synthetic reservations (the e2e
`withFullHourlyQuota` approach, on my private stack's database, removed afterwards by exact id). That run was 149
requests and 498 assertions, with **5 failed**, all of them the fs-api labelling bug F1 below. Everything else held
in replay: `INV2-RPLY…`/`RPLY…` ids with `provenance: "replay"`, Proof status `replay`, the payout items plate
`replay`, and 0 PayPal-verified members.

`packages/test-kit/test/postman-collection.test.mjs` passes 19 of 19, the whole test-kit suite 377 of 377 (16
files), and test-kit's typecheck is clean.

## What was built

| Path                                                 | What                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `postman/fair-split.postman_collection.json`         | Postman v2.1 collection, 74 requests in 4 folders (generated)                                                                                                            |
| `postman/build.mjs`                                  | builds the collection from linted JS functions; `--check` fails when the JSON is stale                                                                                   |
| `postman/lib.cjs`                                    | sandbox library: RFC 8032 Ed25519 (BigInt, CryptoJS SHA-512), RFC 8785 JCS, OpenAPI response schemas into the sandbox's draft-07 Ajv, the I8 label scan, Proof verify    |
| `postman/localhost.postman_environment.json`         | `baseUrl` (loopback) plus empty simulator fields that the runner fills                                                                                                   |
| `postman/run.mjs`                                    | runner: loopback and simulated rail only, freshness check, standalone simulator for ERRPYO005, `npx --yes newman@6.2.3`, summary                                         |
| `postman/README.md`                                  | how to run it (CLI and the Postman app), what it checks, how signing works, the limits                                                                                   |
| `packages/test-kit/test/postman-collection.test.mjs` | Ed25519 byte for byte against `node:crypto`, JCS against the domain's `canonicalize`, Proof verify on a bundle signed in the test, the label scan, the runner's refusals |
| `README.md`, "Postman"                               | the exact local steps (PowerShell and POSIX), local keyless stack only                                                                                                   |

Collection coverage:
- **On every response:** `X-FS-Rail: simulated`; the body against the schema from fs-api's own `/v1/openapi.json`
  for that path, method and status; the simulated label on every PayPal-derived value (`INV2-SIM`, `SIM…`,
  `WH-SIM…`, `sim-` debug ids, provenance `simulated_rail`, or `replay` with `RPLY` ids). The simulator's own
  answers must carry `x-fairsplit-simulated: true`.
- **1, the judge's 60-second loop:** session (201, HttpOnly judge cookie), invoice, fund (Mark paid, then its
  Idempotency-Key replay with `Idempotent-Replayed: true` and the same body), read (seeded stand-in, slip 0462 by
  hand, then a replay and a 422 `IDEMPOTENCY_KEY_REUSED`), holds H1 to H3, both demo keys and both approvals, the
  payout POST within 60 s of the press, Rhea to cash, SETTLED with the posted `batchSha256` equal to the signed one
  (I4), Proof metrics and verification (`sample`, six plates, the run's own sample keys), Reset within 10 s, the old
  token refused.
- **2, Proof verify:** recomputed in the sandbox from the published keys alone: 64 line hashes, the lines root, both
  Ed25519 approvals, the batch sum against the signed total and the PayPal lines (I3), the ledger chain from genesis
  and the signed checkpoint. A copy with one cent moved fails, and re-hashing that line breaks both signed roots.
- **3, labelled failure paths:**
  - **3a:** ERRPYO005 gets 422 `INSUFFICIENT_FUNDS` with a `sim-` debug id, and the balance is unchanged.
  - **3b:** `change_payout` armed before key 2: both keys sign, the POST refuses, the run goes back to IN_REVIEW,
    both approvals are void, and every line is READY again.
  - **3c:** an unsigned copy of a stored event, posted twice with one transmission id: both 400, and the event is
    stored once and unchanged.
  - **3d:** a pairing claimed once, then the token, the code and a never-issued token: each gets 410
    `PAIRING_TOKEN_INVALID`.

## Commands and versions

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55436/postgres
corepack pnpm --filter @fairsplit/e2e stack                # E2E_SKIP_BUILD=1 after the first build; fs-api at :40883
node postman/run.mjs --base-url http://127.0.0.1:40883     # newman 6.2.3 via npx
corepack pnpm --filter @fairsplit/api openapi /tmp/…/openapi.json   # the generator (549,524 bytes); 0.2 reads /v1/openapi.json
cd packages/test-kit && corepack pnpm exec vitest run       # 376 + the new cases
```

- newman **6.2.3**, published 9 Oct 2026 (`npm view newman time`), run only through `npx --yes newman@6.2.3`. It
  adds no dependency.
- Node 24.22.1, pnpm 11.28.6, and the PostgreSQL 17.10 server the coordinator provided (port 55436).

## Decisions taken without asking (the safer option)

- **Signing inside the sandbox.** Postman has no Ed25519, so `lib.cjs` implements it (RFC 8032 over BigInt, with
  CryptoJS SHA-512 and CryptoJS's secure random seeds). Each run makes throwaway demo keys, registers them with proof
  of possession and signs fs-api's live payloads. Precomputing could not work (the payload nonce and expiry come from
  the server), and a local signing helper would make the collection depend on more than newman. No key is committed.
  Test-kit pins the implementation to `node:crypto` byte for byte.
- **ERRPYO005 against the standalone simulator.** fs-api has no route that sends PayPal's insufficient-funds test
  value (see F4). 3a calls `tools/paypal-sim.ts`, which the runner starts on loopback, in memory, with the committed
  registry's fictional `fs-judge` app. The runner injects those credentials, so nothing new is committed.
- **Duplicate delivery without forging.** A real duplicate needs the in-process simulator's signing key, which nothing
  outside fs-api can reach. 3c shows the refusal and the one-row dedupe. It does not fake a signature.
- **Pairing reuse, not expiry.** Expiry means waiting 10 minutes. Reuse, code reuse and a never-issued token all give
  the same 410.
- **The OpenAPI document is fetched live (0.2), not committed.** It is 550 KB, and the live copy cannot drift from the
  server it checks.
- **The strict I8 check stays in replay mode.** It fails there because of F1, rather than being relaxed to pass.
- **No money literals.** Money is checked by conservation (per line, the batch against the signed total and the
  PayPal lines) and by display-equals-cents. Counts (64 lines, 7 on PayPal, 4 open and 3 blocking holds) and the
  hand-typed 64.80 mirror E-01's own assertions.
- **Postgres.** The embedded cluster refuses root (`initdb: cannot be run as root`). I first ran the same embedded
  PG17 binaries as the `postgres` user under `.codex-scratch/`. When the coordinator provided a dedicated server, I
  switched to it (`FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55436/postgres`) and stopped my own cluster.
  Processes were stopped by exact PID only, never by pattern. No repository code was changed for this.

## Findings for other workstreams (not edited here)

**F1 (I8, WS-CORE contract plus WS-API): Mark paid labels a replayed step `simulated_rail`.**
`apps/api/src/runs/paypal.ts:95` returns `provenance: "simulated_rail"`, hard-coded. The frozen contract
`MarkPaidResponse` (`packages/contracts/src/api.ts:59`) pins it with `z.literal("simulated_rail")`. On a replayed run
the same answer carries `invoiceId: "INV2-RPLY-…"`, while `GET /v1/runs/:slug` gives the run and the invoice
`provenance: "replay"`. On the real sandbox rail (`PP_MODE=sandbox`) it would also say `simulated_rail` for a live
call. The fix needs an ADR to widen the literal to `Provenance`, then a WS-API change to return the invoice row's
provenance. Repro:
1. Start the e2e stack and fill the hourly cap with labelled filler rows (as `e2e/lib/judge-quota.ts`
   `withFullHourlyQuota` does, 24 rows of `reconciliation_reports`, `entry: "judge_post"`).
2. `node postman/run.mjs --base-url <origin>`. Requests 1.04, 1.05 and 3b.04 fail with
   `'$.provenance=simulated_rail'`.
3. Delete the filler rows.

**F2 (honesty, WS-API or WS-CONSOLE to decide): a replayed payout's lines read `PAID`.** On a replayed run,
`GET /v1/runs/:slug/lines` returns `state: "PAID"` for the 7 PayPal lines, the run summary reads `lines: {PAID: 7,
OFF_RAIL_DUE: 57}`, and Proof metrics' `progress.display` reads "7 of 8 confirmed". In the same run, Proof metrics
say `paid.paypalVerified.members: 0` and `rails.paypalMembers: 0, cashMembers: 64`, even though 7 lines are on rail
`PAYPAL`. The label lives only on the run, invoice and item provenance. The rule that "a replayed payout never reads
as Paid" needs either a replay-specific line state or a guarantee that every surface reading `PAID` also reads the
provenance. Also, the replayed invoice's `payerViewUrl` points at a `INV2-SIME…` simulator invoice, while its
`paypalInvoiceId` is `INV2-RPLY…`. Repro as for F1; inspect 1.26, 1.28b and 1.29 in newman's JSON report.

**F3 (observability, WS-API `apps/api/src/paypal/webhooks.ts`): the `/ops` duplicates counter under-reports.** The
in-process simulator delivers every event twice (`duplicate: true` by default). After 8 runs the stack's database
held 90 `webhook_transmissions` for 45 stored events, so every copy arrived, verified and was deduplicated
correctly. But only 4 `webhook.received {duplicate: true}` run events existed, and `/v1/ops/overview` showed
`duplicates: 0` after a full run. The cause is that `onDuplicate` returns early when the stored row has no
`workspace_id` yet. `insertWebhookEvent` never sets it, and `processWebhook` assigns it later, so a copy that arrives
before processing is not recorded. That is the usual case for back-to-back copies. MM-6's "resent copy" moment
depends on this event. Repro:

```sql
select (select count(*) from webhook_transmissions),
       (select count(*) from webhook_events where status <> 'rejected'),
       (select count(*) from run_events where type = 'webhook.received' and payload->>'duplicate' = 'true');
```

**F4 (spec drift): no route sends PayPal's insufficient-funds test value.** `docs/spec/00-plan.md:188` lists "Send
PayPal's insufficient-funds test value" (a live one-item ERRPYO005 batch, once per session) among "Try to break it",
and register C-07 says ERRPYO005 "runs as a separate 1-item batch in tests and in the What's real sheet". The judge
tamper kinds are only `amount`, `offsetting`, `recipient` and `change_payout` (`apps/api/src/judge/tamper.ts`), and
`apps/console/src/chrome/honesty.test.ts:64` asserts the control is absent. If dropping it was deliberate, the plan
should say so. If not, it needs a route. The collection covers it against the simulator directly (3a).

**F5 (note, Proof cache area, off limits): the checkpoint is re-signed on every read.** `/v1/proof/:slug` and
`/v1/proof/:slug.json` return the same bundle, but `checkpoint.at` and `signatureHex` change on each request (same
`seq` and `entryHash`). The collection compares the bundles without the checkpoint and verifies each read's own
checkpoint. If the Proof cache is meant to serve one signed record, this is worth a look by the hardening branch.

No OpenAPI defect was found. Every documented response the collection received (about 30 operations) validated
against the generated schemas, including error bodies (`ApiError` 410 and 422).

## Open items

- Mark paid's 429 `QUEUED` branch (wait `retryAfterMs`, then re-press with a new Idempotency-Key) never triggered: no
  run was paced, even back to back. `e2e/specs/api/paypal-pacing.spec.ts` covers the server side.
- Expiry of a pairing token is not exercised: it would mean waiting 10 minutes, or a test clock fs-api does not
  expose over HTTP.
- F1 to F4 above.
- The collection is not in CI. It could run in `.github/workflows/e2e.yml` after the Playwright suite
  (`node postman/run.mjs --base-url $ORIGIN`), at about 1 minute and one live payout per run.

## Commits

| SHA       | Commit                                                                                       |
| --------- | -------------------------------------------------------------------------------------------- |
| `9b4b3e2` | docs(qa): skeleton report for the Postman collection task (T6)                               |
| `8f83904` | feat(qa): Postman collection for the judge loop, Proof verify and the labelled failure paths |
| `3d11dfc` | docs(qa): README section on running the Postman collection locally                           |
| `337622e` | feat(qa): Postman collection checks replayed runs by their RPLY labels                       |
| `29d5bfb` | docs(qa): T6 report: newman green locally, four findings for other workstreams               |
| (this)    | docs(qa): T6 report: commit list and final test counts                                       |

All are WS-QA. Each was checked with `node tools/check-ownership.mjs --ws qa --base <sha>^ --head <sha>` before it
was pushed ("all within WS-QA").
