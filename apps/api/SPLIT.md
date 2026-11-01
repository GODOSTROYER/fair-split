# apps/api: how the API is split

> **Integrated (28 Oct).** `ws/api-judge`, `ws/api-runs` and `ws/api-proof` are merged into `ws/api`; every IC-01
> command is filled in and `pnpm --filter @fairsplit/api smoke` drives all of them against a booted server. The
> shell changes the slices asked for are in: the registry test tells filled-in commands from placeholders;
> OpenAPI documents a 501 only on a placeholder; `appCredentialStore(db)` (src/lib/credential-store.ts) wires
> link revocation into the shared resolver (the `isLinkRevoked` callback is now required, never defaulted); the
> run, workspace and line streams take `STREAM_READERS` (= the runs slice's `CAN.readRuns`); and the typed client
> has `judgeRoutes(api)` plus msw mocks for the judge and auth routes, parity-tested against the server
> (src/routes/client-routes.test.ts). Still open across slices: an operator logout is enforced only in the browser
> (a server-side session epoch needs a WS-DATA table). (`extract` has an inline handler since 31 Oct: below.)

> **The reading, inline (31 Oct, J1).** `extract` runs in fs-api (`src/runs/extract.ts`, registered by `slips`): a
> seeded workspace's replay photos (A–L) are read from the seed as a labelled stand-in, never a Claude recording.
> Rows, fields, box-13 marks, slip 0449's quarantined note, the IC-01 `extract.field` / `extract.row` /
> `extract.quarantined` events and each photo's `rows.accepted` are all provenance `seeded`, actor `system:seed`,
> "Seed stand-in, not a Claude recording" (`SEED_STAND_IN`; `readingProvenance()` tells a run's reading). Scores are
> domain `agreement` over two reads that are both the seed's text; slip 0462's stain hides the second character of
> gross and net, so those two wait for a person at 0.40. One photo per step: each step queues the next one second
> after its own due time in its own transaction (no request or executor slot waits; a restart resumes from the
> committed row; the twelve land in about 11 s), a second delivery changes nothing, and the last step queues
> computeRun once (`compute:{runId}:read`). Funding queues the reading under `extractDedupeKey` (IC-01's key, or its
> sha256 past five photos): IC-01's key for 12 photos is 451 characters, over the outbox's 200, which made Mark paid
> fail on every judge clone. A photo with no seed stand-in stays unread (a live reader is not built in this build).
> `readRateCard`, `warmCaches`, `reconcile` and `pushNotify` complete at once with a labelled "not built in this
> build" outcome (`src/runs/unbuilt.ts`), so no row of theirs dies. Tests: `src/runs/extract.pg.test.ts` (the hero
> path on a world without pre-seeded replay rows, `runs/test/world.ts` `replayRows: false`; a judge session's own
> clone; a second delivery; a restart with the real dispatcher) and the judge-replay twin.

> **What the phone needs (1 Nov, K1b). IC-08 stays frozen: every change here is additive.** No existing route,
> request or response shape changed.
> - _Run lookup._ A frame of a judge session (the Chair's `board:ernesto`, a member's) and a phone paired in it
>   already read their own session's run from `GET /v1/judge/session` (`runSlug`, `runState`; the Chair's request is
>   open when `runState` is `AWAITING_BOARD`): a frame token carries the session id it was minted under, and the read
>   is scoped to the credential's own workspace. No new field was added (strict clients would refuse one). Tests
>   (`routes/judge/phone.pg.test.ts`) pin it with two sessions: neither's frames ever see the other's run.
> - _Renewal._ New route `POST /v1/judge/sessions/:sid/renew` (`renewJudgeSession` in api-client's `JUDGE_ROUTES`,
>   with its msw answer): the judge cookie of that session; 200 with createJudgeSession's resume answer for a live
>   session; 401 FRAME_TOKEN_EXPIRED once the workspace has ended (Reset, expiry, purge), minting nothing and taking
>   no slot of the new-session limits. createJudgeSession is unchanged: a press still starts a fresh workspace after
>   a Reset. The console's `SessionStore.renew()` must move to this route (it still renews through createJudgeSession).
> - _Brand links._ `GET /b/:token` serves the console's index.html whatever the token holds (`static.ts`), the signed
>   dotted `fsb_<payload>.<sig>` included; a missing file with an extension is still a 404.
> - _Media caching._ `/media` is immutable only under a content-hashed name (`s1.4f1c9a2e.m4a`); the audio manifest
>   and every other media file are `no-cache` with a weak ETag (size and mtime) and answer 304 to If-None-Match.
>   This narrows S3.3's "`/media/*` immutable", because the manifest, a retaken clip and a regenerated photo keep
>   their names. `/media/archived/*` tiles (routes/media) keep their own immutable policy.
> - _Not built:_ a Chair app key (kind `app`, proof of possession). It is needed only if the native APK (N1) goes
>   ahead.

> **Hardening after H1/J1/P1 (1 Nov, HD1).** _A restart while a run is in flight (in-process simulator)._ The
> simulator's state lives in the process, so after a restart a batch the previous simulator accepted is one the
> simulator now running never issued. The rule: at boot, before the server listens (`src/paypal/boot.ts` step ½),
> every batch with a PayPal id, provenance `simulated_rail` and an item not yet terminal is recorded once in its
> workspace's ledger as `payout.stranded` (`src/money/settle.ts` `STRANDED_BATCH`: ids, the open-item count, reason
> `simulator_restarted`). In a judge workspace the outcome is `demo_run_ended`, "The simulated PayPal sandbox
> restarted; this demo run ended" (its session is ended at the same boot, as before). In any other workspace (a co-op,
> the showcase) it is `left_for_a_person`, logged at error with the workspace and batch ids: nothing there is
> rewritten. In both, no item is marked paid, failed or returned that the simulator did not report, no run moves, and
> the batch's settle GETs then end at once with no PayPal call (they used to retry until dead). A follow-up settle GET
> whose items are all terminal reads nothing either. A batch with no PayPal id yet (POSTING) is not stranded:
> `money/resume.ts` posts its very ids to the new simulator. **Still open:** the stranded judge workspace itself is
> kept, not purged: `fs_purge_workspace` (WS-DATA, migrations/0014) refuses while an item is not terminal, and fs-api
> never fakes a terminal status to get past it; the hourly pass defers it every time. The pool refill does not depend
> on it. WS-DATA follow-up: let the purge take a judge workspace whose open items all belong to `payout.stranded`
> batches. Note `purgeExpiredJudgeWorkspaces` takes the 20 oldest candidates a pass, so 20 or more such workspaces
> would stop the purge of every other one (order deferred ones last, or skip them). A stranded UNCLAIMED item may still
> get one `cancelUnclaimed` attempt from the hourly pass, which the new simulator answers 404. Deploy between sessions
> (ADR-0010). Tests: `src/paypal/restart.pg.test.ts` (judge and showcase), `src/money/settle-followup.test.ts`.
> _Also:_ the boot loads the simulator's own signing certificate into the webhook verifier before traffic (forged
> SIMCERT URLs can no longer spend the hourly fetch budget first); only the `SIM_*` tuning variables reach the
> in-process simulator (`SIMULATOR_TUNING_VARIABLES`; the rest are ignored and named in a boot warning); boot refuses
> an `FS_OPERATOR_PASSWORD_SCRYPT` that is not a scrypt PHC string (`src/scrypt-phc.ts`) and one seed for both signing
> keys; a seeded run whose reading cannot finish (a photo with no seed stand-in) is HALTED with cause
> `NO_SEED_STAND_IN` naming the document, instead of waiting at EXTRACTING forever; the smoke requires Mark paid to
> succeed, the review to open with 4 open / 3 blocking holds and slip 0462 by hand.

> **Judge rail obeyed (28 Oct, verifier round).** Every PayPal step of a judge workspace (Claude's invoice turn,
> ensureInvoice, recordPayment, the batch POST, the parked item's cancel, the re-route) asks
> `src/money/rail.ts` `railForStep` / `railForItem` before any PayPal call: `beginLiveStep` (a fresh `judgeRail`,
> the single-flight lane, the post's reservation) decides; a queued step re-queues itself (`runs/now.ts`
> `deferTask`); a replay runs the same code on the replay rail (`src/paypal/replay.ts`: no PayPal call, rows and
> events `replay`, the latest settled live run else showcase r37 else the seed as the source, named in
> `judge.step.replayed`); a live step holds the lane and the post runs inside `withArmedTamper`, settling its
> reservation. A run that replayed a step replays to the end. `kill_paypal_live` in Judge Mode is that replay,
> not a refusal. C-21's 40 a day and the balance floor are checked and written under one cross-process lock
> (`money/payouts.ts` `spendLock`). Printed member links are recorded and revocable (`revoke`, `revoke-line`); a
> written batch is never abandoned (`money/resume.ts`); every signed re-route has its own task row.

> **Merged with main (28 Oct, after phase 1).** `ws/api` now builds on main's final packages, with no shims of its
> own. What changed here: approvals sign and check `linesDigest` (every member line, cash lines too; the batch view
> lists `memberLines`) with domain `expectedSigner` + `checkApprovals`; `lines.computed` carries `overrides`;
> device keys go through contracts `DeviceKey` (`src/lib/device-keys.ts`: `fs-analyn-w1` is kind `web` from /ops,
> a judge's key is `web_demo` `fs-{persona}-demo-{6}`) and every published key has its own kind; boot checks the
> PayPal e-mails with `requireAsciiEmail`; invoices send `canonicalInvoiceCall(...).args` as decided; the agent port
> exports `itemLabelGuide()` (ITEM_LABEL_WORDS) for the prompt; `money/payouts.ts` implements the PayoutsRepository
> compare-and-sets (tests: `money/posting-cas.pg.test.ts`); idempotency holds, the WS-DATA limiter and transmission
> store, `PP_CERT_ALLOW`; judge workspaces are claimed by the database clock (`claimJudgeWorkspace`), and a Reset
> ends the session by clearing the claim (the database never moves an expiry earlier). Tests that need a run further
> on or "24 hours later" use `walkRun` / `setWorkspaceExpiry` (`src/test/db-time.ts`). Open across workstreams:
> (1) WS-DATA's `beginPosting`/`voidCheckedApprovals` make the same compare-and-sets but emit `run.state` events in
> a non-IC-01 shape, so apps/api keeps its own until they emit IC-01 payloads; (2) `webhook_events` has no
> `delivery` column, so WS-PPCORE's apply rule fails closed and MM-1 waits for the settle GET; (3) domain
> `senderBatchId` still builds a re-route as `-x{n}` (ADR-0007 wants `-x{n}-{memberNo}`): the API signs re-routes with
> WS-PPMONEY's ids, so clients must too (or get a server-built re-route payload); (4) the live agent prompt is
> WS-AGENT's; (5) the simulator mode still uses the labelled stub unless `PP_SIM_URL` points at `tools/paypal-sim.ts`;
> (6) WS-QA's dependency rules (register §6) forbid what this package's brief prescribes: apps/api importing
> `@fairsplit/api-client` (the shared `/http` table in `lib/commands.ts`/`lib/problem.ts`, the typed client in
> `test/harness.ts` and `smoke/checks.ts`, the parity tests) and api-client importing domain (`verify`, `format`) and
> seed (the msw world), so test-kit's real-tree `deps:check` reports 10 violations until WS-QA sanctions those edges
> (or the shared parts move into contracts). The test-only helpers moved from `runs/testing/` to `runs/test/`.

> **Security pass (28 Oct; the six `[ws/api] SECURITY` review findings and their siblings).** (1) The client
> address comes only from the hop `FS_TRUSTED_EDGE` names (`none` off Render, `render` on it: `CF-Connecting-IP`,
> else the rightmost `X-Forwarded-For` entry, else the socket's peer; `True-Client-IP` is never read), through
> `clientIp(c)` / `clientIpKey(c)` for every per-IP rule and the webhook cert budget; `FairSplitApp.fetch` passes
> the Node bindings on, so the peer is known. The test env runs as deployed (`render`): tests name a network
> with `cf-connecting-ip`. (2) Command bodies are read as a stream and cancelled past the cap. (3) A store or
> resolver without `isLinkRevoked` throws at construction. (4) Every link path asks the same store (`checkLink`,
> `/v1/credential` no longer keep their own ledger reads), and a credentialed SSE stream re-checks its credential
> at every ping (`revalidate`), so revoked, expired or ended credentials stop streaming. (5) Judge-code guesses:
> 5 per 10 minutes per session, 5 a minute per network, 30 a minute in all. (6) The brand view and its CSV show
> member lines only once `proofReady` (read inside the view's snapshot); before, the view is the invoice alone.

> **Quota on resume (28 Oct; the `[ws/api] SECURITY` review of e026049, rounds 1 to 4).** The rule, in plain words:
> **every live judge POST is counted from a slot dated within 90 seconds of the moment it reaches PayPal.**
>
> - A judge post whose batch is written live is never replayed (I8) and never goes live without a counted slot.
>   Its run's slot (`judge_post`) carries a POST only while it is younger than `JUDGE_QUOTA.restampAfterMs` (the live
>   lane's lease, 90 s: the burst that took it, or a quick retry such as refused credentials or an unanswered POST)
>   and only in the clock hour it was taken.
> - A post that resumes later (PayPal's 429 and the 6-minute circuit, a kill switch, an outage the hourly catch-up
>   ends) takes a FRESH slot dated now, under the quota lock, checked against every cap (the rolling 24 h, the
>   clock hour, the session's three, the public third) with its own run's earlier slots left out, and against the
>   service's first-write guard for the write it resumes: the balance less its batch stays at or above US$10,000, and
>   C-21's 40 live batches a day. If anything is full it WAITS (`queued`, `waitingFor` the reason, re-queued by
>   `deferTask`; the hourly cap waits for the next clock hour); kill_payouts makes it wait before it takes a slot.
>   It is never replayed and never live without a slot. The older slot is settled `superseded`.
> - Counting: every count looks back 24 h plus the 90 s, so a POST is counted for the whole 24 h after it (and in its
>   own clock hour). A run counts once however many of its slots are in a window; the spend counts a run through its
>   newest slot, so a post PayPal denies on the fresh slot spends nothing. A run is in the public third while any of
>   its slots in the window was taken without the judge code (a fresh slot that supersedes an uncoded one is uncoded
>   too), so a public POST whose answer was lost never frees a public place when the session unlocks the code before
>   its resume. C-21 counts a batch from its write, and a judge batch also from any live slot of its run in the
>   window. The spend counts a batch written before a balance reading and posted after it from its POST
>   (`batch_posted`), and a written batch still waiting to be posted.
> - No slot is left open with no post behind it: a post's peek leaves its own run out (as the binding decision does),
>   so a slot an earlier attempt took and never used (it threw before its write, e.g. on the spend lock's wait) is its
>   own place on the retry; and a post that replays settles such slots `not_posted` (`releaseUnusedSlots`).
> - Only a batch still waiting for PayPal's answer is resumed (SUBMITTED, no PayPal id). One PayPal named or denied,
>   or one PayPal holds under our ids but not as ours (ADOPT_FAILED), completes its task with no slot and no POST,
>   and frees the turn this process's lane kept for an earlier attempt of it. A resume re-reads its batch once it
>   holds the lane (in `reserveLivePost`, under the quota lock): one PayPal answered while it waited is done too.
> - A written batch resumed more than 90 s after it was last counted, outside the judge quota, is held to C-21 again
>   (under the spend lock) and counted from that POST (`batch_sent`); while C-21 is full it waits. That is every
>   re-route (D7) and a co-op's own primary batch (`guardResumedPrimary`, round 5); a judge primary batch is counted
>   through its run's fresh slot.
> - The hourly purge never removes a batch a count still reads. C-21 and the spend count a batch from its row, and
>   the purge deletes the expired judge workspace's rows. So it waits while C-21 still counts one of its batches (24 h
>   and 90 s after its write, after a live slot of its run, or after a `batch_sent` mark) or the spend does (not
>   DENIED, and written or named by PayPal, `batch_posted`, at or after the latest balance reading on its rail,
>   whatever its age: the service's floor guard reads that reading however old it is). A replayed batch is in no
>   count. A batch POSTed late is counted for the whole 24 h after that POST, even when its workspace expired before it
>   (`judge/quota.ts batchesStillCounted`, read on the database's clock).
> - Lock order, wherever both are held: the quota lock (`fs:judge-quota`), then the spend lock (`fs:payout-spend`):
>   lane, quota, spend, workspace, rows. A resume's fresh slot holds both; the service's spend guard and the C-21
>   guard of a resumed send (`countResumedSend`) hold only the spend lock, `settleLivePost` and `releaseUnusedSlots`
>   only the quota lock. So no two transactions can deadlock. The tests drive the re-route guard on its locked path
>   (a batch last counted a day before) and mix real co-op first writes into the concurrent run.
> - Pool bound: the service's guard and `countResumedSend` wait for the spend lock holding no pooled connection (a
>   try per short transaction, QUEUED after 10 s). Only `reserveLivePost` on a sandbox resume waits holding one, and
>   it runs only under the single-flight lane, so there is at most one such waiter across every process
>   (`judge/quota.ts` header, "POOL BOUND").
> - I8 both ways, for two executors of one run's post that decide differently (a lost outbox heartbeat). Live rows are
>   never replayed: `replayStep` re-reads the rows in the transaction that writes the post's `judge.step.replayed`
>   label, under the workspace lock, and waits if they are written live; the repository writes live rows under the same
>   lock and refuses a run labelled replayed. So a post is never labelled replayed beside a live POST (and `runReplays`
>   ignores a post label an older build left beside live rows). Rows written as a replay are never POSTed live: the
>   repository refuses them on a live rail where it reads them for the service (`loadPosting`, the re-route's
>   `findSupersedingItem`) and at `writeSubmitted`, all before the POST; the run's next attempt replays to the end.
>   The marks (posted, rejected) refuse the other rail's rows besides.
> - Earlier rounds: round 1 stopped the resume override (no live post without a slot) and stopped `settleLivePost`
>   from settling `not_posted` once a batch is written; round 2's 23 h age-out (`heldSlotMaxAgeMs`) is gone: a slot
>   now carries a POST for 90 s, and a later POST takes a slot dated at it. Round 4: the purge used to wait only 24 h
>   after a batch's write, so a POST made a day after its write could drop out of C-21 within the hour. Round 5 (the
>   15 minors of the final verifiers, M1 to M11): the two I8 races, the public third, the purge's spend wait and its
>   provenance filter, the co-op resume's C-21 check, the unused slot, the lane on `done`, the pool bound, D5 under
>   the lane, and the purge tests' C-21 branch.
> - What is left: a burst's own retries (the service's 1 + 3 + 9 s, PayPalHttp's timeouts) can put its POST up to
>   about two minutes after its slot, and a fresh burst that straddles the top of an hour counts in the hour it
>   began. Cancel takes no slot and no C-21 count (it sends no batch). A resumed send's `batch_sent` mark is written
>   just before the service's own kill-switch read, so a POST the switch then refuses leaves the batch counted by C-21
>   for 24 h without a send (it over-counts by that one batch, never under). On a rail with no balance reading at all
>   (the simulated rail before its first; a judge live batch on the sandbox rail always follows one) the spend counts
>   every batch ever, and the purge waits only 26 h after a batch's write or name. The purge reads the counts on the
>   database's clock while the ledger is stamped by the app's; in production they are the same clock, and any skew
>   between them moves the end of its wait by that much.
> - Tests: `money/quota-sendtime.test.ts` (the drift probe, the hourly wait, one run counted once, denied, the held
>   retry, D4, D5 and D5 under the lane, the lane freed on `done`, D6 both ways, the replay label and a live write,
>   the unused slot kept or freed), `money/quota-oracle.test.ts` (send times over three simulated days),
>   `money/quota-purge.test.ts` (a late POST, then the purge: still counted 2 h and 23 h after it; the spend from an
>   old reading; C-21 alone; a replay batch), `money/lock-order.pg.test.ts` (D1, the lock order, waiters holding no
>   connection), `money/reroute-c21.test.ts` (D7), `money/primary-c21.test.ts` (a co-op's primary resumed a day on),
>   `judge/quota.pg.test.ts` (restamp, hour boundary, D2, D8, the public third), `money/quota-resume.test.ts`.

> **Cron tick (J2, 1 Nov).** `POST /internal/cron/tick` (folder `src/routes/internal`, registered as `internal`) is
> what fs-cron's `node tools/cron-tick.mjs` calls at :07 UTC every hour over the private network.
>
> - Auth: `Authorization: Bearer <CRON_SECRET>`, compared in constant time (sha256 of both sides through
>   `timingSafeEqual`) before anything else runs: no credential resolution, no body read, no database. A missing or
>   wrong secret is a bare 401 `UNAUTHENTICATED`. With CRON_SECRET unset or shorter than 16 characters the route
>   answers the ordinary 404 (`No route for POST /internal/cron/tick`) and boot logs a warning: never an open tick.
>   CRON_SECRET was already in `src/env.ts` (`secrets.cronSecret`); nothing there changed.
> - The plan (`internal/cron.ts` `planCronTick`, apps/tasks/src/cron.ts lifted with the IC-01 `TASKS` keys): every
>   tick offers `judgeReset{trigger: cron, workspaceId: null, slot: <UTC hour>}` (`reset:pool:2026-11-01T10`) and
>   `warmCaches{slot: w<23-hour window>}`; ticks from 02:00 to 05:59 UTC also offer `reconcile{nightly}` keyed by the
>   UTC date (`windowStart` = 48 h before that midnight). All of them are system rows (`workspace_id` null) enqueued
>   in ONE transaction with the tick record; a slot's row that already exists is not queued twice (`created: false`).
> - Only a job this process has a handler for is enqueued (`OutboxRuntime.handles(task)`, from the handlers
>   `wireOutbox` was given). A row without one would be claimed, fail `no handler registered` eight times and go
>   dead, so the tick skips that job and labels it `{task, dedupeKey, reason: "no handler"}` in the answer's and the
>   tick record's `skipped`, logs a warning, and boot warns which cron tasks have no handler. Until J1's labelled
>   no-ops for `reconcile` and `warmCaches` are merged, those two are skipped this way; once they are registered, the
>   tick enqueues them with no change here. A process with no outbox wired (some tests) skips every job.
> - At most one tick per 30 minutes, decided in Postgres: `takeCronTick` takes `pg_advisory_xact_lock('fs:cron-tick')`
>   (READ COMMITTED, `lock_timeout` 10 s), reads the last tick from `reconciliation_reports` (kind `health`, no
>   workspace, `summary.source = 'cronTick'`, `window_end` = the tick's app-clock time), and refuses with 429
>   `RATE_LIMITED` plus `Retry-After` when it is under 30 minutes old, enqueueing and recording nothing. Two fs-api
>   processes ticking at once: exactly one is taken. No new table or migration.
> - Answers: 202 `{at, nextTickFrom, tasks: [{task, dedupeKey, created}], skipped: [{task, dedupeKey, reason}]}`;
>   401; 404; 429. The route is raw Hono, so it is not in the public OpenAPI document.
> - The judgeReset pass is the judge folder's existing handler (`judge/reset-task.ts`), unchanged except that its
>   cron pass now also runs WS-DATA's `purgeExpiredTransmissions(db, now)` (expired `webhook_transmissions` ids, by
>   the app clock the verifier uses) and reports `transmissionsPurged`. `reconcile` and `warmCaches` handlers are not
>   registered here (J1 registers labelled no-ops); until they exist the tick skips those jobs (labelled, above).
> - `tools/cron-tick.mjs` (WS-OPS): env `FS_API_HOSTPORT` (`host:port`, render.yaml's `hostport`) and `CRON_SECRET`;
>   prints the enqueued task names, then any skipped ones (`skipped, not enqueued: warmCaches (no handler)`); exit 0
>   taken, 2 refused (a 429 on the first attempt), 1 anything else (a 429 answering a retry after a failed attempt
>   counts as taken).
> - Tests: `routes/internal/cron.test.ts` (plan, secret check, 401/404 before any database access, not in OpenAPI),
>   `routes/internal/cron.pg.test.ts` (enqueued rows and record, the 30-minute refusal, three concurrent HTTP ticks,
>   six ticks over two connection pools, the dispatcher running judgeReset end to end with the purge, a nightly
>   pass with only judgeReset registered: reconcile and warmCaches skipped and labelled, no row of theirs, no dead
>   row; a process without an outbox skipping everything), `routes/internal/cron-tick.boot.pg.test.ts`
>   (`startServer()` booted for real, then `node tools/cron-tick.mjs`: 401, taken, refused, the server's own
>   dispatcher finishing every row the tick enqueued, and no row for a job it skipped);
>   apps/tasks/test/cron-tick.test.ts for the script against a stand-in.

The shell (WS-API, branch `ws/api`) is finished and **frozen**. Three slices now fill in handlers in parallel
worktrees. Each slice edits only its own paths, never `package.json`, the lockfile or a shared file below.
Every dependency a slice needs is already installed; if one is missing, report it (do not add it).

| Slice | Worktree                             | Branch         |
| ----- | ------------------------------------ | -------------- |
| JUDGE | `Z:/Projects/Paypal/fs-wt/api-judge` | `ws/api-judge` |
| RUNS  | `Z:/Projects/Paypal/fs-wt/api-runs`  | `ws/api-runs`  |
| PROOF | `Z:/Projects/Paypal/fs-wt/api-proof` | `ws/api-proof` |

## Ownership (exact)

| Owner                       | Paths (each with its tests)                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JUDGE                       | `apps/api/src/routes/judge/**`, `apps/api/src/routes/auth/**`, `apps/api/src/judge/**`, `apps/api/src/credentials/issue/**`                                                                                                                                                                                                                                                                                                                                     |
| RUNS                        | `apps/api/src/routes/{season,rate-cards,slips,runs,holds,fields,approvals,lines}/**`, `apps/api/src/runs/**`, `apps/api/src/money/**`, `apps/api/src/approvals/**`, `apps/api/src/agent/**`                                                                                                                                                                                                                                                                     |
| PROOF                       | `apps/api/src/routes/{proof,wellknown,brand,statements,print,ops,media}/**`, `apps/api/src/proof/**`, `apps/api/src/ledger/**`, `apps/api/src/statements/**`, `apps/api/src/ops/**`                                                                                                                                                                                                                                                                             |
| SHELL (frozen, WS-API only) | everything else under `apps/api/**`: `package.json`, `tsconfig.json`, `vitest.config.ts`, `tsdown.config.ts`, `src/app.ts`, `src/server.ts`, `src/index.ts`, `src/env.ts`, `src/db.ts`, `src/health.ts`, `src/static.ts`, `src/openapi.ts`, `src/openapi.cli.ts`, `src/middleware/**`, `src/sse/**`, `src/routes/registry.ts`, `src/paypal/**`, `src/credentials/verify/**`, `src/lib/**`, `src/test/**`, `README.md`, `SPLIT.md`; and `packages/api-client/**` |
| WS-PPCORE                   | `apps/api/src/webhooks/**` (mounted by the shell at `/webhooks/paypal`; do not edit)                                                                                                                                                                                                                                                                                                                                                                            |

A test for a slice lives next to its code, inside the slice's paths (`*.test.ts`).

## Which folder implements which IC-01 command

`src/lib/commands.ts` (`COMMAND_FOLDER`) is the single source of truth; the registry mounts every folder, and
`defineRouteFolder()` makes a folder implement **exactly** its commands (a missing or extra key is a type error).

| Folder                                        | Slice | IC-01 commands                                              | Also yours (extra routes, tasks)                                                                                                                       |
| --------------------------------------------- | ----- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `judge`                                       | JUDGE | `createJudgeSession`, `presence`                            | sessions, pool, Reset, quotas, live lane, "Try to break it", `judgeReset` task                                                                         |
| `auth`                                        | JUDGE | `createPairing`, `claimPairing`                             | frame tokens (`POST /v1/judge/sessions/:sid/frames`), member `/s/:token` exchange, brand `/b/:token`, `/ops/login`                                     |
| `rate-cards`                                  | RUNS  | `addDeduction` (always 409, use `problem.rateCardRatified`) | rate-card read and ratify                                                                                                                              |
| `slips`                                       | RUNS  | `capture`                                                   | extraction dispatch and the inline `extract` task (the seed's labelled stand-in reading)                                                               |
| `runs`                                        | RUNS  | `markPaid`, `setFlag`                                       | run reads, quote → invoice → funding, settle GETs, `ensureInvoice`/`recordPayment`/`postPayoutBatch`/`settleBatch`/`processWebhook`/`computeRun` tasks |
| `holds`                                       | RUNS  | `resolveHold`                                               |                                                                                                                                                        |
| `fields`                                      | RUNS  | `enterField`                                                |                                                                                                                                                        |
| `approvals`                                   | RUNS  | `approvalPayload`, `submitApproval`, `declineApproval`      |                                                                                                                                                        |
| `lines`                                       | RUNS  | `payCash`, `resend`                                         | `cancelUnclaimed`, `reroute` tasks                                                                                                                     |
| `season`                                      | RUNS  | none                                                        | W-TR-01..04 reads                                                                                                                                      |
| `proof`                                       | PROOF | `proof`, `proofJson`, `proofExport`                         | public Proof SSE (`/v1/proof/:runSlug/events`)                                                                                                         |
| `statements`                                  | PROOF | `createReviewRequest`                                       | statement reads, `explain` task                                                                                                                        |
| `wellknown`, `brand`, `print`, `ops`, `media` | PROOF | none                                                        | `/.well-known/fairsplit-keys.json`, brand view and CSV, 80 mm print data, `/ops`, dynamic media                                                        |
| `internal`                                    | JUDGE | none                                                        | `POST /internal/cron/tick` (fs-cron's hourly trigger; enqueues judgeReset, reconcile, warmCaches)                                                      |
| (shell) `src/sse`                             | SHELL | `runEvents`, `workspaceEvents`                              | `/v1/lines/:lineId/events`                                                                                                                             |

Until a handler is filled in, its command answers **501** with an IC-01 body
`{code: "INTERNAL", status: 501, details: {reason: "NOT_IMPLEMENTED", command, slice}}` (IC-01 has no
NOT_IMPLEMENTED code); the typed client's `isNotImplemented(e)` recognises it.

## Writing a handler

```ts
// src/routes/holds/index.ts (RUNS)
import { defineRouteFolder } from "../../lib/slice.js";
import { problem } from "../../lib/problem.js";
import { resolveHoldHandler } from "../../runs/holds.js"; // your code, in your paths

export default defineRouteFolder({
  folder: "holds",
  commands: { resolveHold: resolveHoldHandler },
  routes: (r) =>
    r.route(
      {
        method: "GET",
        path: "/v1/runs/:runSlug/holds",
        auth: "frame_or_session",
        name: "listHolds",
        response: HoldList,
      },
      async (ctx) => ({ holds: await listHolds(ctx.scope, ctx.params.runSlug) }),
    ),
  tasks: (deps) => ({ computeRun: (args, task) => computeRun(deps, args, task) }),
  onBoot: async (deps) => {
    /* optional */
  },
});
```

What the shell does **before** your handler runs (`src/lib/command.ts`, one code path for every route):
1. **Credential**: `frame_or_session` needs a frame/console token (`fst_`), a device token (`fsd_`) or the judge
   cookie (`fs_js`), else 401/403; `operator` needs the `fs_ops` cookie; `none`/`public` run anonymous (a presented
   credential that fails is in `ctx.credentialProblem`). **The workspace always comes from the credential**
   (`ctx.scope`), never from a body or a path.
2. **Path params**: `runSlug` must be a run slug, every other param a UUID (or your `params` schema) → 400.
3. **Headers**: `Content-Digest` over the exact body bytes (422 `CONTENT_DIGEST_MISMATCH`), `Idempotency-Key`
   where declared (400 when missing).
4. **Input**: the contract's zod schema (POST body or GET query) → 400 `VALIDATION_FAILED` with located issues.
5. **Idempotency** (S3.10): a POST with `Idempotency-Key` runs once per workspace and key; a retry replays the
   stored response (`Idempotent-Replayed: true`), another body under the key is 422 `IDEMPOTENCY_KEY_REUSED`.
6. **Your handler** returns the body, or `reply(status, body, headers?)` for another documented status (201/200).
7. **Response check**: the body must parse with the contract's response schema and the status must be listed in
   `SUCCESS_STATUS`, else 500 outside production (so contract drift fails your tests).
8. **Errors**: throw `ApiProblem`/`problem.*`; DB trigger errors, `NotFoundError`, serialization failures,
   `PayPalHttpError` and Hono exceptions are mapped for you (`toApiProblem`). Anything else is a 500 that never
   leaks its message.

## Shared APIs (import these; never copy them)

**Route and command layer** (`src/lib`)
- `defineRouteFolder<F>(m: { folder: F; commands: FolderCommands<F>; routes?(r: FolderRouter): void; tasks?(deps: AppDeps): TaskHandlers; onBoot?(deps: AppDeps): Promise<void> })`
- `type CommandHandler<N> = (ctx: CommandContext<N>) => Promise<CommandOutput<N> | Reply<CommandOutput<N>>> | …`
- `CommandContext<N>`: `{ name, c, deps, log, requestId, input, params, credential, scope, credentialProblem, rail: { label, provenance }, rawBody, rawBytes, header(name), now() }`
- `FolderRouter.route(def: RouteDef, handler)`: `RouteDef = { method, path, auth: "none" | "public" | "frame_or_session" | "operator", name, summary?, description?, request?, response?, success?, errors?, headers?, params?, maxBodyBytes? }`; `FolderRouter.app` is raw Hono for non-JSON (redirects, HTML, SSE): use `requireActing`/`requireCredential`/`sendProblem` there.
- `reply(status: 200 | 201 | 202 | 204, body, headers?)`
- `new ApiProblem(code: ErrorCode, message, { retryAfterMs?, paypalDebugId?, details?, fields?, cause? })` and
  `problem.validation(msg, issues?) | unauthenticated() | expired() | forbidden() | notFound(what) | rateLimited(retryAfterMs) | internal(msg, cause) | rateCardRatified({ hash, rateCard, ratifiedOn })`
- `COMMAND_FOLDER`, `ROUTE_FOLDERS`, `errorCodesOf(name)`, `SUCCESS_STATUS` (`src/lib/commands.ts`, the HTTP part
  shared with `@fairsplit/api-client/http`)
- `deps.rateLimits.take(RATE_RULES.presence, key)` → `{ ok: true } | { ok: false; retryAfterMs }` (`src/lib/rate-limit.ts`; presence 1 Hz, pairing claims, session starts per cookie and per hashed IP)
- `clientIpKey(c)` (the hashed address every per-IP rule takes), `clientIp(c)`, `hashedClientIp(keys, ip, now)` (`src/lib/client-ip.ts`; the address comes only from the hop `FS_TRUSTED_EDGE` names, never from a header a client can write; never store a raw IP)
- `contentDigestOf(body)`, `sha256Hex(body)`, `digestMatches(header, bytes)` (`src/lib/digest.ts`)
- `deps.clock.now()` / `ctx.now()`: never `Date.now()` in a handler (tests move a fake clock)

**Credentials, verify side** (`src/credentials/verify`; issuance is JUDGE's `src/credentials/issue`)
- Types: `Credential = FrameCredential | DeviceCredential | JudgeSessionCredential | OperatorCredential | MemberLinkCredential | BrandLinkCredential`; `ActingCredential`
- `actorOf(cred): Actor` (`{role}:{persona}`, impersonated by `judge_session:{sid}`), `scopeOf(cred): WorkspaceScope | null`, `workspaceOf`, `roleOf`, `isActing`
- `src/middleware/credential.ts`: `requireActing(c)`, `requireCredential(c, kinds?)`, `optionalCredential(c)`, `requireRole(cred, roles)`, `requireOperator(c)`
- Wire formats, one definition for issuer and verifier (`codec.ts`): `generateOpaqueToken("frame" | "device")` → return once, store only `opaqueTokenSha256(token)` in `frame_tokens.token_sha256`; `signCookie(deps.credentials.keys.hmacKey(JUDGE_COOKIE.purpose), { v: 1, sid, ws, iat, exp })` with `cookieAttributes(deps.env.publicOrigin, JUDGE_COOKIE.ttlMs)` (likewise `OPERATOR_COOKIE`); `signLink(deps.credentials.keys.linkPrivateKey, { v: 1, k: "member" | "brand", ws, lineId | brand, jti, exp })`; TTLs `FRAME_TOKEN_TTL_MS` (2 h), `DEVICE_TOKEN_TTL_MS`, `PAIRING_TTL_MS` (10 min), `JUDGE_COOKIE_TTL_MS` (24 h), `OPERATOR_COOKIE_TTL_MS` (8 h), `LINK_TTL_MS` (30 days)

**Data and effects** (`deps`, built once at boot: `src/lib/context.ts`)
- `deps.db` (Drizzle as `fs_app`), `deps.sql` (postgres.js), with `@fairsplit/db`: `repos(scope)`, `withWorkspaceTx`, `appendEvent(tx, e)` (writes `run_events` + `pg_notify`), `appendLedger`, `readFlags(db, ws, killEnv(deps.env))` (fresh, never cached), `schema`
- Effects go through the outbox in the same transaction (I7): `enqueue(tx, name, args, TASKS[name].dedupeKey(args))` from `@fairsplit/outbox`; handlers come back through your folder's `tasks`
- `deps.outbox?.runTask(id)` / `idle()` (inline run; tests and resets)

**Realtime** (`src/sse`): the run, workspace and line streams are the shell's. For the public Proof stream:
`deps.sse.open(c, { scope: { workspaceId, runId }, caps: publicCaps(c), lastEventId: parseLastEventId(header, query), filter, project, label: "proof" })`; `capsFor(cred, deps.sse.limits)` for credentialed streams; `findRunId(db, ws, runSlug)`.

**PayPal** (`src/paypal/mode.ts`, ADR-0002): `deps.paypal = { mode: "simulator" | "sandbox", label: "simulated" | "sandbox", provenance: "simulated_rail" | "live", baseUrl, fetch, core: { auth, http, verifier, postback, verifyPayPal, boot }, webhookId, describe() }`.
Build `@fairsplit/paypal-toolkit` / `@fairsplit/paypal-payouts` on `deps.paypal.fetch` and `deps.paypal.core`, so the
simulator routing, the 40/min limiter and `paypal_calls` recording apply. **I8**: stamp every PayPal-derived row,
event and response with `ctx.rail.provenance` (the `X-FS-Rail` header is added for you).

**Env** (`deps.env`, `src/env.ts`): `publicOrigin`, `production`, `paypal.{mode, businessEmail, payerEmail, receivers, unclaimedReceiver, webhookId}`, `secrets.{ledgerSigningKey, operatorPasswordScrypt, judgeCodeSha256, cronSecret}`, `executor`, `kill`. Never log a value.

## Test harness (`src/test`, also `@fairsplit/api/testing`)

```ts
import { createTestApp, createPayPalMock, sseReader } from "../../test/index.js";

const t = await createTestApp(); // no database: memory bus, memory credential store
const t = await createTestApp({ db: "postgres" }); // fresh migrated embedded Postgres (one cluster per run)
const fx = await t.fixture({ withRun: true, runState: "IN_REVIEW" }); // workspace, coop, season, ratified card, members
const token = await t.credentials.frameToken({
  workspaceId: fx.workspaceId,
  role: "treasurer",
  persona: "analyn",
});
const api = t.client(token); // the typed client over the in-process app
await expect(
  api.resolveHold({ params: { holdId }, body: { resolution: "COUNT_ONCE" } }),
).rejects.toMatchObject({ code: "HOLD_NOT_OPEN" });
const r = await t.json("/v1/…", { method: "POST", body, as: t.credentials.bearer(token) }); // raw
const { reader } = await t.sse(`/v1/runs/${slug}/events`, { as: t.credentials.bearer(token) });
t.clock.advance(31 * 60_000); // the fake clock every handler reads
await t.close();
```

- `createTestApp({ db?, clock?, env?, folders?, taskHandlers?, dispatcher?, simulator?, paypalFetch?, webhookTrustAnchors?, static? })`
- `t.credentials`: `workspace()`, `registerWorkspace(id)`, `frameToken({ workspaceId, role?, persona?, memberId?, sessionId?, kind?, expiresAt?, revoked? })`, `judgeCookie({ workspaceId, sessionId? })`, `operatorCookie()`, `memberLink({ workspaceId, lineId })`, `brandLink({ workspaceId })`, and `bearer(token)` / `judge(cookie)` / `operator(cookie)` for `as:`
- PayPal, zero live calls: the default rail is the labelled simulator **stub** (every call 503, nothing pays). For
  real PayPal shapes use `env: { PP_MODE: "sandbox", PP_CLIENT_ID: "test", PP_CLIENT_SECRET: "test", PP_WEBHOOK_ID: "WH-TEST" }` with `createPayPalMock([...handlers])` (msw, unhandled requests fail the test) or `simulator: { name, fetch }` for an in-process simulator. Signed webhooks: `@fairsplit/paypal-core/testing` (`createTestPki`, `signWebhook`, `syntheticEvent`, `payoutItemResource`).
- Postgres mode: `taskHandlers` + `dispatcher: true` run the outbox inline; `t.pg.owner` / `t.pg.app` pools.
- Seeded figures come from `@fairsplit/seed` (`getRun()`, `getHolds()`, `getLines()`, `getProof()`…): never hard-code a number.
- Name invariant tests `inv.iN.*`. Each command needs its happy path and every listed error code.

## Conventions

- TS 6 strict ESM NodeNext: relative imports end in `.js`. Zod 4 here; `paypal-*` packages keep zod 3 inside.
- Money is integer cents (`bigint` in SQL), weights grams; the model never writes a number (I1).
- Forward-only states via `@fairsplit/domain` machines with compare-and-set on state and version (I5).
- Free text goes to `notes`; ledger payloads carry IDs, enums, hashes and cents only.
- No `Date.now()`, no `Math.random()` for anything that matters: `deps.clock`, `node:crypto`.
- Log with `ctx.log` (request id attached). Never log tokens, links, signatures, bodies or secrets.
- `git commit -c user.name="Fair Split" -c user.email="noreply@fairsplit.invalid"`, Conventional Commits ending
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`.

## Gaps in the base the slices will meet (report, do not patch other workstreams)

- **contracts**: no `AgentMoneyPort` or `StatementPlan`/`renderStatement` yet (the plan puts them in IC-01): RUNS and
  PROOF define local types in their own paths until WS-CORE lands them; no `NOT_IMPLEMENTED` error code (the shell
  answers 501 with `INTERNAL`).
- **ai**: `@fairsplit/ai` exports nothing at the root and the agent (WS-AGENT) is not merged: RUNS codes the agent
  replay against `@fairsplit/ai/gateway` and a local port.
- **paypal-sim** (WS-PPSIM) is not in the base: simulator mode answers through the labelled stub until it lands
  (`createPayPalRail({ simulator })` is the one plug-in point). paypal-core has no option to allow-list the
  simulator's webhook cert URL; only `webhookTrustAnchors`.
- **db**: no table for revoked member links (`dbCredentialStore(db, { isLinkRevoked })` takes a required callback;
  fs-api reads the `link.revoked` ledger entries through `appCredentialStore`; an index on
  `ledger_entries((payload->>'jti')) where kind = 'link.revoked'` would keep it fast), no judge session table (the session id lives in the cookie and `frame_tokens.session_id`), no Postgres store for webhook
  transmission ids (paypal-core keeps them in memory). W1 adds nullable `webhook_events.delivery` jsonb
  (migration 0019, after HD2's published 0018): `src/paypal/webhooks.ts` stores the verified delivery and receipt time in the same
  transaction as the event and its outbox task. Legacy rows keep NULL and require a fresh GET.
  `orphan` with an error reason records notices deferred to settlement or blocked by stranded/identity
  checks; `appliedAt` is set only for an actual application or held-status corroboration.
