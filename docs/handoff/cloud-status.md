# Cloud handoff status

Status of the six tasks in [cloud.md](cloud.md). Every branch is cut from `origin/main` at `3e1ec112`; each carries
its report at `docs/reports/cloud-<slug>.md`. Provisional: rows marked "running" are still in progress and this
table will be updated when they finish.

| Task | Branch                 | Head SHA  | Status  | Headline                                                                                                                                                                                                                |
| ---- | ---------------------- | --------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1   | `cloud/security-audit` | `b9320ff` | done    | Every bullet holds or is fixed. S1 (Medium): a cash line's amount could change after both keys and still be posted; fixed by re-hashing lines from their columns. S2 (Low): boot role check missed column-level UPDATE. |
| T2   | `cloud/dr4-linux`      | `4af886c` | running | Linux clean-clone check in progress.                                                                                                                                                                                    |
| T3   | `cloud/mutation-core`  | `13cd07e` | running | Mutation testing in progress.                                                                                                                                                                                           |
| T4   | `cloud/apk-linux`      | `1e561f2` | running | APK build and `android-apk.yml` workflow in progress.                                                                                                                                                                   |
| T5   | `cloud/judge-soak`     | `2169db8` | running | Load levels measured; the 2-hour sustained run is in progress.                                                                                                                                                          |
| T6   | `cloud/postman`        | `0070f3c` | done    | newman 6.2.3 green locally: 124-125 requests, 424-426 assertions, 0 failed over four runs. Found F1/F2: a replayed run's Mark paid says `simulated_rail` and its lines read `PAID`.                                     |

## Environment notes

- The cloud machine had Node 22; Node 24.22.1 (checksum-verified) was installed for the run.
- The embedded Postgres harness refuses to run as root (`initdb: cannot be run as root`), and the cloud session runs
  as root. Each task used its own Postgres 17.10 server (the harness's own binaries, run as the `postgres` user)
  through `FS_TEST_DATABASE_URL`. `packages/db`'s `harness-global-setup.test.ts` fails as root for the same reason;
  that is an environment artefact, not a product finding. T2 covers it as a Linux-stranger trap.
- The machine was shared by six agents (4 cores, 16 GB). Timings were taken under contention; see each report.
- The container restarted once mid-run; in-flight processes (including a soak run) were lost and the tasks resumed.
