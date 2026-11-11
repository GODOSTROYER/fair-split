# HD6 round 5: replay honesty, judging-room admission and memory

11 November 2026. Worktree `fs-wt/hd6`, branch `wp/hd6-hardening-6`. Rebased onto main
`ca3d1578414229f0ecd0ec635976f7dbb363a659` without conflicts, retaining the cloud money fixes.
During validation main advanced to `1aff1774a6b4df45902c06fe09fe42307c8337fe` with media/film work;
this branch retains its tested rebase base. The final ownership check uses that newer main.
All execution was local. PayPal used the in-process simulator or intercepted test fixtures; no real PayPal,
Claude, Gemini or cloud API was called. Seed readings and replayed money remain labelled.

## Numbered acceptance evidence

0. **PASS** — `apps/api/src/lib/rate-limit-availability.test.ts:61`: changed only the disputed R1 assertion.
   A fresh route is admitted by evicting the LRU key in the largest non-critical partition above its floor.
   The other R1/R2 checks remain unchanged. This file changed from 1 failure / 3 passes to **4 passed**.
1. **PASS** — `apps/api/src/runs/machine.ts:144`, `money/items.ts:67`, `runs/reads.ts:270`,
   `proof/metrics.ts:104`, `proof/stream.ts:42`, `paypal/replay.ts:148`: item and line transitions retain
   the event provenance. Run counts distinguish `PAID_REPLAY`; Proof separates replayed PayPal from verified
   PayPal, cash and due, and labels progress. Replay invoices expose no source payer URL. The judge replay
   test proves 7 replayed paid lines, zero plain PAID count, eight replayed items, seven replayed PayPal members,
   correct SSE attribution, and no PayPal call. Existing statement and console replay-label tests pass.
2. **PASS** — `packages/contracts/src/api.ts:59`, `apps/api/src/runs/paypal.ts:96`,
   `money/funding.ts:77`: Mark paid returns the stored invoice provenance, including a funding step that
   switches an initially simulated invoice to replay. **ADR 0020** records the contract change. Postman
   regression tests execute the generated assertions and reject both mismatched invoice/provenance pairs.
3. **PASS** — `apps/api/src/judge/live-step.ts:259`: fresh live steps switch immediately to labelled replay
   when the local queue predicts more than **5,000 ms**; unknown cross-process waits are bounded to
   **5,000 ms** in the visible queue. Written-live batches still resume live; the single-flight lane,
   quota reservation and daily limit remain. `money/judge-load.pg.test.ts:9` proves **25 approved judges,
   1 live / 24 labelled replay**, below 60 seconds of measured processing without advancing the fake clock.
   The final production-bundle full cold-start burst, without allocation sampling and with live capacity
   initially available, reached answered POSTED for **all 25 judges** in **54,086 ms maximum / 53,796 ms p95**.
   All 25 settled with labelled replay payouts and zero label violations. POSTING is the pre-call state;
   its maximum was 53,996 ms. The separate task-level regression proves the mixed 1 live / 24 replay split.
   Cold workspace ledger initialization now batches 56 ordered entries: **3 database queries instead of 168**,
   retaining the same hashes, timestamps, actors, document mapping and database triggers.
   Preparation contention retries after **250 ms** instead of 3,000 ms; capacity refusals and critical
   guards retain their policy. Phase sampling isolated the remaining cold-start tail to the preparation queue.
   Fresh steps also check call headroom in the shared PayPal window while holding the live lane:
   six calls for invoices, three for funding and two for other fresh steps.
   This conservative check prevents a burst starting and then stalling partway through at the 40/min limiter.
   Written-live batches bypass it; the authoritative call limiter remains unchanged.
4. **PASS** — `apps/api/src/lib/rate-limit.ts:46`: **60 successful starts/hour/network**; the daily
   network ceiling remains 60. `judge/admission.pg.test.ts:26` proves 40 starts behind one IPv6 /64;
   `judge/failed-start.pg.test.ts:101` proves 40 QUEUED presses spend no successful-start slots. Existing
   failure refunds already cover every thrown non-start outcome. Separate expensive-attempt guards and all
   critical guess guards remain fail-closed.
5. **PASS** — `apps/api/src/sse/hub.ts:49`, `proof/serve.ts:48`, `db.ts:90`, `render.yaml:67`:
   Queued SSE wire data is capped at **256 KiB/stream**, plus one in-flight message; overflow drains a bounded prefix so reconnects
   advance Last-Event-ID, then aborts a blocked writer after 500 ms. Proof base and tier caches are capped
   at **4 MiB each**. The optional workflow SDK loads only when a workflow is dispatched. Render starts Node
   with **128 MiB old space / 8 MiB semi-space**; build-time Node is unaffected. The dist soak reads those
   flags from the Blueprint. Measured memory and fan-out remain below the requested budgets, below.
6. **PASS** — `packages/db/src/repos/posting.ts:1`, `packages/outbox/src/enqueue.ts:53`,
   `jsonb-size.ts:4`: removed the unused stored-hash reader and its binding. The outbox byte guard now agrees
   with PostgreSQL `jsonb::text` at **8,192 bytes**, including separator spaces, UTF-8 and exponent expansion.
   Published migrations and CHECK constraints were not edited. The test solely exercising the retired reader
   was replaced by an API-retirement check; posting CAS and cloud S1 fresh-hash protection remain tested.

## Memory and timing measurements

Production API bundle, Windows / Node 24.19.0, one private scratch PostgreSQL cluster, keyless e2e stack,
`tools/soak`'s actual JudgeClient/runJudge journey, two SSE streams per judge. Local, explicitly labelled
quota-emulation rows force replay. No credentials or environment values were persisted in the evidence.
Node inspector allocation sampling used a 32,768-byte interval; memory was sampled once a second.
MiB means 1,048,576 bytes. The older cloud report's 644 MB Linux result is separate historical evidence.

| Run                                                                          | Judges settled | Peak RSS MiB | Ending RSS MiB | SSE p95 ms | Maximum press-to-POSTING ms |
| ---------------------------------------------------------------------------- | -------------: | -----------: | -------------: | ---------: | --------------------------: |
| Initial bundle, before memory limits, allocation sampling                    |          25/25 |       543.54 |         534.72 |         34 |                      72,057 |
| Memory limits, allocation sampling                                           |          24/25 |       213.00 |         171.55 |         39 |                      72,355 |
| Memory limits, allocation sampling                                           |          50/50 |       225.86 |         224.61 |         45 |                     159,747 |
| Final bundle with batched opening ledger, allocation sampling                |          25/25 |       220.41 |         215.95 |         36 |                      70,856 |
| Final bundle, allocation sampling disabled for timing                        |          25/25 |       215.03 |         214.31 |         39 |                      59,244 |
| Superseded uniform-headroom policy, 500 ms retry, no allocation sampler      |          25/25 |       224.55 |         224.55 |         33 |                      54,675 |
| Per-step headroom, 500 ms retry, no allocation sampler (196 ms latency miss) |          25/25 |       225.05 |         218.01 |         35 |                      60,111 |
| Final policy, per-step headroom, 250 ms retry, no allocation sampler         |          25/25 |       224.87 |         224.87 |         36 |                      53,996 |
| Earlier two-worker memory configuration, allocation sampling                 |          50/50 |       224.20 |         222.46 |         37 |                     113,888 |
| Exact final code, two workers, allocation sampling                           |          50/50 |       225.46 |         224.58 |         27 |                      87,302 |

The first limited 25-judge allocation run had one QUEUED start exceed the client's 60-second preparation budget;
it was neither counted as a start nor presented as a successful judge. Both final 25-judge runs admitted all 25.
The 50-judge memory run allowed a 180-second per-step client budget; it proves memory/fan-out, not a 60-second
journey for 50 judges. Allocation-instrumented runs are not latency acceptance runs. The earlier refreshed
50-judge run preceded the final fresh-live headroom and retry refinements. The exact final-code run also
allowed 180 seconds per step: **all 50 settled**, zero label violations, maximum answered POST **87,401 ms**.
Against the local baseline, final 25-judge peak RSS fell from 543.54 to **224.87 MiB**; the exact final-code
50-judge peak was **225.46 MiB**, ending at **224.58 MiB**. SSE p95 was **36 / 27 ms** respectively.

The earlier elapsed-only mixed burst missed the bound (89,285 ms maximum answered POST). Predictive fallback
alone still took 80,798 ms. A four-worker experiment introduced written-live stalls and was reverted; the API
keeps its original two-worker limit. Phase samples then showed the cold preparation tail (49,524 ms to get
a workspace) and two exhausted-window invoice stalls. Uniform six-call headroom passed but unnecessarily
replayed smaller steps. The per-step 6/3/2 policy with 500 ms retries preserved three simulated payouts,
but its maximum answered POST was **60,196 ms** (p95 59,486 ms), a strict failure. The final 250 ms preparation
retry with that same per-step policy completed all 25 answered POSTs in **54,086 ms**, with labelled replay
payouts and zero label violations. The machine was not running other agent tests during
these acceptance measurements. The JSON includes unsuccessful intermediate runs, labelled by configuration.

Allocation samples identified retained Proof serialization (`finish`, 0.44 MiB in the initial sample),
Postgres/socket buffers (`onStreamRead`, 0.52 MiB), and ledger DTO conversion among the largest retained
application allocations. Ending live JS heap was **93.43 MiB**, while V8 retained **232.66 MiB** of heap
capacity and process RSS was **534.72 MiB**. This supported bounding V8 as well as application buffers.
In the exact final 50-judge sample the largest application retainer was Proof's `finish` serialization
at **3.98 MiB**; socket `onStreamRead` sampled **0.97 MiB**, and buffer `toString` **0.85 MiB**.
Replay snapshots contain only the eight item outcomes. Public views already have entry bounds, and presence
expires old activity; no large replay snapshot cache was found. Allocation samples are sampled allocations,
not an exact retained-size census. Independent review caught and reproduced the initial SSE reconnect trap;
the fixed implementation delivers the complete large backlog across bounded reconnects without gaps.

Sanitized per-second samples and aggregate results: [hd6-round5-memory.json](hd6-round5-memory.json).
Full local allocation profiles and the Windows profiling adapter remain in ignored `.codex-scratch/memory/`
and `.codex-scratch/profile-soak.mts`. On Linux, `tools/soak/stack.ts --dist` now preserves Render's V8 flags.

## Verification

Regression tests were written and observed red before implementing each numbered policy/behavior change.
All commands use the pinned local dependencies. The initial pure R1 run used the package's default global
setup and stopped its `apps/api/.cache` PostgreSQL cluster. All subsequent database checks used
one cluster under `.codex-scratch/` at a time through the scratch runner / scratch global setup.

| Command / affected gate                                                                                          | Result                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile --prefer-offline`                                                       | Already up to date                                                                                               |
| API `vitest run src/lib/rate-limit-availability.test.ts --maxWorkers=1`                                          | **Tests 4 passed (4)**                                                                                           |
| Provenance unit/core/Postman targeted files                                                                      | **Tests 28 passed (28)**                                                                                         |
| API `vitest run src/money/judge-replay.test.ts` after final invoice fix                                          | **Tests 7 passed (7)**                                                                                           |
| Console `vitest run src/data/payout-replay.test.ts`                                                              | **Tests 39 passed (39)**                                                                                         |
| Nine affected judge/lane/refund files, one worker                                                                | **Tests 66 passed (66)**                                                                                         |
| Predictive lane and payout integration, five files, one worker                                                   | **Tests 23 passed (23)**                                                                                         |
| Final pure lane/headroom boundaries                                                                              | **Tests 13 passed (13)**                                                                                         |
| Preparation retry regressions                                                                                    | **40 passed; stale header assertion fixed and targeted rerun 1 passed (32 skipped)**                             |
| Final 250 ms policy: `failed-start.pg.test.ts`, `contended-start.pg.test.ts`, `judge.pg.test.ts`, one worker     | **Tests 41 passed (41)**                                                                                         |
| Corrected cross-process queue, digest recovery and Proof OpenAPI files                                           | **Tests 19 passed (19)**                                                                                         |
| Data/outbox five affected files                                                                                  | **Tests 40 passed (40)**                                                                                         |
| Ledger batch plus existing ledger files                                                                          | **Tests 17 passed (17)**                                                                                         |
| API `vitest run src/sse/hub.test.ts`                                                                             | **Tests 18 passed (18)**                                                                                         |
| API `vitest run src/db-memory.test.ts`                                                                           | **Tests 1 passed (1)**                                                                                           |
| Tasks `vitest run test/soak-launch.test.ts test/render-blueprint.test.ts`                                        | **Tests 44 passed (44)**                                                                                         |
| API judge, 25-judge load, Proof hardening after ledger batching                                                  | **Tests 42 passed (42)**                                                                                         |
| `turbo run typecheck` filtered to api, tasks, contracts, db, outbox, test-kit, console, paypal-sim               | **9 successful tasks, 9 total (8 packages plus the token build)**                                                |
| `corepack pnpm exec tsc -p e2e/tsconfig.json --noEmit`                                                           | **Exit 0**                                                                                                       |
| Production dist smoke                                                                                            | **checks: 85/85 passed; SMOKE OK**                                                                               |
| `corepack pnpm e2e`                                                                                              | **61 passed (15 API + 23 Chromium + 23 reduced-motion); 2 pre-existing skips of the same phone-tamper scenario** |
| Final targeted e2e: API pacing and Chromium judge flows                                                          | **13 passed (10.7 minutes), no skips; browser press to answered POST 51,988 ms**                                 |
| First full API suite alone                                                                                       | **1,192 passed / 3 stale regression failures; all three files corrected and 19 tests passed together**           |
| Interrupted full API rerun, two workers                                                                          | **1,198 passed / 2 timeouts during an approximately 6 h 40 min host suspension; not acceptance evidence**        |
| Timeout files rerun individually, one worker, no code/assertion/timeout changes                                  | **quota.pg.test.ts: Tests 14 passed (14); verify-cli.test.ts: Tests 18 passed (18)**                             |
| Final full API suite alone: `vitest run --maxWorkers=2 --reporter=verbose` through the scratch PostgreSQL runner | **Tests 1200 passed (1200); Test Files 145 passed (145); 546.65 seconds; exit 0**                                |
| `biome ci` on every branch-changed TypeScript/JavaScript/JSON/Markdown file and memory evidence                  | **Checked 143 files; no fixes, no warnings**                                                                     |
| `corepack pnpm run deps:check`                                                                                   | **No dependency violations; 1,812 modules / 8,497 dependencies**                                                 |
| Main's strict ownership checker, isolated scope trees                                                            | **API, OPS, DATA, QA, CORE, CONSOLE, PPSIM passed**                                                              |

No dependencies, package manifests, lockfiles, published migrations, spec files or ownership-gate files changed.
No push was made. Human review / merger acceptance and real hosted acceptance remain outside this local work.

## Cross-package integration notes

ADR **0020** is used. The initial rebase contained 0016 and 0017; main's concurrent film merge occupied
0018 and 0019 during validation, so this unpublished ADR was renumbered. Mark paid uses the full `Provenance`
schema. Run count keys may include `STATE_REPLAY`; Proof adds `paid.paypalReplayed`,
`rails.paypalReplayedMembers`, progress `provenance` and `items.replayed`.

One additive QA change touches E1's in-flight `e2e/specs/api/paypal-pacing.spec.ts`. Its original 429,
positive wait, honoured retry and simulated invoice assertions are retained on a born-showcase fixture.
The fixture uses the private stack's normal seed window, never changes immutable workspace kind, creates the
invoice through HTTP with officer approval, and revokes its runtime-generated opaque credential. The new
judge case separately proves immediate replay, replay invoice provenance and no additional PayPal calls.
Merge this one-file change with E1's work.

The API regression fixture now exercises a short queue without removing any single-flight assertion.
The digest regression explicitly refuses re-signing tampered, unrecomputed lines under the cloud S1 fix;
a real by-hand correction then produces a different signed digest which matches the intercepted POST.
The original tamper-refusal and new-digest assertions remain. The data batching commit's subject says
"one database round trip"; the measured implementation uses **three queries** for 56 entries, versus 168.
