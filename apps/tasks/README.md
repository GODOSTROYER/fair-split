# @fairsplit/tasks: Workflows entry, cron and inline executor

Owner: WS-OPS. This package wires every IC-01 `TaskName` to an executor. It holds no business logic: each task is a thin wrapper that validates its ids and calls a handler injected from the owning workstream (`src/wiring.ts`).

| Entry           | Built file       | Who runs it                                                                                                               |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`  | `dist/index.js`  | Render Workflows (`fs-tasks`). Refuses to boot unless `PP_ENV=sandbox`, then registers all 16 tasks plus the `opsPing` and `opsDbPing` diagnostics |
| `src/cron.ts`   | `dist/cron.js`   | Render cron (`fs-cron`, `7 * * * *`). Enqueues the scheduled tasks through the outbox |
| `src/inline.ts` | `dist/inline.js` | Local runs and CI (`EXECUTOR=inline`): `corepack pnpm --filter @fairsplit/tasks inline <task> <outboxId>` |

The app exports nothing. Apps are siblings in the dependency rule, so fs-api must not import it.
`src/handoff/dispatcher.ts` (workflow start, 20 s inline fallback, `chooseExecutor`) is WS-OPS's tested
reference for the dispatcher side of S3.3. It is **handed off to WS-DATA**, which owns "outbox with the
inline executor" and `run(name, ids)` (IC-04), and moves to `packages/outbox` as a file move. Until then,
fs-api's `buildFilter` includes `apps/tasks/**` so that a change to task policy redeploys both sides.

**Build.** `tsdown` (`tsdown.config.ts`) bundles the three entries. It inlines every `@fairsplit/*`
package, because they export TypeScript source with `.js` specifiers and have no build step, and it
leaves npm dependencies external. `test/bundle.test.ts` builds the bundle, checks that no workspace
import survives, and runs `dist/index.js` under the fake workflow host. A probe package shaped like
WS-CORE's proves that the config, and not just today's empty contracts, is what makes it work.

## Task contract

- Arguments are **outbox ids only** (S3.3). The wrapper refuses anything that isn't a short id, so a payload can never reach Workflows' 4 MB input cap.
- **Entry guards** (`src/invoke.ts`, the one wrapper every executor uses):
  1. The ids are validated.
  2. The kill flags are read fresh. `FS_KILL=payouts` refuses `postPayoutBatch`, `cancelUnclaimed` and `reroute`, while posted batches keep settling. `paypal_live` also refuses `ensureInvoice`. `ai_live` refuses nothing here, because ClaudeGateway switches to replay. WS-DATA's per-workspace `system_flags` read joins through `anyFlag`. If a flag read throws, the run fails closed.
  3. The handler runs.
- A handler returns `{status: "done" | "skipped" | "failed"}`. `skipped` means the optimistic claim found the row already taken, which is the normal result of a duplicate dispatch.
- **Permanent failures reach the outbox.** If a handler (or a guard) throws `PermanentTaskError` (`NOT_WIRED`, `INVALID_INPUT`, `KILL_SWITCH`, …), the wrapper calls `OutboxPort.markFailed(id, code, detail)` for each id and then returns `failed`. That stops the sweeper from re-dispatching the row. If that write fails, the run throws instead of reporting success. WS-DATA implements the port as an idempotent `UPDATE task_outbox SET state='dead', last_error=… WHERE id=$1 AND state<>'done'`. A handler that returns `failed` itself must record the row itself.
- **One retry owner: the outbox sweeper.** S3.3's claim moves the row to `running` before any I/O, so a Render retry after a transient throw would only ever see `skipped`. Every task therefore registers with `maxRetries: 0`. A transient error is rethrown, the Render run shows as failed, and the row stays `running` until the sweeper re-queues it after 5 minutes (dead after 8 attempts). If WS-DATA makes the claim re-entrant (`OR (state='running' AND claimed_by=$taskRunId)`), Render retries can be turned on in `src/policy.ts`.

| Lane (`TASK_POLICY`) | Tasks | Executor when `EXECUTOR=workflow` |
| -------------------- | ----- | --------------------------------- |
| `inline-api` | ensureInvoice, recordPayment, processWebhook, postPayoutBatch, settleBatch, cancelUnclaimed, reroute, pushNotify | inline in fs-api (warm OAuth cache) |
| `workflow-live` | extract, readRateCard, computeRun, explain, agentTurn | Workflows when live, inline in replay |
| `workflow-scheduled` | reconcile, judgeReset, warmCaches | Workflows, started via the outbox by fs-cron |

## Cron schedule (`fs-cron`, hourly at :07 UTC)

Every pass offers every job that is due. `enqueue` is `ON CONFLICT (dedupe_key) DO NOTHING`, so the first *successful* pass in a slot creates the row. A skipped or failed pass is made up by the next one.

| Offered on               | Job                                              | Dedupe key (one row per)            |
| ------------------------ | ------------------------------------------------ | ----------------------------------- |
| every pass               | `judgeReset{trigger:"cron"}`                     | `judgeReset:cron:{yyyy-mm-ddThh}`   |
| every pass               | `reconcile{mode:"catchup"}` (webhook catch-up)   | `reconcile:catchup:{hour}`          |
| passes 02:07 to 05:07 UTC | `reconcile{mode:"nightly"}` (Transaction Search) | `reconcile:nightly:{date}`          |
| every pass               | `warmCaches{window}`                             | `warmCaches:w{floor(hourIndex/23)}` |

warmCaches works on 23-hour windows, not a nightly slot, because compiled grammars expire 24 h after their last use (S4). The args and dedupe-key builders live in the contracts shim (`TASK_KEYS`) as a proposal for WS-CORE to confirm when IC-01 freezes. The cron holds only `DATABASE_URL`. Until WS-DATA wires `loadCronSink()`, it logs the plan and exits 1, so the Render run shows as failed instead of silently doing nothing. `node apps/tasks/dist/cron.js --plan --at=<iso>` prints any hour's plan.

## Deploying (render.yaml)

1. In Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml` and creates `fs-db` (Postgres 18, `0.1c-256mb`), `fs-api` (web, `0.5c-512mb`), `fs-tasks` (workflow) and `fs-cron`, all in `virginia`. Every service runs Node `24.22.1`, from `NODE_VERSION` in the `fs-config` group. A policy test enforces the pin and will read `.node-version` once WS-QA adds the file.
2. Render prompts once for every `sync: false` value. Render environment groups cannot hold `sync: false` values, so each secret is declared on every service that needs it, and you enter it once per service:
   - **fs-api:** `DATABASE_URL`, `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID`, `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS`, `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `STATEMENT_SIGNING_KEY`, `EXPO_ACCESS_TOKEN`, `FS_KILL`.
   - **fs-tasks:** `DATABASE_URL`, the four `PP_*` values, `ANTHROPIC_API_KEY`, `STATEMENT_SIGNING_KEY`, `EXPO_ACCESS_TOKEN`, `FS_KILL`.
   - **fs-cron:** `DATABASE_URL`.
   - `BETTER_AUTH_SECRET` is generated by Render (`generateValue`, a deliberate deviation from S3.13's `sync: false`).
   - Leave `FS_KILL` empty unless you want to force a kill flag.
3. **Database roles (S3.4, register §7).** Only fs-api's `preDeployCommand` connects as the owner, through `DATABASE_OWNER_URL` (`fromDatabase`). **Contract for WS-DATA:** `@fairsplit/db migrate` reads `DATABASE_OWNER_URL`, never `DATABASE_URL`. The migrations create `fs_app` with `REVOKE UPDATE, DELETE ON run_events, ledger_entries, agent_sessions`. After the first deploy, paste `fs_app`'s connection URL (internal host) into `DATABASE_URL` on all three services. A policy test fails if any running service's `DATABASE_URL` is the owner's connection string.
   - For spike S6, before `fs_app` exists, set fs-tasks' `DATABASE_URL` to the owner's *internal* URL. `opsDbPing` then answers both S3.14 questions. Replace it with `fs_app` afterwards.
   - If S6 shows that the owner cannot `CREATE ROLE`, the BEFORE UPDATE/DELETE triggers are the only enforcement. Record that as an ADR (WS-QA owns `docs/`) before pointing `DATABASE_URL` at the owner, and expect the policy test to need the same ADR reference.
4. fs-api gets `FS_TASKS_SLUG` from `fromService … property: slug`, so task slugs follow whatever slug Render assigns.
5. Migrations run in fs-api's `preDeployCommand` only, because Blueprint workflows accept no `preDeployCommand`. Keep migrations expand-then-contract.
6. Every service deploys on `checksPass`. From 1 to 15 Dec, set `autoDeployTrigger: off` and promote hotfixes manually.
7. Build filters cover each service's workspace dependency closure. A test derives the closure from `workspace:` dependencies. fs-cron uses the same paths as fs-tasks (same bundle), and fs-api includes `apps/tasks/**`.
8. After the first deploy, record the real `onrender.com` host in `docs/sandbox.md` (WS-QA), then run:
   - `corepack pnpm exec tsx tools/spike-s6.ts --live` to measure S6. It reports the startTask p50 (must be 10 s or less, otherwise set `EXECUTOR=worker`), whether fs-db is reachable from the workflow over the private network, and whether the database user can `CREATE ROLE`. It also states whether the verdict covers the full Blueprint or **fs-tasks only**: until `@fairsplit/api` has a build script and `@fairsplit/db` has a `migrate` script, fs-api cannot deploy.
   - `corepack pnpm exec tsx tools/health-check.ts --origin=https://<host>` to check health.

Render's health check is `/healthz` (liveness). `/readyz` depends on PayPal and the webhook registration, and a platform restart can't fix those, so `tools/health-check.ts` and the uptime job watch it instead.

## Tools (WS-OPS)

- `tools/verify.ts`: the clean-clone gate (G7). It clones the committed HEAD, then runs `install --frozen-lockfile`, `typecheck`, `test` and `build`, with no credentials in the environment.
- `tools/health-check.ts`: checks `/healthz`, `/readyz`, `PP_ENV`, the token's exact scopes, webhook registration and drift, and the sandbox balance (warn under US$10k, fail under US$5k). It makes at most 3 PayPal calls and prints only non-secret facts. **The REST app must have List Balances enabled** (scope `https://uri.paypal.com/services/reporting/balances/read`), not just Transaction Search. Without it the balance call returns 403, which counts as a failure because the US$5k guard would be blind.
- `tools/spike-s6.ts`: Blueprint schema and policy checks, deploy readiness (full or fs-tasks only), the entry's cold start under a fake workflow host (`tools/lib/fake-workflow-host.ts`, which speaks the SDK's socket protocol), live startTask latency, and the `opsDbPing` database verdicts.
- `tools/lib/render-blueprint.schema.json`: Render's published Blueprint schema, vendored. Refresh it with `tsx tools/spike-s6.ts --refresh-schema`.

## Shims to swap after WS-CORE merges

`src/_shims/contracts.ts` mirrors the IC-01 `TaskName` registry and proposes `TASK_KEYS` (args and dedupe keys for the three scheduled tasks). Replace its imports with `@fairsplit/contracts` and delete the file. `test/registry.test.ts` pins the 16 names independently, and the entry logs `contractsDrift()` at boot once contracts exports `TASK_NAMES`.

## Requests to other workstreams

- **WS-DATA:**
  - `OutboxPort.markFailed` (idempotent);
  - a `system_flags` `FlagCheck`;
  - the `CronSink`;
  - `migrate` reading `DATABASE_OWNER_URL`;
  - a no-op `migrate` script before 24 Oct;
  - adopt `src/handoff/dispatcher.ts` into `packages/outbox`;
  - confirm the sweeper-owned retry model, or make the claim re-entrant.
- **WS-API:** a stub `@fairsplit/api` with a `build` script and `/healthz` before 24 Oct, so that S6 can deploy the full Blueprint.
- **WS-CORE:** confirm or replace `TASK_KEYS` at the IC-01 freeze.
- **WS-QA:**
  - add `!pnpm-lock.yaml` to `biome.json` `files.includes`, because Biome reformats pnpm's lockfile and every `pnpm install` rewrites it;
  - record `yaml` 2.9.1 and `ajv` 8.20.0 in `docs/versions.md`;
  - add `.node-version` (`24.22.1`).
