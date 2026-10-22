## S5. Execution: Workstreams, Schedule, Verification, Demo and Submission

Who builds what, in what order, how we prove it works, and how it reaches the judges. Where the register already fixes a fact (§11 workstreams and contracts, §12 spikes, gates and cut order, §13 open decisions), this section points to it and adds only what a builder needs.

### S5.1 Ground rules

- **Clock.** All times are IST (UTC+05:30) unless marked PT. The deadline, Thu 12 Nov 12:00 PST, is Thu 12 Nov 20:00 UTC and Fri 13 Nov 01:30 IST (paypalaihackathon.devpost.com/rules). US daylight saving ends at 02:00 PT on Sun 1 Nov, so quotas that reset at Pacific midnight reset at 12:30 IST up to 1 Nov and at 13:30 IST from 2 Nov.
- **People.** The user plus Claude Code subagents. Only the user merges, signs gates, holds credentials and posts anything public.
- **Sources of truth.** Figures: `packages/seed/snapshot/season-2026A.json` (IC-03). Copy and motion: design §6–§8. Contracts: `packages/contracts` (IC-01). Pins: AGENTS.md and `docs/versions.md`.
- **Evidence.** Spikes write `docs/spikes/S{n}.md` (verdict, `debug_id` excerpts, fallback); gates write `docs/gates/G{n}.md` (criteria, CI links, decision, cuts).
- **Dev machine, checked 22 Oct.** Windows 11 Home, 32 GB RAM, Intel Arc iGPU, 2560×1600 panel. `Z:` is a local NTFS volume: clone to `Z:\fs`. LongPathsEnabled is 1; set `git config --global core.longpaths true`. Node 24.19.0 must move to the 24.22.1 pin; pnpm 11.28.6 comes through corepack (10.13.1 is global); Java 24 is present but Android needs JDK 17; adb 1.0.41 sits under `%LOCALAPPDATA%\Android\Sdk\platform-tools`, off PATH; scrcpy is missing; ffmpeg 9.0.2, cloudflared 2025.8.1 and codex-cli 0.159.3 (`image_generation` stable) are present. Windows Sandbox does not exist on Home (learn.microsoft.com, Windows Sandbox overview), which shapes S5.5.4.

### S5.2 Workstreams for Claude subagents

#### S5.2.1 Opening and closing work

Owned paths and G2 deliverables are exactly register §11.

| WS         | 22–24 Oct                                                                                                                                                                                                      | 30 Oct–6 Nov                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| WS-CORE    | IC-01, IC-02, IC-03 drafts by 23 Oct 12:00; engine passes `canonical.test.ts`; freeze 24 Oct 18:00                                                                                                             | Named property tests I1–I8; seed variants for every UI state                      |
| WS-DATA    | Schema; triggers blocking edits to a ratified card and `slip_rows` dated before `ratified_at`; no UPDATE or DELETE grants on `run_events`, `ledger_entries`, `agent_sessions`; outbox with the inline executor | Crash-between-commit-and-dispatch test (I7); migrations frozen at G5              |
| WS-PPCORE  | `PayPalAuth`, `PayPalHttp`, `verifyPayPal`, `tools/setup-webhooks.ts`; S5 with the user                                                                                                                        | Catch-up job; fixtures re-signed with the test CA; the resend beat                |
| WS-PPMONEY | S2, S4 (S11 only if triggered); allowlist contract test against the real 1.11.0 package                                                                                                                        | Cancel and re-route; upstream drafts, kept outside the monorepo                   |
| WS-READ    | S3 on the 10 hero slips; `ClaudeGateway` with the replay cache                                                                                                                                                 | 40-case eval (G3); records the replay run on 29 Oct                               |
| WS-AGENT   | Tool runner behind the lattice, IC-06 stubbed; placeholder validator                                                                                                                                           | Statement texts frozen 1 Nov; hold lines; SMS preview                             |
| WS-API     | S9; routes from IC-01 with msw parity; SSE with Last-Event-ID; frame and pairing tokens                                                                                                                        | Live lane, presence, Judge clone in 10 s or less, balance-based live cap (S5.5.5) |
| WS-OPS     | S6; a hello `fs-api` on 22 Oct so webhooks have an HTTPS URL                                                                                                                                                   | Soak harness, `/ops` checks, `tools/export-sandbox-ids.ts`, December runbook      |
| WS-DS      | S8; tokens with contrast tests in CI; five primitives on web and native by 24 Oct; prototype 25 Oct                                                                                                            | IC-10 by 27 Oct; reduced-motion variants; sound and haptics                       |
| WS-CONSOLE | Routes, data and states on the primitives only until G1; Judge stage shell                                                                                                                                     | W-TR-01 to W-TR-10, Proof, `/ops`; web halves of MM-2 to MM-6                     |
| WS-APP     | S7 end to end; signed APK by 24 Oct                                                                                                                                                                            | MM-1, MM-7, M-BD-02, push, offline outbox; release APK 30 Oct                     |
| WS-QA      | Skeleton, CI, ownership check, PR template, AGENTS.md, bootstrap install of the pinned stack, all on 22 Oct                                                                                                    | E2E catalogue (S5.5.1), Maestro, axe, budgets, re-scans, Devpost text             |
| WS-MEDIA   | 10 hero slips and the BR 2026-04 pages on 22 Oct; S10                                                                                                                                                          | Photos A–L by 27 Oct; audio by 5 Nov; rehearsal 2 Nov; film 6–8 Nov               |

Nobody waits idle. Until a dependency lands, the consumer codes against the frozen contract plus a local stub or msw handler. It deletes the stub in the PR that switches to the real module.

#### S5.2.2 Contracts first

| IC    | Owner             | Frozen                        | Note                                                                   |
| ----- | ----------------- | ----------------------------- | ---------------------------------------------------------------------- |
| IC-01 | WS-CORE           | 24 Oct 18:00 (register)       | Includes `RunEvent`, `TaskName`, screen IDs, routes                    |
| IC-02 | WS-CORE           | 24 Oct 18:00                  | Signatures only                                                        |
| IC-03 | WS-CORE           | 24 Oct 18:00 (register)       | No figure typed anywhere else                                          |
| IC-04 | WS-DATA           | 25 Oct 18:00                  |                                                                        |
| IC-05 | WS-PPCORE         | 25 Oct 18:00                  |                                                                        |
| IC-06 | WS-PPMONEY        | 26 Oct 18:00                  | After S2 and S4                                                        |
| IC-07 | WS-READ, WS-AGENT | 26 Oct 18:00                  | `Extraction` fixed by the S3 verdict                                   |
| IC-08 | WS-API            | 25 Oct 18:00                  | OpenAPI and msw handlers generated from IC-01 in CI, never hand-edited |
| IC-09 | WS-DS             | 27 Oct 18:00                  | After the G1 revision round                                            |
| IC-10 | WS-DS             | 27 Oct (register)             | Phase names are test selectors                                         |
| IC-11 | WS-MEDIA          | Schema 24 Oct; content 27 Oct | Fixtures reviewed by the user                                          |

After a freeze, a change needs an ADR PR (`docs/adr/NNNN-slug.md`: the change, the affected consumers, the migration). The user approves it, and the owner lands it together with the consumers' fixes in one merge train. A consumer that needs something new opens a `contract-request` issue naming the IC, and the owner answers the same day.

#### S5.2.3 Avoiding collisions

1. Each workstream has one worktree and one long-lived branch (`git worktree add Z:\fs-wt\<ws> -b ws/<ws>`). PRs land by rebase-merge, so branches fast-forward and the small daily commits survive.
2. CI checks every PR's paths against `docs/ownership.md`. Root files that no row owns (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.dependency-cruiser.cjs`, `.gitattributes`, `.gitignore`, `lefthook.yml`, AGENTS.md) are WS-QA's hygiene files.
3. `docs/spikes/`, `docs/gates/` and `docs/adr/` accept new files from any workstream. CI rejects edits to existing files there.
4. WS-QA installs the whole pinned stack in one bootstrap PR: the architecture list, minus the register's removals, plus its additions. Later dependencies go in PRs labelled `deps`, the only PRs allowed to touch `pnpm-lock.yaml` and `docs/versions.md`. They merge first in the train, one at a time. Every new pin is exact and at least 14 days old.
5. Only WS-DATA writes migrations.
6. UI strings live beside their screen. `packages/i18n` owns the runtime, ICU set-up, glossary and `REVIEW.md`; status words come from IC-01.
7. A money or kilo literal outside `packages/seed` fails lint, so screens, tests, README and film all read IC-03.

#### S5.2.4 Merge train and review

- **Daily, 21:00–22:30.** Order: `deps`; WS-QA infrastructure; WS-CORE; WS-DATA; WS-PPCORE; WS-PPMONEY, WS-READ, WS-AGENT; WS-API, WS-OPS; WS-DS; WS-CONSOLE, WS-APP; WS-MEDIA and WS-QA tests and docs. Each next PR rebases and must be green again. Each workstream opens at most one PR a day.
- **Pre-review.** A reviewer subagent runs the `code-review` skill on every PR. The author fixes or answers each finding before the user looks.

| Tier               | Paths                                                                                                                | The user reviews                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A: money and trust | `paypal-*`, `apps/api/src/webhooks/**`, `outbox`, approvals, signatures, policy lattice, auth, tokens, `render.yaml` | The diff (400 changed lines at most), the tests, the findings |
| B: logic and AI    | `domain`, `db`, `ai`, `eval`                                                                                         | Summary, tests, eval delta                                    |
| C: UI, media, docs | `ui-*`, `apps/console`, `apps/mobile`, `media`, `video`, docs                                                        | CI screenshots and Playwright traces                          |
- **Stop the line.** A red `main` halts the train. Fix forward within 2 hours or revert.
- **Gates** are 30–90 minute sessions (S5.3.2). The decision and any cuts go into `docs/gates/G{n}.md` that evening.

### S5.3 Schedule and gates

#### S5.3.1 Day by day

| Date       | Gate         | Build                                                                                                                                                                                                        | The user (time)                                                                                                                                                                           |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Thu 22 Oct | —            | Register adopted. QA skeleton, CI, bootstrap deps. CORE IC drafts. OPS hello `fs-api`. MEDIA: 10 hero slips (0403, 0419, 0436, 0449, 0457 white, 0457 pink, 0458, 0462, 0467, 0471) and the BR 2026-04 pages | Create the repo; S1 (60 min); Anthropic, Gemini and Render keys (40 min); OD-6 question to the organisers: if two sponsor prizes pick one project, which is awarded? (5 min)              |
| Fri 23 Oct | —            | S2, S3, S4, S6–S10 run; S11 at 20:00 only if S3 is below 0.80                                                                                                                                                | Hero-slip labels by 12:00 (45 min); S5 (30 min); APIMatic Context Plugin and PayPal AI-Toolkit plugin (15 min); Firebase, EAS (30 min)                                                    |
| Sat 24 Oct | **G0** 17:00 | Verdicts; IC-01/02/03 frozen 18:00; tokens, five primitives, signed APK                                                                                                                                      | G0 (45 min)                                                                                                                                                                               |
| Sun 25 Oct | —            | Prototype on `/prototype` and the APK (register list)                                                                                                                                                        | Review on laptop and phone (60 min)                                                                                                                                                       |
| Mon 26 Oct | **G1** 18:00 | First real chain: webhook, outbox, task, SSE; Judge clone. Re-scan 1                                                                                                                                         | Sign off, or send one revision list (30 min)                                                                                                                                              |
| Tue 27 Oct | —            | Revisions close 18:00; IC-09 and IC-10 frozen; photos A–L with fixtures                                                                                                                                      | Check the A–L fixtures (90 min)                                                                                                                                                           |
| Wed 28 Oct | —            | Hosted loop on Render; live lane; reset; APK pairing                                                                                                                                                         | Smoke-test it (20 min)                                                                                                                                                                    |
| Thu 29 Oct | **G2** 19:00 | MLD; the real Claude run recorded for replay; 2-minute rough cut with HyperFrames' offline Kokoro voice (no Gemini quota); DR-1                                                                              | G2 (90 min); OD-3, OD-8                                                                                                                                                                   |
| Fri 30 Oct | —            | Release APK (R8) smoke test; soak from 12:00; MM-1, MM-5; eval cases 21–40                                                                                                                                   | Release APK smoke test (30 min)                                                                                                                                                           |
| Sat 31 Oct | —            | Soak ends 12:00; MM-2, MM-3                                                                                                                                                                                  | Soak review (20 min); OD-4                                                                                                                                                                |
| Sun 1 Nov  | **G3** 18:00 | Eval vs baseline; Android p95; statement texts frozen; 100+ tests                                                                                                                                            | G3 (45 min); send texts to a native reviewer if OD-2 found one                                                                                                                            |
| Mon 2 Nov  | —            | MM-4, MM-6, MM-7; capture rehearsal; title, map and end card. Re-scan 2                                                                                                                                      | Rehearsal (60 min); display-driver decision                                                                                                                                               |
| Tue 3 Nov  | —            | Audio day 1 (M-014 in three languages, then the other PayPal hero members); upstream drafts                                                                                                                  | Review drafts (30 min)                                                                                                                                                                    |
| Wed 4 Nov  | **G4** 18:00 | Moments asserted, or switched to reduced motion; audio day 2                                                                                                                                                 | G4 (60 min)                                                                                                                                                                               |
| Thu 5 Nov  | —            | Audio done; Devpost text drafted                                                                                                                                                                             | Press **Submit** on Devpost by 20:00; the video field holds a public rough cut narrated by the Flash-Lite draft voice, swapped 9 Nov (60 min); upstream posts (30 min); OD-1, 2, 5, 6, 10 |
| Fri 6 Nov  | **G5** 12:00 | Freeze; TalkBack, 200% text and axe passes; film takes 15:00–19:00                                                                                                                                           | Accessibility passes (90 min); film (4 h)                                                                                                                                                 |
| Sat 7 Nov  | —            | HyperFrames assembly; narration take 1 at 13:45                                                                                                                                                              | Review cut 1 (45 min)                                                                                                                                                                     |
| Sun 8 Nov  | —            | Retakes at 13:45; mix to −14 LUFS; **video lock 22:00**                                                                                                                                                      | Approve the lock (45 min)                                                                                                                                                                 |
| Mon 9 Nov  | **G6** 20:00 | Captions, chapters, thumbnail. Re-scan 3                                                                                                                                                                     | Upload by 12:00; check the embed logged out (60 min)                                                                                                                                      |
| Tue 10 Nov | buffer       | README final (sandbox IDs, real vs simulated, prior art); Devpost final; DR-3 submission dry run                                                                                                             | Edits and dry run (90 min)                                                                                                                                                                |
| Wed 11 Nov | **G7** 22:00 | DR-4 in the morning; tag `v1.0.0`                                                                                                                                                                            | Clean-machine run (2 h); submit; screenshot                                                                                                                                               |
| Thu 12 Nov | —            | Buffer: only a demo-breaking fix merges                                                                                                                                                                      | Stay reachable until 13 Nov 01:30                                                                                                                                                         |
| 13–30 Nov  | —            | `main` frozen except uptime fixes, each logged in CHANGELOG                                                                                                                                                  | —                                                                                                                                                                                         |
| 1–15 Dec   | —            | Deploy freeze; hourly checks (S5.5.5)                                                                                                                                                                        | Check `/ops` daily at 09:00                                                                                                                                                               |

#### S5.3.2 Gates

| Gate       | Passes when                                                                                                                              | If it fails                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| G0, 24 Oct | S1–S4 green, and the memo checkpoint (invoice, verified PAID, payout, verified SUCCEEDED) passed on `fs-dev`                             | The register's G0 kill rules apply. Every other spike takes its register fallback without blocking                                         |
| G1, 26 Oct | The user signs off the register's prototype list                                                                                         | One revision round to 27 Oct 18:00. After that the revised prototype is the baseline, and only token and copy changes follow               |
| G2, 29 Oct | The register's MLD list, plus DR-1                                                                                                       | Apply the register cut order from item 1, never touching the never-cut list; re-check 31 Oct                                               |
| G3, 1 Nov  | All four eval bars met against PP-OCRv5; p95 frame time of 18 ms or less (about 55 fps) on the low-end phone; texts frozen; 100+ tests   | Show the honest eval numbers in the tile and have the film lean on human entry; make the low-end tier the default; run a QA swarm on 2 Nov |
| G4, 4 Nov  | Every MM has a `data-moment-phase` assertion and a reduced-motion variant                                                                | Unfinished moments ship as their reduced-motion version (register)                                                                         |
| G5, 6 Nov  | No open P0 (demo-breaking or money-wrong) or P1 (visible on the judge path) bug; accessibility passes recorded; real-event takes in hand | Only bug fixes merge; missing takes are re-shot 7 Nov                                                                                      |
| G6, 9 Nov  | Public video of 2:55 or less (target 2:50), with English captions and three or more chapters, playing logged out in the Devpost embed    | Upload what exists by 10 Nov 12:00                                                                                                         |
| G7, 11 Nov | DR-4 passes and Devpost shows Submitted                                                                                                  | Fix by 12 Nov 12:00. If that fails, the README names the hosted path as primary and documents the clone issue                              |

**Spike protocol.**
- Each spike has one owner and a 4-hour timebox (S11: 2 hours). Verdicts (GREEN, FALLBACK or KILL) go in `docs/spikes/` by 24 Oct 12:00.
- PayPal spikes run on `fs-dev` only and keep every `debug_id`.
- S4 records ERRPYO002's status, the receiver domain that yields UNCLAIMED (OD-11), and the per-item fee PayPal reports.
- S10 starts from Google's docs, which list Cebuano and Filipino for both 3.8 TTS models (ai.google.dev/gemini-api/docs/speech-generation, read 22 Oct). It measures pronunciation and the free-tier quota, which Google does not publish. Limits apply per project, and requests per day reset at Pacific midnight (ai.google.dev/gemini-api/docs/rate-limits).

### S5.4 Human-only tasks

Register §11 lists the user's steps; these are the exact actions. Subagents prepare inputs and verify outputs.

**S1, PayPal sandbox (22 Oct, about 60 minutes).**
1. On developer.paypal.com, go to Sandbox Accounts, then Create Account, then Create Custom Account. Every account uses Country = United States and USD; never India.
2. Create the accounts:
   - **Business:** the co-op (invoicer and payout sender), with US$100,000 or the form's maximum.
   - **Personal:** the seven on-rail members other than Rhea (M-014, M-007, M-060, M-018, M-039, M-022, M-002 in the seed draft; WS-CORE confirms against IC-03), and Lantern Bay with the maximum balance.
   - **Rhea** gets no account.
3. Create a standby business account, "co-op B", with the maximum balance and no app (R4). The dashboard sets a balance only on a new or duplicated account (developer.paypal.com/tools/sandbox/accounts).
4. In Apps & Credentials, under Sandbox, choose Create App (Merchant) on the co-op account: first `fs-dev`, then `fs-judge`. Under Features, tick Invoicing, Payouts and Transaction search, then save. Transaction search takes about 9 hours to propagate.
5. Put the secrets in the password manager. Then put the `fs-dev` secrets into `Z:\fs\.env.local` and the `fs-judge` secrets into the Render env group `fs-secrets`. Non-secret IDs go to `docs/sandbox.md` through WS-QA.
6. With the secrets in place, the user or WS-PPCORE runs `pnpm tsx tools/setup-webhooks.ts --app fs-dev --url https://<tunnel>/webhooks/paypal`, then the same for `fs-judge` with the Render URL. Each returned ID becomes `PP_WEBHOOK_ID`. Quick-tunnel URLs change on every restart; re-run the script, which PATCHes `/url` (developer.paypal.com/api/webhooks/v1/webhooks-update).

**S5 (23 Oct, 30 minutes).** In a private window, sign in to sandbox.paypal.com as Lantern Bay, open the `recipient_view_url` that WS-PPCORE posts, and pay. WS-PPCORE records the PAID webhook and the postback result.

**Credentials (22–23 Oct).**

| Item                | Where                                                                                                                                                                        | Notes                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Anthropic           | Keys: dev (`.env.local`), ci (GitHub environment `eval-live`), prod (Render)                                                                                                 | Set a Console spend limit above the code's daily cap and the US$3 nightly cap |
| Gemini              | One project, one key, on the dev machine only, for `tools/tts.ts`                                                                                                            | Never in Render or CI; never rotated (register)                               |
| PayPal in CI        | `fs-dev` credentials in the protected environment `sandbox-smoke`                                                                                                            | For E-17                                                                      |
| Render              | Account with a payment method; Blueprint on the repo; `fs-secrets` values entered by the user                                                                                | Paid plans (register)                                                         |
| Expo, EAS, Firebase | `EXPO_TOKEN` in GitHub secrets; Firebase Android app; FCM V1 key via `eas credentials`; `google-services.json` as an EAS file secret                                         | Nothing committed                                                             |
| GitHub              | Public repo; MIT `LICENSE` at the root so the About box detects it; description; topics including `paypal-ai-hackathon`; push protection; branch protection that requires CI |                                                                               |
| YouTube             | Channel phone-verified by 2 Nov, because custom thumbnails need it (support.google.com/youtube/answer/72431)                                                                 |                                                                               |

**Machine and devices (by 30 Oct).**
- **Tools:** JDK 17; platform-tools on PATH; scrcpy 5.0.1 (8 Oct; github.com/Genymobile/scrcpy/releases); OBS Studio 32.2.2; USB debugging enabled.
- **Phones:**
  - A low-end Android (3 GB RAM or less, Android 10–12) for performance and TalkBack evidence.
  - A current Android (14 or later) for push, the ML Kit scanner and filming.
  - With only one phone, it plays the Chair in one film run and the member in a second.
- **Optional, the user's call, by 2 Nov:** the Virtual Display Driver (MIT; `winget install -e --id VirtualDrivers.Virtual-Display-Driver`). Its README says to uninstall it before GPU driver updates.

**Judgement and hands.**
- **Label checks:** hero slips (23 Oct), A–L fixtures (27 Oct), 40 eval labels (29–31 Oct), and a 10% spot-check of P01–P54.
- **Decisions:** every gate, and OD-1 to OD-11 by their dates.
- **On film:** the user's hands are the real co-signer and the member's thumb. The co-signer is never scripted (design).
- **Posts by 5 Nov:**
  - sandbox evidence on PR #107 (github.com/paypal/agent-toolkit/pull/107, open and unmerged on 22 Oct);
  - the token-expiry PR with its jest test;
  - the ai@4 temperature issue.
    Never use the word "merged".
- **Publishing:** YouTube and Devpost.

### S5.5 Verification plan

#### S5.5.1 End-to-end scenarios

Replay scenarios run on every PR with the inline executor and msw. Live scenarios hit the sandbox.

| ID   | Scenario                                                                              | Cadence                                                                 | Asserts                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01 | Judge happy path, with treasurer and Chair contexts                                   | Replay, every PR                                                        | Seven MM phases in order; 64 of 64 lines explained; 3 holds; US$21.14 returned; 7 paid by PayPal and 57 in cash                                     |
| E-02 | E-01 through hosted Judge Mode                                                        | Live: nightly 30 Oct–11 Nov, daily 1–15 Dec                             | About 11 PayPal calls; a 201; verified item events; Rhea goes UNCLAIMED, is cancelled, then RETURNED, then OFF_RAIL_DUE                             |
| E-03 | Tamper: a line edited after key 1, and a payout row altered in the DB after both keys | Replay                                                                  | First case: approvals voided and the run back to IN_REVIEW. Second case: the hash mismatch is refused and nothing calls `POST /v1/payments/payouts` |
| E-04 | A resent webhook                                                                      | Live in E-02; replay                                                    | One "Delivery repeated, already applied." row; no state change, no sound                                                                            |
| E-05 | An item event arrives before the 201                                                  | Replay                                                                  | It joins by `sender_item_id`; no orphan after catch-up                                                                                              |
| E-06 | INVOICE.PAID never arrives                                                            | Replay                                                                  | The 60 s GET funds the run                                                                                                                          |
| E-07 | The sandbox returns 429                                                               | Replay                                                                  | 6-minute circuit; labelled replay; queue copy                                                                                                       |
| E-08 | `kill_payouts` is on                                                                  | Replay                                                                  | The Approve slab is bolted; the run is HALTED below POSTING                                                                                         |
| E-09 | Add to Schedule A                                                                     | Replay                                                                  | 409 `RATE_CARD_RATIFIED`, citing the hash                                                                                                           |
| E-10 | Instruction text on slip 0449                                                         | Replay, eval                                                            | Quarantined; no line changes                                                                                                                        |
| E-11 | A reset during a live run                                                             | Integration                                                             | `judgeReset` skips while the lane lock is held                                                                                                      |
| E-12 | Clerk captures offline                                                                | Maestro                                                                 | "3 saved on this phone", then synced; a resend shows "Already sent"                                                                                 |
| E-13 | Chair co-signs on the phone                                                           | Maestro, web frame                                                      | The seal hash matches; a tampered seal is refused                                                                                                   |
| E-14 | Member listens                                                                        | Maestro                                                                 | Paminawa plays; a missing clip falls back to labelled device speech                                                                                 |
| E-15 | Reduced motion                                                                        | Playwright with `reducedMotion: 'reduce'`; Android animator scales at 0 | Every MM reports its reduced-variant phases                                                                                                         |
| E-16 | Proof verify                                                                          | Replay                                                                  | Six checks read "Matches"; an altered proof is withheld                                                                                             |
| E-17 | `sandbox-smoke.yml`                                                                   | Live, nightly, from GitHub's network, with `fs-dev`                     | Invoice, record payment, and a US$1.00 single-item payout, asserted by GET because the dev tunnel is off at night                                   |

In film mode (`FS_TAKE=film`), E-01 leaves the Chair unscripted and waits up to 120 s for the real `approval.signed` from the paired phone. CI always scripts the Chair.

#### S5.5.2 Device and browser matrix

| Surface              | Must pass                                                                                             | Also                                                                            | Method                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Console, Judge stage | Chrome stable on Windows 11, at 1920×1080 and 1440×900                                                | Edge and Firefox; Playwright WebKit for Safari (real Safari UNVERIFIED: no Mac) | Playwright in CI; manual                                                                                           |
| Proof                | Android Chrome on the low-end phone over mobile data; desktop Chrome                                  | iPhone Safari if available                                                      | Lighthouse CI mobile preset, which is harsher than Fast 4G; a failure is re-measured on the phone before it blocks |
| Fair Split app       | Low-end Android (performance, TalkBack, font scale); current Android (push, scanner, Predictive Back) | AVD API 36 with Google Play; AVD API 34 for CI                                  | Maestro 2.11.0, locally and in GitHub Actions (EAS Free has no Maestro jobs: expo.dev/pricing)                     |
| `/app` frames        | Chrome inside W-JG-01; Android Chrome                                                                 | A judge's own phone, by QR                                                      | Playwright; manual                                                                                                 |
| iOS                  | A 5-second simulator clip (P2, first to cut)                                                          | —                                                                               | EAS simulator build, with Maestro on a GitHub macOS runner                                                         |

#### S5.5.3 Accessibility and performance

- **Automated accessibility.** axe runs on every route state via `@axe-core/playwright` 4.13.0 (4.14.0, from 15 Oct, is under 14 days old). WS-DS contrast tests fail CI below 4.5:1 for console text, 7:1 for statement copy and 3:1 for non-text.
- **Manual passes on 6 Nov:**
  - NVDA with Chrome through Approve, by keyboard and the ConfirmDialog route;
  - TalkBack through the member, clerk and board screens;
  - the web at 200% zoom;
  - the app at `adb shell settings put system font_scale 1.3`, then `2.0`.
- **Android performance:**
  - Frame time: run `adb shell dumpsys gfxinfo <pkg> reset`, run the MM-1 and MM-7 flows on the release APK, then read the 95th-percentile frame time from `dumpsys gfxinfo`. It passes at 18 ms or less.
  - Cold start via `adb shell am start -W`: 2,500 ms or less.
  - `dumpsys meminfo` total PSS: 180 MB or less.
- **Web budgets.** The design §9 budgets run as gzip checks on `dist` in CI. Moments are profiled in Chrome DevTools at 4× CPU throttling, as a proxy for a 2020 integrated-GPU laptop.
- **Judge time.** Measured from `run_events`, from the first press to the batch 201: the median must be 60 s or less across the DR runs and the soak.

Each live run appends the invoice ID, `sender_batch_id`, `payout_batch_id`, item IDs, webhook event IDs and `debug_id`s to `run_events`. `tools/export-sandbox-ids.ts` writes the README table from the film run and the latest E-02. The waffle and the README read `eval/report/latest.json`, always with N = 40.

#### S5.5.4 Judge-path dry runs

| Run  | When   | Set-up                                                                                                                                                                                                                                                                                                                                             | Pass                                                                                      |
| ---- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| DR-1 | 29 Oct | The user's phone and a private laptop window over a phone hotspot. From the README link: mark paid, resolve holds, approve, co-sign by QR, reset, run again                                                                                                                                                                                        | No login needed; first press to 201 in 60 s or less; reset in 10 s or less                |
| DR-2 | 5 Nov  | A logged-out browser profile: Devpost page, video, repo, Judge Mode, the "What's real" sheet                                                                                                                                                                                                                                                       | Nothing asks for credentials                                                              |
| DR-3 | 10 Nov | A Stage-1 screener pass on phone and laptop: the first 300 characters, LICENSE in About, the public captioned video, Judge Mode. Then `e2e/submission/llm-grader.spec.ts`: claude-haiku-5-5, through `ClaudeGateway`, reads the public Devpost text and README                                                                                     | It names Invoicing v2, Payouts v1, Webhooks, Agent Toolkit 1.11.0 and all three model IDs |
| DR-4 | 11 Nov | (a) A new local Windows user with only the README prerequisites. (b) `clean-clone.yml` on `ubuntu-latest`, `windows-latest` and `macos-latest`, running the README quickstart verbatim in keyless replay. (c) Judge Mode from another network. (d) The release APK on a second phone, SHA-256 checked, paired by QR. (e) `pnpm verify-proof <url>` | All five green                                                                            |

#### S5.5.5 Soak, balance and the judging window

- **Soak, 30 Oct 12:00 to 31 Oct 12:00.** `fs-cron` resets hourly. A GitHub Actions job runs a replay session every 15 minutes and a live run every 4 hours. Pass criteria: `/readyz` never returns 5xx, no outbox row stays dispatched over 5 minutes, resets finish within 10 s, no webhook is unmatched after catch-up, and memory stays steady.
- **Balance.**
  - A live run moves US$341.74 net (Rhea's US$26.65 comes back) plus sandbox fees, and record-payment brings nothing in. US$100,000 therefore covers about 290 runs.
  - Spend at most 35 runs before 1 Dec, across G2, DR-1, the soak, nightly E-02, the film and DR-4.
  - The daily live cap is `min(100, floor((balance − 10,000) / (345 × days left to 15 Dec)))`, about 15 on 1 Dec. Past the cap, Judge Mode replays the last live run, labelled with its run number and time.
  - Balance is read from `TransactionSearchController.searchBalances`, which can be up to 3 hours behind (PayPal-TypeScript-Server-SDK transaction-search doc), minus ledger payouts since that reading.
- **1–15 Dec.**
  - Deploy freeze; hotfixes go out by manual promotion only.
  - `fs-cron` runs hourly checks at :07: `/readyz`, token scope, webhook registration (re-PATCH on drift), catch-up, Claude budget, balance and cap. Results show on `/ops`.
  - `uptime.yml` calls `/readyz` from outside Render every 30 minutes. GitHub emails the owner when a scheduled run fails.
  - One E-02 runs daily at 16:37 (03:07 PST).

### S5.6 Demo video

#### S5.6.1 Rules

The register's rules for every moment apply unchanged:
- a `data-moment-phase` assertion, a reduced-motion version and a recording of the real event;
- "×12 real time" labels;
- disclosed Gemini narration;
- no product sound under the voice;
- captions throughout.

The contest rules add:
- under 3 minutes;
- public on YouTube;
- the project running on its device;
- no third-party trademarks or copyrighted music without permission;
- an English translation of non-English audio.

Target length: 2:50.

#### S5.6.2 Beat sheet

`video/script.ts` holds each line as `say` (spoken) and `show` (caption). Figures render from IC-03, and the test count comes from CI at lock. The lines below use seed values.

| Time | Beat                                                                                                                                                       | Screen and source                                                                                                                                                                                                           | Spoken (Gemini TTS)                                                                                                                                                                                                                                                                                                                                                                          | Sound                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 0:00 | MM-1 Bayad na                                                                                                                                              | M-MB-01 on a physical phone; a real verified PAYOUTS-ITEM.SUCCEEDED for M-014; the thumb taps Paminawa at 0:05                                                                                                              | None. The Cebuano statement plays with an English caption                                                                                                                                                                                                                                                                                                                                    | Chime, then the clip             |
| 0:09 | Title "Fair Split: co-op payroll"; Analyn ("Hypothetical persona, synthetic data"); "Half of Filipino adults have no formal financial account (BSP, 2025)" | HyperFrames                                                                                                                                                                                                                 | "Analyn keeps the books for a cacao co-op in Davao: sixty-four members, paid from paper slips. Half of Filipino adults have no formal financial account."                                                                                                                                                                                                                                    | Voice                            |
| 0:20 | Funding                                                                                                                                                    | W-TR-01: the Toolkit invoice; record-payment labelled "Marked as paid in sandbox"; the INVOICE.PAID arc                                                                                                                     | "Lantern Bay funds the audited pay run with one PayPal invoice, drafted by Claude through the Agent Toolkit. A verified paid webhook starts the run."                                                                                                                                                                                                                                        | E4 in the gap                    |
| 0:32 | MM-2 Paper prints itself                                                                                                                                   | W-TR-03 replaying the recorded 29 Oct Claude run, labelled; W-TR-04 for slip 0462, entered by hand at 0:42                                                                                                                  | "Claude reads Jessie's handwritten slips into rows. Two independent reads must agree, or a person decides. Here, a water stain: Analyn enters it by hand."                                                                                                                                                                                                                                   | Ticks in the gaps                |
| 0:44 | MM-3 The pink copy; also the AG Grid segment (63 rows update in the themed grid)                                                                           | W-TR-06 dial over W-TR-05                                                                                                                                                                                                   | "Slip 0457 is here twice: the white original and the office's pink copy. Counted once, seventeen dollars ninety-four returns to sixty-three members."                                                                                                                                                                                                                                        | Plunk and needle tick in the gap |
| 0:56 | H2 and H3 resolved                                                                                                                                         | W-TR-06 ink stamps                                                                                                                                                                                                          | "A yield too high for one plot, and a fine no rule allows: both resolved, in ink."                                                                                                                                                                                                                                                                                                           | —                                |
| 1:04 | MM-4 Bolted                                                                                                                                                | W-TR-02: 409 `RATE_CARD_RATIFIED` with the hash                                                                                                                                                                             | After the clack: "Nobody adds a deduction mid-season: the rate card was hashed first."                                                                                                                                                                                                                                                                                                       | Clack                            |
| 1:10 | MM-5 Two keys                                                                                                                                              | W-TR-07, and M-BD-02 on the second phone; real Ed25519 signatures                                                                                                                                                           | "The batch is over three hundred dollars, so the Chair must co-sign. Analyn holds to sign; Ernesto signs on his phone. Two keys, one batch hash."                                                                                                                                                                                                                                            | Seal plunk after the line        |
| 1:24 | MM-6 Honest fan-out, "×12 real time"                                                                                                                       | W-TR-08: the 201, verified item events, Rhea's UNCLAIMED, one resent duplicate                                                                                                                                              | "PayPal answers 201: sent, not yet confirmed. Each thread lands only on a verified item webhook. Rhea has no PayPal account, so hers parks, then goes to cash. A repeated delivery changes nothing."                                                                                                                                                                                         | Scale notes in the gaps          |
| 1:42 | Proof                                                                                                                                                      | W-PF-01: Dana verifies in her browser                                                                                                                                                                                       | "Dana, at Lantern Bay, opens Proof and verifies it in her own browser: invoice, rate card, slips, lines, both signatures, every payout item. Members appear by number, never by name."                                                                                                                                                                                                       | —                                |
| 2:00 | MM-7 Tap a peso                                                                                                                                            | M-MB-01: US$43.69 tapped, then a zoom to slip 0403                                                                                                                                                                          | None. Paminawa says "Gikan kini sa inyong resibo 0403…" with an English caption                                                                                                                                                                                                                                                                                                              | Device audio                     |
| 2:12 | Architecture map                                                                                                                                           | HyperFrames labels: Invoicing v2 via Agent Toolkit 1.11.0; verified, deduplicated webhooks; the typed Payouts tool and the PR #107 URL; Claude's three model IDs and engine v1; Render; APIMatic; the test count; prior art | "Invoicing v2 through Agent Toolkit 1.11.0. Verified, deduplicated webhooks. Our typed Payouts tool, evidence on PR 107. Clause-to-Cash, Tributary, SarafuPay and harambee. They split money people already agreed on. Fair Split turns paper into ratified rules and rows, binds the treasurer to a hashed rate card, and proves each payment on the member's phone and the brand's Proof." | Voice                            |
| 2:34 | Limits and live metrics                                                                                                                                    | W-PF-01 metrics from the film run: 64 of 64 explained; 7 of 64 on PayPal, 8.1% of value; 3 holds; US$21.14 returned; invoice to last confirmation                                                                           | "Limits, plainly: a sandbox prototype on a synthetic co-op; no real farmer was paid. US sandbox accounts; live Payouts need PayPal's approval. Slip reading here replays a recorded Claude run. Claude writes in pencil. People sign in ink. PayPal makes it carbon."                                                                                                                        | —                                |
| 2:50 | End                                                                                                                                                        | End card: name, URL, "Narration: synthetic voice (Gemini TTS). People, slips and co-op are synthetic."                                                                                                                      | —                                                                                                                                                                                                                                                                                                                                                                                            | —                                |

The script runs to about 315 spoken words. The 2:12 and 2:34 beats need about 158 words a minute; the rest sit at 130–150. If a beat runs long, cut words, and never take time from MM-1 or MM-7. Under OD-2's default, the "machine-translated, pending native review" chip appears whenever Cebuano is on screen.

#### S5.6.3 Capture on Windows

- **Session.**
  - One live Judge run on `fs-judge`, on 6 Nov from 15:00, recorded at once by OBS (console) and scrcpy (member and Chair phones, one instance per `-s <serial>`).
  - With only one phone: run A uses it as the Chair (0:20–1:42); run B re-pairs it as M-014 (0:00, 2:00). Both runs are real, and their run numbers go into `video/TAKES.md`.
  - Budget: three runs, about US$1,030 of sandbox balance.
- **Console.**
  - Display: preferably a 3840×2160 virtual monitor at 200% scaling, which gives the 1920×1080 layout twice the pixels for punch-ins. Without the driver, use the panel at 100% scaling in a 2560×1440 window, with punch-ins of 1.33× at most.
  - Browser: Chrome full screen (`--start-fullscreen`, Playwright `viewport: null`).
  - OBS: display capture at 60 fps, Quick Sync CQP 16, recorded as MKV and remuxed to MP4.
  - The treasurer side is E-01 in film mode, run headed. It injects an ink-arrow cursor eased over 40 steps and logs clicks to `video/takes/<run>/cursor.json`, which HyperFrames uses for zoom keyframes.
  - A two-frame white flash at t0 syncs all sources.
  - Console shots driven by a person use OpenScreen 2.1.2 (MIT, click-based auto-zoom; getopenscreen.com).
- **Phones.**
  - Turn on demo mode before each take (AOSP SystemUI `docs/demo_mode.md`):
    - `adb shell settings put global sysui_demo_allowed 1`
    - `adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941`
    - battery: `-e level 100 -e plugged false`
    - notifications: `-e command notifications -e visible false`
  - Record with `scrcpy -s <serial> --video-codec=h264 --video-bit-rate=20M --max-fps=60 --show-touches --record=member.mp4`. Device audio is captured on Android 11 and later, which the chime and Cebuano clips need.
  - Before editing, run `ffmpeg -i member.mp4 -vf fps=60 -c:v libx264 -crf 14 -pix_fmt yuv420p member60.mp4`.
- **Rehearsal, 2 Nov.** Run a 20-second take through capture, HyperFrames, render and an unlisted YouTube test upload. Also run `npx hyperframes@0.8.157 benchmark` to choose between 4K and 1080p mastering.
- **Hygiene.** No secret, client ID or full sandbox email in frame (blur in post); no device or brand logos; generic frames only.

#### S5.6.4 HyperFrames assembly

- **Project.** WS-MEDIA owns `video/`. Every command runs as `npx hyperframes@0.8.157`, the version the installed plugin bundles; npm publishes daily and 0.8.185 is the latest. 0.8.157 will be 19 days old at first use on 2 Nov. Run `init video --non-interactive --resolution landscape`, then the `/general-video` workflow, with one sub-composition per beat and one caption track. Raw takes are gitignored; compositions, script, cursor logs and `video/LICENSES.md` are committed.
- **Registry items.** Use them only after re-tokenising to `--fs-*` and Mona Sans:
  - `ui-focus-zoom` for punch-ins;
  - `browser-device-stage` for generic frames around web-frame shots;
  - `state-chip-rail` for the run-strip echo, with its mono font replaced.

  Do not use `count-up`, `multiplayer-cursors`, `tracing-beam` (glow) or `hw-pipeline` (handwritten labels): the design bans what they draw. The architecture map is our own SVG in the print, ink and jade grammar. No product UI is recreated; every interface frame is a recording.
- **Renders.**
  - While editing: `render --quality draft`.
  - Final: `render --fps 60 --quality delivery --resolution landscape-4k --gpu --output renders/fair-split.mp4` (`--gpu` uses Quick Sync). Fallback: 1080p60.
  - The README hero image is the honest split fan (design), rendered with `--format gif --fps 15` at 8 MB or less.

#### S5.6.5 Voice, music, captions and mix

- **Voice.**
  - Models: `gemini-3.8-flash-tts` for finals and `gemini-3.8-flash-lite-tts` for drafts. Both are free on the free tier, where inputs are used to improve Google's products (ai.google.dev/gemini-api/docs/pricing), so only synthetic text is sent.
  - Audition Sulafat, Sadaltager, Iapetus and Gacrux on 2 Nov.
  - Direction goes in `speech_metadata.style` ("warm, unhurried documentary narrator, quietly confident"), and pauses are written as `<short pause>` and `<long pause>`. There is no speed control.
  - `tools/tts.ts` sends the whole narration as one request per take, with beats split by `<long pause>`, then cuts on silence. Take 1 runs on 7 Nov and single-beat retakes on 8 Nov, both at 13:45.
  - Member audio uses 3–4 Nov, in the register's order. Scratch tracks use the offline Kokoro voice (`npx hyperframes@0.8.157 tts`).
- **Music.**
  - Default: none. The narration, the product's own synthesised sounds and the Cebuano clips fill the film, and the judge model marks down music over narration.
  - If the user wants a cue (decided at the rehearsal), use one YouTube Audio Library track filtered by "Attribution not required". YouTube calls these tracks copyright-safe and says they will not be claimed (support.google.com/youtube/answer/3376882). Use it only where neither voice nor product sound plays.
  - The music file stays out of the repo. `video/LICENSES.md` records title, artist and a library screenshot. No AI music.
- **Captions.**
  - Text comes from the `show` lines and timing from `npx hyperframes@0.8.157 transcribe`.
  - Style: two lines of 42 characters at most, sentence case, Mona Sans, inside the safe zone.
  - The first narrated cue starts "[Synthetic voice, Gemini TTS]". Cebuano audio carries an English translation.
  - `captions.en.vtt` goes to YouTube, and the same track is burned in.
- **Mix and export.**
  - Voice and product sound never overlap. In the "×12 real time" stretches, the recorded audio is muted and each scale note is re-placed on its event's frame.
  - Loudness: a first `ffmpeg -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json` pass to measure, then a second pass with the measured values.
  - Export per YouTube's guidance (support.google.com/youtube/answer/1722171):
    - MP4 with the moov atom first and no edit lists;
    - H.264 High, two consecutive B-frames, closed GOP of half the frame rate, 4:2:0;
    - 2160p60 at 53–68 Mbps, or 1080p60 at 12 Mbps;
    - AAC-LC at 384 kbps, 48 kHz.
- **Lock check, 8 Nov.** 2:55 or shorter; every money figure matches the seed; every replay and simulation is labelled; disclosures are present; a 0.25× scrub finds no secret or third-party logo; captions match the speech word for word.

#### S5.6.6 YouTube (9 Nov, by 12:00)

- **Settings:**
  - Public.
  - "No, it's not made for kids".
  - Altered or synthetic content: Yes, because the generated slips are realistic scenes (support.google.com/youtube/answer/14328491).
  - Embedding allowed.
  - English captions file uploaded.
- **Chapters** go in the description, starting at 00:00, with three or more, each 10 s or longer (support.google.com/youtube/answer/9884579). The 9-second cold open and the title share the first chapter to meet the 10-second minimum.
  - 00:00 Paid, in Cebuano
  - 00:20 Funding
  - 00:32 Paper to rows
  - 00:44 Holds
  - 01:04 Rules and two keys
  - 01:24 PayPal fan-out
  - 01:42 Proof
  - 02:00 Tap a peso
  - 02:12 How it's built
  - 02:34 Limits
- **Thumbnail:** a 3840×2160 PNG of the phone at "Bayad na" beside W-TR-07.
- **Description:** its first 300 characters are the Devpost opening below.
- **After swapping the link on Devpost,** set the rough cut to private.

### S5.7 Devpost submission checklist

Devpost checks projects submitted at least a week early for baseline eligibility (help.devpost.com/article/126). Whether staff review this hackathon is UNVERIFIED. So 5 Nov means pressing Submit, not saving a Draft. Editing stays open until the deadline.
- [ ] **Name:** "Fair Split: co-op payroll".
- [ ] **Tagline** (139 characters; Devpost pages give the limit as both 140 and 200, so stay at 140 or fewer): "Claude reads a cacao co-op's handwritten weigh-slips, code audits each line, two people sign, PayPal Payouts pays every member, with proof."
- [ ] **Opening, the first 300 characters (291):** "Fair Split is co-op payroll on PayPal: Invoicing v2 through Agent Toolkit 1.11.0 bills the brand, Payouts v1 pays each member, verified Webhooks drive every state. claude-opus-5-5 reads handwritten slips, claude-sonnet-5-5 matches deductions to rules, claude-haiku-5-5 screens for injection."
- [ ] **Story headings:**
  - PayPal APIs used (API, call, file)
  - AI tools used
  - Try it in 60 seconds
  - Inspiration
  - What it does
  - How we built it
  - What's real and what's simulated
  - Prior art (ten entries and the register's sentence)
  - Challenges
  - Accomplishments (test count, eval with N = 40, sandbox IDs)
  - Known limitations
  - What's next (who pays, OD-10)
  - Sponsor tools
  - Prize category
  - Built 22 Oct–12 Nov 2026
- [ ] **AI tools, each with how it was used** (the rules ask for both):
  - claude-opus-5-5: slip reads, zoom re-read, rate-card reader, audit agent, statements.
  - claude-sonnet-5-5: deduction classifier.
  - claude-haiku-5-5: injection screen, language check.
  - Claude Code: wrote the code in parallel workstreams; the user reviewed and merged.
  - OpenAI's image model through Codex CLI: synthetic slips, rate card, logbook and eval images.
  - Gemini 3.8 Flash TTS: member audio and narration, labelled synthetic.
  - The APIMatic Context Plugin: grounding for PayPal code; fixes in `docs/apimatic-context-plugin.md`.
  - The PayPal AI-Toolkit plugin: PayPal docs and tools inside Claude Code.
- [ ] **Built with (25, the maximum):** paypal, paypal-invoicing, paypal-payouts, paypal-webhooks, paypal-agent-toolkit, paypal-server-sdk, anthropic, claude, claude-code, typescript, vite, react, hono, postgresql, expo, react-native, ag-grid, apimatic, render, postman, zod, playwright, maestro, gemini-tts, openai-image-generation. Never `nextjs` or `ag-studio`.
- [ ] **Try it out:** Judge Mode (`/judge` on the `fs-api` host); the film run's Proof; the repo; the APK release with its SHA-256; the Postman collection.
- [ ] **Gallery** (3:2, 1800×1200 PNG, 5 MB or less, each with a "Synthetic data" chip):
  - thumbnail: the phone at "Bayad na" beside Approve;
  - paper prints itself;
  - the pink copy;
  - Bolted;
  - two keys and the seal;
  - the fan-out with Rhea parked;
  - Proof verified;
  - the architecture map in plain text, with no third-party logos;
  - tests, eval and CI.
- [ ] **Video:** the G6 link, playing in the Devpost embed while logged out.
- [ ] **Additional questions:** repo URL; MIT; individual entrant; a new project begun 22 Oct; sponsor tools used.
  - The prize text names Most Impactful only, never PayPal + AI or Demo Delivery.
  - APIMatic is the primary sponsor and AG Grid is also entered. Render is entered only if OD-6 says yes.
- [ ] **Testing instructions:** "No login: open Judge Mode. Optional local run: `pnpm i && pnpm verify` in keyless replay. A live local run needs your own US sandbox REST app (README)." No secret is published.
- [ ] **Repo at G7:**
  - LICENSE detected in the About box; description, website and topics set.
  - README with:
    - hero image and identity paragraph;
    - quickstart and `.env.example`;
    - "Where the PayPal and AI calls live";
    - architecture diagram;
    - "Verify in 60 seconds";
    - test-count and CI badges;
    - real vs simulated;
    - sandbox IDs;
    - prior art;
    - a synthetic-data section with prompts and image hashes;
    - an AG Grid section;
    - known limitations;
    - OFL licences.
  - `docs/apimatic-context-plugin.md` with three or more dated fixes and a screenshot.
  - CONTRIBUTING, CODE_OF_CONDUCT and SECURITY.
  - Tag `v1.0.0`.
- [ ] **Final:** Devpost shows Submitted; the confirmation screenshot goes into `docs/gates/G7.md`.

### S5.8 Risk register

| ID  | Risk                                   | Trigger                                                                 | Response and fallback                                                                                                                                                                                                            | Owner                     |
| --- | -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| R1  | Payouts blocked                        | A 403 in S4 survives a fresh account                                    | G0 kill rule; MTS ticket; the user decides                                                                                                                                                                                       | WS-PPMONEY, user          |
| R2  | Extraction short of the bar            | S3 exact-row below 0.85, or below 0.70 after a day of prompting         | Rework read variants and prompts, then apply the G0 kill rule                                                                                                                                                                    | WS-READ                   |
| R3  | Shared-IP throttle while judges click  | A 429 or refused connection in `paypal_calls`                           | 6-minute circuit, labelled replay, queue copy, no polling                                                                                                                                                                        | WS-PPCORE, WS-API         |
| R4  | Sandbox balance runs out               | Projected balance under US$10,000 before 15 Dec 08:00 PT                | Lower the cap. Then the user pays a `tools/topup.ts` invoice from Lantern Bay on the hosted page (UNVERIFIED until S5 passes). Last resort: co-op B with a new app (about 30 minutes, plus about 9 hours for Transaction Search) | WS-OPS, user              |
| R5  | Webhooks late, missing or out of order | No event 60 s after an expected transition                              | 60 s GET; catch-up from `webhooks-events`; hourly re-PATCH                                                                                                                                                                       | WS-PPCORE                 |
| R6  | Gemini quota, or poor Cebuano quality  | `RESOURCE_EXHAUSTED`, or the S10 listening test fails                   | Drafts on Flash-Lite or Kokoro; spread generation over days; S10 fallback (Filipino audio with Cebuano text, labelled); labelled device speech                                                                                   | WS-MEDIA                  |
| R7  | Codex quota, or wrong digits in images | No file after `codex exec` exits 0, or a label mismatch                 | One image per run with the file checked; regenerate; OD-4 archived tile                                                                                                                                                          | WS-MEDIA                  |
| R8  | Expo SDK 58 trouble                    | S7 fails                                                                | Register fallback by 25 Oct                                                                                                                                                                                                      | WS-APP                    |
| R9  | Workflows slow or broken               | `startTask` p50 over 10 s                                               | `executor=worker`; inline fallback                                                                                                                                                                                               | WS-OPS                    |
| R10 | Subagents collide                      | Two or more PRs blocked in one train                                    | ADR-only contract changes; the `deps` lane; rebase duty the next morning                                                                                                                                                         | WS-QA                     |
| R11 | Review bottleneck                      | Six or more PRs open longer than 24 hours                               | Tiered review; pause work from the bottom of the cut order                                                                                                                                                                       | User                      |
| R12 | Moments overrun                        | An MM still unasserted on 4 Nov                                         | Its reduced-motion version ships                                                                                                                                                                                                 | WS-DS, WS-CONSOLE, WS-APP |
| R13 | Judge path over 60 s                   | DR-1 median above 60 s                                                  | In Judge Mode only, a labelled ×2 replay of the reading; never in the film                                                                                                                                                       | WS-CONSOLE                |
| R14 | Video pipeline slips                   | No rough cut on 29 Oct, a failed rehearsal, or a 4K render over 2 hours | 1080p60 master; OBS for all capture; no display driver                                                                                                                                                                           | WS-MEDIA                  |
| R15 | AI narration marked down               | Known (judge model, Render judge)                                       | Disclose it everywhere; keep the script sparse; let product sound carry MM-1 and MM-7; OD-5 stays No unless the user chooses otherwise                                                                                           | User                      |
| R16 | Rights or labels wrong in the film     | The lock check finds a logo, unlicensed sound or unlabelled replay      | Fix before G6                                                                                                                                                                                                                    | WS-MEDIA                  |
| R17 | A secret leaks                         | Push protection or gitleaks fires, or a secret shows in a take          | Rotate first, then `git filter-repo`; re-shoot or blur                                                                                                                                                                           | User, WS-QA               |
| R18 | Deadline-day failure                   | Devpost or YouTube trouble                                              | Upload on 9 Nov, submit on 11 Nov, keep 12 Nov as buffer                                                                                                                                                                         | User                      |
| R19 | A new twin appears                     | Re-scans on 26 Oct, 2 Nov and 9 Nov                                     | Update the prior-art table before lock                                                                                                                                                                                           | WS-QA                     |
| R20 | Demo decays during judging             | `/readyz` red, webhook drift, or a key or budget expiring               | Hourly checks, `uptime.yml` email, hotfix by manual promotion                                                                                                                                                                    | WS-OPS, user              |
| R21 | No low-end phone                       | None in hand by 26 Oct                                                  | Borrow or buy one; otherwise label the evidence with the device actually used                                                                                                                                                    | User                      |

### Register deviations and clarifications

1. **Time zone.** Register times carry no zone; S5 reads them as IST.
2. **Freeze dates added** for IC-02, IC-04 to IC-09 and IC-11. The register fixes only IC-01, IC-03 and IC-10.
3. **Ownership refined** (S5.2.3). Assigning unowned root files, adding shared append-only doc folders and creating the `deps` lane narrow §11 without contradicting it.
4. **Human steps added** beyond §11: devices, system tools, Claude Code plugins, the on-camera hands and the OD-6 question.
5. **Live-run cap.** The architecture's US$120 batch limit and 100 runs a day cannot hold with the register's US$368.39 batch and US$100,000 balance. The register wins, and S5 adds a balance-based cap and a standby account.
6. **Rhea.** The design calls her item the ERRPYO002 case. Register §8 and MM-6 give her an address with no PayPal account, so her item goes UNCLAIMED, is cancelled, and is RETURNED. S5 follows the register; ERRPYO002 is only logged in S4.
7. **Film funding** uses record-payment, as the register's beats say, not the architecture's hosted-page payment.
8. **5 Nov** means pressing Submit on Devpost, because the early review covers submitted projects only.
9. **New pins** under the 14-day rule, recorded in `docs/versions.md`: `@axe-core/playwright` 4.13.0 and `hyperframes` 0.8.157.
10. **Tagline and hero image.** The end card uses the design's public tagline. The README hero image is the honest split fan (design), not the architecture's member GIF.
