# Cloud handoff, 5 Nov 2026

Six independent tasks for a cloud Claude Code session on Linux. Each one is keyless (no secrets exist here, and none may be added), stays out of the areas being changed on the owner's laptop, and returns its results as a pushed branch with a report.
- **Base:** `origin/main` at `3e1ec112` (the light "Hayag" look, C6 experience fixes, the replay sweep, E1c, film script v4).
- **Branch for this note:** `cloud/handoff`. Branch every task from `origin/main`, not from here.
- **Deadline context:** the hackathon submission is Wed 11 Nov 2026. Results that land by 8 Nov can still be merged and shown.

## Set up the machine

```bash
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack enable
corepack pnpm install --frozen-lockfile
npx playwright install --with-deps chromium   # only for tasks that run e2e or a browser
```

- Node must be 24.19 or newer (`engines` in `package.json`; the repo pins 24.22.1).
- **Postgres:** the test harness in `packages/db/src/testing/cluster.ts` starts its own cluster from bundled binaries under `<package>/.cache/pg/` (gitignored). To use an existing server instead, set `FS_TEST_DATABASE_URL` to an admin URL.
- **Keyless replay:** PayPal is a contract-faithful in-process simulator (`packages/paypal-sim`, `tools/paypal-sim.ts`), and Claude's readings replay from recordings. Do not create a `.env` with real keys. `.env.example` lists the variable names only.
- The whole check that CI runs is `corepack pnpm verify` (`tools/verify.ts`); e2e is `corepack pnpm e2e`.

## Ground rules

Read `AGENTS.md`, `CONTRIBUTING.md` and `docs/ownership.md` first. Then:
- **One workstream per commit.** The commit scope is the workstream key: core, data, ppcore, ppmoney, ppsim, read, api, ops, ds, console, app, qa or media (`docs/**` is qa; `docs(adr)` counts as qa). Run `corepack pnpm ownership:check` before every push.
- **Never touch** `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `docs/versions.md`, any `package.json` (deps lane), `docs/spec/**`, `docs/ownership.md`, `tools/check-ownership.mjs` or `.github/workflows/ownership.yml`.
- **Add no dependencies.** Run tools through `npx --yes <package>@<exact version>`, choosing a version published at least 14 days ago.
- **Never skip git hooks** (`--no-verify`, `core.hooksPath`). Never add secrets, real email addresses or keys.
- **Honesty is a product feature.** Never change a seed figure (IC-03). Keep every "Simulated PayPal sandbox" label, every replay label and every synthetic-data disclosure. A replayed payout never reads as "Paid".
- **Push only your own branches** (`cloud/<slug>`). Never push to `main`, open or merge a PR, change repository settings, make the repository public, or post anything outside GitHub.
- **Tests first** for any fix: a failing test in one commit, the minimal fix in the next.

## Off limits: in flight on the owner's laptop

Do not edit these; write findings in your report instead.

| Area                 | Paths                                                                                                                                   | Why                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| UI redesign, round 2 | `apps/console/**`, `apps/mobile/src/**`, `packages/tokens`, `packages/ui-web`, `packages/ui-native`, `packages/motion`, `packages/i18n` | Six agents are rebuilding every screen     |
| Film                 | `video/**`, `media/**`                                                                                                                  | Narration, music and sound are being mixed |
| Security hardening   | `apps/api` rate limits, judge admission, the Proof cache and export                                                                     | A hardening branch is on its third round   |

## How to run it

1. Run the tasks **in parallel**, one subagent per task. Give each task its own git worktree on its own branch from `origin/main`: `git worktree add -b cloud/<slug> ../<slug> origin/main`.
2. Each task writes its report at `docs/reports/cloud-<slug>.md` (qa scope), covering what you ran, results with numbers, what you changed (commit list), and what is still open, with exact repros.
3. **Push early and often.** Push each task branch at its first useful commit, and again at least every hour. If the session ends, whatever was pushed is what the owner gets.
4. When every task is done or stuck, write `docs/handoff/cloud-status.md` on `cloud/handoff`. It is a table with one row per task: branch, head SHA, status (done, partial or blocked) and a one-line headline. Push it.
5. Do not wait for anyone: nobody can answer questions during the run. When a choice is unclear, take the safer option and note it in the report.

## The tasks (highest value first)

### T1 · Security audit of the money path · `cloud/security-audit`

Run an adversarial review of everything that can move money or fake proof, and prove every confirmed issue with a failing test.
- **Approvals:** Ed25519 signatures. Keys come only from `device_keys` for the role; approvers and keys are distinct; nonces are never reused; the `exp` window holds.
- **`PayoutsService.executeApproved`:** both digests are re-hashed from the database (invariant I4); the receiver, amount, item count, daily cap and balance guards hold; "already exists" adoption rebuilds the signed hash.
- **Webhook verification:** cert URL pattern, transmission freshness, `transmission_id` replay, the 64 KB cap, cert-fetch budgets.
- **The policy lattice:** `invoiceEqualsQuote` with unknown keys, strict date parsing, `sendNeedsTreasurer`, monotonicity (policies only tighten).
- **Credentials:** the judge cookie and scoped tokens (workspace taken from the credential), single-use pairing, member and brand link tokens.
- **IC-12 FrameBridge:** origin and source checks.
- **Proof's in-browser verify.**
- **Immutability:** the ledger and `run_events` (role privileges and the boot refusal).
- **The slip-injection quarantine.**

For each confirmed issue, give the severity, a failing test in that package's test folder (in its workstream scope) and a proposed fix. Fix it too if it is outside the off-limits table: the test first, then the minimal fix, one commit each. List rejected hypotheses briefly.

**Done means** every bullet above is marked "holds" or has a finding with a test.

### T2 · Linux clean-clone check (DR-4) · `cloud/dr4-linux`

Prove that a stranger on Linux can run Fair Split from the README, and fix what stops them.
1. On a fresh clone, follow the README's local steps exactly as written.
2. Then run `corepack pnpm verify`, every workspace test suite, `typecheck`, `biome ci`, `deps:check`, `build`, and `corepack pnpm e2e` in keyless replay. Also run the Render build and start commands from `render.yaml`, and `corepack pnpm verify-proof` against a locally running stack.
3. Rerun each failure up to three times to separate flaky from broken. Record the wall time per step.
4. Look for Windows-only assumptions: path separators, case-sensitive imports, CRLF, shell-specific scripts, drive letters, port clashes.
5. Fix what you can in `tools/`, `e2e/`, `packages/test-kit`, root scripts and the README's run instructions. Anything in the off-limits areas gets an exact repro in the report.

**Done means** the README path is green on Linux, or every red step has a repro and a cause.

### T3 · Mutation testing of the money core · `cloud/mutation-core`

Find weak spots in the tests that guard money, then kill them.
- Run StrykerJS through npx (an exact version at least 14 days old) with the Vitest runner, configured from a file you add under each package; do not touch any `package.json`. Cover:
  - `packages/domain`: integer-cent arithmetic, holds, the policy lattice, digests, the run, line and item state machines, invariants I1–I8
  - `packages/contracts`
  - the `packages/seed` canonical figures
  - `packages/outbox`
  - the money paths in `packages/paypal-*`
- Kill every survivor that matters (arithmetic, rounding, conservation, signature and digest inputs, policy verdicts, idempotency, state transitions) with new tests. Use fast-check where a property fits. Make one commit per package, in its scope.
- Change source only when a test exposes a real bug: the test first, the fix in its own commit, flagged at the top of the report.
- Skip `apps/api`.

**Done means** the report has the mutation score before and after for each package, and every remaining survivor has a reason it is acceptable.

### T4 · Android APK build on Linux · `cloud/apk-linux`

The plan needs Ubuntu for this, because local EAS builds refuse Windows.
1. Install JDK 17 and the Android SDK command-line tools.
2. In `apps/mobile` (Expo SDK 58), run `npx expo prebuild`, then `./gradlew assembleRelease` with R8 on. Sign with a throwaway keystore generated in the session, labelled "build-check". Never commit the keystore or the generated `android/` folder. No Expo login, no EAS cloud.
3. Report the APK size per ABI against the 35 MB budget, and its SHA-256.
4. Fix build problems only in build config (`app.json` or `app.config.*`, `eas.json`, config plugins, metro config), in the app scope. Do not touch `apps/mobile/src`.
5. Add `.github/workflows/android-apk.yml` (qa scope):
   - triggered by `workflow_dispatch` only, on ubuntu with JDK 17 and Gradle caches
   - signed from the repository secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` when they exist; otherwise debug-signed, with an artifact name that says "not release-signed"
   - uploads the APK and writes its SHA-256 to the job summary
6. If the network blocks Google's Maven or the SDK downloads, still write and lint the workflow, and report exactly what was blocked.

**Done means** an APK built, with its size and hash reported; or the blocker is documented and the workflow is ready to run.

### T5 · Judge-load soak in replay · `cloud/judge-soak`

Find out whether the hosted demo would hold up when many judges use it at once.
1. Start the full stack: Postgres and `fs-api` in keyless replay, serving the console.
2. Write load scripts in `tools/soak/` (ops scope), plain Node or Playwright with no new dependencies. Each run sends N concurrent judges through the 60-second loop: first press, resolve holds, both keys, payout, Proof, Reset.
3. Run at 10, 25 and 50 judges, plus one sustained run of at least 2 hours.
4. Measure:
   - first press to payout POST, p50 and p95 (target: 60 s or less)
   - reset time (target: 10 s or less)
   - SSE fan-out latency, p95 (target: 100 ms or less)
   - outbox rows stuck more than 5 minutes
   - memory and handle growth over time
   - DB connection count
   - error and 429 rates
   - whether the replay labels survive under load
5. Commit the CSVs (small) with the report. Fixes are allowed only outside the off-limits areas; for the rest, give the numbers and exact repros.

**Done means** all three load levels and the long run are measured, with the limits found and recommendations.

### T6 · Postman collection with tests · `cloud/postman`

1. Get the API's OpenAPI document from `apps/api` (`@hono/zod-openapi`, under `/v1`), from a running app or the repo's generator.
2. Build a Postman v2.1 collection in `postman/` (qa scope) with three parts:
   - **The judge's 60-second loop:** session, invoice, fund, read, holds, both approvals, payout, Proof, reset.
   - **Proof verify.**
   - **The labelled failure paths:** the insufficient-funds test value, the tamper refusal after both keys, a duplicate webhook delivery, and an expired or reused pairing token.
3. Add `pm.test` assertions on status codes, response schemas, idempotency, and the simulated-sandbox label on every PayPal value.
4. Add an environment file for localhost replay, and a runner script using `npx --yes newman@<exact version>`.
5. Run it green against the stack you started. Add a short "Postman" section to the README with the exact local steps. Do not claim the collection runs against a hosted demo.

**Done means** newman passes locally and its output is summarised in the report.

## If there is credit left over

Pick up the open items in the reports (yours first), or deepen T1 and T3. Do not start work inside the off-limits areas.
