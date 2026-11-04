# DR-4: Linux clean-clone check (cloud task T2)

Branch `cloud/dr4-linux`, cut from `origin/main` at `3e1ec11`. Run on 4 and 5 Nov 2026.

**Verdict.** A stranger on Linux, as a regular user, can follow the README from a fresh clone to a running stack, a
settled judge run and a six-of-six `verify-proof`. Every other step passes too: typecheck, `biome ci`,
`deps:check`, build, the booted smoke (85 of 85), `corepack pnpm e2e` (61 passed, 2 skipped as designed), the
Render build, preDeploy, start and cron commands, and `verify-proof` against both local servers. Three things stop a
stranger, and each now has a fix or a documented way through:
1. **As root, the embedded Postgres cannot start** (`initdb: error: cannot be run as root`). Root is the default
   in Docker and many CI images. Fixed: the harness now fails at once with a message naming the two ways out, and
   the README says it (commits below).
2. **`corepack pnpm test` and `corepack pnpm verify` time out under CPU contention.** This machine ran six agents
   on 4 cores, at load averages of 12 to 47. Each run failed on a different test that hit its timeout:
   `@fairsplit/eval` (3 of 3 full runs), `apps/console` (2 tests) and `packages/api-client` (2 tests). Every one
   passes when rerun alone (table below). There is no Linux-specific failure. One timeout that failed 3 of 3 runs
   got headroom (`packages/eval`); the rest are documented below.
3. **A run stopped during a package's first initdb broke that package's Postgres tests for good.** When one
   package's test fails, turbo stops every running task. If that lands during another package's first initdb, the
   half-made cluster was reused by every later run (`database "postgres" does not exist`, shown only as vite's
   `code.charCodeAt is not a function`) until `.cache/pg` was deleted by hand. R2's flakes trigger exactly this.
   Fixed, tests first: initdb now runs in a scratch directory that becomes the cluster only on success.

No Windows-only assumption breaks Linux: no committed CRLF, no import whose letter case differs from the file, no
shell-specific script, no drive letter outside a test of the Windows branch, and every port is picked free.

## Machine and method

- Ubuntu 24.04.5 LTS (kernel 6.18), 4 cores, 15 GB RAM, shared with five other agents. Load averages are recorded
  with every timing, because they explain every red step.
- Node 24.22.1 (CI and `render.yaml` pin 24.19.0), corepack 0.36.0, pnpm 11.28.6 through corepack, git 2.43.0,
  Playwright 1.64.1 (Chromium build 1248).
- The session runs as root, so the "stranger" ran as the machine's regular user `ubuntu` (uid 1000) under
  `runuser`, with a fresh `HOME` (no corepack cache, no pnpm store, no Playwright browsers) in
  `/tmp/cloud-dr4-linux-stranger/`. Its environment held only `PATH`, `HOME`, the session's egress proxy and its CA
  bundle, and `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. A first attempt as root is recorded separately.
- The fresh clone is `git clone https://github.com/GODOSTROYER/fair-split.git` at `3e1ec11`, followed exactly as
  the README's "Run it locally" section is written, with the POSIX `export` in place of the PowerShell `$env:` line,
  as the README says.

## Wall time per step

All runs as the regular user, in the fresh clone of `3e1ec11` unless noted. Load = 1-minute load average before
the step, then after it. Attempts count reruns made to tell a flake from a break.

| #   | Step                                             | Command                                                                  |                   Wall | Load (before → after) | Result                                                                                              | Attempts |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------ | ---------------------: | --------------------- | --------------------------------------------------------------------------------------------------- | -------: |
| 1   | Long paths (Windows only)                        | `git config --global core.longpaths true`                                |                  0.0 s | 3.5                   | pass (no effect on Linux)                                                                           |        1 |
| 2   | Clone                                            | `git clone https://github.com/GODOSTROYER/fair-split.git`                |                  4.3 s | 3.5 → 3.5             | pass                                                                                                |        1 |
| 3   | Install (empty store, pnpm downloaded)           | `corepack pnpm install --frozen-lockfile`                                |                 21.1 s | 3.4 → 3.2             | pass (1,192 packages, 1.4 GB store)                                                                 |        1 |
| 4   | Stack, as root                                   | `corepack pnpm --filter @fairsplit/e2e stack`                            |      11.2 s to failure | 4.4                   | **fail**: `initdb: error: cannot be run as root`                                                    |        1 |
| 4   | Stack, as the regular user                       | same                                                                     | about 22 s to `ready:` | 3.0                   | pass; console and `/app` built from scratch; Ctrl-C stops all in 4 s                                |        1 |
| 5   | A judge run to SETTLED (scripted, see below)     | `tsx settle.mts http://127.0.0.1:<port>`                                 |                 24.7 s | 3.8 → 3.0             | pass, `2026A-r1` settled in 22.0 s                                                                  |        1 |
| 6   | Proof check against the local stack              | `corepack pnpm verify-proof http://127.0.0.1:<port>/proof/2026A-r1`      |                  1.7 s | 2.9                   | pass: six of six, "Sample, never Verified"                                                          |        1 |
| 7   | Typecheck                                        | `corepack pnpm typecheck`                                                |                148.9 s | 2.9 → 18.7            | pass, 26 of 26 tasks                                                                                |        1 |
| 8   | Every workspace test suite                       | `corepack pnpm test`                                                     |                174.6 s | 18.2 → 41.6           | **fail**: `@fairsplit/eval` timeout; turbo stops                                                    |        2 |
| 8a  | ↳ eval's failing file alone                      | `vitest run src/run.test.ts` (packages/eval)                             |         12.4 s, 13.4 s | 31.7, 28.7            | pass, 4 of 4                                                                                        |        2 |
| 8b  | ↳ eval package alone                             | `corepack pnpm --filter @fairsplit/eval test`                            |                 27.6 s | 11.9                  | pass, 22 of 22                                                                                      |        1 |
| 8c  | ↳ apps/api (stopped by turbo)                    | `corepack pnpm --filter @fairsplit/api test`                             |                509.9 s | 11.7 → 17.3           | pass, 1,064 tests in 116 files                                                                      |        1 |
| 8d  | ↳ apps/console (stopped by turbo)                | `corepack pnpm --filter @fairsplit/console test`                         |                750.3 s | 17.3 → 26.2           | 940 of 942: 2 timeouts                                                                              |        1 |
| 8e  | ↳ the 2 console files alone                      | `vitest run W-BR-01/brand.test.tsx W-TR-07/approve.test.tsx`             |         73.0 s, 62.7 s | 26.4, 26.1            | pass, 29 of 29, twice                                                                               |        2 |
| 9   | Playwright's Chromium (README step)              | `corepack pnpm --filter @fairsplit/e2e exec playwright install chromium` |                 70.5 s | 41.3 → 44.8           | pass: build 1248, headless shell, ffmpeg (681 MB)                                                   |        1 |
| 10  | Biome                                            | `corepack pnpm exec biome ci .`                                          |                 19.4 s | 12.2 → 13.8           | pass (1,999 files; 2 warnings, 1 info, all in `apps/console`)                                       |        1 |
| 11  | Dependency rules                                 | `corepack pnpm deps:check`                                               |                 17.6 s | 13.8 → 14.2           | pass (1,725 modules, 8,136 dependencies)                                                            |        1 |
| 12  | Build                                            | `corepack pnpm build`                                                    |                 10.4 s | 22.5 → 23.2           | pass, 5 of 5 tasks                                                                                  |        1 |
| 13  | Booted smoke                                     | `corepack pnpm --filter @fairsplit/api smoke`                            |                 70.1 s | 22.8 → 25.2           | pass, 85 of 85 checks, IC-01 21 of 21                                                               |        1 |
| 14  | Clean-clone verify (main)                        | `corepack pnpm verify --keep`                                            |                392.9 s | 25.0 → 42.2           | **fail** at test: the same eval timeout                                                             |        1 |
| 15  | E2E, keyless replay                              | `corepack pnpm e2e`                                                      |   1,955.8 s (32.6 min) | 19.8 → 14.4           | pass: api 15, chromium 23 + 1 skipped, reduced motion 23 + 1 skipped                                |        1 |
| 16  | Render fs-api build (a second fresh clone)       | `render.yaml` `buildCommand`, in bash, with its env vars                 |                 24.1 s | 14.2 → 15.9           | pass; `scan-dist: PASS` (336 files, 13 secret values, 5 patterns)                                   |        1 |
| 17  | Render preDeploy                                 | `corepack pnpm --filter @fairsplit/db migrate`                           |                  3.9 s | 15.4                  | pass; fs_app created with LOGIN                                                                     |        1 |
| 18  | Render start, `RENDER=true`                      | `node apps/api/dist/index.js`                                            |        up in about 4 s | 15.0                  | pass: `/healthz`, `/readyz`, `/judge`, `/app/`, `/media/`, OpenAPI all 200; stops on SIGTERM in 2 s |        1 |
| 19  | A judge run on the Render-mode server            | `tsx settle.mts http://127.0.0.1:<port>`                                 |                 26.6 s | 14.3 → 12.4           | pass, settled in 23.1 s                                                                             |        1 |
| 20  | Proof check against the Render-mode server       | `corepack pnpm verify-proof http://127.0.0.1:<port>/proof/2026A-r1`      |                  1.9 s | 12.2                  | pass: six of six, "Sample, never Verified"                                                          |        1 |
| 21  | Render fs-cron build and start                   | `true`, then `node tools/cron-tick.mjs`                                  |                  0.3 s | 12.1                  | pass: `OK 202`, judgeReset and warmCaches enqueued                                                  |        1 |
| 22  | Render Blueprint lint                            | `corepack pnpm exec tsx tools/lint-render.ts`                            |                  2.0 s | 12.0                  | pass: schema and policy                                                                             |        1 |
| 23  | Clean-clone verify of this branch                | `corepack pnpm verify --source=<github url> --ref=cloud/dr4-linux`       |                249.0 s | 11.6 → 47.8           | **fail** at test: 2 api-client timeouts (5 s) at load 47                                            |        1 |
| 23a | ↳ api-client alone, same clone                   | `corepack pnpm test` (packages/api-client)                               |                  6.9 s | 42.0 → 40.0           | pass, 80 of 80                                                                                      |        1 |
| 24  | The rest of step 23's tests                      | `corepack pnpm test --concurrency=2 --continue` (same clone)             |                567.2 s | 33.5 → 17.4           | **fail**: apps/api (R3: a half-made cluster), 2 console timeouts                                    |        1 |
| 24a | ↳ apps/api again, cluster unchanged              | `corepack pnpm test` (apps/api)                                          |                  3.3 s | 14.1                  | **fail** again, the same way (R3 is sticky)                                                         |        2 |
| 24b | ↳ apps/api after `rm -rf apps/api/.cache/pg`     | `corepack pnpm test` (apps/api)                                          |                363.5 s | 10.9 → 14.5           | pass, 1,064 of 1,064                                                                                |        1 |
| 24c | ↳ the 2 console files alone                      | `vitest run ReadingRoom.test.tsx W-TR-08/fanout.test.tsx`                |                 55.4 s | 9.3 → 11.1            | pass, 25 of 25                                                                                      |        1 |
| 25  | Clean-clone verify of this branch, with R3's fix | `corepack pnpm verify --source=<github url> --ref=cloud/dr4-linux`       |                404.9 s | 12.2 → 23.5           | **fail** at test: 3 `packages/ai` timeouts (30 s); no half-made cluster this time                   |        1 |
| 25a | ↳ packages/ai alone, same clone                  | `corepack pnpm test` (packages/ai)                                       |                 95.7 s | 20.8 → 14.3           | pass, 233 of 233                                                                                    |        1 |

### E2E timings (step 15)

- `cold-judge-timing`: first press → in review 12.7 s, payouts POST answered 13.9 s (budget 60 s).
- DR-0, chromium: first press → POST answered 52.7 s (budget 60 s), Reset 0.4 s (budget 10 s). The browser timing
  spec measured 52.6 s. Reduced motion: 46.8 s and 42.7 s, Reset 0.3 s. All ran at load 15 to 30. **52.7 s at load
  20 leaves 7 s of headroom on a contended 4-core box.** The `[paypal-window]` waits (25 to 58 s) happen before
  the clock starts, as designed.
- PayPal's window peaked at 17 and 22 of 40 calls per 60 s; it never filled during a run.
- The two skips are the documented `test.fixme` for the phone's pre-key-2 line drift (e2e README, "Known gaps").

## The red steps: repro and cause

### R1. The embedded Postgres refuses root (fixed)

Repro, on any Linux as root (a Docker container, for example):

```sh
git clone https://github.com/GODOSTROYER/fair-split.git && cd fair-split
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @fairsplit/e2e stack
# Error: initdb --pgdata=…/.codex-scratch/e2e-stack/pg/pg17 exited 1
# initdb: error: cannot be run as root
```

The same failure hits every Postgres-backed suite (`packages/db`, `packages/outbox`, `apps/api`, `apps/tasks`), the
smoke and `corepack pnpm verify`. Cause: `packages/db/src/testing/cluster.ts` runs `initdb` and `pg_ctl` as the
current user, and Postgres refuses uid 0. The harness gave no hint that `FS_TEST_DATABASE_URL` is the way out.

Fix (WS-DATA, tests first): `startTestCluster` checks the uid before it creates anything and throws one message:
"The embedded test Postgres cannot run as root: initdb and postgres refuse uid 0. Run as a regular user, or set
FS_TEST_DATABASE_URL to the admin URL of a Postgres server". An external server is still accepted as root. The
README now says this, and that `verify` needs `--db=<url>` for it, because `verify` strips `FS_*` variables from its
children. Checked as root: `FS_TEST_DATABASE_URL=<server> corepack pnpm --filter @fairsplit/e2e stack` comes up
with "postgres external cluster" and serves `/judge`.

`packages/db/test/harness-global-setup.test.ts` always starts its own embedded cluster, so as root it still
fails. Its failure now reads as the new message instead of initdb's. Running it as root needs a non-root user;
nothing else does.

### R2. Test timeouts under CPU contention (flaky, not broken)

Repro: run `corepack pnpm test` (turbo's default concurrency of 10 vitest processes) on a 4-core box that is already
busy. Seen here at 1-minute load averages of 18 to 47:

| Package               | Test                                                                                               | Limit | Alone                  | Under load                    |
| --------------------- | -------------------------------------------------------------------------------------------------- | ----: | ---------------------- | ----------------------------- |
| `packages/eval`       | `src/run.test.ts` "live records, replay reproduces with no network, a missing recording fails"     |  60 s | 12.4 s, 13.4 s, 14.0 s | timed out in 3 of 3 full runs |
| `apps/console`        | `W-BR-01/brand.test.tsx` "shows the invoice, the final count and names under the agreement…"       |  20 s | pass (2 of 2)          | timed out once                |
| `apps/console`        | `W-TR-07/approve.test.tsx` "a step the server has not wired yet (501)…" (`findBy` gave up)         |   1 s | pass (2 of 2)          | failed once                   |
| `packages/api-client` | `src/brand.test.ts` "accepts an issued brand link and rejects member or unknown brand links"       |   5 s | pass                   | timed out once (10.7 s)       |
| `packages/api-client` | `src/msw/parity.test.ts` "every success body is contract-valid"                                    |   5 s | pass                   | timed out once (12.7 s)       |
| `apps/console`        | `features/reading/ReadingRoom.test.tsx` "reduced motion reaches the same phases, with no flight"   |     — | pass                   | phase list differed once      |
| `apps/console`        | `W-TR-08/fanout.test.tsx` "shows the paced cancellation delay…" (`findBy` for `W-TR-08.queued`)    |   1 s | pass                   | failed once                   |
| `packages/ai`         | `src/read/duplicates.test.ts` (2 tests) and `src/read/extract.test.ts` "replays the recorded run…" |  30 s | pass (233 of 233)      | timed out once each           |

Cause: CPU starvation. The eval test runs sharp's image prep three times over; `r1.test.ts`, its sibling, already
allows 120 s and took 89 s under the same load. The README's Tests section already notes console timeouts "under
the trial's load". Nothing here is Linux-specific.

Done: the eval test's limit is now 180 s (WS-READ, test-only). Not done: the console is off limits, and api-client's
two tests are a WS-API choice. Suggested follow-ups:
- `apps/console` (off limits; a repro only): `src/screens/W-TR-07/approve.test.tsx` uses `findByTestId` with the
  default 1 s wait for `W-TR-07.error`. Under load the 501 path takes longer. Repro:
  `corepack pnpm --filter @fairsplit/console test` while another full `corepack pnpm test` runs. A
  `{ timeout: 5_000 }` on that `findBy` would cover it. The same goes for `W-BR-01/brand.test.tsx`'s 20 s limit.
- `packages/api-client`: give `brand.test.ts` and `msw/parity.test.ts` a `testTimeout` of 30 s.
- `packages/ai`: `src/read/duplicates.test.ts` and `src/read/extract.test.ts` time out at 30 s under load (sharp
  again). WS-READ could give them the eval test's 180 s.
- On a busy machine, `corepack pnpm test --concurrency=2` (turbo's flag, passed through by pnpm) cuts the
  contention. It still failed two console tests at load 17 to 33 (step 24), so it does not cure contention.

### R3. A run stopped during initdb leaves a half-made cluster that every later run reuses (fixed)

Seen in step 24: `apps/api`'s tests failed in 3 s, before any test ran:

```text
[@fairsplit/db testing] api: the process is exiting while the global setup was still preparing the migrated template …
TypeError: code.charCodeAt is not a function
    at extractInlineSourceMap (…/node_modules/vite/dist/node/module-runner.js:366:57)
    …
    at queryError (…/node_modules/postgres/src/connection.js:404:41)
```

`apps/api/.cache/pg/pg17.log` held the real error, `FATAL: database "postgres" does not exist`, and
`pg17/base/` held only `1` (template1): no `template0` (4) and no `postgres` (5). Vite's source-map hook crashed
while formatting postgres.js's error, which hid the message. Cause: step 23's verify stopped at
`packages/api-client`'s timeout, and turbo ended `apps/api` while it was "still starting the test cluster", that is,
in its first initdb. initdb writes `PG_VERSION` early and the `postgres` database last. `startTestCluster` treated
`PG_VERSION` as "initialised", so every later run reused the broken directory. Deleting `apps/api/.cache/pg` healed
it (step 24b).

Repro with the real binaries, as a regular user (the script lives outside the repo, at
`/tmp/cloud-dr4-linux-stranger/scripts/initdb-kill-fixed.mts`): start `startTestCluster` in a child process,
SIGKILL its process group 100, 300 or 600 ms into initdb, then call `startTestCluster` again and connect. Before
the fix, the second start failed 3 of 3 times (`pg_ctl start exited 1` once, `connect ECONNREFUSED` twice). With the
fix it connected 3 of 3 times. A Ctrl-C does not cause this, because initdb removes its own directory on SIGINT;
a SIGKILL does.

Fix (WS-DATA, tests first): initdb writes `pg17.initdb-<pid>` beside the cluster, which is renamed to `pg17` only
after initdb exits 0. On Windows the rename is retried for up to 5 s on `EPERM`, `EACCES` and `EBUSY`, in case a
scanner holds a file. Scratch directories left by killed runs, and a `pg17` with no `PG_VERSION`, are cleared
before the next initdb. The tests (`packages/db/test/cluster-initdb.test.ts`) drive `startTestCluster` with fake
`initdb` and `pg_ctl` shell scripts, so they skip on Windows. The rename path is therefore untested on Windows:
the owner should run `corepack pnpm --filter @fairsplit/db test` once on the laptop after deleting
`packages/db/.cache/pg`. A directory that an older harness already left half-made is not healed. Delete
`<package>/.cache/pg` once.

## Windows-only assumptions (step 4 of the task)

| Check                     | How                                                                                                         | Result                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CRLF                      | `git ls-files --eol`; `.gitattributes`                                                                      | 0 CRLF or mixed files; 2,140 `i/lf`, 195 binary, 56 empty. `.gitattributes` is `* text=auto eol=lf` plus binaries                                                                            |
| Letter case               | a scan of all 6,187 relative path literals in tracked code, JSON, YAML, CSS and HTML against `git ls-files` | 0 mismatches; no two tracked paths differ only by case                                                                                                                                       |
| Path separators           | grep for `\\`, `win32` and `split("\\")` in `tools/`, `e2e/`, `packages/test-kit`, scripts                  | only deliberate `win32` branches (`tools/verify.ts` corepack lookup, `e2e/stack/stack.ts` env whitelist, `cluster.ts`, `fake-workflow-host.ts` pipes); each has a POSIX branch that ran here |
| Shell-specific scripts    | every `package.json` script; `lefthook.yml`; spawns in `tools/`, `e2e/`, `apps/mobile/scripts`              | all run through `node`, `tsx`, `turbo` or `process.execPath`; none uses `cmd`, PowerShell, `set X=`, `%VAR%`, `rm -rf` or `cp`                                                               |
| Drive letters             | grep for `[A-Z]:\\`                                                                                         | only `apps/tasks/test/verify.test.ts`, which tests the Windows branch on purpose                                                                                                             |
| Port clashes              | the stack, the smoke and e2e beside five other agents' stacks                                               | none: the stack, the cluster and fs-api each pick a free port. Render's `PORT` is the platform's                                                                                             |
| Executable bits, shebangs | `git ls-files -s`                                                                                           | three `100755` `.mjs` files, all run with `node` anyway                                                                                                                                      |
| Corepack's location       | `tools/verify.ts` `resolveCommand`                                                                          | finds `<prefix>/lib/node_modules/corepack/dist/corepack.js` on Linux (`/opt/node24`)                                                                                                         |

## What a stranger needs that this machine already had

- Node 24.19 or newer, with corepack. The README says so.
- Chromium's system libraries. They were already installed here, so `playwright install chromium` warned about
  nothing. On a fresh Ubuntu, Chromium needs about 30 apt packages. The README's command lacked `--with-deps`;
  it now gives `playwright install --with-deps chromium` for Linux (it uses sudo for apt). CI already uses
  `--with-deps` (`.github/workflows/e2e.yml`).
- Network access to registry.npmjs.org (pnpm and the packages), GitHub, and cdn.playwright.dev (the browser).
  All three were reachable through the session's proxy.
- A non-root user, or a Postgres server for `FS_TEST_DATABASE_URL` (R1).

## What changed (commits on `cloud/dr4-linux`)

| SHA       | Scope | Change                                                                                                                                        |
| --------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `144ade8` | data  | test: `packages/db/test/cluster-root.test.ts`, 4 tests: refuse uid 0 before initdb, name both ways out, accept an external server             |
| `de3da46` | data  | fix: `rootRefusal` and the uid check in `packages/db/src/testing/cluster.ts`                                                                  |
| `2387346` | qa    | this report (skeleton)                                                                                                                        |
| `8d6b467` | qa    | README "Run it locally": the Linux notes (not as root; `--with-deps`); `core.longpaths` is Windows-only                                       |
| `cbf6e77` | read  | test-only: `packages/eval/src/run.test.ts` limit 60 s → 180 s                                                                                 |
| `4cfba87` | qa    | this report (full)                                                                                                                            |
| `875b2ab` | data  | test: `packages/db/test/cluster-initdb.test.ts`, 3 tests: a failed initdb leaves no `pg17`; success leaves no scratch; old scratch is cleared |
| `8a7a0d0` | data  | fix: initdb in `pg17.initdb-<pid>`, renamed on success (R3); `Binaries` exported for the tests' fakes                                         |

Each commit was checked with `node tools/check-ownership.mjs --ws <key> --base <sha>^ --head <sha>` ("all within
WS-…"). `packages/db` and `packages/eval` are outside the task's suggested paths (`tools/`, `e2e/`, `test-kit`,
root scripts, README), but are not off limits. The coordinator allowed a minimal tests-first fix in `packages/db`.
The eval change touches only a test's limit.

## Safer-option decisions

- **Stranger as a regular user, not root.** The session is root, and a typical developer is not. Root was run once,
  to record R1, and then the whole path was run as `ubuntu` with an empty `HOME`. The stranger's files live in
  `/tmp/cloud-dr4-linux-stranger/`, outside the session scratch dir, because that dir is mode 700 and `ubuntu`
  cannot reach it.
- **No root-script change.** Every root `package.json` script is already cross-platform; nothing in the deps lane
  needed a change.
- **The Render emulation used throwaway values** for every `generateValue` and `sync: false` key (random seeds, a
  random operator password hashed with `tools/ops-hash-password.mjs --stdin`). They lived in a mode-600 file
  outside git, and the database was dropped afterwards. `RENDER=true`, `PORT` and `RENDER_EXTERNAL_URL` were set
  the way Render sets them. The database was a dedicated local Postgres 17.10 server the coordinator provided,
  not Render's Postgres 18.
- **A judge run was scripted** with the e2e harness's own `settledRun` (`e2e/lib/judge-run.ts`), from a script
  outside the repo, so `verify-proof` had a settled Proof to check. My first try used a `.ts` file with top-level
  await, which tsx compiled as CommonJS. Renaming it `.mts` fixed that; it was my mistake, not the repo's.
- **No timeouts raised in `apps/console`** (off limits) or `packages/api-client` (WS-API, one failure seen). Repros
  are above.
- `corepack pnpm verify` was run with `--keep`, to inspect a failure, and the kept clones were deleted afterwards.

## Open items

1. `apps/console` (off limits): four contention failures in R2. Repro and suggested change above.
2. `packages/api-client` (5 s) and `packages/ai` (30 s): contention timeouts (R2).
3. R3's rename has not been exercised on Windows (its tests skip there). Run the db suite once on the laptop.
4. DR-0's first press → payout measured 52.7 s at load 20: 7 s of headroom. Remeasure on the judging host.
5. turbo prints `WARNING no output files found for task …#test` for about 20 packages, because `turbo.json`
   declares `outputs: ["coverage/**"]` for `test`, and no package writes coverage. It is cosmetic, and only noise in
   a stranger's log. `"outputs": []` for `test` (root config, WS-QA) would silence it.
6. The fs-api boot on a fresh Render-mode database warns `fs_run_seq is inside the seeded range (1-999,999): set
   FS_RUN_SEQ_FLOOR to this database's live block`. This is expected on a new database, but the runbook
   (`apps/tasks/README.md`, "Deploying") should say whether the first deploy sets it.
