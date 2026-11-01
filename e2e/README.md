# @fairsplit/e2e

The end-to-end harness (E1): one private stack per run, driven by Playwright 1.64.1 in Chromium.

```sh
corepack pnpm e2e                      # from the repository root: every spec, the stack up and down around them
corepack pnpm e2e --project api        # only the API-scripted specs
corepack pnpm --filter @fairsplit/e2e stack   # the stack alone, until Ctrl-C (to drive it by hand)
```

Chromium is Playwright's own build (1248 for 1.64.1). Locally it must already be installed; nothing here downloads
a browser. CI installs it on the runner (`.github/workflows/e2e.yml`, pushes to main and workflow_dispatch).

## The stack (`stack/`)

Global setup (`stack/global-setup.ts`) starts it once and its returned teardown stops it, after the last spec, on a
failure and on Ctrl-C; a process `exit` listener stops it if the runner ends any other way.
1. `turbo run build` for the console and the `/app` export (cached). `E2E_SKIP_BUILD=1` skips it.
2. Curated media assembled with `tools/assemble-media.ts` under `.codex-scratch/e2e-stack/media`, then an embedded
   Postgres 17 under `.codex-scratch/e2e-stack` (gitignored), through `@fairsplit/db/testing` as fs-api's smoke does,
   or `FS_TEST_DATABASE_URL`; a fresh `fs_e2e` database with every migration.
3. fs-api from `apps/api/src/index.ts` (tsx) on a free port, `PP_MODE=simulator`: PayPal is fs-api's in-process
   simulator (ADR-0010), so every PayPal-derived value reads "Simulated PayPal sandbox". Its environment is a
   whitelist with throwaway signing keys made for the run: no `ANTHROPIC_API_KEY`, so the reading is the seed's
   labelled stand-in. The private stack sets `NODE_ENV=test` and `FS_TEST_JUDGE_HOURLY_MAX=24`: the hourly quota is
   global, so separate judge cookies alone cannot isolate live-payout specs. fs-api accepts this override only in
   test + simulator mode outside Render; production's three-per-hour default stays intact. Daily, per-cookie,
   balance, lane and PayPal request pacing guards still apply. Each HTTP helper starts without a judge cookie,
   and each browser test has its own Playwright context.
4. fs-api serves the console at `/`, the `/app` export and the curated folder at `/media` from that one origin
   (`STATIC_MEDIA_DIR` points to the assembled folder).

A run that was killed hard (no teardown) leaves fs-api and the cluster up; the next start ends the fs-api its pid
file names and reuses or restarts the cluster.

| Variable           | Effect                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `E2E_CONSOLE_DIR`  | serve this console build instead of `apps/console/dist` (for example a ws/console build) |
| `E2E_SKIP_BUILD=1` | do not run `turbo run build` (the dists must exist)                                      |
| `E2E_BASE_URL`     | run the specs against that origin and start nothing (a hosted fs-api, DR-0)              |

## The specs

- `specs/api/media.spec.ts`: curated console photo and slip URLs return nonempty WebP images.
- `specs/api/e01-judge-run.spec.ts`: E-01 v1 (a). One judge run through fs-api with the treasurer and the Chair
  scripted (browser demo keys, proof of possession): the phases in order, 4 open / 3 blocking holds and 0462 by
  hand, the I4 refusal (change_payout armed before key 2: refused after both keys, approvals voided), 7 PayPal and
  57 cash lines, the simulated label on every PayPal-derived value (X-FS-Rail and the DTO labels), Proof (64 of 64
  explained, US$21.14 kept, chain and six plates), Reset within 10 s and a second press.
- `specs/api/cold-judge-timing.spec.ts`: first press to the payouts POST within 60 s, measured (annotated).
- `specs/api/paypal-pacing.spec.ts`: Mark paid with PayPal's window full answers 429 QUEUED with its wait
  (`retryAfterMs`, `Retry-After`). The harness honours it and the run funds.
- `specs/api/judge-quota.spec.ts`: the private stack reports the raised hourly cap. Explicitly labelled synthetic
  reservations fill that cap only after a run's invoice funds; its payout replays and Proof reports five matching
  plates plus one labelled replay, with no PayPal-verified members. The fixture removes only its exact row IDs in
  `finally`, and resets its judge session. It is skipped against an origin without the private stack database.
- `specs/browser/judge.spec.ts`: /judge's first view (noindex, no /v1 call before the first press), the first press
  funding the run, Reset and a second press.
- `specs/browser/proof.spec.ts`: /proof/<runSlug> for a settled run renders its six plates; Verify reads Sample,
  six of six.
- `specs/browser/phone-cosign.spec.ts`: the real `/app` Chair export against fs-api's routes. API helpers take a
  keyless judge run through the review and key 1; a test-owned same-origin parent performs the IC-12 `fs.ready` /
  `fs.token` handshake with a real frame token (no token in the URL). The phone displays its checked batch hash and
  the count of all checked member lines, registers its browser key with proof of possession and signs key 2. The event stream proves
  `APPROVED` to `POSTING`. An explicit adversarial `/lines` response fixture proves an inconsistent cash-line root
  signs and submits nothing. Separately, the real `change_payout` judge route proves fs-api refuses the changed
  payout after key 2, voids both approvals and allows a fresh review and signing. This test does not claim that the
  console stage performs the handoff, or that the route changes a line before signing; those gaps are fixmes below.

For the stage handoff, `/frames` returns separate `role: "board"` and `persona: "ernesto"` fields. IC-12 requires
the qualified `persona: "board:ernesto"`; form it as `${role}:${persona}` when building `fs.token`. Pass
`ws: workspaceId` and `exp: Date.parse(expiresAt)`, and send only to the same-origin Chair window after `fs.ready`.

The browser specs need the console's Judge stage. They read the served build's Vite manifest
(`lib/console.ts`): with main's console before M3 (only `/prototype`), they are `fixme` naming M3, and they run as
soon as the build holds `/judge` and `/proof/$runSlug`.

## PayPal's window (`lib/paypal-window.ts`)

fs-api's limiter allows 40 PayPal calls in any 60 s, at most 20 of them background (`packages/db/src/limiter.ts`).
A full window paces a live step: it answers QUEUED and runs later. A judge run makes 10 live calls, 7 of them in the
second around INVOICED, and its settle checks can take all 20 background slots. So two presses inside one minute can
leave the second run's Mark paid without room.
- Before every judge press, the harness reads the window from the stack's own database (`E2E_DATABASE_URL`, set by
  global setup, never printed). It waits until the earlier runs' live calls leave room for the whole run, even with
  the background share full. Waits are printed as `[paypal-window] waited …`. The timing spec presses first, on an
  idle window, and its clock starts after any wait.
- A press PayPal still paces is honoured, not failed (`honourQueued` in `lib/api.ts`). The harness waits the
  `retryAfterMs` the QUEUED answer names, then asks again, unless the queued step already ran on its own.
- E-01 asserts that the window had room at its press and never filled during its run. Teardown prints the suite's
  peak (`[stack] PayPal's window peaked at …`), leaving out the pacing spec's labelled filler rows.

Against a hosted origin (`E2E_BASE_URL` set by hand) there is no database, so nothing is read and nothing waits.
QUEUED is still honoured, and the pacing spec is skipped.

## Known gaps (test.fixme, each naming its owner)

| Spec                                            | Waits for                                                                                                                                                                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API: approvals read "Demo key (this browser)"   | WS-API: `runs/dto.ts` keyLabel expects `-w<digits>`, `judge/keys.ts` mints `fs-<persona>-demo-<6>`                                                                                                                                     |
| API: the cold judge in the browser within 60 s  | C5b: Play it for me in http mode; key 2 through C5c or K1a                                                                                                                                                                             |
| Browser: slip 0462 by hand                      | C5b: the by-hand page stays "hasn't been read in this run yet" in http mode                                                                                                                                                            |
| Browser: Play it for me to the POST             | C5b (and C5c/K1a for key 2)                                                                                                                                                                                                            |
| Browser: Try to break it, the I4 refusal shown  | C5b: no tamper controls in http mode                                                                                                                                                                                                   |
| Browser: Proof's holds caught and US$21.14 kept | C5b: Proof reads the holds from the seed, not `/v1/proof/:runSlug/metrics`                                                                                                                                                             |
| Browser: over-quota Proof labels payout replay  | WS-CONSOLE: render `verification.status=replay`, `payoutItems.state=replay`, the explicit recorded-status label and the five-of-six verdict. The API/domain regression remains active.                                                 |
| Browser: every stage spec, with main's console  | M3: ws/console merged                                                                                                                                                                                                                  |
| Phone: console stage hands the Chair its token  | WS-CONSOLE/M3: mint `board:ernesto` via `POST /v1/judge/sessions/:sid/frames`; keep it in memory; send IC-12 `fs.token` after the Chair iframe's same-origin `fs.ready`, resend after reload, and discard it/send `fs.reset` on Reset  |
| Phone: judge-route line drift before key 2      | WS-API: `change_payout` mutates only inside `postPayoutBatch`, after both signatures, then restores the line on refusal. No existing judge route exposes pre-sign drift; the client guard uses an explicitly labelled response fixture |
