## S5. Execution: Workstreams, Schedule, Verification, Demo and Submission

This section covers who builds what, in what order, how we prove it works and how it reaches the judges. Where the register already fixes a fact (§11 workstreams and contracts, §12 spikes, gates and cut order, §13 open decisions), this section points to it and adds only what a builder needs. Every departure from the register is listed under Register deviations.

### S5.1 Ground rules

- **Clock.** All times are IST (UTC+05:30) unless marked PT. The deadline is Thu 12 Nov 12:00 PST, which is 20:00 UTC and Fri 13 Nov 01:30 IST (paypalaihackathon.devpost.com/rules §1). US daylight saving ends on 1 Nov, so quotas that reset at Pacific midnight reset at 12:30 IST up to 1 Nov and at 13:30 IST from 2 Nov.
- **Authority.** The user approves Tier-A pull requests, signs gates, holds every credential and publishes anything public. Claude Code subagents do the rest. GitHub's merge queue does the merging (S5.2.4).
- **Capacity.** Every session draws on one Claude plan allowance. The docs warn: "A single burst of heavy activity, such as a large workflow fanout, can exhaust the weekly allowance before the session window resets" (code.claude.com/docs/en/errors). S5.2.2 sizes the work to that allowance, and S5.3.1 sizes it to the user's hours.
- **Sources of truth.** Figures come from `packages/seed/snapshot/season-2026A.json` (IC-03). Interfaces come from `packages/contracts` (IC-01, IC-12). Copy and motion come from design §6–§8. Pins live in AGENTS.md and `docs/versions.md`.
- **Evidence.**
  - Spikes write `docs/spikes/S{n}.md`: the verdict, `debug_id` excerpts and the fallback.
  - Gates write `docs/gates/G{n}.md`: the criteria, CI links, decision and cuts.
- **Dev machine, checked 22 Oct.**
  - Windows 11 Home, 32 GB RAM, Intel Arc integrated GPU, 2560×1600 panel.
  - `Z:` is a local NTFS volume; clone to `Z:\fs`. LongPathsEnabled is 1; run `git config --global core.longpaths true`.
  - Node 24.19.0 must move to the 24.22.1 pin. pnpm 11.28.6 comes through corepack (10.13.1 is installed globally).
  - Java 24 is installed, but Android needs JDK 17. adb 1.0.41 is installed but not on PATH. scrcpy is missing.
  - ffmpeg 9.0.2, cloudflared 2025.8.1 and codex-cli 0.159.3 are installed.
  - Windows Sandbox does not exist on Home, which shapes DR-4.

### S5.2 Lanes, capacity and contracts

#### S5.2.1 Five lanes over thirteen workstreams

The thirteen workstreams in register §11 remain the units of ownership. Their paths stay in `docs/ownership.md`, and their IC ownership and G2 deliverables are unchanged. One exception: `packages/ui-native` moves from WS-DS to WS-APP.

The workstreams run as five lanes. A lane is one long-running Claude Code session on claude-opus-5-5 with its own worktree. It may start claude-sonnet-5-5 helpers for tests, fixtures, docs and scripts.

| Lane            | Workstreams                                                                 | Shift            | PRs/day        | Due first                                                                                                     |
| --------------- | --------------------------------------------------------------------------- | ---------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| L1 Spine        | CORE, DATA, PPCORE, PPMONEY, API, OPS                                       | A, B             | 2              | Contracts and contract diff 22 Oct; headless money loop on `fs-dev` 23 Oct; walking skeleton on Render 25 Oct |
| L2 AI           | READ, AGENT                                                                 | A                | 1              | S3 on the hero slips 23 Oct                                                                                   |
| L3 Console      | CONSOLE; DS for tokens, motion, seal, ui-web, i18n, assets and `/prototype` | B (C if allowed) | 1              | Tokens and web primitives 24 Oct; `/prototype` 25 Oct                                                         |
| L4 App          | APP, `packages/ui-native`                                                   | B (C if allowed) | 1              | Hello APK on the film phone 23 Oct; native primitives and signed APK 24 Oct                                   |
| L5 Media and QA | MEDIA, QA                                                                   | A                | 1, plus `deps` | Bootstrap PR, account-CSV tool and hero slips 22 Oct                                                          |

**Shifts.**
- A: 08:30–13:30.
- B: 14:00–19:00.
- C: 20:00–00:30, only when S5.2.2 allows.

At most four sessions run at once: three lanes plus one helper or reviewer.

At the end of each shift, a lane pushes its branch and writes a three-line status in its open PR. L5's `tools/digest.ts` builds the user's 09:00 digest from open PRs, CI, DR-0 and gate checklists.

#### S5.2.2 Capacity rules

- **Daily check.** At 09:00 the user runs `/usage`, which shows plan limits and reset times (code.claude.com/docs/en/errors), and logs the session and weekly figures in the digest. Lanes run with "Continue automatically at usage limit" turned on in `/config`, so hitting a limit pauses a lane instead of ending it.
- **Stop rule.** Any of these triggers it:
  - weekly usage reaches 60% before the middle of the week;
  - a lane hits a limit twice in one week;
  - six or more PRs have waited over 24 hours.

  When it triggers, pause the lowest lane that day, in this order: L4 polish beyond M-MB-01 and M-BD-02, then L3 non-hero screens, then L5 media extras. L1 and the never-cut list never pause.
- **Extra capacity (OD-14).** There are two options:
  - `/usage-credits` buys extra usage on Pro and Max plans (support.claude.com/en/articles/12429409).
  - Helpers run on an API key in a separate Console workspace with its own spend cap.

  By default neither is used, and the stop rule applies.
- **Models.**
  - Opus leads the lanes and writes all money code.
  - Sonnet runs helpers and the reviewer.
  - Haiku is used only where the product itself uses it.

#### S5.2.3 Contracts first

Some sections were drafted from a truncated register, so they disagree on:
- moment phases;
- statement slots and placeholders;
- audio mentions;
- money formatting;
- the member link;
- the treasurer's key.

These steps happen before any lane writes UI or API code:
1. **22 Oct, L1.** Generate `packages/contracts` from the full register only. Write `docs/contract-diff.md`, listing every route, moment phase, placeholder, event, screen ID and key ID in S1–S4 that disagrees with it.
2. **23 Oct 12:00, the user.** Settle the diff in one 20-minute sitting. These defaults apply unless the user overrides them:
   - Moment phases (IC-10) come from S2.9's `MOMENTS`. S1.9's phase column becomes generated documentation.
   - One `StatementPlan` type, `{slots, placeholders, mentions[]}`, is shared by the templates, `explain` (IC-07), the audio manifest and PaminawaPlayer. IC-11 gains per-sentence `mentions` such as `slip:0403`.
   - DTOs carry integer cents. Every UI formats them through `api-client`'s pure `format`, which re-exports `domain/format`.
   - `/s/:token` answers with a 302 to `/app/s/:token`, so M-MB-01 renders in the Expo export.
   - The treasurer signs with `fs-analyn-w1`, a persisted browser key registered once. In Judge Mode the stage uses a labelled demo key instead.
   - IC-12 FrameBridge is added.
3. The settled contracts take precedence over any section text. Corrections go in `docs/adr/0001-contract-errata.md`.
4. **CI spec-lint (E-18).** `tools/spec-lint.ts` fails when any `data-moment-phase` value, `{{PLACEHOLDER}}` or route literal in `apps/**` is not exported by `packages/contracts`.

| IC    | Owner             | Frozen                        | Note                                                                                                                |
| ----- | ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| IC-01 | WS-CORE           | 24 Oct 18:00 (register)       | Generated from the register: `RunEvent`, `TaskName`, screen IDs, routes                                             |
| IC-02 | WS-CORE           | 24 Oct 18:00                  | Signatures only                                                                                                     |
| IC-03 | WS-CORE           | 24 Oct 18:00 (register)       | No figure is typed anywhere else                                                                                    |
| IC-04 | WS-DATA           | 25 Oct 18:00                  |                                                                                                                     |
| IC-05 | WS-PPCORE         | 25 Oct 18:00                  |                                                                                                                     |
| IC-06 | WS-PPMONEY        | 26 Oct 18:00                  | After S2 and S4                                                                                                     |
| IC-07 | WS-READ, WS-AGENT | 26 Oct 18:00                  | `Extraction` is fixed by S3; `explain` returns a `StatementPlan`; gateway calls take a `readMode` of replay or live |
| IC-08 | WS-API            | 25 Oct 18:00                  | OpenAPI spec and msw handlers are generated in CI and never hand-edited                                             |
| IC-09 | WS-DS             | 27 Oct 18:00                  | After the G1 revision round                                                                                         |
| IC-10 | WS-DS             | 27 Oct (register)             | Phases from S2.9; they double as test selectors                                                                     |
| IC-11 | WS-MEDIA          | Schema 24 Oct; content 27 Oct | The audio manifest carries `mentions`                                                                               |
| IC-12 | WS-CORE           | 25 Oct 18:00                  | FrameBridge (new)                                                                                                   |

**IC-12 FrameBridge.** WS-CONSOLE implements the stage side and WS-APP the frame side. The messages are:

| Message                      | Direction      | Rule                                                            |
| ---------------------------- | -------------- | --------------------------------------------------------------- |
| `fs.ready {role, build}`     | Frame to stage | Sent when the frame has loaded                                  |
| `fs.token {frameToken, exp}` | Stage to frame | Sent only after `fs.ready`                                      |
| `fs.feedback {event}`        | Frame to stage | Only the stage plays sound                                      |
| `fs.theme {theme, tier}`     | Stage to frame | The same values also work as the URL parameters `?theme=&tier=` |

Each side drops any message whose `event.origin` is not the `fs-api` origin. Frame tokens last 2 hours (IC-08).

**Changing a frozen contract.**
- An ADR PR (`docs/adr/NNNN-slug.md`) records the change, the affected consumers and the migration. The user approves it.
- The owner lands the ADR together with the consumers' fixes in one queue group.
- A consumer that needs something new opens a `contract-request` issue naming the IC. The owner answers the same day.
- Consumers code against the frozen contract plus a stub or msw handler. They delete the stub in the PR that switches to the real module.

#### S5.2.4 Collisions, merging and review

1. **Worktrees.** Each lane gets one worktree and branch (`git worktree add Z:\fs-wt\<lane> -b lane/<lane>`) and rebases on `main` at the start of every shift.
2. **Path ownership.** CI checks each PR's paths against `docs/ownership.md`.
   - Root files that no workstream owns belong to WS-QA: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `biome.json`, `.dependency-cruiser.cjs`, `.gitattributes`, `.gitignore`, `lefthook.yml`, AGENTS.md and CODEOWNERS.
   - `docs/spikes/`, `docs/gates/` and `docs/adr/` accept new files from anyone. CI rejects edits to existing files there.
3. **Dependencies.** L5's bootstrap PR installs the whole pinned stack: the architecture list, minus the register's removals, plus its additions.
   - After that, dependencies change only in PRs labelled `deps`. Only these PRs may touch `pnpm-lock.yaml` and `docs/versions.md`.
   - `deps` PRs are queued first each morning, one at a time.
   - Every new pin is exact and at least 14 days old.
4. **Migrations and strings.**
   - Only WS-DATA writes migrations.
   - UI strings live beside their screen.
   - `packages/i18n` owns the runtime, ICU setup, glossary and `REVIEW.md`.
   - Status words come from IC-01.
5. **Literals.** A money or kilo literal outside `packages/seed` fails lint.

**Repository and queue (the user, 22 Oct).**
- **Organization.** Create a free GitHub organization and put the public repo inside it. Merge queues are available "in any public repository owned by an organization" (github/docs, gated-features/merge-queue).
- **Bot account.** Create a machine account, `fs-bot`. GitHub's terms allow "no more than one free machine account in addition to your free Personal Account". Give it a fine-grained token scoped to this repo only, with write access to contents, pull requests and commit statuses. Lanes commit, push and open PRs as `fs-bot`.
- **Ruleset on `main`.**
  - Pull request required.
  - Required checks: `ci` and `review/subagent`.
  - Code-owner review required.
  - Merge queue required: rebase, build concurrency 2, merge limit 1–3.
  - No force pushes.
- **CI trigger.** `ci.yml` runs on both `pull_request` and `merge_group`. Without `merge_group`, the queue never merges ("Managing a merge queue", docs.github.com).
- **Fallback if the user declines the bot.** A required `tier-a` check passes only when the user has added a `human-approved` label, and AGENTS.md forbids agents to add it. This is weaker, because the agents then act as the user.

| Tier                     | Paths (CODEOWNERS)                                                                                         | Merges when                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A: money and trust       | `/packages/paypal-*/`, `/apps/api/src/webhooks/`, any `approvals/` or `signatures/` folder, `/render.yaml` | `ci` and `review/subagent` are green and the user has approved as code owner                          |
| B and C: everything else | —                                                                                                          | `ci` and `review/subagent` are green; UI PRs attach Playwright screenshots of every route they change |
- **Reviewer.** `review/subagent` comes from a Sonnet session that did not write the PR. It runs the `code-review` skill; the author fixes or answers each finding; the reviewer then posts the status with a link to its findings.
- **Code layout.** Approval and signature code must live under folders named `approvals/` or `signatures/`.
- **Limits.**
  - At most six PRs a day, plus `deps`.
  - Tier-A diffs are 400 changed lines or fewer.
  - The user reviews Tier A from 20:00 to 20:30.
- **Broken `main`.** If `main` goes red, enqueuing stops. Fix forward within 2 hours or revert.

#### S5.2.5 Where the polish goes

- **Hero path.** These are the only screens with bespoke motion; the seven moments and the INVOICE.PAID beat live only here:
  - W-JG-01;
  - W-TR-01 to W-TR-08;
  - W-PF-01;
  - M-MB-01;
  - M-BD-02.

  Every other screen ships on the five primitives, with only the drawer and micro transitions.
- **Cut now:**
  - W-TR-10's command menu (⌘K) and the console theme switch. The console stays Tablea; `?`, J/K, Enter, Space and D remain.
  - W-PF-02, except its header strip and export.
  - M-ON-01's theme picker. The app stays Adlaw; language choice and pairing remain.
  - M-CK-02's custom styling, which becomes stock Material 3.
  - Data mode stays as plain tables.

### S5.3 Schedule and gates

#### S5.3.1 Day by day

The whole judge path runs on Render from 25 Oct, in plain unstyled components, and is exercised every day from 26 Oct (DR-0). Design-system pieces then replace the plain ones inside the working path. The last column is the user's time in minutes.

| Date       | Gate         | Build                                                                                                                                                                                                                                                                                                                                  | User (min)                                                                                                                                   |
| ---------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Thu 22 Oct | —            | L5: bootstrap PR (pinned stack, CI on `merge_group`, CODEOWNERS, ownership check, spec-lint and word-list stubs, AGENTS.md), `tools/sandbox-accounts.ts`, 10 hero slips (0403, 0419, 0436, 0449, 0457 white, 0457 pink, 0458, 0462, 0467, 0471), BR 2026-04 pages. L1: contracts and `docs/contract-diff.md`; hello `fs-api` on Render | Org, repo, ruleset and bot (40); S1 (45); Anthropic, Gemini and Render keys and billing (40); OD-6 email (5); OD-12 and OD-13 (10): **140**  |
| Fri 23 Oct | —            | Spikes S2, S3, S4 and S6–S10; S11 at 20:00 only if S3 is below 0.80. L1: headless money loop on `fs-dev` (invoice, record payment, verified PAID, 8-item batch, verified item events, Rhea cancelled then RETURNED); engine passes `canonical.test.ts`. L4: hello APK on the film phone                                                | Contract diff (20); hero-slip labels by 12:00 (45); S5 (30); pilot outreach (45); JDK, adb and USB debugging (20): **160**                   |
| Sat 24 Oct | **G0** 17:00 | Spike verdicts; IC-01/02/03 frozen 18:00; tokens and five primitives (L3 web, L4 native); signed APK                                                                                                                                                                                                                                   | G0 (45); freeze ADR (15); Tier A (45); Firebase and EAS (30); APIMatic and AI-Toolkit plugins (15): **150**                                  |
| Sun 25 Oct | —            | Walking skeleton: `fs-api` with the inline executor serves `/judge`, the console routes, `/app` and `/p` in plain components, with a labelled placeholder recording, and the live lane works on `fs-judge`. `/prototype` (register list). IC-04, IC-05, IC-08 and IC-12 frozen 18:00                                                   | Prototype on laptop and phone (60); skeleton click-through (15); Tier A (30): **105**                                                        |
| Mon 26 Oct | **G1** 18:00 | Critique report; primitives live in W-JG-01 and W-TR-07; DR-0 daily and E-02 nightly from today; IC-06 and IC-07 frozen; competitor re-scan 1                                                                                                                                                                                          | G1 (45); Tier A (30): **75**                                                                                                                 |
| Tue 27 Oct | —            | Revisions close 18:00; IC-09, IC-10 and IC-11 content frozen; photos A–L with fixtures                                                                                                                                                                                                                                                 | A–L check (60); Tier A (30): **90**                                                                                                          |
| Wed 28 Oct | —            | Real Claude run on the 12 photos recorded and swapped into Judge Mode; reset in 10 s or less; APK pairs by QR                                                                                                                                                                                                                          | Smoke test and pairing (20); Tier A (30): **50**                                                                                             |
| Thu 29 Oct | **G2** 19:00 | DR-1 in the morning; rough cut v1 (2 min, Kokoro scratch voice); G2 decides cuts only                                                                                                                                                                                                                                                  | DR-1 (30); G2 (45); rough cut (10); Tier A (30); OD-3 and OD-8 (5): **120**                                                                  |
| Fri 30 Oct | —            | Release APK (R8) smoke test; soak from 12:00; M-MB-01 and M-BD-02 to final; MM-1, MM-5; eval cases 21–40                                                                                                                                                                                                                               | APK smoke (30); eval labels part 1 (40); Tier A (30): **100**                                                                                |
| Sat 31 Oct | —            | Soak ends 12:00; MM-2, MM-3                                                                                                                                                                                                                                                                                                            | Soak review (20); eval labels part 2 (40); Tier A (30); OD-4 (5): **95**                                                                     |
| Sun 1 Nov  | **G3** 18:00 | Eval against PP-OCRv5; Android p95; statement texts frozen; 100+ tests                                                                                                                                                                                                                                                                 | Eval labels part 3, by 12:00 (40); G3 (45); Tier A (30): **115**                                                                             |
| Mon 2 Nov  | —            | MM-4, MM-6, MM-7; Proof verify; capture rehearsal; title, map and end card; competitor re-scan 2                                                                                                                                                                                                                                       | Rehearsal, including a hosted-page payment and the 640 px check (60); voice audition (20); display-driver decision (5); Tier A (30): **115** |
| Tue 3 Nov  | —            | Audio day 1 (M-014 in three languages, then the other PayPal hero members); upstream drafts; README in the S5.7 order                                                                                                                                                                                                                  | Upstream drafts (30); pilot replies (15); Tier A (30): **75**                                                                                |
| Wed 4 Nov  | **G4** 18:00 | Audio day 2; rough cut v2 on the S5.6.2 beat sheet, with the Flash-Lite voice                                                                                                                                                                                                                                                          | G4 (60); Tier A (30): **90**                                                                                                                 |
| Thu 5 Nov  | —            | Audio done; Devpost text generated                                                                                                                                                                                                                                                                                                     | Press **Submit** on Devpost by 20:00, with rough cut v2 public (60); upstream posts (30); DR-2 (20); OD-1, 2, 5, 6, 10 (15): **125**         |
| Fri 6 Nov  | **G5** 12:00 | Freeze; film 15:00–19:00                                                                                                                                                                                                                                                                                                               | G5 (20); NVDA, TalkBack, zoom and font-scale passes (90); film (240): **350**                                                                |
| Sat 7 Nov  | —            | HyperFrames assembly; narration take 1 at 13:45                                                                                                                                                                                                                                                                                        | Review cut 1 (45)                                                                                                                            |
| Sun 8 Nov  | —            | Retakes at 13:45; mix; **video lock 22:00**                                                                                                                                                                                                                                                                                            | Approve the lock (45)                                                                                                                        |
| Mon 9 Nov  | **G6** 20:00 | Captions, chapters and thumbnail; competitor re-scan 3                                                                                                                                                                                                                                                                                 | Upload by 12:00 and check the embed logged out (60); G6 (15): **75**                                                                         |
| Tue 10 Nov | buffer       | README and Devpost final; DR-3                                                                                                                                                                                                                                                                                                         | Edits and DR-3 (90)                                                                                                                          |
| Wed 11 Nov | **G7** 22:00 | DR-4 in the morning; tag `v1.0.0`                                                                                                                                                                                                                                                                                                      | Clean-machine run (120); submit and screenshot (20): **140**                                                                                 |
| Thu 12 Nov | —            | Only a demo-breaking fix merges                                                                                                                                                                                                                                                                                                        | Stay reachable until 13 Nov 01:30                                                                                                            |
| 13–30 Nov  | —            | `main` frozen except for uptime fixes, each logged in CHANGELOG                                                                                                                                                                                                                                                                        | —                                                                                                                                            |
| 1–15 Dec   | —            | Deploy freeze; hourly checks (S5.5.5)                                                                                                                                                                                                                                                                                                  | Check `/ops` daily at 09:00                                                                                                                  |

The user's total is about 42 hours, including 10 minutes each morning for `/usage` and the digest. That is 3 hours or less on every day except 6 Nov, which needs about 6. OD-12 asks the user to confirm these hours; if they have less, pause work by the stop rule. If the register is adopted after 18:00 on 22 Oct, that day's build items move to the morning of 23 Oct. The gates do not move.

#### S5.3.2 Gates

| Gate       | Passes when                                                                                                                              | If it fails                                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| G0, 24 Oct | S1–S4 green, and the memo checkpoint (invoice, verified PAID, payout, verified SUCCEEDED) passed on `fs-dev`                             | Register G0 kill rules apply; every other spike takes its register fallback                                          |
| G1, 26 Oct | The user signs off the register's prototype list after reading the critique report; hero-path primitives already run inside the skeleton | One revision round until 27 Oct 18:00; after that, only token and copy changes                                       |
| G2, 29 Oct | DR-1 passes on the MLD, which has run since 25 Oct with the real recording since 28 Oct; G2 decides cuts only                            | Apply the register cut order from item 1, never touching the never-cut list; re-check 31 Oct                         |
| G3, 1 Nov  | All four eval bars met against PP-OCRv5; p95 frame time of 18 ms or less on the low-end phone; texts frozen; 100+ tests                  | Show the honest eval numbers; the film leans on human entry; the low-end tier becomes the default; QA swarm on 2 Nov |
| G4, 4 Nov  | Every MM has a `data-moment-phase` assertion and a reduced-motion variant; rough cut v2 passes E-19                                      | Unfinished moments ship in their reduced-motion versions                                                             |
| G5, 6 Nov  | No open P0 (demo-breaking or money-wrong) or P1 (visible on the judge path) bug; accessibility passes recorded                           | Only fixes merge; missing takes are re-shot on 7 Nov                                                                 |
| G6, 9 Nov  | Public video of 2:55 or less (target 2:50) with English captions and the S5.6.6 chapters, playing logged out in the Devpost embed        | Upload what exists by 10 Nov 12:00                                                                                   |
| G7, 11 Nov | DR-4 passes and Devpost shows Submitted                                                                                                  | Fix by 12 Nov 12:00. If that fails, the README names the hosted path as primary and documents the clone issue        |

**G1 critique.** A critique subagent runs the `impeccable` skill's critique, with design §0–§8 as the pinned brief, over every hero-path screen in the skeleton and `/prototype`. It writes `docs/gates/G1-critique.md` by 26 Oct 12:00: one row per screen, pass or fail, with a screenshot. The tests are:
1. **Squint.** At half size with a 6 px blur, the screen's one focal element is still the most prominent thing. There are no more than two slabs.
2. **Crops.** Screenshots at 1470×956 and frames from the 1080p rough cut, viewed 640 px wide: the hero element and its numbers are readable, and no text is smaller than 14 px.
3. **Three seconds.** A fresh subagent that sees only the screenshot names the screen's purpose and the next action, and both match the spec.
4. **Template test.** Would this appear in a SaaS template? Any hit on design §2.2's generic look or the banned tells fails: gradient text, the same radius everywhere, three icon cards, sparkle icons, count-ups, glow, monospace micro-labels, middle-dot metadata, arrows on buttons.
5. **Token hygiene.** No raw colours, corners of 0 or 2 only, shadows only on paper, contrast tests green.

The user reads the report and its fix list before signing.

**Spike protocol.**
- Each spike has one owner and a 4-hour timebox (S11: 2 hours). Verdicts are due by 24 Oct 12:00.
- PayPal spikes run on `fs-dev` (co-op B) only and keep every `debug_id`.
- **S4** checks four things:
  - each of the seven receivers ends SUCCESS (an unconfirmed receiver email would park as UNCLAIMED instead; see R26);
  - Rhea's alias ends UNCLAIMED (OD-11);
  - ERRPYO002's behaviour;
  - the per-item fee PayPal reports.
- **S5** also proves the film's funding path: a payment on the hosted page produces PAID, and the record shows whether the webhook arrives.
- **S10** starts from Google's docs, which list Cebuano and Filipino for both 3.8 TTS models (ai.google.dev/gemini-api/docs/speech-generation, read 22 Oct). It measures pronunciation and the free-tier quota, which Google does not publish.

### S5.4 Human-only tasks

> **Do we need nine real sandbox accounts?** Nine is the minimum, and the plan creates ten. They are free sandbox test identities, not real PayPal accounts: there is no KYC and no money, and no email leaves the sandbox. One CSV upload creates all of them in about 10 minutes.
> - **One business account (co-op A).** It invoices Lantern Bay and sends the payouts; `invoicer_email_address` must be its email.
> - **Seven personal receivers.** A payout item reaches SUCCESS only in an existing account. An address with no account goes UNCLAIMED (RECEIVER_UNREGISTERED, developer.paypal.com), which is exactly Rhea's beat, so Rhea gets no account. Sending several items to one shared receiver is UNVERIFIED, and Proof would then show one masked receiver for several members, which looks staged.
> - **One payer (Lantern Bay).** This is the only way to get a real PAID on PayPal's hosted page, which S5, every film run and R4 top-ups need. Judge Mode itself uses record-payment.
> - **The tenth, co-op B.** It runs `fs-dev` and the nightly CI smoke test. Each database has its own `run_seq`. If dev, CI and the judge shared one merchant, a dev run could create `FS-2026A-r37` or reuse a `sender_batch_id`, and the judge's adopt-on-duplicate logic would latch onto the dev invoice or batch. They would also share one balance and one Transaction Search. Co-op B is also the standby for R4.
> - **Three logins are kept:** co-op A, co-op B and Lantern Bay. The receivers' passwords are random and thrown away; the dashboard can reset one if it is ever needed.

| Row | Role                                                                                        | Type       | `ppBalance` | Login kept | Used by                                            |
| --- | ------------------------------------------------------------------------------------------- | ---------- | ----------- | ---------- | -------------------------------------------------- |
| 1   | Co-op A                                                                                     | BUSINESS   | 100000      | Yes        | `fs-judge`, film                                   |
| 2   | Co-op B                                                                                     | BUSINESS   | 100000      | Yes        | `fs-dev`, E-17, R4 standby                         |
| 3–9 | Receivers: M-014, M-007, M-060, M-018, M-039, M-022, M-002 (WS-CORE confirms against IC-03) | PERSONAL   | 0           | No         | Batches from both merchants                        |
| 10  | Lantern Bay                                                                                 | PERSONAL   | 100000      | Yes        | Hosted-page payments                               |
| —   | Rhea (M-031)                                                                                | No account | —           | —          | `rhea-<16 random hex>@example.com`, never uploaded |

**S1 (22 Oct, about 45 minutes).**
1. **Generate the CSV.** The user runs `pnpm tsx tools/sandbox-accounts.ts` in their own terminal.
   - It asks, with hidden input, for the three passwords to keep, which the user generates in a password manager. PayPal's rules: 8–10 characters, upper and lower case, a digit or symbol, and no four repeated or consecutive characters.
   - It writes `.secrets/sandbox-accounts.csv` (gitignored) in UTF-16LE with the header `country_code,account_type,primary_email_alias,password,first_name,last_name,ppBalance,addBank,ccType,payment_card`.
   - The file has ten rows, all `US`, all `addBank` Y, `VISA`, `PAYPAL`, with plain-ASCII names from IC-03.
   - Aliases follow `fs-<role>-<8 random hex>@personal.example.com` or `@business.example.com`.
   - PayPal's limits: at most 40 rows, a `.csv` or `.txt` file, `ppBalance` from 0 to 100000 (developer.paypal.com/sandbox-testing/bulk-accounts).
2. **Upload.** Use the sandbox's Bulk Account Upload. Check that all ten rows show US and the right balances, then delete the CSV. Never use the default accounts PayPal created at sign-up: their country may follow the developer account (UNVERIFIED), which is the memo's India failure mode.
3. **Apps.** In Apps & Credentials, under Sandbox, choose Create App (Merchant). Create `fs-judge` on co-op A and `fs-dev` on co-op B. Tick Invoicing, Payouts and Transaction search. Transaction Search takes about 9 hours to propagate.
4. **Secrets.**
   - **Password manager:** the three logins and both apps' secrets.
   - **`.env.local` (`fs-dev`):**
     - `PP_CLIENT_ID` and `PP_CLIENT_SECRET`;
     - `PP_BUSINESS_EMAIL` (co-op B);
     - `PP_BRAND_EMAIL`;
     - `PP_RECEIVERS`, a JSON map from member number to email;
     - `PP_UNCLAIMED_RECEIVER`.
   - **Render `fs-secrets`:** the `fs-judge` values, with co-op A.
   - **GitHub environment `sandbox-smoke`:** the `fs-dev` values.
   - **Everywhere else:** sandbox emails appear only masked. That covers fixtures, recordings, `docs/sandbox.md` (which lists roles, app names and webhook IDs) and the film.
5. **Webhooks.** For each app, run `pnpm tsx tools/setup-webhooks.ts --app <app> --url <https url>/webhooks/paypal`; the returned ID becomes that app's `PP_WEBHOOK_ID`. Quick-tunnel URLs change on every restart; re-running the script PATCHes the URL (developer.paypal.com/api/webhooks/v1/webhooks-update).

**S5 (23 Oct, 30 minutes).** In a private window, sign in to sandbox.paypal.com as Lantern Bay. Open the `recipient_view_url` that WS-PPCORE posts for an `fs-dev` invoice and pay it from the balance. WS-PPCORE records three things:
- PAID;
- whether the webhook arrived;
- the result of the postback verification.

**Pilot outreach (23 Oct, 45 minutes).**
- **Who.** At least 10 contacts:
  - Davao Region co-ops from the CDA masterlist (cda.gov.ph/cooperative-masterlist/);
  - Mindanao cacao industry groups;
  - US and EU craft chocolate makers that buy Philippine cacao;
  - Fairtrade or Rainforest Alliance field staff.
- **The three questions:**
  - How is the premium split today?
  - How long does that take?
  - What disputes come up?
- **The ask.** By 5 Nov, a one-sentence quote, with written permission to use the person's name and role. Publish quotes verbatim only.
- **Records.** The consent message stays private. `docs/pilot-quote.md` records only the quote, the name, the role and the consent date.
- **If nothing arrives.** Known limitations says "No pilot partner yet". A hypothetical persona's words never become a quote.

**Credentials (22–24 Oct).**

| Item                | Where                                                                                                                                                       | Notes                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic           | Three keys: dev (`.env.local`), ci (GitHub environment `eval-live`), prod (Render)                                                                          | Set a Console spend limit above the code's daily cap and the US$3 nightly cap. A separate `fs-agents` workspace is created only under OD-14 |
| Gemini              | One project and one key, on the dev machine only, for `tools/tts.ts`                                                                                        | Never in Render or CI; never rotated                                                                                                        |
| GitHub              | Organization, public repo, `fs-bot` and its token, ruleset, MIT `LICENSE` at the root, description, topics including `paypal-ai-hackathon`, push protection | S5.2.4                                                                                                                                      |
| Render              | Account with a payment method; Blueprint; `fs-secrets` values typed in by the user                                                                          | Paid plans (register)                                                                                                                       |
| Expo, EAS, Firebase | `EXPO_TOKEN` in GitHub secrets; Firebase Android app; FCM V1 key via `eas credentials`; `google-services.json` as an EAS file secret                        | Nothing committed                                                                                                                           |
| YouTube             | Channel phone-verified by 2 Nov, which custom thumbnails require (support.google.com/youtube/answer/72431)                                                  |                                                                                                                                             |

**Machine and devices.**
- **By 23 Oct:** JDK 17, platform-tools on PATH, and USB debugging on the film phone.
- **By 30 Oct:** scrcpy 5.0.1 and OBS Studio 32.2.2.
- **Phones:**
  - A low-end Android (3 GB RAM or less, Android 10–12) for performance and TalkBack evidence.
  - A current Android (14 or later) for push, the scanner and filming.
- **Optional, decided by 2 Nov:** the Virtual Display Driver (`winget install -e --id VirtualDrivers.Virtual-Display-Driver`). Uninstall it before GPU driver updates.

**Judgement and hands.**
- **Labels.**
  - Hero slips on 23 Oct.
  - A–L on 27 Oct: only the fields a checker subagent flags, plus a 10% random sample.
  - The 40 eval labels from 30 Oct to 1 Nov.
  - A 10% sample of P01–P54.
- **Decisions.** Every gate, and OD-1 to OD-14 by their dates.
- **On film.** The user's hands are the real co-signer and the member's thumb.
- **Posts by 5 Nov.**
  - Sandbox evidence on PR #107 (github.com/paypal/agent-toolkit/pull/107).
  - The token-expiry PR with its jest test.
  - The ai@4 temperature issue.
  - Never use the word "merged".
- **Publishing.** YouTube and Devpost.

### S5.5 Verification plan

#### S5.5.1 End-to-end scenarios

| ID   | Scenario                                                                              | Cadence                                                                                | Asserts                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01 | Judge happy path, with treasurer and Chair contexts                                   | Replay, every PR                                                                       | Seven MM phases in order; 64 of 64 lines explained; 3 holds; US$21.14 returned; 7 paid by PayPal and 57 in cash. Proof shows "Premium allocated: 100%, no deductions" and a split "Paid" metric (PayPal-confirmed, cash attested by the clerk, outstanding). An English line sits under every Cebuano or Filipino sentence in the member frame. No rival product names appear on Proof |
| E-02 | E-01 through hosted Judge Mode on co-op A                                             | Live, nightly 26 Oct–15 Dec                                                            | About 11 PayPal calls; a 201; verified item events; Rhea goes UNCLAIMED, is cancelled, then RETURNED, then OFF_RAIL_DUE                                                                                                                                                                                                                                                                |
| E-03 | Tamper: a line edited after key 1, and a payout row altered in the DB after both keys | Replay                                                                                 | First case: approvals voided and the run back to IN_REVIEW. Second case: the hash mismatch is refused before `POST /v1/payments/payouts`                                                                                                                                                                                                                                               |
| E-04 | A resent webhook                                                                      | Live within E-02; replay                                                               | One "Delivery repeated, already applied." row; no state change, no sound                                                                                                                                                                                                                                                                                                               |
| E-05 | An item event arrives before the 201                                                  | Replay                                                                                 | It joins by `sender_item_id`; no orphan remains after catch-up                                                                                                                                                                                                                                                                                                                         |
| E-06 | INVOICE.PAID never arrives                                                            | Replay                                                                                 | The 60 s GET funds the run                                                                                                                                                                                                                                                                                                                                                             |
| E-07 | The sandbox returns 429                                                               | Replay                                                                                 | 6-minute circuit, labelled replay, queue copy                                                                                                                                                                                                                                                                                                                                          |
| E-08 | `kill_payouts` is on                                                                  | Replay                                                                                 | The Approve slab is bolted; the run is HALTED below POSTING                                                                                                                                                                                                                                                                                                                            |
| E-09 | Add to Schedule A                                                                     | Replay                                                                                 | 409 `RATE_CARD_RATIFIED`, citing the hash                                                                                                                                                                                                                                                                                                                                              |
| E-10 | Instruction text on slip 0449                                                         | Replay, eval                                                                           | Quarantined; no line changes                                                                                                                                                                                                                                                                                                                                                           |
| E-11 | A reset during a live run                                                             | Integration                                                                            | `judgeReset` skips while the lane lock is held                                                                                                                                                                                                                                                                                                                                         |
| E-12 | Clerk captures offline                                                                | Maestro                                                                                | "3 saved on this phone", then synced; a resend shows "Already sent"                                                                                                                                                                                                                                                                                                                    |
| E-13 | Chair co-signs on the phone                                                           | Maestro, web frame                                                                     | The seal hash matches; a tampered seal is refused                                                                                                                                                                                                                                                                                                                                      |
| E-14 | Member listens                                                                        | Maestro                                                                                | Paminawa plays; a missing clip falls back to labelled device speech                                                                                                                                                                                                                                                                                                                    |
| E-15 | Reduced motion                                                                        | Playwright with `reducedMotion: 'reduce'`; Android animator scales at 0                | Every MM reports the phases of its reduced variant                                                                                                                                                                                                                                                                                                                                     |
| E-16 | Proof verify                                                                          | Replay                                                                                 | Six checks read "Matches"; an altered proof is withheld                                                                                                                                                                                                                                                                                                                                |
| E-17 | `sandbox-smoke.yml` with `fs-dev` (co-op B)                                           | Live, nightly, from GitHub's network                                                   | Invoice, record payment, and a US$1.00 payout, asserted by GET. The CI database sets `run_seq` to the current Unix minute and the dev database starts at 100000, so invoice numbers and `sender_batch_id`s never repeat                                                                                                                                                                |
| E-18 | Contract lint                                                                         | Every PR                                                                               | Spec-lint (S5.2.3) passes                                                                                                                                                                                                                                                                                                                                                              |
| E-19 | Public copy                                                                           | Every PR that touches README, `docs/devpost.md`, `video/script.ts` or gallery captions | No banned phrase (S5.7.1); every figure equals IC-03; the script has 240 words or fewer and every beat runs at 140 wpm or less                                                                                                                                                                                                                                                         |

**Film mode** (`FS_TAKE=film`):
- E-01 leaves the Chair unscripted and waits up to 120 s for the real `approval.signed`.
- It sets `readMode=live`, so slip reading runs live instead of from the replay cache.

CI always scripts the Chair and replays the reading.

#### S5.5.2 Device and browser matrix

| Surface              | Must pass                                                                                             | Also                                                                 | Method                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Console, Judge stage | Chrome stable on Windows 11, at 1920×1080 and 1440×900                                                | Edge and Firefox; Playwright WebKit (real Safari UNVERIFIED: no Mac) | Playwright in CI; manual                                                                       |
| Proof                | Android Chrome on the low-end phone over mobile data; desktop Chrome                                  | iPhone Safari if one is available                                    | Lighthouse CI mobile preset; a failure is re-measured on the phone before it blocks            |
| Fair Split app       | Low-end Android (performance, TalkBack, font scale); current Android (push, scanner, Predictive Back) | AVD API 36 with Google Play; AVD API 34 for CI                       | Maestro 2.11.0, locally and in GitHub Actions (EAS Free has no Maestro jobs: expo.dev/pricing) |
| `/app` frames        | Chrome inside W-JG-01; Android Chrome                                                                 | A judge's own phone, by QR                                           | Playwright; manual                                                                             |
| iOS                  | A 5-second simulator clip (P2, the first thing cut)                                                   | —                                                                    | EAS simulator build with Maestro on a macOS runner                                             |

#### S5.5.3 Accessibility and performance

- **Automated accessibility.**
  - axe runs on every route state via `@axe-core/playwright` 4.13.0. Version 4.14.0 is under 14 days old.
  - Contrast tests fail CI below 4.5:1 for console text, 7:1 for statement copy and 3:1 for non-text elements.
- **Manual passes, 6 Nov:**
  - NVDA with Chrome through Approve, by keyboard and by the ConfirmDialog;
  - TalkBack through the member, clerk and board screens;
  - the web at 200% zoom;
  - the app at `adb shell settings put system font_scale 1.3`, then `2.0`.
- **Android:**
  - 95th-percentile frame time from `dumpsys gfxinfo`, over the MM-1 and MM-7 flows on the release APK: 18 ms or less.
  - Cold start via `am start -W`: 2,500 ms or less.
  - Total PSS: 180 MB or less.
- **Web.**
  - Design §9's gzip budgets run in CI.
  - Moments are profiled at 4× CPU throttling.
- **Judge time.** Measured from `run_events`, from the first press to the batch 201. The median must be 60 s or less across the dry runs and the soak.
- **Evidence.**
  - Each live run appends its IDs (invoice, batch, items, events, `debug_id`s) to `run_events`.
  - `tools/export-sandbox-ids.ts` writes the README table from the film run and the latest E-02.
  - The waffle and the README read `eval/report/latest.json` with N = 40.

#### S5.5.4 Judge-path dry runs

| Run  | When                    | Set-up                                                                                                                                                                                                                                                                                                                                             | Pass                                                                                                                                              |
| ---- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| DR-0 | Daily 09:00 from 26 Oct | GitHub Actions runs `e2e/judge-path.spec.ts` (replay) against the hosted `/judge`; the trace video is linked in the digest                                                                                                                                                                                                                         | Green; first press to 201 in 60 s or less                                                                                                         |
| DR-1 | 29 Oct                  | The user's phone and a private laptop window over a phone hotspot. Starting from the README link: mark paid, resolve holds, approve, co-sign by QR, reset, run again                                                                                                                                                                               | No login needed; first press to 201 in 60 s or less; reset in 10 s or less                                                                        |
| DR-2 | 5 Nov                   | A logged-out browser profile: Devpost page, video, repo, Judge Mode, the "What's real" sheet                                                                                                                                                                                                                                                       | Nothing asks for credentials                                                                                                                      |
| DR-3 | 10 Nov                  | A Stage-1 screener pass (first 300 characters, LICENSE in About, public captioned video, Judge Mode). Then `e2e/submission/llm-grader.spec.ts`: claude-haiku-5-5, through `ClaudeGateway`, reads the public Devpost text and README                                                                                                                | It names Invoicing v2, Payouts v1, Webhooks, Agent Toolkit 1.11.0 and all three model IDs, and finds no claim that all members are paid by PayPal |
| DR-4 | 11 Nov                  | (a) A new local Windows user with only the README prerequisites. (b) `clean-clone.yml` on `ubuntu-latest`, `windows-latest` and `macos-latest`, running the README quickstart verbatim in keyless replay. (c) Judge Mode from another network. (d) The release APK on a second phone, SHA-256 checked, paired by QR. (e) `pnpm verify-proof <url>` | All five green                                                                                                                                    |

#### S5.5.5 Soak, balance and the judging window

- **Soak, 30 Oct 12:00 to 31 Oct 12:00.**
  - `fs-cron` resets hourly.
  - A GitHub Actions job runs a replay session every 15 minutes and a live run every 4 hours.
  - Passes when:
    - `/readyz` never returns 5xx;
    - no outbox row stays dispatched for over 5 minutes;
    - resets finish within 10 s;
    - no webhook is unmatched after catch-up;
    - memory stays steady.
- **Balance (co-op A only; dev and CI draw on co-op B).**
  - A Judge run moves US$341.74 net, because Rhea's US$26.65 comes back, plus sandbox fees. Record-payment brings nothing in.
  - A film run is funded on the hosted page, so co-op A comes out about US$3,965 ahead per run, before fees.
  - Plan for at most 50 live Judge runs before 1 Dec.
  - The daily live cap is `min(100, floor((balance − 10,000) / (345 × days left to 15 Dec)))`, which is about 15 on 1 Dec. Past the cap, Judge Mode replays the last live run, labelled with its run number and time.
  - Balance is read from `TransactionSearchController.searchBalances`, which can be up to 3 hours behind, minus any ledger payouts since that reading.
- **1–15 Dec.**
  - Deploy freeze; hotfixes go out by manual promotion only.
  - `fs-cron` runs hourly checks at :07 and shows them on `/ops`: `/readyz`, token scope, webhook registration (re-PATCHed on drift), catch-up, Claude budget, balance and cap.
  - `uptime.yml` calls `/readyz` from outside Render every 30 minutes; GitHub emails the owner when a scheduled run fails.
  - One E-02 runs daily at 16:37 IST (03:07 PST).

### S5.6 Demo video

#### S5.6.1 Rules

**From the register** (unchanged): every moment has a `data-moment-phase` assertion, a reduced-motion version and a recording of the real event. Waits are labelled "×12 real time". The Gemini narration is disclosed. No product sound plays under the voice, and captions run throughout.

**From the contest:**
- under 3 minutes;
- public on YouTube;
- footage of the project running on its device;
- no third-party trademarks or copyrighted music without permission;
- an English translation of anything not in English (rules: Submission Requirements, Language Requirements).

**Film budget:**
- target 2:50;
- 240 words or fewer, counted as a word processor does (a hyphenated word is one);
- 140 wpm or less in every beat, and no beat shorter than 10 s;
- only Analyn and Lantern Bay are named aloud. Nang Celing is named in a lower third; everyone else is a role (the clerk, the Chair, a member without PayPal);
- no rival product names;
- the slip-0449 injection stays out of the film;
- each beat has one hero element filling at least 40% of the frame height.

#### S5.6.2 Beat sheet

`video/script.ts` holds each line as `say` (spoken) and `show` (caption). Figures render from IC-03; the test count comes from CI at lock.

| Time      | Beat and hero element                                                                                 | Screen and source                                                                                                                                                                                                                                                                                                                       | Spoken (`say`)                                                                                                                                                                                | Sound                               |
| --------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 0:00–0:10 | Cold open: MM-1, then a short MM-7 (the phone)                                                        | M-MB-01 on a physical phone; a real, verified PAYOUTS-ITEM.SUCCEEDED for M-014; the thumb taps "Premium 43.69", then slip 0403, zooming into the clerk's "38.45"                                                                                                                                                                        | None. Captions: "Paid by PayPal Payouts (sandbox), confirmed by a verified webhook." / "Every peso traces back to her weigh-slip."                                                            | Chime and haptics                   |
| 0:10–0:24 | Problem and promise (the 12-photo contact sheet; title "Fair Split: co-op payroll for cacao farmers") | W-JG-01 first view. Source line in plain text, no logo: "Fairtrade cocoa rules: every member gets a premium receipt (Côte d'Ivoire and Ghana, req. 4.3.4)"                                                                                                                                                                              | "Sixty-four cacao farmers, two hundred sixty-four handwritten slips, one premium. Fair Split: Claude reads the paper, code checks each line, two officers sign, every farmer can check." (27) | Voice                               |
| 0:24–0:38 | Funding (the PAID event and arc)                                                                      | About 3 s of PayPal's hosted invoice page as Lantern Bay pays; the verified INVOICING.INVOICE.PAID row; W-TR-01's invoice plate reads Paid (PAID, not MARKED_AS_PAID)                                                                                                                                                                   | "Lantern Bay pays one PayPal invoice that Claude drafted with PayPal's Agent Toolkit. Nothing starts until PayPal's webhook is verified." (20)                                                | E4 in a gap                         |
| 0:38–0:52 | MM-2 (a slip crop flying to its row, then the by-hand field)                                          | W-TR-03 reading live, chip "Live Claude read, ×12"; W-TR-04 on slip 0462; lower third "Analyn R. Sumalinog, treasurer. Hypothetical persona, synthetic data."                                                                                                                                                                           | "Claude reads every slip twice, independently; a row goes in only when both reads agree. A water stain: Analyn types it from the logbook." (24)                                               | Ticks in gaps                       |
| 0:52–1:06 | MM-3 and the AG Grid segment (the overlap turning black, the dial)                                    | W-TR-06 over W-TR-05; 63 rows update in the themed grid                                                                                                                                                                                                                                                                                 | "The same slip, photographed twice: the white original and the office's pink copy. Counted once, seventeen dollars ninety-four goes back to sixty-three members." (23)                        | Plunk and needle tick in a gap      |
| 1:06–1:20 | Rules nobody can bend: H2 and H3 stamps, then MM-4 (the refusal plate)                                | W-TR-06 ink stamps; W-TR-02 shows the 409 `RATE_CARD_RATIFIED` with the hash                                                                                                                                                                                                                                                            | "Two more holds, resolved in ink. Then Analyn tries a new deduction mid-season. The board's rate card was hashed before the first slip. It cannot change." (26)                               | Clack in the gap after "mid-season" |
| 1:20–1:34 | MM-5 (the seal on both screens)                                                                       | W-TR-07 and M-BD-02; real Ed25519 signatures                                                                                                                                                                                                                                                                                            | "Over three hundred dollars needs a second key: Analyn holds to sign, the Chair signs on his phone. Both keys cover one batch hash." (24)                                                     | Seal plunk after the line           |
| 1:34–1:52 | MM-6, "×12 real time" (the split fan)                                                                 | W-TR-08: the 201, verified item events, Rhea UNCLAIMED, one resent duplicate                                                                                                                                                                                                                                                            | "PayPal accepts the batch, not yet confirmed. Each payment lands only on a verified webhook. A member without PayPal is parked, then moved to cash. Repeats change nothing." (28)             | Scale notes in gaps                 |
| 1:52–2:06 | Proof (the six checks)                                                                                | W-PF-01 verify, plus the split "Paid" metric                                                                                                                                                                                                                                                                                            | "Lantern Bay checks the chain in its own browser: invoice, rate card, slips, both signatures, every PayPal payment and every cash line." (22)                                                 | —                                   |
| 2:06–2:21 | How it's built (a labelled map, our own SVG, no rival names)                                          | Labels: Invoicing v2 via Agent Toolkit 1.11.0; Payouts v1 typed tool, evidence on PR #107; webhooks self-verified and deduplicated; the three Claude model IDs; engine v1; Render; APIMatic; the test count                                                                                                                             | "Built on Invoicing through PayPal's Agent Toolkit, Payouts through our typed tool, verified webhooks, three Claude models, and code that computes every amount." (23)                        | —                                   |
| 2:21–2:50 | Close: a 6 s limits card, then Nang Celing hears her slip, then the end card at 2:45                  | Card. Then M-MB-01 Paminawa says "Gikan kini sa inyong resibo 0403…" (English caption) and the chip rises; lower third "Nang Celing, member M-014. Hypothetical persona, synthetic data." Three live metrics: "64 of 64 lines explained", "On PayPal: 7 of 64 members, 8.1% of value; the rest in cash", "US$21.14 returned to members" | Over the card: "A sandbox prototype with synthetic people: no real farmer was paid." (11). After the clip: "Claude reads. People decide. PayPal pays. Every farmer can check." (10)           | Device audio between the two lines  |

The script has 238 words, and every beat runs between 86 and 120 wpm.

**Limits card text.** "Sandbox only, US test accounts; live Payouts need PayPal's approval. Synthetic co-op, people and slips. Cebuano is machine-translated, pending native review." The last sentence goes if OD-2 finds a reviewer.

**Disclosures.** OD-2's notice and the persona labels appear as lower thirds from 0:24 and on the end card, not on the cold-open phone.

**Fallback line at 0:24.** If the 2 Nov rehearsal shows no webhook arriving for hosted payments, the line becomes "Nothing starts until PayPal confirms it's paid."

#### S5.6.3 Capture on Windows

- **Runs.** Film day is 6 Nov from 15:00, on `fs-judge`.
  - Every film run is funded on the hosted page: the user, signed in as Lantern Bay in a private window, pays `FS-2026A-r{n}`, and OBS records it.
  - Budget three runs. Lantern Bay spends US$13,000.50.
- **One phone.** Run A pairs it as the Chair, for 0:24–1:52. Run B re-pairs it as M-014, for the cold open and close. Both runs are real; their numbers go in `video/TAKES.md`.
- **Live read.**
  - With `readMode=live`, `ClaudeGateway` skips the replay cache, and the daily cap allows US$10 that day.
  - If the read differs from IC-03's rows or holds, read again.
  - If it still differs, use the 28 Oct recording labelled "Recorded live run (28 Oct)" and say so on the limits card. A difference that lands in "By hand" is honest footage and stays.
- **Console.**
  - Display: preferably a 3840×2160 virtual monitor at 200% scaling. Without one, use the 2560×1440 window at 100%, with punch-ins of 1.33× at most.
  - Chrome runs full screen (`--start-fullscreen`, Playwright `viewport: null`).
  - OBS: display capture at 60 fps, Quick Sync CQP 16, recorded as MKV and remuxed to MP4.
  - The treasurer side is E-01 in film mode, run headed. It injects an ink-arrow cursor eased over 40 steps and logs clicks to `video/takes/<run>/cursor.json`, which drives the zoom keyframes.
  - A two-frame white flash at t0 syncs all sources.
- **Phones.**
  - Demo mode (AOSP SystemUI `docs/demo_mode.md`):
    - `adb shell settings put global sysui_demo_allowed 1`;
    - `adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941`;
    - battery at 100 and unplugged;
    - notifications hidden.
  - Record with `scrcpy -s <serial> --video-codec=h264 --video-bit-rate=20M --max-fps=60 --show-touches --record=member.mp4`. Device audio is captured on Android 11 and later.
  - Convert to constant frame rate with `ffmpeg -i member.mp4 -vf fps=60 -c:v libx264 -crf 14 -pix_fmt yuv420p member60.mp4`.
- **Rehearsal, 2 Nov.**
  - A 20-second take through capture, HyperFrames, render and an unlisted YouTube upload.
  - One hosted-page payment on `fs-dev`, end to end.
  - Playback at 640 px wide (a small embedded player), checking every hero element and caption.
  - `npx hyperframes@0.8.157 benchmark`, to choose between 4K and 1080p mastering.
- **Hygiene.**
  - No secret, client ID or full sandbox email in frame; blur in post.
  - PayPal's hosted page appears unaltered, for about 3 seconds, as the payment being proven; its logo is not reused anywhere else.
  - No device or third-party logos; generic frames only.

#### S5.6.4 HyperFrames assembly

- **Project.**
  - WS-MEDIA owns `video/`.
  - Every command runs as `npx hyperframes@0.8.157`, the version the installed plugin bundles. It will be 19 days old at first use.
  - Set-up: run `init video --non-interactive --resolution landscape`, then the `/general-video` workflow, with one sub-composition per beat and one caption track.
  - Raw takes are gitignored. Compositions, the script, cursor logs and `video/LICENSES.md` are committed.
- **Registry items.**
  - Allowed after re-tokenising to `--fs-*` and Mona Sans:
    - `ui-focus-zoom`;
    - `browser-device-stage`, with generic frames;
    - `state-chip-rail`, with its mono font replaced.
  - Banned, because the design bans what they draw: `count-up`, `multiplayer-cursors`, `tracing-beam` and `hw-pipeline`.
  - No product UI is recreated; every interface frame is a recording.
- **Renders.**
  - Drafts: `render --quality draft`.
  - Final: `render --fps 60 --quality delivery --resolution landscape-4k --gpu --output renders/fair-split.mp4`.
  - Fallback: 1080p60.

#### S5.6.5 Voice, music, captions and mix

- **Voice.**
  - Models: `gemini-3.8-flash-tts` for finals, `gemini-3.8-flash-lite-tts` for drafts (including rough cut v2). The free tier uses inputs to improve Google's products (ai.google.dev/gemini-api/docs/pricing), so only synthetic text is ever sent.
  - Audition Sulafat, Sadaltager, Iapetus and Gacrux on 2 Nov.
  - Direction goes in `speech_metadata.style`: "warm, unhurried documentary narrator, quietly confident". Pauses are written as `<short pause>` and `<long pause>`.
  - `tools/tts.ts` sends one request per take, with beats split by `<long pause>`, then cuts on silence.
  - Take 1 is on 7 Nov at 13:45; single-beat retakes are on 8 Nov at 13:45.
  - Member audio is made 3–4 Nov. Scratch tracks use Kokoro (`npx hyperframes@0.8.157 tts`).
- **Music.**
  - Default: none. The judge model marks music over narration down.
  - If the user wants a cue at the rehearsal, use one YouTube Audio Library track filtered by "Attribution not required" (support.google.com/youtube/answer/3376882), played only where no voice or product sound plays.
  - The file stays out of the repo; `video/LICENSES.md` records it. No AI music.
- **Captions.**
  - Text comes from the `show` lines. Timing comes from `npx hyperframes@0.8.157 transcribe`, whose local speech model is Parakeet according to our media research; confirm at first use.
  - Style: two lines of 42 characters at most, sentence case, Mona Sans, inside the safe zone.
  - The first narrated cue starts "[Synthetic voice, Gemini TTS]".
  - Cebuano audio always gets an English caption.
  - `captions.en.vtt` goes to YouTube, and the same track is burned in.
- **Mix and export.**
  - Voice and product sound never overlap.
  - In "×12 real time" stretches, the recorded audio is muted and each scale note is placed on its event's frame.
  - Loudness: a first `loudnorm=I=-14:TP=-1:LRA=11:print_format=json` pass to measure, then a second pass using the measured values.
  - Export (support.google.com/youtube/answer/1722171):
    - MP4 with the moov atom first;
    - H.264 High, closed GOP of half the frame rate, 4:2:0;
    - 2160p60 at 53–68 Mbps, or 1080p60 at 12 Mbps;
    - AAC-LC at 384 kbps, 48 kHz.
- **Lock check, 8 Nov.**
  - 2:55 or shorter.
  - E-19 green: banned phrases, word count, wpm.
  - Every money figure equals the seed.
  - Every replay and speed-up is labelled.
  - The live-read chip, or its fallback label, is present.
  - The PAID funding shot, or its fallback line, is present.
  - No rival names.
  - Readable at 640 px.
  - A 0.25× scrub finds no secret or third-party logo.
  - Captions match the speech word for word.

#### S5.6.6 YouTube (9 Nov, by 12:00)

- **Title.** "Fair Split: co-op payroll for cacao farmers".
- **Settings.**
  - Public.
  - "No, it's not made for kids".
  - Altered or synthetic content: Yes (support.google.com/youtube/answer/14328491).
  - Embedding allowed.
  - English captions uploaded.
- **Chapters** go in the description. YouTube needs at least three, starting at 00:00, each 10 s or longer (support.google.com/youtube/answer/9884579):
  - 00:00 Paid, and traced to her slip
  - 00:24 Funded by a PayPal invoice
  - 00:38 Paper to rows
  - 00:52 The pink copy
  - 01:06 Rules nobody can bend
  - 01:20 Two keys
  - 01:34 PayPal fan-out
  - 01:52 Proof
  - 02:06 How it's built
  - 02:21 Limits, and her slip
- **Thumbnail.** A 3840×2160 three-panel image that cannot be read as bill-splitting: slip 0403's handwriting, then the audited line (US$43.69 premium, rule R0, 148.0 kg), then the phone at "Bayad na" captioned "Paid".
- **Description.** The first 300 characters are the Devpost opening.
- After swapping the link on Devpost, set rough cut v2 to private.

### S5.7 Devpost and README

#### S5.7.1 Copy

- **Name.** "Fair Split: co-op payroll for cacao farmers". The same name goes on Devpost, YouTube and the thumbnail.
  - Never show "Fair Split" alone: devpost.com/software/fair-split is a Stripe expense-splitter.
  - OD-13 may still rename the project.
- **Tagline** (138 characters; keep it to 140 or fewer): "Co-op payroll from handwritten slips: Claude reads, code audits, two officers sign, PayPal pays, and every farmer gets a receipt to check."
- **Opening** (the first 300 characters, here 297; also the README identity paragraph): "Fair Split: payroll for a cacao co-op paid from handwritten slips. claude-opus-5-5 reads them; claude-sonnet-5-5 and claude-haiku-5-5 check rules and text. PayPal Invoicing v2 (Agent Toolkit 1.11.0) funds it, Payouts v1 pays the 7 of 64 members on PayPal, Webhooks confirm each; the rest get cash."
- **Generation.** `tools/devpost-text.ts` renders `docs/devpost.md` from IC-03 and templates. The user pastes it into Devpost.
- **Word list for E-19** (case-insensitive). These phrases are banned:
  - "pays every member", "pays each member", "every member is paid", "all members are paid";
  - "drive every state";
  - "merged" near PR #107;
  - "certified", "EUDR-compliant";
  - "real farmers";
  - "production-ready", "instant GCash", "live payouts".

  DR-3 also fails if any public text implies that all 64 members are paid by PayPal.

#### S5.7.2 One order for the README and the Devpost story

1. **Identity.** The opening, the tagline, and the hero GIF "What a farmer sees": 8 MB or less, 15 fps, showing a peso tapped, then the clerk's handwriting, then "Bayad na", with English captions.
2. **Judge it in 60 seconds.** Numbered clicks, the `/judge` link, and the "What's real" sheet.
3. **The problem.**
   - Fairtrade's Standard for Cocoa (v2.15) already requires per-member premium receipts (req. 4.3.4). From October 2026 it also requires at least 40% of the premium to go to members as cash (req. 4.6.2). Both rules apply only to co-ops in Côte d'Ivoire and Ghana, so the Philippines is not yet covered.
   - Philippine adults with a formal account: 50% (BSP, 2025) and 58% in Q1 2026 (a BSP-commissioned SWS survey, context.ph, 22 May 2026). The two surveys use different age bases.
   - Co-op counts from CDA's published lists (UNVERIFIED until WS-QA pulls them).
   - The pilot quote, or "No pilot partner yet".
4. **What a farmer sees.** The statement, audio, tap-a-peso, and cash members on the same statement.
5. **PayPal.** A table of API, file and why, plus a "Why PayPal" paragraph.
6. **AI.** A table of model, job and guard; the 40-case eval against PP-OCRv5 with N stated; the tools list in S5.7.4.
7. **Real sandbox IDs** from the film runs.
8. **What is real, what is replayed and what is simulated.**
9. **Prior art** (S5.7.3).
10. **Known limitations, including fees.** Sandbox $0.25 per item; in production, 2% per international item.

After that come:
- Run it: quickstart, `.env.example`, `pnpm verify`, the architecture diagram, and the split fan;
- AG Grid;
- APIMatic, with `docs/apimatic-context-plugin.md` (three or more dated fixes and a screenshot);
- Synthetic data, with prompts and image hashes;
- What's next (OD-10: the brand pays a per-run audit fee);
- Licences: MIT and OFL;
- "Built 22 Oct–12 Nov 2026".

Devpost also gets two extra headings: "Sponsor tools", and "Prize category", which names Most Impactful only.

#### S5.7.3 Prior art (README and Devpost only; never on Proof or in the film)

| Entry                                                                              | What it does                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supplora Pay (devpost.com/software/supplora-pay)                                   | Claude reads supplier invoices for a restaurant. Integer-cent checks against delivery notes and price history hold bad lines, and the owner approves one Payouts batch. It grew out of a tool that has run in a real restaurant since March 2026 |
| Clause-to-Cash (devpost.com/software/clause-to-cash-contracts-that-collect)        | Contract terms are extracted with page-and-quote citations into a Mandate. A 10-rule deterministic Guard gates the Invoicing v2 invoices and the Payouts revenue shares                                                                          |
| Tributary (devpost.com/software/tributary-executable-revenue-share-infrastructure) | Plain-English revenue shares become a DealSpec, locked by a SHA-256 hash once people have resolved the ambiguities. Integer-cent payouts with clawbacks; statement numbers are checked against the engine trace                                  |
| PayFlow (devpost.com/software/payflow-gj19y4)                                      | Receipt photos are parsed by AI and matched to the PayPal ledger in code; one human approval releases a batch payout                                                                                                                             |
| TipPool (URL UNVERIFIED)                                                           | Claude turns house tip rules into an exact-cent split; one Payouts batch pays the staff                                                                                                                                                          |

**Contrast sentence.** "Supplora Pay, Clause-to-Cash and Tributary protect a payer or a contract's parties. Fair Split protects the payees: 64 farmers with no easy way to check their own pay, most of them paid in cash, and it lets the brand that funded them verify every line, PayPal or cash."

WS-QA re-verifies every row at re-scan 1 on 26 Oct. That re-scan is seeded with Supplora Pay, LOCIM and Leash. Any row WS-QA cannot open is replaced by the next nearest of the register's ten.

#### S5.7.4 AI tools

Devpost asks each entry to "identify which tools (model or AI service) were used and explain how" (paypalaihackathon.devpost.com).

| Tool                                         | How it was used                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| claude-opus-5-5                              | Slip reads A and B, zoom re-reads, the rate-card reader, the audit agent, statement wording  |
| claude-sonnet-5-5                            | The deduction classifier                                                                     |
| claude-haiku-5-5                             | The injection screen and the language check                                                  |
| Claude Code                                  | Wrote the code in five lanes; the user reviewed money paths, and merges went through a queue |
| OpenAI's image model, via Codex CLI          | Synthetic slips, the rate card, the logbook, eval images                                     |
| Gemini 3.8 Flash TTS (Flash-Lite for drafts) | Member audio and narration, labelled synthetic                                               |
| PaddleOCR PP-OCRv5 (`ppu-paddle-ocr` 6.6.1)  | The eval's OCR baseline only                                                                 |
| Kokoro (HyperFrames)                         | Rough cut v1's scratch voice only                                                            |
| HyperFrames' `transcribe` model              | Caption timing only                                                                          |
| APIMatic Context Plugin                      | Grounding for PayPal code                                                                    |
| PayPal AI-Toolkit plugin                     | PayPal docs and tools inside Claude Code                                                     |

#### S5.7.5 Form checklist

- [ ] **Built with** (25, the maximum): paypal, paypal-invoicing, paypal-payouts, paypal-webhooks, paypal-agent-toolkit, paypal-server-sdk, anthropic, claude, claude-code, typescript, vite, react, hono, postgresql, expo, react-native, ag-grid, apimatic, render, postman, zod, playwright, maestro, gemini-tts, openai-image-generation. Never `nextjs` or `ag-studio`.
- [ ] **Try it out:**
  - Judge Mode (`/judge`);
  - the film run's Proof;
  - the repo;
  - the APK release with its SHA-256;
  - the Postman collection.
- [ ] **Gallery.** Each image is 3:2, 1800×1200 PNG, 5 MB or less, with a "Synthetic data" chip and an English caption under any Cebuano text. The injection beat stays in the README and eval only.
  1. The three-panel thumbnail.
  2. The verified PAID event.
  3. Paper to rows.
  4. The pink copy (dial and grid).
  5. Bolted.
  6. Two keys and the seal.
  7. The fan-out: 7 PayPal, Rhea parked, 56 cash.
  8. Proof verified.
  9. The architecture map, in text with no logos.
  10. Tests, eval and CI.
- [ ] **Video:** the G6 link, playing in the embed while logged out.
- [ ] **Additional questions:**
  - repo URL;
  - MIT licence;
  - individual entrant;
  - a new project begun 22 Oct;
  - sponsor tools used. APIMatic is the primary sponsor and AG Grid is also entered; Render is entered only if OD-6 says yes.
- [ ] **Testing instructions:** "No login: open Judge Mode. Optional local run: `pnpm i && pnpm verify` in keyless replay. A live local run needs your own US sandbox REST app (README)." No secret is published.
- [ ] **Repo at G7:**
  - LICENSE detected in the About box;
  - description, website and topics set;
  - CONTRIBUTING, CODE_OF_CONDUCT and SECURITY;
  - test-count and CI badges;
  - tag `v1.0.0`.
- [ ] **5 Nov.** Press Submit. Devpost runs a baseline eligibility check on projects submitted a week early when the hackathon shows its review icon (help.devpost.com/article/126); whether this one does is UNVERIFIED. Edits stay open until the deadline (rules §5).
- [ ] **Final:** Devpost shows Submitted, and the screenshot goes in `docs/gates/G7.md`.

### S5.8 Risk register

| ID  | Risk                               | Trigger                                                                             | Response and fallback                                                                                                                                                                                             | Owner    |
| --- | ---------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R1  | Payouts blocked                    | A 403 in S4 survives a fresh account                                                | G0 kill rule; MTS ticket; the user decides                                                                                                                                                                        | L1, user |
| R2  | Extraction short of the bar        | S3 exact-row rate below 0.85, or below 0.70 after a day of prompting                | Rework the reads; then the G0 kill rule                                                                                                                                                                           | L2       |
| R3  | Shared-IP throttle                 | A 429 or refused connection                                                         | 6-minute circuit, labelled replay, no polling                                                                                                                                                                     | L1       |
| R4  | Co-op A balance runs out           | Projected balance under US$10,000 before 15 Dec 08:00 PT                            | Lower the cap. Then Lantern Bay pays an `FS-TOPUP-{n}` invoice on the hosted page (needs S5). Last resort: point `fs-judge` at co-op B with a new app, about 30 minutes plus about 9 hours for Transaction Search | L1, user |
| R5  | Webhooks late or missing           | No event 60 s after an expected transition                                          | 60 s GET; catch-up; hourly re-PATCH                                                                                                                                                                               | L1       |
| R6  | Gemini quota, or poor Cebuano      | `RESOURCE_EXHAUSTED`, or S10 fails                                                  | Drafts on Flash-Lite or Kokoro; spread generation over days; labelled Filipino audio with Cebuano text; labelled device speech                                                                                    | L5       |
| R7  | Codex quota, or wrong digits       | No file after exit 0, or a label mismatch                                           | One image per run, with the file checked; regenerate; OD-4 tile                                                                                                                                                   | L5       |
| R8  | Expo SDK 58 trouble                | S7 fails                                                                            | Register fallback by 25 Oct                                                                                                                                                                                       | L4       |
| R9  | Workflows slow                     | `startTask` p50 over 10 s                                                           | `executor=worker`; inline fallback                                                                                                                                                                                | L1       |
| R10 | Lanes collide                      | Two or more queue ejections in a day                                                | ADR-only contract changes; the `deps` lane; spec-lint; rebase each shift                                                                                                                                          | L5       |
| R11 | Review bottleneck                  | Six or more PRs waiting over 24 h                                                   | Tier A only on money paths; stop rule                                                                                                                                                                             | User     |
| R12 | Moments overrun                    | An MM still unasserted on 4 Nov                                                     | It ships as its reduced-motion version                                                                                                                                                                            | L3, L4   |
| R13 | Judge path over 60 s               | DR-1 median above 60 s                                                              | A labelled ×2 replay of the reading, in Judge Mode only                                                                                                                                                           | L3       |
| R14 | Video pipeline slips               | Failed rehearsal, or a 4K render over 2 hours                                       | 1080p60 master; OBS for all capture; no display driver                                                                                                                                                            | L5       |
| R15 | AI narration marked down           | Known (judge model, Render judge)                                                   | Disclose everywhere; 238 words; product sound carries the cold open and close; OD-5 stays No unless the user chooses otherwise                                                                                    | User     |
| R16 | Rights or labels wrong in the film | The lock check finds a logo, unlicensed sound, an unlabelled replay or a rival name | Fix before G6                                                                                                                                                                                                     | L5       |
| R17 | A secret leaks                     | Push protection or gitleaks fires, or a secret shows in a take                      | Rotate first, then `git filter-repo`; re-shoot or blur                                                                                                                                                            | User, L5 |
| R18 | Deadline-day failure               | Trouble with Devpost or YouTube                                                     | Upload on 9 Nov, submit on 11 Nov, keep 12 Nov as buffer                                                                                                                                                          | User     |
| R19 | A new twin appears                 | Re-scans on 26 Oct, 2 Nov and 9 Nov                                                 | Update the prior-art table before lock                                                                                                                                                                            | L5       |
| R20 | Demo decays during judging         | `/readyz` red, webhook drift, or a key or budget expiring                           | Hourly checks; `uptime.yml` email; hotfix by manual promotion                                                                                                                                                     | L1, user |
| R21 | No low-end phone                   | None in hand by 26 Oct                                                              | Borrow or buy one; otherwise label the evidence with the device actually used                                                                                                                                     | User     |
| R22 | Claude usage exhausted             | Stop-rule thresholds (S5.2.2)                                                       | Pause the lowest lane; OD-14                                                                                                                                                                                      | User     |
| R23 | Section contracts drift            | Spec-lint fails, or the contract diff is still open after 23 Oct 12:00              | The user settles it; errata ADR; regenerate                                                                                                                                                                       | L1       |
| R24 | Hosted payment fails on film day   | No PAID within 5 minutes                                                            | Fund with record-payment, labelled "Marked as paid in sandbox"; use the 0:24 fallback line; add it to the limits card                                                                                             | User, L1 |
| R25 | The film's live read diverges      | Rows or holds differ from IC-03                                                     | Read again; otherwise the labelled 28 Oct recording                                                                                                                                                               | L2       |
| R26 | A receiver parks instead of paying | S4 shows UNCLAIMED for one of the seven                                             | Re-create that row with a new alias; re-run S4                                                                                                                                                                    | User, L1 |
| R27 | Read as a bill-splitter            | A re-scan or reviewer flags it                                                      | The name always carries its qualifier; three-panel thumbnail; OD-13                                                                                                                                               | User     |

**Open decisions added.**
- **OD-12:** the user's daily hours. Default: 3 h or less, and about 6 h on 6 Nov. Decide by 22 Oct.
- **OD-13:** keep the name. Default: keep it, always with "co-op payroll for cacao farmers". Decide by 23 Oct 12:00.
- **OD-14:** buy capacity. Default: no; the stop rule applies. Decide when R22 fires.

### Register deviations and clarifications

1. **Time zone.** Register times carry no zone; S5 reads them as IST.
2. **Contract freezes.** Freeze dates added for IC-02, IC-04 to IC-09 and IC-11. IC-12 FrameBridge is new. IC-07 gains `StatementPlan` and `readMode`; IC-11 gains `mentions`.
3. **Ownership.**
   - The five lanes group the §11 workstreams.
   - `packages/ui-native` moves from WS-DS to WS-APP.
   - Root files go to WS-QA; append-only doc folders; a `deps` lane.
4. **Merging.** For tiers B and C, the merge queue (org repo, `fs-bot`, required checks) replaces §11's "The user merges daily". The user approves Tier A only.
5. **Sandbox accounts.**
   - §8 has one business account serving both apps. S5 adds co-op B for `fs-dev` and CI, and creates every account by bulk upload.
   - New env keys: `PP_RECEIVERS`, `PP_BRAND_EMAIL`, `PP_UNCLAIMED_RECEIVER`.
6. **Live-run cap.** The architecture's US$120 batch limit and 100 runs a day cannot hold at the register's US$368.39 batch. S5 uses a balance-based cap instead.
7. **Rhea.** Her item goes UNCLAIMED, is cancelled, then RETURNED (register §8 and MM-6). ERRPYO002 is only logged in S4.
8. **Film funding.** The film uses the hosted page, giving a real PAID, as in architecture §6.2. Design §7's 0:20 beat said record-payment. Judge Mode keeps record-payment.
9. **Film structure.**
   - The beats and times change: MM-1 runs 0:00–0:10, with a short MM-7 tap.
   - MM-7's audio moves to the close.
   - H2 and H3 merge with MM-4.
   - The map names no rivals; a limits card is added.
   - The BSP figure gives way to the Fairtrade 4.3.4 line. That line is scoped to Côte d'Ivoire and Ghana, because a generic "requires" would overclaim.
   - The film uses a live Claude read.
   - A literal closing line replaces the design's pencil/ink/carbon tagline in the film.
10. **Prior art.** A 5-row table in the README and Devpost only. The film and the Proof footer name no rivals, where the register had ten entries plus four named in the film.
11. **Public copy.** The opening is rewritten with "7 of 64", plus the word list. The README hero is the farmer GIF, not the split fan. The story order changes.
12. **Proof metrics.** The metric splits into "allocated" and "paid", where the design had "Premium paid to members: 100%". An English gloss appears under Cebuano in Judge Mode frames.
13. **Cuts at G1.** ⌘K, the console theme switch, W-PF-02 beyond export, M-ON-01's theme picker and M-CK-02's styling. Bespoke motion is on the hero path only.
14. **Real recording.** Made on 28 Oct, not at G2. The Judge Mode label shows the actual recording date, not the design's fixed "29 Oct".
15. **5 Nov.** Means pressing Submit, not saving a draft.
16. **New pins.** `@axe-core/playwright` 4.13.0 and `hyperframes` 0.8.157.
17. **Name and keys.** The public name gains "for cacao farmers". The treasurer's key ID is `fs-analyn-w1`; the register names only `fs-ernesto-a1`.
18. **OD-2 notice.** It appears as a lower third from 0:24 and on the end card, not on the cold-open phone.

### Review resolutions

- **PayPal engineer, major (tagline and opening).** Fixed in S5.7.1: honest tagline, an opening that carries "7 of 64" within 297 characters, and the E-19 word list. I used the Devpost veteran's tagline wording, which avoids the jargon "on-rail".
- **PayPal engineer, minor (accounts).** Fixed in S5.4:
  - one bulk-upload CSV;
  - co-op A for `fs-judge` and the film, co-op B for `fs-dev` and CI (the reason, namespace collisions, is spelled out);
  - a never-registered alias for Rhea;
  - the film funded on the hosted page.
- **Design director, major (hero path).** Fixed in S5.2.5 and the G1 rubric. The hero path adds W-TR-02 and W-TR-05, which host MM-4 and the AG Grid segment. The cuts are adopted (deviation 13).
- **Design director, minor (CSV).** Fixed: the gitignored CSV comes from WS-QA's tool, with password-manager logins entered through a hidden prompt (Excel's "Unicode text" export would turn the commas into tabs). Co-op B is in the same file. Default accounts are banned.
- **Delivery lead, blocker (capacity).** Fixed in S5.2.1–S5.2.2 and S5.3.1:
  - five lanes, at most four sessions, shifts;
  - `/usage` daily and the stop rule;
  - OD-14 for extra capacity;
  - an org repo with a merge queue, six PRs a day;
  - Tier A narrowed;
  - the user's hours itemised (about 42 h) and OD-12.
- **Delivery lead, major (skeleton first).** Fixed: money loop on 23 Oct, skeleton on Render on 25 Oct, DR-0 daily from 26 Oct, real recording on 28 Oct, G2 decides cuts only.
- **Delivery lead, major (contract drift).** Fixed within S5's scope: reconciliation on 22–23 Oct with the reviewer's defaults, IC-12, spec-lint (E-18) and an errata ADR. Correcting the text of S1–S4 belongs to those sections.
- **Devpost veteran, blocker (copy contradicts the product).** Fixed: tagline, opening, word list, and DR-3's grader failing on any "all paid by PayPal" claim.
- **Devpost veteran, blocker (differentiation).** Fixed for S5: a 5-row table in the README and Devpost only (rows checked against the live pages), the contrast sentence, no rivals in the film, 0449 kept out of marketing, and re-scan seeds. Removing the Proof footer falls to WS-CONSOLE and is asserted in E-01.
- **Devpost veteran, blocker (first 20 seconds).** Fixed with the new 0:00–0:24. I verified Fairtrade req. 4.3.4 in the standard's PDF: it applies only to Côte d'Ivoire and Ghana, so the on-screen line says so. The BSP figure is dropped from the film.
- **Devpost veteran, major (real voice).** Fixed: outreach task on 23 Oct, with the quote due 5 Nov. Consent is kept private, because the repo is public; only the quote, name, role and date are published.
- **Devpost veteran, major (faked funding).** Fixed: film runs pay on the hosted page, the rehearsal covers it, deviation 8 is corrected, and R24 is the fallback.
- **Devpost veteran, major (density).** Fixed:
  - 238 words, 86–120 wpm, no beat under 10 s;
  - three names, the merged rules beat, a map without rivals;
  - a close on Nang Celing with a literal last line;
  - the 40% hero rule and the 640 px check.

  The limits card sits inside the close beat, so even it is not a separate beat under 10 s.
- **Devpost veteran, major (README order).** Fixed in S5.7.2. The split fan moves to Run it; OD-10 fills What's next.
- **Devpost veteran, minor (live read).** Fixed: `readMode=live` in the film, two attempts, and a labelled fallback to the replay.
- **Devpost veteran, minor (name).** Fixed for S5: OD-13 by 23 Oct 12:00, the qualifier everywhere, and the three-panel thumbnail. I verified the expense-splitter on Devpost.
- **Devpost veteran, minor (nine accounts).** Partly rejected. The other answers are adopted, but co-op B is created now rather than deferred: sharing one merchant risks adopting a dev invoice or batch in the judge run.
- **Security reviewer, major (copy and metrics).** Fixed:
  - tagline and opening, plus the word list;
  - the Proof metric split, asserted in E-01;
  - PP-OCRv5, Kokoro and the transcription model added to the AI tools;
  - English gloss in Judge Mode frames and gallery captions.
- **Security reviewer, minor (accounts).** Fixed: three logins kept, receiver passwords discarded, a 16-hex alias for Rhea checked in S4, sandbox emails in env only and masked elsewhere. The repeated-receiver option is noted as UNVERIFIED and rejected.
