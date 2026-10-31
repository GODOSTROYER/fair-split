# ADR-0010: The PayPal simulator runs in process inside fs-api

- **Status:** Accepted (user, on merge)
- **Date:** 31 Oct 2026 (IST)
- **Author:** WS-API (work package P1, with WS-PPCORE's verifier option and WS-QA's dependency rule)
- **Touches:** ADR-0002, register §6 (dependency rule) and §8 (webhooks, limits), `.dependency-cruiser.cjs`,
  `apps/api/src/paypal/**`, `apps/api/src/server.ts`, `apps/api/src/money/settle.ts` (Proof plate 6),
  `packages/paypal-core` (webhook verifier), `apps/api/package.json`, `render.yaml` (H1)

## Context

ADR-0002 runs PayPal only on our contract-faithful simulator (`packages/paypal-sim`), labelled "Simulated PayPal
sandbox" everywhere. Until now fs-api never ran against it:
- In `PP_MODE=simulator` without `PP_SIM_URL`, fs-api used a labelled stub that answers every PayPal call with
  503 `SIMULATOR_NOT_RUNNING`, so Judge Mode replayed every PayPal step (`simulator_not_running`). `render.yaml`
  has no simulator service and no `PP_SIM_URL`, and `apps/api` did not depend on `@fairsplit/paypal-sim`.
- A separate simulator service reached through `PP_SIM_URL` cannot work for Invoicing: the Agent Toolkit 1.11.0
  sends its calls through its own axios to `https://api.sandbox.paypal.com`, not through fs-api's rail. Only the
  simulator's in-process interceptor (node:http/https and the global undici dispatcher) routes them.
- The simulator signs webhooks exactly like PayPal (RSA-SHA256 over `id|time|webhookId|crc32`), but with a leaf its
  own CA issued, served at `{host}/paypal-sim/sim/certs/SIMCERT-….pem`. paypal-core's verifier accepted only PayPal's
  cert URL shape and subject, so no simulator delivery could ever verify.
- Judge Mode's quota counts from a balance reading; on the simulated rail, without one, from the opening US$100,000:
  min(40, (100,000 − 10,000) / (345 × 45 days)) = 5 live posts a day, a public third of 1. Nearly every session
  would replay.
- The 28 Oct booted smoke saw `markPaid` answer 429 QUEUED. Cause (found again here, fixed by J1 in
  `money/funding.ts`): the `extract` task's IC-01 dedupe key names every unread photo (`extract:<id>+<id>+…`); a judge
  pool clone has the replay photos unread, the key outgrows the outbox's 200 characters, `enqueue` throws a
  TypeError, the FUND transaction rolls back, and the generic classification answers QUEUED. It is not a PayPal
  pacing and not rail-specific.

## Decision

1. **In process.** In `PP_MODE=simulator` without `PP_SIM_URL`, `startServer` starts the simulator in fs-api's own
   process through `setupPayPalRail` (`apps/api/src/paypal/simulator.ts`) before it builds the rail, and passes
   `sim.apiFetch` to `createPayPalRail` as the rail's simulator. The interceptor catches the Agent Toolkit's axios
   and any global fetch to the sandbox hosts. A simulator that does not start is a boot refusal. `PP_SIM_URL` stays
   for a separately run simulator in development; the labelled 503 stub stays as the test harness's default only.
2. **One importer.** `apps/api/src/paypal/simulator.ts` is the only file of any app that imports
   `@fairsplit/paypal-sim` (dependency-cruiser rule `paypal-sim-only-through-the-api-adapter`); everything else, the
   tests included, goes through it.
3. **Public surface.** Only `sim.publicFetch` is mounted, at `/paypal-sim`: the certificate chain, the labelled
   invoice and pay pages, `/sim/health`. The REST API is never mounted (in process only) and `/sim/admin/*` is
   unreachable from outside (404), so no `SIM_ADMIN_TOKEN` exists and **no new secret** is added.
4. **Webhooks.** At each boot one webhook is registered (fs-api's subscribed event types) to
   `${PUBLIC_ORIGIN}/webhooks/paypal`. The simulator delivers to the host app's own fetch, in process, through the
   real route: RSA-SHA256 over the CRC32, the cert URL pattern, the 5-minute window, transmission-id dedupe in
   Postgres, the `webhook_events` row. Its id, minted fresh per boot, is the rail's webhook id (`PP_WEBHOOK_ID` is
   not used in this mode).
5. **Trust, simulator mode only.** paypal-core's verifier takes an optional `simulator` trust (the simulator's
   `certUrlPattern` and CA, `createPayPalCore({ webhookSimulator })`). With it, the cert URL must match the pattern
   (PayPal's own cert URLs are refused) and the leaf must chain to the simulator's CA, which stands in for PayPal's
   certificate subject. Only an in-process simulator rail passes it; a sandbox rail never does, and without it a
   simulator-signed delivery is refused before any fetch.
6. **Defaults.** `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS` and
   `PP_UNCLAIMED_RECEIVER` default to the committed `fs-judge` app and accounts in
   `packages/paypal-sim/data/accounts.json`: public, fictional values that only this simulator accepts. A set value
   wins; a client id the simulator does not know refuses the boot.
7. **State.** In memory only (no snapshot on Render's ephemeral disk; signing keys generated per process). The
   duplicate-delivery toggle is on (MM-6's resent copy). Rhea Jumawan (M-031) has no account, so her item parks
   UNCLAIMED. The co-op's simulated business balance opens at US$1,000,000, and a `searchBalances` reading is recorded
   in the judge quota ledger at boot and every 12 hours, so the quota allows 40 live posts a day to 15 Dec. The
   `SIM_*` tuning variables (`SIM_SPEED`, `SIM_LATENCY_MS`, …) still apply.
8. **Restart.** A restart or redeploy forgets every simulator object. Before the server listens, every claimed judge
   session of the previous process ends (claim cleared, tokens revoked, a `judge.session.reset` ledger entry with
   `trigger: "simulator_restarted"`); the judge folder's boot hook refills the pool. Deploy between sessions.
9. **Every item status rests on a verified event (Proof plate 6).** On a live rail a status can land before PayPal's
   signed event for it. Our cancel sets Rhea's RETURNED from PayPal's answer, so her signed `PAYOUTS-ITEM.CANCELED`
   arrives for an item that is already RETURNED. A settle GET can also read a SUCCESS before its SUCCEEDED is
   processed. Such an event changes nothing, so it used to leave no `webhook.applied` entry, and plate 6 read "failed"
   on every settled run. `processWebhook` (`money/settle.ts`, WS-API) now records one `webhook.applied` entry when a
   verified event (not `dev_mock`) names the status its fresh GET confirms and the item already holds, unless a
   verified entry of the chain already carries that status for the item. It writes no state change and no
   `item.updated`. Rhea's RETURNED then rests on the signed CANCELED, after our own `payout.cancel` in the chain,
   which is the order the seeded showcase's ledger has. This does not depend on W1 (storing the webhook
   `delivery`): W1 only lets a signed SUCCEEDED apply at once, and a CANCELED always waits for a fresh GET.

## Consequences

- WS-API: done here (`paypal/{simulator,pages,boot}.ts`, `server.ts`, `app.ts` mounts `/paypal-sim`). The hero path
  runs against the real simulator (`paypal/sim-hero-path.test.ts`, no msw): 7 SUCCESS, Rhea UNCLAIMED → cancel →
  RETURNED, every signed webhook verified and stored, X-FS-Rail `simulated`, the ledger chain verifies, no spec
  violation. The booted smoke walks one judge run's money path (`smoke/money.ts`) to the same end; its reading step
  needs J1's extract replay (on a trial merge with it, 31 Oct, 83 of 83 checks passed from `src/` and from `dist/`).
  Proof verifies all six plates on a live simulator run (decision 9): the hero path asserts it on a world that
  opens with a judge clone's ledger, and the smoke's `money.ledger` check requires it.
- WS-PPCORE: the verifier's `simulator` option and `checkSimulatorCertUrl` (tests in `verify.simulator.test.ts`).
- WS-QA: the dependency rule. WS-OPS (H1): `render.yaml` keeps `PP_MODE=simulator` with no `PP_SIM_URL` and no
  simulator service; the PP_* values may stay as plain `value:` entries (they equal the defaults); no `sync: false`
  key is added.
- Labels are unchanged: `X-FS-Rail: simulated`, provenance `simulated_rail`, "Simulated PayPal sandbox
  (contract-tested against PayPal's OpenAPI specs)". The judge rail now reads `live` instead of
  `replay (simulator_not_running)`, quota replays stay labelled.
- What gets worse, and what we accept:
  - **One instance only.** Each fs-api process has its own simulator, so two instances would hold two PayPals that
    disagree. `render.yaml` keeps fs-api at one instance in simulator mode.
  - Real (non-judge) workspaces in simulator mode lose their simulator objects on restart; only judge sessions are
    ended. Outbox rows of an ended judge workspace may fail against the new simulator until the hourly purge removes
    the workspace, and a batch whose POST a crash left unanswered is resumed (money/resume.ts) against the new
    simulator, for a session that has ended.
  - The simulator's state grows with use and is freed only by a restart; a judge run adds its invoice, batch, events
    and deliveries. A redeploy (between sessions) resets it.
  - A balance reading is the simulator's own number for its own simulated account: it decides how many live posts the
    demo allows, never real money.
  - Webhook delivery in process skips the network hop PayPal's delivery takes; the route, the verification and the
    storage are the same code.

## Alternatives considered

| Option                                                          | Why not                                                                                                                                                                                                           |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A separate Render service with `PP_SIM_URL`                     | The Agent Toolkit's axios calls bypass fs-api's rail and would go to PayPal's real sandbox host with a simulator token; it costs a service, delivers webhooks over the network, and its admin API needs a secret. |
| Keep the labelled stub (replay every PayPal step)               | Honest but weak: the hosted demo's PayPal chain would be replay only, and real workspaces get 503s.                                                                                                               |
| Persist the simulator's state in Postgres                       | More code in two workstreams for a demo that can deploy between sessions; reset-on-boot is enough.                                                                                                                |
| Trust the simulator's CA as a plain `webhookTrustAnchors` entry | PayPal's structural cert URL check (a paypal.com host, `/v1/notifications/certs/CERT-…`) still refuses the simulator's URL, and a plain anchor would add trust without replacing PayPal's shape.                  |
| Expose `/sim/admin` behind `SIM_ADMIN_TOKEN`                    | Needs a new secret; nothing on the judge path needs the admin API.                                                                                                                                                |
