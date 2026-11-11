# Cloud handoff status

Final status of the six tasks in [cloud.md](cloud.md). Every branch is cut from `origin/main` at `3e1ec112`, is
fully pushed, and carries its report at `docs/reports/cloud-<slug>.md`. Every commit was checked against its own
workstream with `node tools/check-ownership.mjs --ws <key> --base <sha>^ --head <sha>`; the one exception is
noted under T5.

| Task | Branch                 | Head SHA  | Status  | Headline                                                                                                                                                                                                                                                                      |
| ---- | ---------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | `cloud/security-audit` | `b9320ff` | done    | Every bullet holds or is fixed, tests first. S1 (Medium): a cash line's amount could change after both keys and still be posted; lines are now re-hashed from their columns. S2 (Low): the boot role check missed column-level UPDATE. apps/api 1,065/1,065.                  |
| T2   | `cloud/dr4-linux`      | `f51906c` | done    | The README path is green on Linux for a non-root user: `pnpm verify` from a clean clone in 546 s, e2e 61 passed (2 fixme), Render commands and `verify-proof` six of six. Fixed the Postgres harness: a clear root refusal, no broken cluster after a killed initdb.          |
| T3   | `cloud/mutation-core`  | `6c3586d` | partial | Mutation scores before → after: domain 75.82% → 88.65%, paypal-payouts 73.44% → 92.98%, paypal-core 76.83% → 80.01%, outbox 66.56% → 70.33%, contracts 68.82% → 92.47%, seed 80.48% (unchanged). No bug in the money code. Stopped by the owner before the final report pass. |
| T4   | `cloud/apk-linux`      | `7c1d5f1` | done    | The R8 release APK built on Linux (JDK 17, throwaway key). 3 of 4 ABIs miss the 35 MB budget (arm64-v8a 42.36 MB, armeabi-v7a 33.08, x86_64 44.95, x86 44.90). `android-apk.yml` is ready and lint-clean; it has not run on GitHub.                                           |
| T5   | `cloud/judge-soak`     | `5b4cef6` | done    | The replay path holds to about 25 judges (payout POST p95 30 s at 10, 62 s at 25, 225 s at 50); a 130-minute run showed no leaks and 0 label violations in about 1,270 replays. The live path collapses at 10 judges (the single-flight lane, F1).                            |
| T6   | `cloud/postman`        | `0070f3c` | done    | newman 6.2.3 green locally: 124-125 requests, 424-426 assertions, 0 failed over four runs. F1/F2: a replayed run's Mark paid says `simulated_rail` and its lines read `PAID`.                                                                                                 |

## For the merger

- **T5:** commit `e09fc8f` (`fix(ops)`) also deletes three `docs/reports/cloud-judge-soak/long-interrupted-*.csv`
  files, which are qa paths, so it fails the per-commit ownership check; `6960f11` re-adds them as
  `long-seg1-*.csv`. Split or squash it at merge.
- **T3:** the report's survivor reasons were not given a final pass; the per-package table and findings are
  current as of `6c3586d`.
- **T4:** the per-ABI size fix (`android.useLegacyPackaging`) is a projection, not a measured build, and is not
  committed; it changes what ships, so it is WS-APP's call. The two new action pins need a deps PR for
  `docs/versions.md`.

## Environment notes

- The cloud machine had Node 22; Node 24.22.1 (checksum-verified) was installed for the run.
- The embedded Postgres harness refuses to run as root (`initdb: cannot be run as root`), and the cloud session runs
  as root. Each task used its own Postgres 17.10 server (the harness's own binaries, run as the `postgres` user)
  through `FS_TEST_DATABASE_URL`. `packages/db`'s `harness-global-setup.test.ts` fails as root for the same reason;
  that is an environment artefact, not a product finding. T2 covers it as a Linux-stranger trap.
- The machine was shared by six agents (4 cores, 16 GB), and was OOM-killed once. Timings were taken under
  contention; see each report.
- The container restarted twice mid-run; in-flight processes (including two soak segments and one APK build) were
  lost and the tasks resumed.
