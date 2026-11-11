# HD6 round 6: availability before hosting

11 November 2026. Worktree `fs-wt/hd6`, branch `wp/hd6-hardening-6`, reset from a clean
tree to `origin/main` (`febd48580931892a09937145b1390929780b1f91`). All checks use localhost,
the in-process simulator or intercepted test fixtures. PayPal values retain the label
"Simulated PayPal sandbox"; no seeded/replayed reading is presented as live Claude output,
and no invoice is claimed to be Claude-drafted. No ADR or dependency change was needed.

## Acceptance

1. **PASS** — `render.yaml:67`: old-space cap is 192 MiB, with the existing 8 MiB semi-space setting.
   `apps/tasks/test/render-blueprint.test.ts:133` failed first (192 expected, 128 actual), then passed.
   Historical round-5 measurements and the headroom calculation are below.
2. **PASS** — `apps/api/src/judge/session.ts:117`, `packages/api-client/src/client.ts:167`,
   `apps/api/src/lib/rate-limit.ts:52`: the client carries an advisory `x-fs-judge-attempt` header,
   starting at 1 and saturating at 8 after preparation refusals. Success or another API refusal resets it.
   Both admission-lock and clone-slot preparation responses use 250 ms × attempt, capped at 2 s,
   with jitter over 80–100% of that ceiling (including at the cap). Malformed attempts use 1.
   The nonrefundable per-network guard is bounded at 2,400 attempts/minute; successful-start limits,
   the global expensive-work budget and critical guess guards are unchanged.
   `judge/preparation.pg.test.ts` failed first with only 11/60 starts under the 600-attempt budget;
   the fixed code admits all 60 concurrent judges behind one NAT with clones slowed by 150 ms,
   and verifies the remaining attempt bucket can be exhausted and refuses further work.
   `packages/api-client/src/client.test.ts` verifies attempt transport, saturation and client isolation.
3. **PASS** — `apps/api/src/judge/lane.ts:213`, `judge/live-step.ts:260`: the bound counts time queued
   behind a local holder, plus time since the first cross-process lock refusal. A ready head's idle
   reservation contributes no blocked time. `judge/lane-wait.test.ts` failed first at both 6 s and 20 s;
   both delayed uncontended invoice tasks now stay live. Waiting behind a holder over 5 s still
   switches to labelled `lane_full` replay, including after promotion. Existing cross-process wait,
   written-live protection, single-flight and daily-quota tests remain.

## Memory budget

These are preserved **historical round-5 Windows/Node measurements**, not a fresh round-6 soak
or a hosted Linux guarantee. Source: `hd6-round5-memory.json`, final 25-judge policy and exact final
50-judge code samples. Changing the cap does not allocate 192 MiB immediately. Conservatively charging
the entire 64 MiB cap increase against the prior peak RSS gives:

| Judges | Peak used heap MiB | Peak allocated heap MiB | Peak RSS MiB | RSS plus 64 MiB | Headroom under decimal 512 MB |
| -----: | -----------------: | ----------------------: | -----------: | --------------: | ----------------------------: |
|     25 |              99.78 |                  120.61 |       224.87 |          288.87 |                    199.41 MiB |
|     50 |             106.39 |                  121.44 |       225.46 |          289.46 |                    198.82 MiB |

Against 512 MiB the remaining headroom is 223.13 / 222.54 MiB. This covers the measured process RSS
plus the full cap increase; final hosting still needs its own platform measurement.

## Verification

The scratch runner starts exactly one embedded PostgreSQL cluster under `.codex-scratch/test-pg`,
passes its local URL to the unchanged harness through `FS_TEST_DATABASE_URL`, and stops it in `finally`.
The full API suite ran alone, with one worker; it reported no timeouts or failures.

| Command / check                                                                                                                   | Result                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `corepack pnpm install --frozen-lockfile --prefer-offline`                                                                        | Already up to date                                                                                        |
| Tasks `vitest run test/render-blueprint.test.ts`                                                                                  | RED first: 1 failed / 42 passed; GREEN: **Tests 43 passed (43)**                                          |
| API `vitest run src/judge/lane-wait.test.ts --maxWorkers=1` before implementation                                                 | RED: **2 failed / 14 passed**, both uncontended delayed invoices incorrectly replayed                     |
| Client `vitest run src/client.test.ts` before implementation                                                                      | RED: **1 failed / 9 passed**, missing attempt headers                                                     |
| API `vitest run src/judge/preparation.pg.test.ts --maxWorkers=1` before implementation                                            | RED: **2 failed**, fixed hint and only 11/60 starts                                                       |
| API affected files: preparation, lane-wait, lane, failed-start, contended-start, judge, rate-limit-availability; `--maxWorkers=1` | **Tests 70 passed (70)**                                                                                  |
| Client `vitest run src/client.test.ts`                                                                                            | **Tests 10 passed (10)**                                                                                  |
| Full API `vitest run --maxWorkers=1`, alone                                                                                       | **Tests 1205 passed (1205); Test Files 146 passed (146)**; 1561.87 seconds                                |
| API smoke through scratch runner (`node --import tsx src/smoke/run.ts`)                                                           | **checks: 85/85 passed; SMOKE OK**                                                                        |
| `corepack pnpm e2e`                                                                                                               | API **16 passed**; Chromium **22 passed / 1 failed / 1 pre-existing skip**; stopped before reduced motion |
| `corepack pnpm e2e --project=chromium specs/browser/dr0-moments.spec.ts`, alone                                                   | **1 passed**, unchanged assertions; POST answered **51,513 ms**, Reset **215 ms**                         |
| `corepack pnpm e2e --project=reduced-motion`                                                                                      | **23 passed / 1 pre-existing skip**, no failures                                                          |
| `corepack pnpm exec turbo run typecheck --filter=@fairsplit/api --filter=@fairsplit/api-client --filter=@fairsplit/tasks`         | **3 successful, 3 total**                                                                                 |
| `npx --no-install biome ci` on all changed paths                                                                                  | **Checked 13 files; no fixes**                                                                            |
| `corepack pnpm run deps:check`                                                                                                    | **No dependency violations; 1,813 modules / 8,503 dependencies**                                          |
| Main's checker: `node .codex-scratch/co.mjs --repo . --branch ws/<scope> --base main --head <scope-only branch> --strict`         | **OPS, API and QA passed**; scope-only commits cherry-picked onto main; temporary branches removed        |

The first Chromium failure was `e2e/lib/moments.ts:108`: the Member-frame observer did not find
MM-1 `flood` after `pending` → `press`. Its POST timing had passed at **52,685 ms**. The exact
scenario passed alone without any code, assertion or timeout change. Reduced-motion DR-0 also
passed with POST answered **46,775 ms**, Reset **209 ms**. The main browser journeys answered
POST in **51,912 ms** (Chromium) / **46,134 ms** (reduced motion).

Read-only review found that the unchanged mobile hook (`apps/mobile/src/ui/moment.tsx:64`) emits
phases through React state, while the console hook writes phase attributes synchronously. React
batching of the closely scheduled `flood` / `fill` phases is a plausible explanation, not a proven
root cause. No app, console or e2e source changed in this package. Initial failure artifacts and
all runner logs remain in ignored `.codex-scratch/`; the failure is retained as evidence.

Across the initial run, isolated rerun and remaining project, all **62 active e2e scenarios** passed;
the same pre-existing phone-tamper scenario is skipped in each browser project. The initial full command
returned nonzero for the recorded phase-order failure, so this is not a claim of a green first invocation.

## Handoff

Only ops, api and qa paths changed, in separate commits with the required Codex trailer. Critical guess
guards and every existing R1/R2 test body remain unchanged. No new dependency, contract, migration, ADR,
ownership gate, app, console or e2e source changed. No push was made. All started servers and PostgreSQL
clusters were stopped; scratch scripts, logs and failure artifacts are ignored under `.codex-scratch/`.

The three requested availability fixes are complete. Hosted Linux RSS acceptance remains with hosting;
the budget above is explicitly a projection from historical local samples. The unchanged mobile phase-hook
observation is a cross-package note for its owner, with both the initial failure and unchanged pass retained.
