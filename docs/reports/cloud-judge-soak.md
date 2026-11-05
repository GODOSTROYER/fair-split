# Cloud T5: judge-load soak in replay (`cloud/judge-soak`)

Status: **done**, apart from the n50 live-config row, which is still running when this is written (filled in below
when it lands). Measured on 4–5 Nov 2026.

## Headline

- **The labelled replay path (what most judges get on the hosted demo once an hour's three live payouts are used)
  holds up to about 25 simultaneous judges.**
  - First press to the payout POST, p95: **30 s** at 10 judges, **62 s** at 25, **225 s** at 50.
  - In the sustained run (10 judges looping, 130 min, 1,143 judge loops): p95 **21 s**.
  - Reset: p95 **≤ 162 ms** everywhere.
  - **0 label violations in about 1,270 replayed payouts.**
- **The live path does not hold even at 10 simultaneous judges.** Every judge who presses early in a clock hour is
  "live" until the hour's POSTs land. The single-flight live lane then paces them at about one PayPal burst per 40 s,
  however fast PayPal answers:
  - 10 judges: p50 **900 s**, p95 **1,103 s**.
  - 25 judges: **none** reached the POST within 15 minutes of waiting.
  - With production's quota (sustained run), the 9 live judges took **776–817 s**, and each new clock hour stalled all
    10 looping judges for about 15 minutes (F1).
- **Two ways a crowd gets refused or misled:**
  - Behind one NAT, presses that answer QUEUED use up the network's 30 session starts an hour. **Only 5 of 35
    judges** got in, and 30 got `429 RATE_LIMITED` (F8).
  - A busy lane makes Rhea's pay-cash answer `503 CIRCUIT_OPEN`, "the sandbox is pacing us", with no 429 anywhere
    (F2).
- **No leaks in 130 minutes:**
  - RSS flat at about 440 MB after warm-up.
  - fds ≤ 67, DB connections ≤ 13, no outbox row stuck for more than 5 minutes, no dead rows.
  - But fs-api's RSS reaches **644 MB on the production build** at 25 replay judges, against Render's
    `0.5c-512mb` plan (F5).
  - `run_events` grows by about 1,450 rows (≈ 0.8 MB) per judge loop until the hourly fs-cron purge (F9).
- **SSE fan-out p95** (commit → delivery estimate) was 21–79 ms up to 25 judges, and **141 ms at 50** on a host at
  load 50 (target ≤ 100 ms).

## What ran

| Item     | Value                                                                                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base     | `origin/main` 3e1ec11                                                                                                                                                                                                       |
| Node     | 24.22.1 (`corepack pnpm` 11.28.6), Linux x64, 4 cores, 15 GB, **shared with five other agents** (1-minute load averages 1–50 during runs, recorded in every `metrics.csv`)                                                  |
| Postgres | external **PostgreSQL 17.10** (`FS_TEST_DATABASE_URL`, trust auth, `max_connections=300`, harness options), not the embedded cluster: `initdb` refuses to run as root here                                                  |
| Stack    | `tools/soak/stack.ts` → `e2e/stack/stack.ts`, unchanged: fs-api via tsx (`--dist`: the production build), `PP_MODE=simulator`, keyless, `NODE_ENV=test`, `FS_TEST_JUDGE_HOURLY_MAX=24`, console, `/app` and `/media` served |
| Load     | `tools/soak/run.ts`: plain `node:http`, one cookie jar and one loopback source address (127.x.y.z) per judge, no new dependencies                                                                                           |
| Fresh    | every run on a fresh stack and a fresh `fs_e2e` database                                                                                                                                                                    |

The loop each judge runs is the e2e `api` project's sequence (`e2e/lib/judge-run.ts`, `cold-judge-timing.spec.ts`):
1. First press with no cookie (QUEUED honoured).
2. Two SSE streams on the run (the per-credential cap is 2).
3. INVOICED, then Mark paid (QUEUED honoured), then IN_REVIEW.
4. Slip 0462 by hand, then H1–H3.
5. The Chair's frame, both browser demo keys with proof of possession, then both keys.
6. POSTING, POSTED, Rhea to cash, SETTLED.
7. Proof verification and metrics (and, for a replayed payout, the treasurer's Proof export), then Reset, then a
   check that the old token is refused.

Waits follow the event stream, with a fallback `GET /v1/runs/:slug` every 5 s. A judge gives up on a step after
`--step-s` (900 s, 15 minutes, unless noted) and presses Reset, as a person would.

Commands (each on a fresh stack):

```sh
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0 E2E_SKIP_BUILD=1
export FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:<port>/postgres
corepack pnpm exec tsx tools/soak/stack.ts [--dist] &  # state in .codex-scratch/soak/stack.json (owner-only, never printed)
corepack pnpm exec tsx tools/soak/run.ts --label=n10 --judges=10 --step-s=900                     # e2e quota config
corepack pnpm exec tsx tools/soak/run.ts --label=r50 --judges=50 --step-s=900 --prod-quota=0     # every payout replays
corepack pnpm exec tsx tools/soak/run.ts --label=s35 --judges=35 --shared-ip --prod-quota=0      # one NAT
corepack pnpm exec tsx tools/soak/run.ts --label=long-seg3 --judges=10 --minutes=125 --step-s=900 --prod-quota=3
```

### Two quota configurations, both named

- **e2e stack as given** (`n*` runs): hourly cap 24 (test override). The simulator's balance reading gives a daily
  cap of 40 and a public share of 13. Every judge pressing on a fresh hour is live.
- **Production quota emulated** (`r*`, `d25`, `s35` = `--prod-quota=0`; `long-*` = `--prod-quota=3`): on the local
  stack only, the run writes explicitly labelled synthetic reservations into the judge-quota ledger
  (`summary.soakFixture = "soak-production-hourly-quota-emulation"`, coded, US$0; the technique of
  `e2e/lib/judge-quota.ts`). They bring the hour's cap down to production's 3, or to 0, where every payout is a
  labelled `hourly_cap` replay (the hosted demo once an hour's three are used). They are replaced at each new clock
  hour. No code or setting changes. This is a **non-production database manipulation**, used only to reach
  production's quota on a test stack.

## Results by load level

Load is the host's 1-minute average at the start, then the peak (4 cores). Times are from the first press, on the
client's clock. In the SSE column, tail is the commit → delivery estimate, all is write → delivery (an upper bound)
and spread is the gap between two subscribers; method below.

| Run                   | Judges | Load start/peak | Outcome                   | Press → payout POST p50 / p95 | ≤ 60 s | Reset p50 / p95 | SSE p95 tail / all / spread | 429s / requests | 5xx | RSS start → peak MB | fds peak | DB conns | Stuck outbox | Label violations |
| --------------------- | -----: | --------------- | ------------------------- | ----------------------------- | -----: | --------------- | --------------------------- | --------------- | --: | ------------------- | -------: | -------: | -----------: | ---------------: |
| r10 replay            |     10 | 14 / 15         | 10 settled                | **27.3 s / 29.8 s**           |  10/10 | 10 / 42 ms      | 56 / 123 / 4 ms             | 5 / 335         |   0 | 337 → 524           |       65 |       13 |            0 |                0 |
| r25 replay            |     25 | 11 / 12         | 25 settled                | **53.6 s / 62.2 s**           |  18/25 | 15 / 28 ms      | 50 / 108 / 4 ms             | 50 / 980        |   0 | 338 → 674           |      110 |       13 |            0 |                0 |
| d25 replay, dist      |     25 | 4 / 4           | 25 settled                | **32.9 s / 39.1 s**           |  25/25 | 16 / 33 ms      | 27 / – / 2 ms               | 50 / 950        |   0 | 411 → **644**       |      110 |       13 |            0 |                0 |
| r50 replay            |     50 | 28 / 50         | 50 settled                | **191.6 s / 225.3 s**         |   0/50 | 36 / 162 ms     | 141 / 273 / 7 ms            | 230 / 3,269     |   0 | 336 → 646           |      185 |       13 |            0 |                0 |
| s35 replay, one NAT   |     35 | 4 / 5           | **5 settled, 30 refused** | 16.0 s / 16.3 s (the 5)       |   5/35 | –               | –                           | 55 / –          |   0 | –                   |        – |        – |            0 |                0 |
| n10 live              |     10 | 27 / 49         | 10 settled                | **900.1 s / 1,103.2 s**       |   0/10 | 13 / 43 ms      | 79 / 155 / 13 ms            | 21 / 2,026      |  10 | 334 → 371           |       66 |       14 |            0 |                0 |
| n25 live              |     25 | 19 / 47         | **25 stuck**              | none reached the POST         |   0/25 | 19 / 62 ms      | 69 / 106 / 8 ms             | 84 / 7,054      |   0 | 336 → 400           |      111 |       13 |            0 |                0 |
| n10 live, 180 s steps |     10 | 12 / 27         | **10 stuck**              | none within 3 min per step    |   0/10 | –               | –                           | 15 / 479        |   0 | 338 → 379           |       66 |       13 |            0 |                0 |
| n50 live              |     50 | see below       |                           |                               |        |                 |                             |                 |     |                     |          |          |              |                  |

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
- **Host load matters:** r25 at load 11–12 had a POST p95 of 62 s; d25 at load 4 had 39 s.

## Sustained run (≥ 2 h)

The container restarted twice during the soak, killing every process; disk survived. Each attempt is kept:

| Segment                      | Start (UTC)        | End (UTC)                   | Length      | Judge loops | Notes                                                                                                       |
| ---------------------------- | ------------------ | --------------------------- | ----------- | ----------: | ----------------------------------------------------------------------------------------------------------- |
| `long-seg1`                  | 4 Nov 23:35:51     | ≈ 23:43 (container restart) | 7 min       |           0 | first live wave still in the lane                                                                           |
| `long-seg2`                  | 4 Nov 23:46:11     | ≈ 00:04 (container restart) | 18 min      |          20 | quota emulation then double-counted the daily cap (fixed in e09fc8f): 14 replays read `daily_cap`           |
| **`long-seg3`** (the result) | **5 Nov 00:09:29** | **02:20:01 (completed)**    | **130 min** |   **1,143** | 10 judges looping, production quota (3 live per clock hour), 30 s samples, partial CSVs pushed every 30 min |

Total soak time across segments: about 155 minutes. **The longest contiguous segment, 130 minutes, meets the ≥ 2 h
target.**

`long-seg3` (`long-seg3-summary.json`, recomputed from its CSVs, because the run's own summary step crashed on 2 M
fan-out samples; fixed in 532a0c4/1579bf2):
- **1,143 loops, all settled:**
  - 1,134 labelled replays, 9 live (3 in each of the clock hours 00, 01 and 02).
  - 26 runs peeked live and replayed at the POST (F7).
  - 0 label violations. Every replay's Proof read `replay`, its export items were `replay:8` and its PayPal-verified
    members were 0. Every live run's Proof read `sample`.
- **POST timing:**
  - Replay: press → POST p50 **15.2 s**, p95 **20.8 s**; 1,113 of 1,134 within 60 s.
  - The 21 replays over 60 s were judges who pressed in an hour's first minutes, waited in the lane as "live" and
    replayed at the POST (max 1,106 s).
  - Live: p50 **776 s**, p95 **817 s**.
- **Each new clock hour stalls the loop:** `long-seg3-minutes.csv` minutes 51–65 and 112–124 show 0 judges done for
  about 15 minutes after 01:00 and 02:00, while the hour's 3 live slots drain through the lane (F1).
- **Reset:** p50 11 ms, p95 29 ms, max 90 ms.
- **SSE fan-out:** per-minute p95 (tail) median 21 ms, worst minute 46 ms.
- **Errors:** 42,890 requests, 50 × 429 (all QUEUED), 8 × 5xx in the per-minute rows (F2's 503 CIRCUIT_OPEN on the 9 live judges' pay-cash; the last one finished after the final minute row), 0
  socket errors.
- **Memory and handles:**
  - RSS 340 MB at the start, one peak of 720 MB at 00:39 during the first replay wave, then 423–442 MB from 00:54 to
    the end. There is no upward trend over 85 minutes, so no leak.
  - fds 55–67 throughout. DB connections 6–13. PayPal window ≤ 12 of 40, 0 PayPal 429s.
- **Outbox:** 0 rows stuck for more than 5 minutes, 0 dead. Queued rows varied from 0 to 33 (lane waits, not stuck).
- **`run_events`** grew to **1.65 M rows** (F9; no fs-cron purge runs in this stack).

## Findings

### F1 · The live lane paces at its 40 s ETA, not at PayPal's speed (live path collapses at 10 judges)

In `apps/api/src/judge/lane.ts`, a step that is not at the head gets `etaMs = position × burstMs` (40 s), and its
outbox row is re-queued with that wait (`run_after`, via `money/rail.ts`). When the head's burst ends after about
1 s on the simulator, the next entry becomes head with a 60 s reservation, but its task does not ask until its own
`run_after`. For a deep position that can be minutes away.

Meanwhile, the PayPal window had room the whole time: it peaked at 12 of 40 calls/min, with 0 PayPal 429s. Each live
run needs four lane bursts, and each of a run's steps joins at the back of the lane, behind every other judge's
steps. So with N live judges the POST comes after roughly 3N × 40 s:
- n10: posts 499–1,103 s after the press.
- n25: all 23 judges at APPROVED were still waiting for the POST after 15 minutes. Their `postPayoutBatch` rows were
  queued about 40 s apart.

Production's 3-per-hour cap does not prevent this. The steps before the POST only _peek_ at the quota, so every
judge who presses before the hour's third POST lands is live, and all of them queue in the lane. The sustained run
shows it every hour (above).

Repro (fresh stack, e2e config): `corepack pnpm exec tsx tools/soak/run.ts --judges=2 --step-s=900`. The smoke run
posted 98 s and 137 s after the press; for 10 judges see `n10-judges.csv`. While it runs, watch `GET /v1/judge/lane`
(`depth`) and `select name, run_after - now() from task_outbox where state = 'queued'`.

Recommendations (judge admission, off limits here):
- When a burst releases the lane, wake the next head's task (an outbox `pg_notify`, or set its `run_after` to now)
  instead of each entry trusting a position × 40 s guess.
- Feed `burstMs` from measured bursts (about 1–2 s on the simulator).
- Bind the hour's live slots at the _press_ (reserve then, release on Reset or timeout). Judges past the hour's three
  would then be labelled replay from the start, instead of spending 15 minutes in the lane and replaying at the POST
  anyway.

### F2 · A busy lane makes pay-cash answer `503 CIRCUIT_OPEN` "the sandbox is pacing us", with no 429 anywhere

In n10, **all 10** `POST /v1/lines/:id/pay-cash` calls answered `503 CIRCUIT_OPEN`, with the message "The simulated
PayPal sandbox is pacing us; the cancel waits". So did all 9 live judges' pay-cash calls in `long-seg3`. Meanwhile
`paypal_calls` held **0** 429s; the cancel was only queued behind other judges in the lane:
- In `apps/api/src/runs/tasks.ts`, `cancel()`, case `"REFUSED"`, maps `outcome.code === "QUEUED"` to
  `PayPalStepError("CIRCUIT_OPEN", …)` with a 30 s retry.
- The cancel still runs later from the outbox, and every run settled.
- But the answer names the wrong cause (the 6-minute 429 circuit), and it is a 503 rather than the 429 QUEUED every
  other paced step answers. The stage may say "pacing us… a few minutes" for a 30 s lane wait.

Repro: two live judges at once (`run.ts --judges=2`). The second judge's pay-cash answers 503 CIRCUIT_OPEN while
`select count(*) from paypal_calls where status = 429` is 0. Recommendation (WS-API): answer `429 QUEUED` with the
lane's `retryAfterMs` there, as Mark paid does. This is not fixed here, because the console (off limits) reads these
codes and the cancel shares the lane with judge admission.

### F3 · Replay path: the inline executor runs every judge's reading two at a time

fs-api runs outbox tasks inline with `concurrency: 2` (`packages/outbox/src/executors.ts`; `EXECUTOR=inline` in
`render.yaml`, no worker). Every judge's reading (about 1,400 replayed events per run), agent turn and settle checks
share those two slots. Reading time (FUNDED → IN_REVIEW, p50) grows with load:

| Judges | FUNDED → IN_REVIEW |
| -----: | -----------------: |
|     10 |               19 s |
|     25 |               40 s |
|     50 |              132 s |

This sets the replay-path limit at **about 25 simultaneous judges for a p95 near 60 s on this host**.
Recommendation (WS-DATA/WS-API): raise inline concurrency for replay-only tasks, or batch a replayed reading's event
inserts (1,400 rows per run).

### F4 · The warm workspace pool is 3

`POOL_TARGET = 3` (`apps/api/src/judge/pool.ts`), and clones are single-flight. A burst of presses beyond the pool
answers `429 QUEUED PREPARING_WORKSPACE` (retry 3 s). The press reached 201 at p50 3.6 s at 10 judges, 7.2 s at 25
and 18.2 s at 50 (max 32.9 s), with 230 QUEUED answers at 50. The answers are honest and honoured. But see F8: each
one costs a session start. A larger pool before a judging window would remove the wait.

### F5 · Memory exceeds Render's 512 MB plan at 25 replay judges, on the production build too

RSS of fs-api, from `/proc/<pid>/status`:

| Build                                                       | Idle   | 10 replay judges | 25 replay judges | 50 replay judges | 10 looping, steady 2 h |
| ----------------------------------------------------------- | ------ | ---------------- | ---------------- | ---------------- | ---------------------- |
| tsx (e2e stack)                                             | 335 MB | 524 MB           | 674 MB           | 646 MB           | 423–442 MB (peak 720)  |
| **dist** (`node apps/api/dist/index.js`, as Render runs it) | 411 MB | –                | **644 MB**       | –                | –                      |

`render.yaml` gives fs-api `plan: 0.5c-512mb`. The bundled dist build is no smaller than tsx; its bundle is
8.6 MB. RSS falls back after each wave, and the 2-hour run shows no trend, so this is peak working set, not a leak.
Recommendation: before the judging window, move fs-api to a 1 GB plan, or bound concurrent readings (F3) so the peak
stays under about 400 MB. Then confirm with `stack.ts --dist` plus `run.ts --judges=25 --prod-quota=0`.

### F6 · What held

- **Labels (I8):** 0 violations across every run (about 1,270 replayed payouts, 20 live).
  - Every replayed run's rail read `Replay: …`.
  - Replayed payouts: `POSTED` and every `item.updated` carried `provenance: replay`; Proof `verification.status`
    read `replay`, with `payoutItems.state` = `replay` and PayPal-verified members = 0; the treasurer's Proof export
    held 8 items, all `replay`, with no notice id.
  - Live payouts: the simulated label, Proof `sample`, 7 PayPal-verified members.
  - `X-FS-Rail: simulated` was on every answer, and no event naming Claude lacked the replay provenance.
  - After Reset, the old console token got 401.
- **Reset:** p95 ≤ 162 ms at every level; target ≤ 10 s.
- **Outbox:** 0 rows queued past their `run_after` or in flight for more than 5 minutes, and 0 dead rows, in every
  run.
- **DB connections** (`pg_stat_activity` on `fs_e2e`): ≤ 14 at every level and over 2 hours. The pool
  (`DB_POOL_MAX` default 10), LISTEN and the limiter never grew past that.
- **File descriptors:** they track open SSE streams and sockets (peak 185 with 50 judges × 2 streams) and return to
  33–36 after each run.
- **429s:** apart from F8, all were `QUEUED` (the workspace pool, the lane at Mark paid). 0 SSE stream refusals.
- **Errors:**
  - 5xx: only F2's 503s.
  - `read ECONNRESET` on 10–17 `GET /v1/runs/:slug` calls in the n25 and r50 runs. This is the client's 5 s fallback
    GET reusing a keep-alive socket just as Node's default 5 s `keepAliveTimeout` closes it: a load-tool artefact,
    and browsers retry these.

### F7 · A run can read "live" after both keys and still replay at the POST (labelled correctly)

The rail a judge sees after both keys (`GET /v1/judge/session`) is a peek. The binding decision is taken at the POST
(`reserveLivePost`, `judge/quota.ts`). In `long-seg2` (5 runs) and `long-seg3` (26 runs), judges peeked `live` after
both keys, but the hour's slots went before their POST, so they replayed. The payout was labelled correctly every
time: `POSTED` and every item carried `provenance: replay`, and Proof read `replay`.

The soak's first check classified these runs by the peek and counted 10 "violations" in `long-seg2`. That was the
check's error. Since e09fc8f it classifies by the payout's own provenance and records the peek mismatch as data
(`peekMismatch`).

Product note: between both keys and the POST, the stage can show "Simulated PayPal sandbox" for a payout that then
replays, after the judge may have waited up to 15 minutes in the lane (F1). The replay label arrives with the POST
events. That is honest, but surprising.

Also: a member line's DTO `provenance` (`live` on these keyless runs) describes how the line was computed, not the
payout. For a replayed payout its state is still `PAID` and its provenance is not `replay`. Only the items, the
events and Proof say that the payout was replayed. Any screen that shows `PAID` from the line alone must also read
those. The e2e browser spec `judge.spec.ts` (`phoneScreenSweep`, replayed branch) checks that the Member frame does.
This soak did not add a browser pass.

### F8 · Behind one NAT, presses that answer QUEUED use up the network's session starts: 5 of 35 judges get in

`apps/api/src/judge/session.ts`, `startJudgeSession`:
- Step 2 takes the per-cookie (3 an hour) and per-IP (30 an hour) session-start slots.
- Step 4 can still answer `429 QUEUED PREPARING_WORKSPACE` when the warm pool (3) is empty.

A QUEUED press therefore costs a slot without starting a session. In `s35` (35 judges, one address, fresh stack),
the press answered 25 QUEUED and then 30 `RATE_LIMITED` ("Too many new sessions from this network"). Only **5 judges
got in**, and the address was locked out for the rest of the hour.

The same applies per browser. A judge whose second press after Reset meets two QUEUED answers has used up "Three new
sessions an hour per browser".

Repro: `corepack pnpm exec tsx tools/soak/run.ts --judges=35 --shared-ip --prod-quota=0` on a fresh stack; see
`s35-endpoints.csv` (`press`: `429/QUEUED:25 429/RATE_LIMITED:30`). Recommendation (judge admission, off limits
here): take the slots only once a session is created, or refund them when the press answers QUEUED.

### F9 · `run_events` grows about 1,450 rows (≈ 0.8 MB) per judge loop until fs-cron's hourly purge

Each judge loop writes about 1,450 run events. A mid-run sample measured `run_events` at 7.8 MB for 13,739 rows,
indexes included, so about 570 B per row and about 0.8 MB per loop. `long-seg3` reached **1.65 M rows (≈ 0.9 GB)** in
130 minutes at about 520 loops an hour. The e2e stack has no fs-cron, so nothing was purged here. In production the
hourly pass (`judge/reset-task.ts`, at :07) purges ended judge workspaces, so the table holds at most about an hour of
loops.

Two production facts to check, which this soak could not measure:
- Render's `fs-db` is `plan: 0.1c-256mb`: a tenth of a vCPU for Postgres, while every replayed reading inserts about
  1,400 rows. The local server here was not CPU-bound.
- The database's disk size against about 0.4–0.9 GB an hour of events at this rate.

Recommendation: run `run.ts --prod-quota=0` against a Render preview with the real `fs-db` plan before the judging
window.

### SSE fan-out: method

Each judge opens two streams on its run. For every live event (not one replayed after Last-Event-ID) seen on both
streams, three numbers are recorded:
- **all:** `arrivedAt − at`, where `at` is the event's `clock_timestamp()` at insert, on the same host clock. This is
  an upper bound, because it also counts the rest of the inserting transaction.
- **tail:** the same lag for the last-written event of each burst (arrivals within 3 ms of each other on stream A,
  which is how one transaction's events arrive). Its write is the closest to the commit, so this is the client-side
  estimate of commit → delivery.
- **spread:** `|arrival on stream A − arrival on stream B|`, how far apart two subscribers hear the same event.

Fan-out p95 (tail) was 21–79 ms up to 25 judges and **141 ms at 50** (host load 50 on 4 cores), against a 100 ms
target. Spread p95 stayed ≤ 13 ms: the single LISTEN connection's fan-out did not slow with more subscribers.

## Limits found

| Path                    | Limit for p95 ≤ 60 s to the POST (this host)                                       | Binding constraint                                   |
| ----------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Labelled replay         | about **25** simultaneous judges (sustained: 10 looping ≈ 520 loops an hour holds) | inline executor concurrency 2 (F3); warm pool 3 (F4) |
| Live (simulated PayPal) | **1** judge at a time; 2 at once already take 98–137 s                             | lane ETA pacing (F1)                                 |
| One NAT / room          | **5** judges an hour when the pool is cold                                         | per-IP session starts spent on QUEUED presses (F8)   |
| Memory (512 MB plan)    | under 25 replay judges (644 MB on dist at 25)                                      | peak working set during readings (F5)                |
| SSE fan-out ≤ 100 ms    | about 25–50 judges (141 ms at 50, host load 50)                                    | host CPU                                             |

## Recommendations, in order

1. **F1:** wake the lane's next head when a burst ends, and bind the hour's live slots at the press. This is the one
   change that makes concurrent judges work.
2. **F8:** take or refund the session-start slots only when a session is created. Otherwise a judging room is locked
   out after five presses.
3. **F5:** fs-api on a 1 GB plan for the judging window, or a bound on concurrent readings.
4. **F3/F4:** inline concurrency for replay tasks (or batched inserts), and a warm pool sized to the expected burst
   (for example 10).
5. **F2:** answer `429 QUEUED` for a lane-queued cancel, not `503 CIRCUIT_OPEN`.
6. **F9:** load-test against the real `fs-db` plan (0.1 vCPU) before judging.

## How a hosted Render instance differs

- **CPU:** 0.5 vCPU (`0.5c-512mb`) against 4 shared cores here. The replay limit (F3: CPU-bound inline tasks) will be
  lower on Render, plausibly 10–15 judges for p95 ≤ 60 s. The lane limit (F1) is timer-bound and the same anywhere.
- **Memory:** 512 MB against a measured 644 MB on the dist build at 25 judges (F5).
- **Network:** judges come through Cloudflare and Render's proxy, and the per-IP throttles key on `CF-Connecting-IP`.
  Judges in one room share one address (F8). Every run here except `s35` gave each judge its own address.
- **Database:** Render Postgres (`0.1c-256mb`) over the network, against a local, uncontended PG 17 here (F9).
- **Quota:** production's hourly cap is 3, with no test override. The `r*`, `d25`, `s35` and `long-*` runs emulate it
  with labelled ledger rows.

## Changes (commits on `cloud/judge-soak`)

| SHA     | Scope | What                                                                                           |
| ------- | ----- | ---------------------------------------------------------------------------------------------- |
| df68089 | ops   | `tools/soak/` (stack wrapper, client, judge loop, sampler, run), `apps/tasks` typecheck + test |
| 02d7c10 | ops   | step budget, production-quota emulation, socket error codes                                    |
| caeb1ab | ops   | checks replayed payouts' export items and PAID lines' provenance                               |
| 03d4155 | ops   | `stack.ts --dist`: fs-api from the production build                                            |
| e09fc8f | ops   | classify a payout by its own provenance; the quota emulation keeps the daily cap               |
| 532a0c4 | ops   | test: summaries must survive millions of samples (failing first)                               |
| 1579bf2 | ops   | fix: no array spreads onto the stack in summaries                                              |
| others  | qa    | report and CSVs (`docs(qa): …`), including partial long-run CSVs pushed every 30 minutes       |

Caveat for the merger: **e09fc8f** (`fix(ops)`) also deletes three
`docs/reports/cloud-judge-soak/long-interrupted-*.csv` files (WS-QA paths), staged by mistake. 6960f11 re-adds them as
`long-seg1-*.csv`. Rewriting the pushed history was refused here, so the per-commit ownership check flags e09fc8f.
Split or squash it when merging.

`apps/tasks/tsconfig.json` now typechecks `tools/soak/*.ts`. `apps/tasks/test/soak.test.ts` covers the pure parts:
percentiles (including 2 M samples), CSV, judge addresses, the `inv.i8.soak-labels` rail-label check and fan-out
bursts. `biome check` and `deps:check` pass on `tools/soak`.

## Files

`docs/reports/cloud-judge-soak/<run>-{judges,metrics,endpoints}.csv` and `<run>-summary.json` (`long-seg*` also have
`-minutes.csv`):
- `judges`: one row per judge, with step times in ms from the press (`long-seg3` trimmed to 16 columns).
- `metrics`: server samples every 15–30 s, with the host's load averages.
- `minutes`: per-minute aggregates of the judges that finished in that minute.
- `endpoints`: per-endpoint latency and status counts.

## Safer-option decisions

- Each judge got its own loopback source address. One shared address would have hit the per-IP cap and hidden every
  other limit; the shared-address case is its own run (`s35`).
- The production quota is emulated with labelled ledger rows on the local stack only, with no env or code change.
- Nothing in `apps/api` was changed. F1, F2, F4 and F8 are in or next to the off-limits judge admission and pacing
  code, and the console reads their codes. They are reported with numbers and repros only.
- External Postgres 17.10 instead of the embedded cluster (root). The stack code is unchanged.
- No browser (Playwright) pass. The replayed-payout rendering is covered by `judge.spec.ts`, and the console is off
  limits.
