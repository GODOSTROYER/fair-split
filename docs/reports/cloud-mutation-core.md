# Cloud task T3: mutation testing of the money core

Branch `cloud/mutation-core`, cut from `origin/main` at `3e1ec112`. Every package's mutation score went up;
the remaining survivors are listed below with the reason each one is acceptable, by class, and in full in
[`cloud-mutation-core-survivors.md`](cloud-mutation-core-survivors.md).

## Real bugs found

**No bug in the money code.** No test exposed a wrong amount, a wrong verdict or a wrong transition, so no
source file changed. Findings that are not bugs in the money path, but worth a look:
1. **Vitest 5: a RegExp inside `toMatchObject` matches any string.** A RegExp has no own enumerable keys, so
   as an expected value it is a vacuous subset: `expect({ a: "x" }).toMatchObject({ a: /nomatch/ })` passes.
   Mutation testing caught it in this branch's own first draft. Use `expect.stringMatching(...)`. A search of
   the repo's existing tests found no such use; it is worth a lint or review rule.
2. **outbox (WS-DATA): enqueue's 8 KB check and the database's CHECK disagree by one byte.** `enqueue`
   measures `JSON.stringify(args)`; `task_outbox_args_size_ck` measures `octet_length(args::text)`, and
   jsonb prints `{"runId": "…"}` with a space after each colon. An args object of exactly 8,192 bytes passes
   enqueue and the INSERT fails with a database error instead of enqueue's RangeError. Both refuse, so
   nothing is lost; `packages/outbox/test/mutants.test.ts` pins the current behaviour. Fix: measure the same
   thing in both places, or give the CHECK a margin.
3. **paypal-core (WS-PPCORE): `decideItemStatus` and domain's `applyItemStatus` disagree on RETURNED.**
   paypal-core accepts RETURNED after our cancel from any lower rank; domain (the one `apps/api` uses) also
   requires the current status to be UNCLAIMED. Only domain's is on the money path, so not a bug today.
4. **I4 adoption's currency check was untested.** `#adopt` refuses a listed item in another currency before
   re-hashing; removing that check survived, because `toBatchItem` forces USD into the digest. The code is
   right; a test now holds it (a listed EUR item is ADOPT_FAILED).
5. **The policy lattice hides weak tests by design.** `decide` takes the maximum over every policy, and
   invoiceEqualsQuote denies any key it does not know, so a policy that stopped denying (a stray recipient
   path, a nested date, the AUTO_CANCEL window edges, kill_paypal_live on a non-PayPal tool) was masked.
   `policy.edges.test.ts` now calls each policy on its own and pins its verdict and reason.
6. **I3's `conserve()` was never handed an unbalanced set.** Each of its first three clauses could be replaced
   by `true` and every test still passed; `engine.lines.edges.test.ts` breaks each clause on its own. (The
   fourth, on-rail + off-rail + carried = net, is true by construction: each line's net goes to exactly one.)
7. **Deduction rounding was untested.** Switching a loan's or advance's owed and carried amounts from half-up
   to floor survived; tests now pin half-up cases, and the shared loan, advance and bonus caps across several
   loans and advances in ref order.

## How it was run

- StrykerJS **10.0.0** (`@stryker-mutator/core`, `@stryker-mutator/vitest-runner`; published 14 Aug 2026;
  10.1.1 of 23 Oct 2026 is under 14 days old), through `npx`, with no dependency added and no
  `package.json` touched. From a package folder:

  ```sh
  npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 \
    -p vitest@5.0.5 -p typescript@6.0.3 stryker run stryker.config.mjs
  ```

  `typescript@6.0.3` and `vitest@5.0.5` are the repo's own pins: Stryker's tsconfig step imports
  `typescript` from its own install, and npm would otherwise add the newest Vitest as the runner's peer. The
  runner itself loads the workspace's Vitest. Outbox needs Postgres: in this container the embedded test
  cluster refuses to run as root (`initdb: cannot be run as root`), so the orchestrator started a Postgres
  17.10 server and outbox runs used `FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres`.
- Shared settings: `tools/stryker/base.mjs` (WS-OPS). Each package's `stryker.config.mjs` names only what it
  mutates. `coverageAnalysis: "perTest"`, `concurrency: 2` (outbox 1), `timeoutMS: 15000`, incremental mode,
  `vitest.related: false`, `ignoreStatic: true` (`STRYKER_STATIC=1` turns it off).
- **The published Vitest runner does not work with Vitest 5 as is.** It narrows each mutant's run to the tests
  that cover it with a test-name regex built as `describe name` + `" "` + `test name`; Vitest 5 matches the
  pattern against `describe name > test name`. Every mutant covered by a test inside a `describe` ran **zero**
  tests and read as Survived (a first run of `money.ts` scored 20.5%, `mulDivFloor`'s emptied body
  "surviving", `testsCompleted: 0` in the JSON). `tools/stryker/vitest5-runner.mjs` is the published runner,
  loaded from the npx install, with only that pattern widened to accept either separator. The Vitest side
  alone: in `describe("suite one")`, `it("alpha")`, `testNamePattern: /suite one alpha/` runs nothing and
  `/suite one > alpha/` runs alpha.
- Where Stryker writes: the package's `coverage/` folder (gitignored and ignored by Biome), so no
  `.gitignore`/`biome.json` change. Three traps decided that: a sandbox under `node_modules/` finds no tests
  (Vitest excludes it); a sandbox outside the repo cannot resolve the hoisted `vitest` and silently uses the
  npx copy; and Stryker rewrites tsconfig `extends` as if the sandbox were one folder deep, so `tempDirName`
  is the single segment `coverage`. Side effect: while a run is going, or after one was killed,
  `coverage/sandbox-*` holds a copy of the tests, and a plain `vitest run` in that package picks them up too.
  Delete stale `coverage/sandbox-*` folders after an interrupted run.
- Two packages have a test config of their own for Stryker, both committed: paypal-core's
  `vitest.stryker.config.ts` (its `apps/api/src/webhooks` project is found by a path relative to the
  config, which does not exist in the sandbox) and seed's (`photo-hashes.test.ts` reads `media/` by a
  relative path; it checks served photo bytes, not a figure).
- **Static mutants.** A mutant reached only while modules load (a constant table, a vocabulary list, a zod
  schema) needs a full-suite rerun each. `ignoreStatic` skips those (Ignored in the table); a mutant that
  tests also cover still runs against them. The tables that matter are pinned by tests instead
  (`fsm.edges.test.ts` pins every run edge, every line edge and every line rank).
- **The machine.** Shared by six agents, OOM-killed once and restarted twice during this task. After the OOM:
  one Stryker at a time with two workers, queued behind a `flock`; long packages in chunks (files or line
  ranges) that finish inside an hour, each with its own incremental file in the scratch folder, so a restart
  loses one chunk at most. Load averages ran 13-44 on 4 cores, so timings are not meaningful.

## Scores

Score is Stryker's: (killed + timeout) / (killed + timeout + survived + no coverage). Ignored are static
mutants skipped by `ignoreStatic`. "Before" is the first run with the adapter; "after" is with this branch's
tests. paypal-payouts, paypal-core and outbox are restricted to their money paths (each package's
`stryker.config.mjs` says which files); domain, contracts and seed are whole.

| Package        | Mutants | Ignored |      Killed |   Survived | Timeout |    No cov | Score before → after |
| -------------- | ------: | ------: | ----------: | ---------: | ------: | --------: | -------------------- |
| domain         |    5279 |     518 | 3583 → 4078 | 1014 → 561 | 27 → 22 | 137 → 100 | 75.82% → 86.12%      |
| paypal-payouts |    1425 |     115 |         959 |        264 |       3 |        84 | 73.44% → pending     |
| paypal-core    |    2145 |     134 |        1534 |        389 |      11 |        77 | 76.83% → 76.83%      |
| outbox         |     647 |       8 |         389 |        177 |      35 |        36 | 66.56% → 66.56%      |
| contracts      |    1640 |    1547 |          64 |         26 |       0 |         3 | 68.82% → 68.82%      |
| seed           |       – |       – |           – |          – |       – |         – | – → pending          |

## Remaining survivors and why they are acceptable

Every remaining survivor and no-coverage mutant is listed with its class in
[`cloud-mutation-core-survivors.md`](cloud-mutation-core-survivors.md). The classes:
1. **Sort comparators (equivalent).** V8's `Array.prototype.sort` only asks whether the comparator is `< 0`,
   and every key sorted here is unique (member numbers, sender_item_ids, row IDs, mark IDs), so mutating the
   `>`/`0` branch, `<` into `<=`, or a tie branch changes nothing (checked: a 5,000-element sort with
   `(a, b) => a < b ? -1 : 0` gives the same order). Lists sorted again downstream are equivalent too.
2. **Wording.** Refusal and error messages where the refusal itself (code, verdict, thrown type) is tested,
   and display text (hold params' `*Display`, `copy.ts`, labels): text, not a figure any line, invoice,
   payout or statement uses.
3. **Redundant guards (equivalent).** A check that a later check makes unreachable or always true:
   `isRetryable`'s 429/401 branch (every caller handles 429 and 401 first), `null <= 0n` being true in JS
   (the next clause of the adoption reader), a `typeof` before a Set or regex test that rejects the same
   values, `BigInt` division throwing its own RangeError for a zero divisor, optional chaining on a value a
   preceding check guarantees, `case null:` removal falling through to the same code, an initial value
   always overwritten before use, a sub-condition already decided by an earlier branch.
4. **Unreachable bounds.** `sender_batch_id` at most 256 characters (ours are at most about 91), a share or
   total weight overflowing (both are bounded by a safe total), `jwk.x` missing, node's Ed25519 `verify`
   throwing on a 32-byte key (it does not; checked with several keys), a `PayoutParamsError` from a body the
   service builds itself.
5. **Fail-closed only.** A mutant that can only make the code refuse more: a page bound that matters only at
   15,000 items (adoption would fail, never succeed), the live-environment guard refusing even with
   `allowLive`.
6. **Infrastructure, not the money path (open).** The outbox dispatcher, executors and worker (polling,
   timers, watchdogs, events), the webhook verifier's certificate-fetch budgets and bounded caches
   (`verify.ts` lines 1-700) and PayPalHttp's retry and backoff timing. Listed; follow-up work.
7. **Agreement scoring (`agreement.ts`, the AI-2 table, open).** It decides which slip fields go to a person;
   what it decides feeds LOW_CONFIDENCE holds, which the engine tests cover. Its own survivors are mostly
   score constants. Listed; follow-up work.

## What changed (commits)

Each commit is in one workstream's scope; `node tools/check-ownership.mjs --ws <key> --base <sha>^ --head
<sha>` printed "all within WS-<KEY>" for every one.
- `c2c2a3c` chore(ops): StrykerJS setup for mutation testing (Vitest 5 runner adapter)
- `13cd07e` docs(qa): T3 mutation-testing report skeleton
- `31774c9` chore(ops): Stryker settings for a shared machine (ignoreStatic, 15 s timeout, per-package concurrency)
- `e09d2f4` test(ppmoney): kill mutation survivors in the payout money paths
- `df6674d` test(core): kill mutation survivors in domain money, ids, approvals, fsm and policy
- `fcba88a` docs(qa): T3 interim scores and findings
- `5e40da5` test(core): Stryker configs for contracts and seed
- `0568601` test(data): Stryker config for outbox
- `40950c1` test(ppcore): Stryker config for the paypal-core money paths
- `951aa54` test(ppmoney): more mutation survivors killed in PayoutsService
- `6702fa6` test(core): second round of domain mutation kills (invoice, policy paths, approvals, lines root)
- `f6eb0c1` test(core): engine hold survivors (keeper copy, re-shoots, low confidence, input checks)
- `194cb6c` test(core): engine mark, yield, quarantine and mass-balance survivors
- `bb289d6` test(core): conservation clauses, shared deduction caps, ruled-mark audit, duplicate effects
- `fedd17b` test(ppcore): run Stryker on the paypal-core project alone
- `f059d36` test(data): outbox mutation survivors (enqueue limits, dedupe return, backoff, run events, routing)
- `a40888a` test(core): formatting, amounts in words, ASCII e-mail and UUIDv7 edges
- `92e40f1` test(core): contracts mutation survivors (every task dedupe key, key-ID shape, labels, paths)
- `e4be762` test(core): run seed mutation tests without the media photo-hash test
- `ae921c3` test(ppcore): webhook verification mutation survivors (expired-cert policies, signature bounds, reported id, cert size)
- `8ceb711` test(ppcore): stored-webhook apply gate edges (signature size, receipt time, ids, resource type)
- `3f4d718` test(ppcore): PayPalHttp request-id header, body and content-type survivors
- `0009f9d` test(core): Proof plates pinned per tampered field (which plates fail, and why)
- `db6abbd` test(core): resolved duplicate and low-confidence holds record their resolution
- `338115d` test(core): mass-balance clear params, unreadable-mark resolution, hand-entered prior keys
- `d93e38e` test(core): deduction rounding, pending-run block, tolerance edge, effects across holds, hold order

## Safer-option decisions

- Stryker 10.0.0, not 10.1.1 (under 14 days old).
- The Vitest 5 adapter is a small local plugin in `tools/stryker/` (WS-OPS), committed on its own, rather
  than a patched npx cache: the published runner cannot run this repo's tests unadapted, and the handoff
  forbids a new dependency. Each package still has its own `stryker.config.mjs`, as the handoff asks.
- No source file changed: no test exposed a bug in the money code. Every new test passes on `main`'s code.
- Tests that pin current behaviour (the Proof plate failure table, the run and line edge tables, the task
  dedupe keys) were checked against the spec's wording and the code's comments, not only recorded.
- Outbox ran at concurrency 1: each Vitest instance's global setup drops the suite's leftover test databases,
  and two instances in one sandbox share the suite name.
- Seed figures were not touched.

## Open, with repros

From the package folder, with the command above (outbox also with `FS_TEST_DATABASE_URL`); the survivors
file lists each one.
- Outbox dispatcher, executors and worker.
- `verify.ts` lines 1-700 (certificate-fetch budgets, bounded maps, health marks); `http.ts` retry timing.
- `agreement.ts` score constants, `copy.ts` text.
- Static mutants (Ignored): contracts' zod schemas and domain's constant tables. Run them with
  `STRYKER_STATIC=1` and `--mutate <file>:<from>-<to>`; each costs a full suite run.
