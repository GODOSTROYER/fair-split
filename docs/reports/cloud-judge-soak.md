# Cloud T5: judge-load soak in replay (`cloud/judge-soak`)

Status: **in progress**. The 10/25/50 levels are measured; the 2-hour run is going. This file is updated as runs finish.

## Headline

- **On the labelled replay path (what most judges get on the hosted demo once an hour's three live payouts are
  used), the loop holds at 10 judges and degrades past 25.** First press to the payout POST: p95 **30 s** at 10,
  **62 s** at 25, **225 s** at 50. Reset stays at p95 **≤ 162 ms**, and every replay label held: **0 violations in
  85 replayed runs**.
- **The live path does not hold even at 10 simultaneous judges.** On a fresh hour every judge is "live" at the
  press, and the single-flight live lane paces them at about one PayPal burst per 40 s, however fast PayPal answers.
  At 10 judges the first press to the POST took p50 **900 s**, p95 **1,103 s**. At 25 judges **none** reached the
  POST within 15 minutes of waiting. The cause is the lane's ETA-based retry (F1). It sits in judge admission, which
  is off limits, so it is reported, not fixed.
- Nothing leaked within a run: no outbox row stuck for more than 5 minutes, no dead rows, DB connections flat at
  13–14, file descriptors back to baseline after every run. RSS under tsx peaked at **674 MB**, which is above
  Render's `0.5c-512mb` plan (F5).

## What ran

| Item     | Value                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Base     | `origin/main` 3e1ec11                                                                                                                                                                      |
| Node     | 24.22.1 (`corepack pnpm` 11.28.6), Linux x64, 4 cores, 15 GB, **shared with five other agents** (load averages 10–50 during runs)                                                          |
| Postgres | external **PostgreSQL 17.10** (`FS_TEST_DATABASE_URL`), not the embedded cluster: `initdb` refuses to run as root on this machine                                                          |
| Stack    | `tools/soak/stack.ts` → `e2e/stack/stack.ts`, unchanged: fs-api via tsx, `PP_MODE=simulator`, keyless, `NODE_ENV=test`, `FS_TEST_JUDGE_HOURLY_MAX=24`, console, `/app` and `/media` served |
| Load     | `tools/soak/run.ts`: plain `node:http`, one cookie jar and one loopback source address (127.x.y.z) per judge, no new dependencies                                                          |
| Fresh    | each level on a fresh stack and a fresh `fs_e2e` database                                                                                                                                  |

The loop each judge runs is the e2e `api` project's sequence (`e2e/lib/judge-run.ts`, `cold-judge-timing.spec.ts`):
1. First press with no cookie (QUEUED honoured).
2. Two SSE streams on the run (the per-credential cap is 2).
3. INVOICED, then Mark paid (QUEUED honoured), then IN_REVIEW.
4. Slip 0462 by hand, then H1–H3.
5. The Chair's frame, both browser demo keys with proof of possession, then both keys.
6. POSTING, POSTED, Rhea to cash, SETTLED.
7. Proof verification and metrics, then Reset, then a check that the old token is refused.

Waits follow the event stream, with a fallback `GET /v1/runs/:slug` every 5 s. A judge gives up on a step after
`--step-s` (900 s, 15 minutes, unless noted) and presses Reset, as a person would.

Commands (each on a fresh stack):

```sh
export FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/postgres E2E_SKIP_BUILD=1
corepack pnpm exec tsx tools/soak/stack.ts &   # writes .codex-scratch/soak/stack.json (owner-only; never printed)
corepack pnpm exec tsx tools/soak/run.ts --label=n10 --judges=10 --step-s=900                    # e2e quota config
corepack pnpm exec tsx tools/soak/run.ts --label=r50 --judges=50 --step-s=900 --prod-quota=0    # every run replays
corepack pnpm exec tsx tools/soak/run.ts --label=long --judges=10 --minutes=125 --step-s=900 --prod-quota=3
```

### Two quota configurations, both named

- **e2e stack as given** (`n*` runs): hourly cap 24 (test override). The simulator's balance reading gives a daily
  cap of 40 and a public share of 13. Every judge pressing on a fresh hour is live.
- **Production quota emulated** (`r*` runs = `--prod-quota=0`, `long` = `--prod-quota=3`): on the local stack only,
  the run inserts explicitly labelled synthetic reservations into the judge-quota ledger (`summary.soakFixture =
  "soak-production-hourly-quota-emulation"`, coded, US$0; the technique of `e2e/lib/judge-quota.ts`). They bring the
  hour's cap down to production's 3 (`long`), or to 0 (`r*`: every run is a labelled `hourly_cap` replay, which is the
  hosted demo once an hour's three are used). They are re-inserted at each new clock hour. No code or setting
  changes. This is a **non-production database manipulation**, used to reach production's quota on a test stack.

## Results by load level

Load averages are the host's 1-minute `uptime` at the start, then the peak during the run (4 cores). Times are from
the first press, on the client's clock.

| Run                   | Judges | Load start/peak | Outcome      | Press → payout POST p50 / p95 | ≤ 60 s | Reset p50 / p95 | SSE fan-out p95 tail / all / spread | 429s / requests | 5xx | RSS start → peak MB | fds peak | DB conns | Stuck outbox | Label violations |
| --------------------- | -----: | --------------- | ------------ | ----------------------------- | -----: | --------------- | ----------------------------------- | --------------- | --: | ------------------- | -------: | -------: | -----------: | ---------------: |
| r10 replay            |     10 | 14 / 15         | 10 settled   | **27.3 s / 29.8 s**           |  10/10 | 10 / 42 ms      | 56 / 123 / 4 ms                     | 5 / 335         |   0 | 337 → 524           |       65 |       13 |            0 |                0 |
| r25 replay            |     25 | 11 / 12         | 25 settled   | **53.6 s / 62.2 s**           |  18/25 | 15 / 28 ms      | 50 / 108 / 4 ms                     | 50 / 980        |   0 | 338 → 674           |      110 |       13 |            0 |                0 |
| r50 replay            |     50 | 28 / 50         | 50 settled   | **191.6 s / 225.3 s**         |   0/50 | 36 / 162 ms     | 141 / 273 / 7 ms                    | 230 / 3,269     |   0 | 336 → 646           |      185 |       13 |            0 |                0 |
| n10 live              |     10 | 27 / 49         | 10 settled   | **900.1 s / 1,103.2 s**       |   0/10 | 13 / 43 ms      | 79 / 155 / 13 ms                    | 21 / 2,026      |  10 | 334 → 371           |       66 |       14 |            0 |                0 |
| n25 live              |     25 | 19 / 47         | **25 stuck** | none reached the POST         |   0/25 | 19 / 62 ms      | 69 / 106 / 8 ms                     | 84 / 7,054      |   0 | 336 → 400           |      111 |       13 |            0 |                0 |
| n10 live, 180 s steps |     10 | 12 / 27         | **10 stuck** | none within 3 min per step    |   0/10 | –               | –                                   | 15 / 479        |   0 | 338 → 379           |       66 |       13 |            0 |                0 |
| n50 live              |     50 | pending         |              |                               |        |                 |                                     |                 |     |                     |          |          |              |                  |

How the time splits (p50, seconds from the press; `*-judges.csv`):

| Run | Press 201 | INVOICED | FUNDED | IN_REVIEW | Both keys | POSTING | SETTLED |
| --- | --------: | -------: | -----: | --------: | --------: | ------: | ------: |
| r10 |       3.6 |      6.0 |    6.2 |      24.8 |      26.6 |    28.3 |    53.8 |
| r25 |       7.2 |      9.3 |    9.5 |      49.3 |      51.1 |    53.6 |    79.2 |
| r50 |      18.2 |     23.7 |   23.9 |     156.3 |     160.3 |   192.2 |   227.7 |
| n10 |       3.6 |    204.6 |  572.2 |     584.3 |     587.1 |   948.0 | 1,276.4 |
- **Replay:** the time goes into the reading (FUNDED → IN_REVIEW: 19 s at 10, 40 s at 25, 132 s at 50), and into the
  press at 50 (230 × `429 QUEUED PREPARING_WORKSPACE`).
- **Live:** the time goes into every PayPal step (invoice, record payment, POST, cancel), each waiting its turn in
  the lane.

## Findings

### F1 · The live lane paces at its 40 s ETA, not at PayPal's speed (live path collapses at 10 judges)

In `apps/api/src/judge/lane.ts`, a step that is not at the head gets `etaMs = position × burstMs` (40 s), and its
outbox row is re-queued with that wait (`run_after`, via `money/rail.ts`). When the head's burst ends after about
1 s on the simulator, the next entry becomes head with a 60 s reservation. But its task does not ask until its own
`run_after`, which can be minutes away for a deep position.

Meanwhile, the PayPal window had room the whole time: it peaked at 12 of 40 calls/min, with 0 PayPal 429s. Each live
run needs four lane bursts, and each of a run's steps joins at the back of the lane, behind every other judge's
steps. So with N live judges the POST comes after roughly 3N × 40 s:
- n10: posts 499–1,103 s after the press.
- n25: all 23 judges at APPROVED were still waiting for the POST after 15 minutes. Their `postPayoutBatch` rows were
  queued about 40 s apart.

Production's 3-per-hour cap does not prevent this. The steps before the POST only _peek_ at the quota, so on a fresh
hour every judge who presses before the third POST lands is live, and all of them queue in the lane.

Repro (fresh stack, e2e config): `corepack pnpm exec tsx tools/soak/run.ts --judges=2 --step-s=900`. The smoke run
posted 98 s and 137 s after the press. With `--judges=10`, see `n10-judges.csv`. While it runs, watch `GET
/v1/judge/lane` (`depth`) and `select name, run_after - now() from task_outbox where state = 'queued'`.

Recommendations (judge admission, off limits here):
- When a burst releases the lane, wake the next head's task (an outbox `pg_notify`, or set its `run_after` to now)
  instead of each entry trusting a position × 40 s guess.
- Feed `burstMs` from measured bursts (about 1–2 s on the simulator).
- Bind the hour's live slots at the _press_, not only at the POST. Judges past the hour's three would then be
  labelled replay from the start, instead of spending 15 minutes in the lane and replaying at the POST anyway.

### F2 · A busy lane makes pay-cash answer `503 CIRCUIT_OPEN` "the sandbox is pacing us", with no 429 anywhere

In n10, **all 10** `POST /v1/lines/:id/pay-cash` calls answered `503 CIRCUIT_OPEN`, with the message "The simulated
PayPal sandbox is pacing us; the cancel waits". Meanwhile `paypal_calls` held **0** 429s and the window peaked at 12
of 40. The cancel was only queued behind other judges in the lane:
- In `apps/api/src/runs/tasks.ts`, `cancel()`, case `"REFUSED"`, maps `outcome.code === "QUEUED"` to
  `PayPalStepError("CIRCUIT_OPEN", …)` with a 30 s retry.
- The cancel still runs later from the outbox, and every run settled.
- But the answer names the wrong cause (the 6-minute 429 circuit), and it is a 503 rather than the 429 QUEUED that
  every other paced step answers. The stage may say "pacing us… a few minutes" for a 30 s lane wait.

Repro: two live judges at once (`run.ts --judges=2`). The second judge's pay-cash answers 503 CIRCUIT_OPEN while
`select count(*) from paypal_calls where status = 429` is 0. Recommendation: answer `429 QUEUED` with the lane's
`retryAfterMs` there, as Mark paid does. This is not fixed here, because the console (off limits) reads these codes.

### F3 · Replay path: the inline executor runs every judge's reading two at a time

fs-api runs outbox tasks inline with `concurrency: 2` (`packages/outbox/src/executors.ts`; fs-api has no worker,
`EXECUTOR=inline` in `render.yaml`). Every judge's reading (about 1,400 replayed events per run), agent turn and
settle checks share those two slots. Reading time (FUNDED → IN_REVIEW, p50) grows with load:

| Judges | FUNDED → IN_REVIEW |
| -----: | -----------------: |
|     10 |               19 s |
|     25 |               40 s |
|     50 |              132 s |

This sets the replay-path limit at **about 25 simultaneous judges for a p95 near 60 s on this host**.
Recommendation (WS-DATA/WS-API): raise inline concurrency for replay-only tasks, or batch a replayed reading's event
inserts.

### F4 · The warm workspace pool is 3

`POOL_TARGET = 3` (`apps/api/src/judge/pool.ts`), and clones are single-flight. A burst of presses beyond the pool
answers `429 QUEUED PREPARING_WORKSPACE` (retry 3 s). The press reached 201 at p50 3.6 s at 10 judges, 7.2 s at 25
and 18.2 s at 50 (max 32.9 s), with 230 QUEUED answers at 50. The answers are honest and honoured, and no judge was
refused. A larger pool before a judging window would remove the wait.

### F5 · Memory (tsx) exceeds Render's 512 MB plan under replay load

Measured RSS of fs-api (`/proc/<pid>/status`):
- Idle after boot: about 335 MB.
- Replay runs: 524 MB at 10 judges, **674 MB** at 25, 646 MB peak at 50.
- Live runs: about 400 MB.

`render.yaml` gives fs-api `plan: 0.5c-512mb` and runs the built `node apps/api/dist/index.js`, not tsx. The tsx
loader and its in-memory transpile inflate the absolute numbers here, so the hosted process starts lower; that was
not measured (open item). The growth during a run is what transfers: about +190 MB at 10 replay judges and +340 MB at
25. RSS falls back after a run (n10: 371 → 208 MB). See the 2-hour run's trend before calling anything a leak.
Recommendation: measure the dist build under r25 and keep at least 25 % headroom, or move fs-api to the 1 GB plan
for the judging window.

### F6 · What held

- **Labels (I8):** 0 violations in every run.
  - Every replayed run's rail decision read `Replay: this hour's simulated PayPal sandbox payouts are used up`.
  - Replayed runs: Proof `verification.status` read `replay`, plate `payoutItems.state` = `replay`, PayPal-verified
    members = 0, and every `item.updated` event carried `provenance: replay`.
  - Live runs: the simulated label, Proof `sample`, 7 PayPal-verified members.
  - `X-FS-Rail: simulated` was on every answer, and no event naming Claude lacked the replay provenance.
  - After Reset, the old console token got 401.
  - The line DTO state of a replayed payout is still `PAID` (`PAID:7 OFF_RAIL_DUE:57`). Whether the stage renders
    it as "Paid" was not checked in a browser here (console off limits); see open items.
- **Reset:** p95 ≤ 162 ms at every level; target ≤ 10 s.
- **Outbox:** 0 rows queued past their `run_after` or in flight for more than 5 minutes, and 0 dead rows, in every
  run.
- **DB connections** (`pg_stat_activity` on `fs_e2e`): 13–14 at every level. The pool (`DB_POOL_MAX` default 10),
  LISTEN and the limiter never grew past that.
- **File descriptors:** they track the open SSE streams and sockets (peak 185 with 50 judges × 2 streams) and return
  to 33–36 after each run.
- **429s:** all were `QUEUED` (the workspace pool at the press, the lane at Mark paid). No `RATE_LIMITED`, because
  each judge had its own address. 0 SSE stream refusals.
- **Errors:**
  - 5xx: only F2's 503s.
  - `read ECONNRESET` on 10–17 `GET /v1/runs/:slug` calls per run. This is the client's 5 s fallback GET reusing a
    keep-alive socket just as Node's default 5 s `keepAliveTimeout` closes it: a load-tool artefact, and browsers
    retry these.

### SSE fan-out: method

Each judge opens two streams on its run. For every live event (not one replayed after Last-Event-ID) seen on both
streams, three numbers are recorded:
- **all:** `arrivedAt − at`, where `at` is the event's `clock_timestamp()` at insert, on the same host clock. This is
  an upper bound, because it also counts the rest of the inserting transaction.
- **tail:** the same lag for the last-written event of each burst (arrivals within 3 ms of each other). Its write is
  the closest to the commit, so this is the client-side estimate of commit → delivery.
- **spread:** `|arrival on stream A − arrival on stream B|`, how far apart two subscribers hear the same event.

Fan-out p95 (tail) was 50–79 ms up to 25 judges and **141 ms at 50** (host load 50 on 4 cores), against a 100 ms
target. Spread p95 stayed ≤ 13 ms: the single LISTEN connection's fan-out did not slow with more subscribers.

## Sustained run (≥ 2 h)

Pending: `long`: 10 judges looping, 125 minutes, production quota emulated (3 live per clock hour), 30 s samples;
`long-minutes.csv`, `long-metrics.csv`.

## How a hosted Render instance differs

- **CPU:** 0.5 vCPU (`0.5c-512mb`) against 4 shared cores at load averages of 10–50 here. The replay limit (F3:
  CPU-bound inline tasks) will be lower on Render, plausibly 10–15 judges for p95 ≤ 60 s. The lane limit (F1) is
  timer-bound and the same anywhere.
- **Memory:** the dist build has a lower base, but the cap is 512 MB (F5).
- **Network:** judges come through Cloudflare and Render's proxy, and the per-IP throttles key on `CF-Connecting-IP`.
  Judges in one room behind one NAT share **30 new sessions an hour** (`RATE_RULES.judgeSessionPerIp`), then get
  `429 RATE_LIMITED`. This run gave every judge its own address; see open items.
- **Database:** Render Postgres over the network adds per-query latency that this local server does not have.
- **Quota:** production's hourly cap is 3, with no test override. The `r*` and `long` runs emulate it.

## Changes (commits)

| SHA     | Scope | What                                                                   |
| ------- | ----- | ---------------------------------------------------------------------- |
| df68089 | ops   | `tools/soak/` (stack wrapper, client, judge loop, sampler, run), tests |
| 00fc69c | qa    | report skeleton                                                        |
| 02d7c10 | ops   | step budget, production-quota emulation, socket error codes            |
| 1061c4b | qa    | CSVs for n10/n25 live and r10/r25/r50 replay                           |

`apps/tasks/tsconfig.json` now typechecks `tools/soak/*.ts`. `apps/tasks/test/soak.test.ts` covers the pure parts:
percentiles, CSV, judge addresses, the `inv.i8.soak-labels` rail-label check and fan-out bursts.

## Files

`docs/reports/cloud-judge-soak/<run>-{judges,metrics,endpoints}.csv` and `<run>-summary.json`:
- `judges`: one row per judge, with step times in ms from the press.
- `metrics`: server samples every 15–30 s, with load averages.
- `endpoints`: per-endpoint latency and status counts.

## Safer-option decisions

- Each judge got its own loopback source address. One shared address would have hit the per-IP cap (30 new sessions
  an hour) and hidden every other limit; the shared-address case is reported separately.
- The production quota is emulated with labelled ledger rows, with no env or code change.
- Nothing in `apps/api` was changed: F1, F2 and F4 are in or next to the off-limits judge admission and pacing code,
  and the console reads their codes. They are reported with numbers and repros only.
- External Postgres 17.10 instead of the embedded cluster (root). The stack code is unchanged.
