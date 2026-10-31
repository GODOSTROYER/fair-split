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
2. An embedded Postgres 17 under `e2e/.cache/stack` (gitignored), through `@fairsplit/db/testing` as fs-api's smoke
   does, or `FS_TEST_DATABASE_URL`; a fresh `fs_e2e` database with every migration.
3. fs-api from `apps/api/src/index.ts` (tsx) on a free port, `PP_MODE=simulator`: PayPal is fs-api's in-process
   simulator (ADR-0010), so every PayPal-derived value reads "Simulated PayPal sandbox". Its environment is a
   whitelist with throwaway signing keys made for the run: no `ANTHROPIC_API_KEY`, so the reading is the seed's
   labelled stand-in.
4. fs-api serves the console at `/`, the `/app` export and `/media` from that one origin.

A run that was killed hard (no teardown) leaves fs-api and the cluster up; the next start ends the fs-api its pid
file names and reuses or restarts the cluster.

| Variable           | Effect                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `E2E_CONSOLE_DIR`  | serve this console build instead of `apps/console/dist` (for example a ws/console build) |
| `E2E_SKIP_BUILD=1` | do not run `turbo run build` (the dists must exist)                                      |
| `E2E_BASE_URL`     | run the specs against that origin and start nothing (a hosted fs-api, DR-0)              |

## The specs

- `specs/api/e01-judge-run.spec.ts`: E-01 v1 (a). One judge run through fs-api with the treasurer and the Chair
  scripted (browser demo keys, proof of possession): the phases in order, 4 open / 3 blocking holds and 0462 by
  hand, the I4 refusal (change_payout armed before key 2: refused after both keys, approvals voided), 7 PayPal and
  57 cash lines, the simulated label on every PayPal-derived value (X-FS-Rail and the DTO labels), Proof (64 of 64
  explained, US$21.14 kept, chain and six plates), Reset within 10 s and a second press.
- `specs/api/cold-judge-timing.spec.ts`: first press to the payouts POST within 60 s, measured (annotated).
- `specs/browser/judge.spec.ts`: /judge's first view (noindex, no /v1 call before the first press), the first press
  funding the run, Reset and a second press.
- `specs/browser/proof.spec.ts`: /proof/<runSlug> for a settled run renders its six plates; Verify reads Sample,
  six of six.

The browser specs need the console's Judge stage. They read the served build's Vite manifest
(`lib/console.ts`): with main's console before M3 (only `/prototype`), they are `fixme` naming M3, and they run as
soon as the build holds `/judge` and `/proof/$runSlug`.

## Known gaps (test.fixme, each naming its owner)

| Spec                                            | Waits for                                                                                          |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| API: approvals read "Demo key (this browser)"   | WS-API: `runs/dto.ts` keyLabel expects `-w<digits>`, `judge/keys.ts` mints `fs-<persona>-demo-<6>` |
| API: the cold judge in the browser within 60 s  | C5b: Play it for me in http mode; key 2 through C5c or K1a                                         |
| Browser: slip 0462 by hand                      | C5b: the by-hand page stays "hasn't been read in this run yet" in http mode                        |
| Browser: Play it for me to the POST             | C5b (and C5c/K1a for key 2)                                                                        |
| Browser: Try to break it, the I4 refusal shown  | C5b: no tamper controls in http mode                                                               |
| Browser: Proof's holds caught and US$21.14 kept | C5b: Proof reads the holds from the seed, not `/v1/proof/:runSlug/metrics`                         |
| Browser: every stage spec, with main's console  | M3: ws/console merged                                                                              |
