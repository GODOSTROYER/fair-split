# @fairsplit/tasks: Workflows entry, cron and inline executor

Owner: WS-OPS. This package wires every IC-01 `TaskName` to an executor. It holds no business logic: each task is a thin wrapper that validates its ids and calls a handler injected from the owning workstream (`src/wiring.ts`).

| Entry           | Built file       | Who runs it                                                                                                               |
| --------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`  | `dist/index.js`  | Render Workflows (`fs-tasks`). Importing it registers all 16 tasks plus the `opsPing` diagnostic                          |
| `src/cron.ts`   | `dist/cron.js`   | Render cron (`fs-cron`, `7 * * * *`). Enqueues the scheduled tasks through the outbox                                     |
| `src/inline.ts` | `dist/inline.js` | Local runs and CI (`EXECUTOR=inline`): `corepack pnpm --filter @fairsplit/tasks inline <task> <outboxId>`                 |
| `src/lib.ts`    | (source export)  | fs-api's dispatcher: `createInlineExecutor`, `createWorkflowExecutor`, `runWithFallback`, `chooseExecutor`, `TASK_POLICY` |

## Task contract

- Arguments are **outbox ids only** (S3.3). The wrapper refuses anything that isn't a short id, so a payload can never reach Workflows' 4 MB input cap.
- A handler returns `{status: "done" | "skipped" | "failed"}`. `skipped` means the optimistic claim found the row already taken, which is the normal result of a duplicate dispatch.
- If a handler throws `PermanentTaskError`, the wrapper returns `failed` with the error's code, so Render doesn't spend retries on it. The run still shows as succeeded in Render's dashboard; the outbox row records the real state. Any other error is rethrown, and Render retries it under the task's policy.
- Until a workstream's handler is wired in, its tasks fail with `NOT_WIRED`.

| Lane (`TASK_POLICY`) | Tasks                                                                                                            | Executor when `EXECUTOR=workflow`            | Render retry       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------ |
| `inline-api`         | ensureInvoice, recordPayment, processWebhook, postPayoutBatch, settleBatch, cancelUnclaimed, reroute, pushNotify | inline in fs-api (warm OAuth cache)          | 2 retries, 5 s × 2 |
| `workflow-live`      | extract, readRateCard, computeRun, explain, agentTurn                                                            | Workflows when live, inline in replay        | 3 retries, 2 s × 2 |
| `workflow-scheduled` | reconcile, judgeReset, warmCaches                                                                                | Workflows, started via the outbox by fs-cron | 1 retry, 30 s      |

`runWithFallback` starts `fs-tasks/<name>` with the outbox dedupe key as Render's `idempotencyKey`. If `startTask` throws, or the run is not `running` within 20 s, it cancels the run and runs the task inline. A late duplicate is safe because handlers claim their row.

## Cron schedule (`fs-cron`, hourly at :07 UTC)

| When                               | Job                                              | Dedupe key                        |
| ---------------------------------- | ------------------------------------------------ | --------------------------------- |
| every pass                         | `judgeReset{trigger:"cron"}`                     | `judgeReset:cron:{yyyy-mm-ddThh}` |
| every pass                         | `reconcile{mode:"catchup"}` (webhook catch-up)   | `reconcile:catchup:{hour}`        |
| 02:07 UTC                          | `reconcile{mode:"nightly"}` (Transaction Search) | `reconcile:nightly:{date}`        |
| every 23 h (`hourIndex % 23 == 0`) | `warmCaches`                                     | `warmCaches:w{n}`                 |

warmCaches runs every 23 h, not nightly, because compiled grammars expire 24 h after their last use (S4). The cron holds only `DATABASE_URL`. Until WS-DATA wires `loadCronSink()`, it logs the plan and exits 1, so the Render run shows as failed instead of silently doing nothing. `node apps/tasks/dist/cron.js --plan --at=<iso>` prints any hour's plan.

## Deploying (render.yaml)

1. In Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml`, creates `fs-db` (Postgres 18, `0.1c-256mb`), `fs-api` (web, `0.5c-512mb`), `fs-tasks` (workflow) and `fs-cron`, all in `virginia`.
2. Render prompts once for every `sync: false` value. A secret is declared on each service that needs it, because Render environment groups cannot hold `sync: false` values, so enter it once per service:
   - **fs-api:** `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID`, `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS`, `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `STATEMENT_SIGNING_KEY`, `EXPO_ACCESS_TOKEN`, `FS_KILL`.
   - **fs-tasks:** the `PP_*` four, `ANTHROPIC_API_KEY`, `STATEMENT_SIGNING_KEY`, `EXPO_ACCESS_TOKEN`, `FS_KILL`.
   - **fs-cron:** none.
   - `BETTER_AUTH_SECRET` is generated by Render.
   - Leave `FS_KILL` empty unless you want to force a kill flag.
3. fs-api gets `FS_TASKS_SLUG` from `fromService … property: slug`, so task slugs follow whatever slug Render assigns.
4. Migrations run in fs-api's `preDeployCommand` only; Blueprint workflows accept no `preDeployCommand`. Keep migrations expand-then-contract.
5. Every service deploys on `checksPass`. From 1 to 15 Dec, set `autoDeployTrigger: off` and promote hotfixes manually.
6. After the first deploy, record the real `onrender.com` host in `docs/sandbox.md` (WS-QA), then run:
   - `corepack pnpm exec tsx tools/spike-s6.ts --live` to measure S6: startTask p50 must be 10 s or less, otherwise set `EXECUTOR=worker`;
   - `corepack pnpm exec tsx tools/health-check.ts --origin=https://<host>` to check health.

Render's health check is `/healthz` (liveness). `/readyz` depends on PayPal and the webhook registration, and a platform restart can't fix those, so `tools/health-check.ts` and the uptime job watch it instead.

## Tools (WS-OPS)

- `tools/verify.ts`: the clean-clone gate (G7). It clones the committed HEAD, then runs `install --frozen-lockfile`, `typecheck`, `test` and `build`, with no credentials in the environment.
- `tools/health-check.ts`: `/healthz`, `/readyz`, `PP_ENV`, token scope, webhook registration and drift, and sandbox balance (warn under US$10k, fail under US$5k). It makes at most 3 PayPal calls and prints only non-secret facts.
- `tools/spike-s6.ts`: Blueprint schema and policy checks, the entry's cold start under a fake workflow host (`tools/lib/fake-workflow-host.ts`, which speaks the SDK's socket protocol), and live startTask latency.
- `tools/lib/render-blueprint.schema.json`: Render's published Blueprint schema, vendored. Refresh it with `tsx tools/spike-s6.ts --refresh-schema`.

## Shims to swap after WS-CORE merges

`src/_shims/contracts.ts` mirrors the IC-01 `TaskName` registry. Replace its imports with `@fairsplit/contracts` and delete the file. `test/registry.test.ts` pins the 16 names independently, so any drift fails the build.
