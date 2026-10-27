# @fairsplit/tasks: Workflows entry, cron plan and inline executor

Owner: WS-OPS. This package wires the IC-01 `TaskName` registry to executors. It holds no business logic:
each task is a thin wrapper that validates its ids, reads the kill flags and calls a handler injected
from the owning workstream (`src/wiring.ts`).

| Entry           | Built file       | Who runs it                                                                                                                                                                 |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`  | `dist/index.js`  | Render Workflows (`fs-tasks`). Boot checks, then registers S3.3's three Workflows tasks (`extract`, `readRateCard`, `warmCaches`) plus the `opsPing` and `opsDbPing` probes |
| `src/inline.ts` | `dist/inline.js` | Local runs and CI (`EXECUTOR=inline`), for any of the 16 TaskNames: `corepack pnpm --filter @fairsplit/tasks inline <task> <outboxId>`                                      |
| `src/cron.ts`   | `dist/cron.js`   | The hourly plan, as a tested reference for fs-api's `/internal/cron/tick`, and a CLI: `node apps/tasks/dist/cron.js --plan --at=<iso>`                                      |

On Render, `fs-cron` runs `tools/cron-tick.mjs`, a dependency-free script that POSTs fs-api's
`/internal/cron/tick` over the private network (approved S3.3, S3.14). fs-api enqueues the plan.

The app exports nothing: apps are siblings in the dependency rule, so fs-api must not import it.
`src/handoff/` (the dispatcher side of S3.3 and the Render idempotency key) and `src/db-env.ts` (boot-time
database credentials) are tested references for WS-DATA and WS-API to lift into `packages/outbox`,
`packages/db` and `apps/api` as file moves.

**Build.** `tsdown` bundles the three entries. It inlines every `@fairsplit/*` package (they export
TypeScript source and have no build step) and leaves npm dependencies external. `test/bundle.test.ts`
runs the built `dist/index.js` under a fake Workflows host that speaks the SDK's socket protocol.

**Files next to a package's source.** packages/ai loads its prompts with
`new URL("./prompts/", import.meta.url)` and packages/db finds `../migrations` the same way. Rolldown
leaves `import.meta` alone, so once inlined those would resolve under `dist/` (ENOENT, and every
`./prompts/` folder would become the same one). `build/inline-import-meta.ts` therefore makes
`import.meta.url`, `.filename`, `.dirname` and `.main` in every inlined module describe its source file,
as Node does unbundled, and fails the build on any other use (`import.meta.resolve`, the bare object).
The paths are relative to `dist/`, so the bundle runs inside the checkout it was built from, which is
how Render runs it (the external npm dependencies need that checkout's `node_modules` too). The app's
own modules keep the chunk's `import.meta`: the entries compare it with `process.argv[1]`. Because the
prompts are read at deploy time, `render.yaml` never ignores `*.md` files; only tests and READMEs are
skipped (`checkIgnoredPaths` in `tools/lib/blueprint.ts`).

## Task contract

- Arguments are **outbox ids only** (S3.3), never payloads, so nothing can reach Workflows' 4 MB input cap.
- **Entry guards** (`src/invoke.ts`, the one wrapper every executor uses):
  1. run the entry's role check (`src/app-role.ts`, S3.4), once per process, before its first task. A
     role that can UPDATE `ledger_entries` refuses every task permanently (`BOOT_REFUSED`); a check that
     cannot reach the database, or finds it unmigrated, fails the run and is asked again by the next;
  2. validate the ids;
  3. read the kill flags fresh (`FS_KILL` united with the workspace's `system_flags`, S3.11). Only
     `kill_payouts` refuses at entry: `postPayoutBatch`, `cancelUnclaimed` and `reroute`, while posted
     batches keep settling. A flag read that throws fails the run (fail closed);
  4. call the handler with the flag set in `TaskInvocation.flags`. `kill_paypal_live` means a labelled
     replay in Judge Mode and a refusal in a real workspace, which only the handler can tell apart:
     `paypalLane(flags, workspaceKind)`. `kill_ai_live` means replay only: `aiLane(flags)`.
- A handler returns `{status: "done" | "skipped" | "failed", mode?: "live" | "replay"}`. `skipped` means
  the optimistic claim found the row already taken: the normal result of a duplicate dispatch.
- **Permanent failures reach the outbox.** A `PermanentTaskError` (`NOT_WIRED`, `INVALID_INPUT`,
  `KILL_SWITCH`, `BOOT_REFUSED`, …) is written with `OutboxPort.markFailed(id, code, detail)` for each
  id, then returned as `failed`. If that write fails, the run throws instead of reporting success.
  Transient errors are rethrown.

## Retry model

1. **Within one run** (Workflows lanes only): Render retries a thrown attempt as a new attempt of the
   same task run, twice, after 5 s and 10 s (`RENDER_RETRY`). The retry does useful work when the failed
   attempt left the row claimable: it failed before the claim (boot, runtime, role check, database
   reach: the row is still `dispatched`), or the runner gave the row back, as WS-DATA's runner does on
   a handler failure (back to `queued` with backoff). Otherwise the retry's claim exits `skipped`,
   which is safe.
2. **Across runs:** the outbox re-queues the row and the dispatcher starts a **new** run. Render returns
   the first run for an idempotency key repeated within 24 h, so the key is scoped to the dispatch attempt
   (`renderIdempotencyKey(outboxIds, attempt)`), never the bare dedupe key.
3. **Pickup fallback** (`runWithFallback`): if `startTask` throws, the run is not `running` within 20 s,
   or Render reports it `failed` or `canceled` before it was ever seen running, the task runs inline.
   The Workflows run is never cancelled: it may already hold the claim and be part-way through its
   effects, and the claim makes the late duplicate harmless.
4. **Sweeper** (S3.3, the same 5 minutes for every task): a row `dispatched` for 5 minutes without a
   claim, or `running` for 5 minutes without a heartbeat, is re-queued; it is `dead` after 8 attempts.
   The claim heartbeats while its handler runs (WS-DATA's runner, every 30 s), so a long attempt is
   never swept; a timeout only bounds an attempt that hangs. A hung live read (`extract`, 300 s) is back
   in the queue within 10 minutes (`hungAttemptRequeuedAfterMs`), a crashed one 5 minutes after its
   last heartbeat. `test/retry-model.test.ts` drives the real wrappers through a fake Render that keeps
   both rules.

| Lane (`TASK_POLICY`) | Tasks                                                                                                                                                                   | With `EXECUTOR=workflow`                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `inline-api`         | ensureInvoice, recordPayment, processWebhook, postPayoutBatch, settleBatch, cancelUnclaimed, reroute, computeRun, explain, agentTurn, pushNotify, reconcile, judgeReset | inline in fs-api: one warm OAuth cache     |
| `workflow-live`      | extract, readRateCard                                                                                                                                                   | Workflows when live; inline when replaying |
| `workflow-scheduled` | warmCaches                                                                                                                                                              | Workflows; enqueued by the hourly tick     |

`chooseExecutor` also keeps every AI lane inline while the dispatcher's own fresh flags carry
`kill_ai_live`, so a lagging `FS_KILL` on fs-tasks can never run a live Claude call. fs-tasks holds no
PayPal credentials and does not register the inline lanes: a stray `startTask` for one is refused before
Render is called.

## Hourly plan (fs-cron at :07 UTC → `/internal/cron/tick`)

Each tick offers every job that is due. `enqueue` is `ON CONFLICT (dedupe_key) DO NOTHING`, so the first
successful tick in a slot creates the row, and a missed or failed tick is made up by the next one.

| Offered on                    | Job                                              | Dedupe key (one row per)            |
| ----------------------------- | ------------------------------------------------ | ----------------------------------- |
| every tick                    | `judgeReset{trigger:"cron"}`                     | `judgeReset:cron:{yyyy-mm-ddThh}`   |
| ticks from 02:00 to 05:59 UTC | `reconcile{mode:"nightly"}` (Transaction Search) | `reconcile:nightly:{date}`          |
| every tick                    | `warmCaches{window}`                             | `warmCaches:w{floor(hourIndex/23)}` |

Webhook catch-up (`reconcile{mode:"catchup"}`) runs once per fs-api boot (S3.6.5), keyed by the boot's
UTC hour, not from the tick. warmCaches uses 23-hour windows because compiled grammars expire 24 h after
their last use (S4). The args and keys live in the contracts shim (`TASK_KEYS`) as a proposal for WS-CORE.

`tools/cron-tick.mjs` sends `POST /internal/cron/tick` with `Authorization: Bearer $CRON_SECRET` and
`{"at": "<iso>"}`. It exits 0 on 2xx, and on 429 (fs-api already took a tick in this half hour); it retries
connection errors and 5xx twice and never follows a redirect with the secret.

## Deploying (render.yaml)

1. **New → Blueprint**, from the `deploy` branch. Render creates `fs-db` (Postgres 18, `0.1c-256mb`),
   `fs-api` (web, `0.5c-512mb`, `/healthz`), `fs-tasks` (workflow) and `fs-cron` (`7 * * * *`), all in
   `virginia`, each with `NODE_VERSION=24.22.1`. There is no environment group (S3.13).
2. Render prompts once for each `sync: false` value:
   - **fs-api:** `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID`, `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`,
     `PP_RECEIVERS`, `PP_UNCLAIMED_RECEIVER`, `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `EXPO_PUSH_TOKEN`,
     `OPS_PASSWORD_SCRYPT`, `JUDGE_CODE_SHA256`, and `FS_KILL` (leave empty);
   - **fs-tasks:** `ANTHROPIC_API_KEY` and `FS_KILL` (leave empty).
   - **Generated:** `FS_APP_DB_PASSWORD`, `STATEMENT_SIGNING_KEY`, `COOKIE_KEY` and `CRON_SECRET`, on
     fs-api, shared with the others through `fromService`.
   - Render ignores `sync: false` keys added later, so set any later secret in the Dashboard by hand.
3. **PayPal rail (ADR-0002).** `PP_MODE: simulator` runs the contract-faithful simulator, labelled as a
   simulated rail. Once sandbox credentials exist, change that one line to `sandbox`.
4. **Database roles (S3.4, register §7).** fs-api holds the owner's URL only as `DATABASE_OWNER_URL`,
   which `@fairsplit/db migrate` reads in the preDeployCommand (on Render it never reads `DATABASE_URL`).
   Migrate creates `fs_app` with LOGIN, or resets its password, from `FS_APP_DB_PASSWORD`, so the first
   deploy needs no manual step. No service declares `DATABASE_URL`: fs-api's boot builds fs_app's from the
   owner URL's host, port and database and then deletes the owner URL from `process.env`
   (`useAppDatabaseUrl`, the reference for WS-API); fs-tasks builds it from `FS_DB_HOST`, `FS_DB_PORT`,
   `FS_DB_NAME` and the shared password, and never sees the owner's credentials. Both refuse to start on
   an ambiguous or half-set environment, and refuse to run a task as a role that can UPDATE
   `ledger_entries`. This layout departs from the S3.14 snippet; ADR-0005 records why.
   - **Residual risk (ADR-0005):** deleting the owner URL from `process.env` does not erase it from the
     process's initial environment (`/proc/self/environ`), so code execution or a file read in fs-api
     could still recover it. `fs-db` therefore sets `ipAllowList: []`: Render then refuses every
     external connection, so a leaked owner URL works only from inside the private network. For `psql`,
     open a Shell on fs-api in the Dashboard.
   - If S6 finds that workflows do not receive `fromService` values, copy fs-api's `FS_APP_DB_PASSWORD`
     to fs-tasks by hand; fs-tasks refuses to boot until it has one.
   - If S6 finds that the owner cannot `CREATE ROLE`, migrate fails the deploy. The S3.4 fallback (the
     app runs as the owner, with delete-guard triggers) needs an ADR first.
5. **Kill switch.** `system_flags` is the runtime authority. `FS_KILL` is the deploy-wide override and
   must hold the same value on fs-api and fs-tasks; `opsPing` reports fs-tasks' value.
6. Every service deploys on `checksPass`. From 1 to 15 Dec, promote hotfixes by hand (S3.14).
7. Build filters cover each service's workspace dependency closure and every file its commands run;
   `test/render-blueprint.test.ts` derives both. fs-api also rebuilds on `apps/tasks/**`, because the
   executor lanes must match its dispatcher.
8. After the first deploy:
   - `corepack pnpm exec tsx tools/spike-s6.ts --live` measures S6: the `startTask` p50 (10 s or less,
     else `EXECUTOR=worker`), fs-db reach from the workflow as fs_app (which also proves the owner could
     create fs_app), and that fs_app can neither create roles nor UPDATE `ledger_entries`. It states
     whether the verdict covers the full Blueprint or fs-tasks only, until `@fairsplit/api` can build and
     `@fairsplit/db` has `migrate`.
   - `corepack pnpm exec tsx tools/health-check.ts --origin=https://<host>`.

Render's health check is `/healthz` (liveness). `/readyz` depends on PayPal and the webhook registration,
which a restart cannot fix, so the health check and `uptime.yml` watch it instead.

## Tools (WS-OPS)

- `tools/verify.ts`: the clean-clone gate (G7). Clones the committed HEAD and runs `install
  --frozen-lockfile`, `typecheck`, `test` and `build` with a scrubbed environment (no API keys, PayPal or
  database credentials, kill flags or `FS_*` settings). The Postgres tier runs on packages/db's embedded
  Postgres; `--db=<url>` uses a server instead (as `FS_TEST_DATABASE_URL`, test step only, never printed).
  The test step reports skipped tests per package.
- `tools/health-check.ts`: `/healthz`, `/readyz`, `PP_ENV` (unset fails, as at boot), `PP_MODE`, the
  token's exact scopes, webhook registration and drift, and the sandbox balance (warn under US$10k, fail
  under US$5k). At most 3 PayPal calls; prints only non-secret facts. On the simulator the PayPal checks
  are skipped and labelled. **The REST apps need List Balances ticked** (scope
  `https://uri.paypal.com/services/reporting/balances/read`), not only Transaction Search as register §8
  and S1 list; without it the balance call returns 403 and the US$5k guard is blind.
- `tools/scan-dist.ts`: the last step of fs-api's build (S3.13). Fails if any secret env value (8+
  characters) or a PayPal, Anthropic, Render or Google key shape reaches `apps/*/dist`. Prints names, never values.
- `tools/lint-render.ts`: CI's render.yaml lint (S3.17): Render's schema plus the rules above.
- `tools/spike-s6.ts`: Blueprint checks, the entry's cold start under the fake host, live `startTask`
  latency and the `opsDbPing` verdicts. `tools/lib/render-blueprint.schema.json` is Render's published
  schema, vendored; refresh it with `tsx tools/spike-s6.ts --refresh-schema`.
- `tools/cron-tick.mjs`: fs-cron's whole job.

## Shims to swap after WS-CORE merges

`src/_shims/contracts.ts` mirrors the IC-01 `TaskName` registry and proposes `TASK_KEYS`. Replace its
imports with `@fairsplit/contracts` and delete it. `test/registry.test.ts` pins the 16 names
independently, and the entry logs `contractsDrift()` at boot once contracts exports `TASK_NAMES`.

## Requests to other workstreams

- **WS-DATA:** `OutboxPort.markFailed` (idempotent); a `system_flags` `FlagSource`; the `CronSink`; adopt
  `src/handoff/` into `packages/outbox` with a dispatcher-incremented attempt counter for the Render key;
  keep the runner's release on handler failure and the claim's heartbeat (the one 5-minute sweeper
  threshold relies on it: `readRateCard` may run 10 minutes); keep migrate's `DATABASE_OWNER_URL`
  contract, which render.yaml relies on. Once `@fairsplit/db` merges, fs-tasks' role check becomes its
  `assertAppRole`.
- **WS-API (a gate for the first fs-api deploy, ADR-0005):** call `useAppDatabaseUrl` at boot before
  anything reads `DATABASE_URL` (render.yaml gives fs-api only `DATABASE_OWNER_URL`, so without it fs-api
  has no database URL), then the S3.4 role check; serve `/internal/cron/tick` as above; pass the fresh
  flags to `chooseExecutor`; read `FS_TASKS_SLUG`.
- **WS-CORE:** confirm or replace `TASK_KEYS` at the IC-01 freeze.
- **WS-QA:** run `tools/lint-render.ts` in CI; add `.node-version` (`24.22.1`); amend register §8/S1 to
  tick List Balances on both REST apps. (`yaml` 2.9.1 and `ajv` 8.20.0 came through the deps lane,
  `deps/ops-pins`, and are in `docs/versions.md`.)
