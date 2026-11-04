# DR-4: Linux clean-clone check (cloud task T2)

Status: in progress. Branch `cloud/dr4-linux`, cut from `origin/main` at `3e1ec11`.

## Machine

- Ubuntu 24.04.5 LTS, 4 cores, 15 GB RAM, shared with five other agents (load averages are recorded per step).
- Node 24.22.1 (CI and `render.yaml` pin 24.19.0), corepack 0.36.0, pnpm 11.28.6 through corepack, git 2.43.0.
- The session runs as root. The "stranger" runs as the machine's regular user `ubuntu` (uid 1000), with a fresh
  `HOME` (no corepack cache, no pnpm store, no Playwright browsers) in `/tmp/cloud-dr4-linux-stranger/` and a
  clean environment (PATH, the egress proxy and its CA bundle, `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`, nothing else).

## Findings so far

1. **As root, the embedded Postgres refuses to start.** `corepack pnpm --filter @fairsplit/e2e stack` (the README's
   step) fails after 11 s with `initdb: error: cannot be run as root`. Docker containers and many CI images run as
   root. Fixed in `packages/db/src/testing/cluster.ts` (tests first): the harness now says why before it creates
   anything and names the two ways out (a regular user, or `FS_TEST_DATABASE_URL`).
2. **As a regular user the README path is green:** clone 4.3 s, frozen install 21.1 s (fresh store), the stack
   ready in about 22 s, a scripted judge run settled in 22 s, `verify-proof` six of six. Ctrl-C stops fs-api,
   Postgres and the cluster cleanly.
3. `corepack pnpm test`: `@fairsplit/eval` `src/run.test.ts` timed out at 60 s twice at load 20 to 40, and passes
   alone in 12 to 14 s. Turbo then stops, so `apps/api` and `apps/console` did not finish. Being rerun.

(Timing table, the remaining steps and the commit list follow.)
