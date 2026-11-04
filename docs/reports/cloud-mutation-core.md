# Cloud task T3: mutation testing of the money core

Branch `cloud/mutation-core`, cut from `origin/main` at `3e1ec112`. Status: **in progress** (this report is
updated as each package lands).

## Real bugs found

None yet.

## How it was run

- StrykerJS **10.0.0** (`@stryker-mutator/core` and `@stryker-mutator/vitest-runner`, published 14 Aug 2026;
  10.1.1 of 23 Oct 2026 is under 14 days old), through `npx`, with no dependency added and no `package.json`
  touched. The runner's peer range is `vitest >=2.0.0`; it runs the repo's Vitest 5.0.5.
- Each package has its own `stryker.config.mjs`. Run it from the package folder:

  ```sh
  npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 \
    -p vitest@5.0.5 -p typescript@6.0.3 stryker run stryker.config.mjs
  ```

  `typescript@6.0.3` (the repo's pin) is there because Stryker's tsconfig preprocessor imports `typescript`
  from its own install; `vitest@5.0.5` (the repo's pin) because npm would otherwise install the newest Vitest
  as the runner's peer. The runner itself loads the workspace's own Vitest.
- Shared settings live in `tools/stryker/base.mjs`; each package's `stryker.config.mjs` only names what it
  mutates. `coverageAnalysis: "perTest"`, `concurrency: 2` (outbox: 1), incremental mode,
  `vitest.related: false`, `ignoreStatic: true` (see "Static mutants" below).
- **The published Vitest runner does not work with Vitest 5 as is.** It narrows each mutant's run to the tests
  that cover it with a test-name regex built as `describe name` + `" "` + `test name`; Vitest 5 matches the
  pattern against `describe name > test name`. So every mutant covered by a test inside a `describe` ran
  **zero** tests and was reported as Survived (the first money.ts run scored 20.5%, with `mulDivFloor`'s
  whole body emptied "surviving"; the JSON report showed `testsCompleted: 0`). `tools/stryker/vitest5-runner.mjs`
  is the published runner, loaded from the npx install, with only that pattern widened to accept either
  separator. Reproduce the Vitest side in isolation: a `describe("suite one")` with `it("alpha")`, run with
  `testNamePattern: /suite one alpha/` runs nothing, `/suite one > alpha/` runs alpha.
- Everything Stryker writes stays under the package's `coverage/` folder (gitignored and ignored by Biome), so
  no `.gitignore` or `biome.json` change was needed. Three traps decided that location:
  1. a sandbox under `node_modules/` finds no tests (Vitest excludes `node_modules`);
  2. a sandbox outside the repo cannot resolve the workspace's hoisted `vitest`, and silently falls back to
     the copy npx installed;
  3. Stryker rewrites the tsconfig `extends` path as if the sandbox were exactly one folder below the package,
     so `tempDirName` must be a single segment (`coverage`); a deeper one breaks Vite's tsconfig lookup and
     every test file fails to transform ("No tests were executed").

### Static mutants

A mutant that is reached only while modules load (a constant table, a vocabulary list) is "static": Stryker
must rerun the whole suite with a fresh module graph for it (22 s for domain under load), which on money.ts
alone was estimated at 47% of the run. `ignoreStatic: true` skips mutants that only load-time code reaches
(reported as Ignored); a mutant that tests also cover ("hybrid") still runs against those tests. The tables
that matter (state-machine edges, hold kinds and resolutions, published fees) were then run separately with
`STRYKER_STATIC=1` and a `--mutate file:lines` range; see each package.

## Scores

Score is Stryker's: (killed + timeout) / (killed + timeout + survived + no coverage). Static mutants
skipped by `ignoreStatic` are counted separately as Ignored. Interim: domain chunks still running.

| Package (scope)                             | Mutants | Ignored |      Killed |  Survived | Timeout |  No cov | Score before → after      |
| ------------------------------------------- | ------: | ------: | ----------: | --------: | ------: | ------: | ------------------------- |
| paypal-payouts (money paths)                |   1,425 |     115 | 959 → 1,119 | 264 → 148 |   3 → 5 | 84 → 38 | 73.44% → 85.80% (interim) |
| domain: money.ts                            |     151 |       0 |         103 |        42 |       2 |       4 | 69.54% → pending          |
| domain: quote, batch, digest-input, ids     |     148 |       1 |         114 |        31 |       0 |       2 | 77.55% → pending          |
| domain: fsm.ts                              |     208 |     154 |          45 |         9 |       0 |       0 | 83.33% → pending          |
| domain: approval, sig, canon, jcs, ratecard |     429 |      10 |         351 |        60 |       2 |       4 | 84.65% → pending          |
| domain: policy.ts                           |     894 |     105 |         656 |       123 |       5 |       5 | 83.78% → pending          |

## Findings so far

- **No real bug in the money code yet.** Every survivor so far is a missing test, an equivalent mutant or
  a guard that another layer also enforces.
- **Vitest 5 trap: a RegExp inside `toMatchObject` matches any string.** A RegExp has no own enumerable
  keys, so as an expected value it is a vacuous subset: `expect({ a: "x" }).toMatchObject({ a: /nomatch/ })`
  passes. Mutation testing caught it in this branch's own first draft (a reason pattern that "passed" under
  a mutant). Use `expect.stringMatching(...)`. A search of the repo's existing tests found no such use.
- **Defence in depth hides weak tests in the policy lattice.** `decide` takes the maximum over every
  policy, and invoiceEqualsQuote denies any unknown key, so a policy that stopped denying (a stray
  recipient path, a nested date, the edges of the AUTO_CANCEL window, kill_paypal_live on a non-PayPal
  tool) was masked. The new `policy.edges.test.ts` calls each policy on its own.
- **I4 adoption accepted an item in another currency, as far as the tests knew.** `#adopt` checks that each
  listed item is USD before re-hashing; removing that check survived, because `toBatchItem` forces USD into
  the digest. The code is right; it now has a test (a listed EUR item is ADOPT_FAILED).
- `paypal-core`'s `decideItemStatus` accepts RETURNED after a cancel from any lower rank, while domain's
  `applyItemStatus` (the one apps/api uses) also requires the current status to be UNCLAIMED. Not a bug
  today (only domain's is on the money path), but the two disagree; noted for WS-PPCORE.

## Remaining survivors and why they are acceptable

(Filled in per package when its final run is in.)

## Commits

- `c2c2a3c` chore(ops): StrykerJS setup (shared settings, Vitest 5 runner adapter)
- `31774c9` chore(ops): settings for a shared machine (ignoreStatic, 15 s timeout, per-package concurrency)
- `e09d2f4` test(ppmoney): payouts config and tests
- `df6674d` test(core): domain config and tests

## Safer-option decisions

- Stryker 10.0.0, not 10.1.1: 10.1.1 (23 Oct 2026) is under the 14-day rule.
- The Vitest 5 adapter lives in `tools/stryker/` (WS-OPS), committed on its own, because the handoff forbids
  touching any `package.json` and the published runner cannot run this repo's tests unadapted. Each package
  still has its own `stryker.config.mjs`, as the handoff asks; it imports the shared settings.
- Postgres: the embedded test cluster refuses to run as root in this container ("initdb: cannot be run as
  root"); the orchestrator started a Postgres 17.10 server and outbox runs use
  `FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres`. Outbox runs at concurrency 1, because
  each Vitest instance's global setup drops the suite's leftover databases and two instances in one sandbox
  share the suite name.
- The machine is shared and was OOM-killed once (other agents included); after that, one Stryker at a time,
  two workers at most, queued with a lock (`flock`).
