# Fair Split: co-op payroll

**Every peso, traced to the pencil mark.**

_Claude writes in pencil. People sign in ink. PayPal makes it carbon._

<!-- Badges (planned): CI status and test count, added once CI runs on GitHub. -->

> **Status (22 Oct 2026): early build.** This README is a skeleton. Sections marked _Planned_ describe what is
> being built for the PayPal AI Hackathon and do not exist yet. Sandbox only; every co-op, member, slip and
> document is synthetic.

## What it is

Fair Split is co-op payroll on PayPal: **Invoicing v2 through Agent Toolkit 1.11.0** bills the brand, **Payouts v1**
pays each member, and verified **Webhooks** drive every state. **claude-opus-5-5** reads handwritten weigh-slips,
**claude-sonnet-5-5** matches deductions to the co-op's ratified rules, and **claude-haiku-5-5** screens for
injection. A deterministic engine, not the model, computes every member's share and holds anything it cannot
justify. The treasurer and a board member approve with two keys, PayPal Payouts pays each member, and every member
can read, and hear, exactly why their number is their number.

The model reads paper; code computes; people approve; PayPal executes.

### PayPal APIs used

| API                | How                                                                                         | Status  |
| ------------------ | ------------------------------------------------------------------------------------------- | ------- |
| Invoicing v2       | Through `@paypal/agent-toolkit` 1.11.0: create, send, auto-cancel rule, get, record payment | Planned |
| Payouts v1         | Our own typed tool (the toolkit has none), following PayPal ai-toolkit PR #107's names      | Planned |
| Webhooks v1        | Self-verified (CRC32 + RSA-SHA256), deduplicated by event ID                                | Planned |
| Transaction Search | `@paypal/paypal-server-sdk` 2.5.0, nightly, labelled as lagging                             | Planned |

### AI tools used

- **claude-opus-5-5**: slip reads, zoom re-read, rate-card reader, audit agent, member statements.
- **claude-sonnet-5-5**: deduction classifier.
- **claude-haiku-5-5**: injection screen, language check.
- **Claude Code**: wrote the code in parallel workstreams; the user reviewed and merged.
- **OpenAI's image model through Codex CLI**: synthetic slips, rate card, logbook and eval images.
- **Gemini 3.8 Flash TTS**: member audio and narration, labelled as a synthetic voice.
- **APIMatic Context Plugin**: grounding for PayPal code (fixes logged in `docs/apimatic-context-plugin.md`, planned).
- **PayPal AI-Toolkit plugin**: PayPal docs and tools inside Claude Code.

## Quickstart

Prerequisites: Node 24.19 or newer, Git. pnpm 11.28.6 comes through corepack (bundled with Node 24).

```sh
git clone <this repo> fair-split && cd fair-split
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
```

_Planned:_ `corepack pnpm verify` runs the whole demo in keyless replay (no PayPal or Claude credentials). A live
local run needs your own **US-country** PayPal sandbox REST app: copy `.env.example` to `.env` and fill it in.
Never commit `.env`.

## Where the PayPal and AI calls live

_Planned: filled in as each module lands. Every PayPal call goes through `packages/paypal-*`; every Claude call goes
through `ClaudeGateway` in `packages/ai`._

| Call                                                  | API                          | File        | Purpose                            |
| ----------------------------------------------------- | ---------------------------- | ----------- | ---------------------------------- |
| `create_invoice`, `send_invoice`, …                   | Invoicing v2 (Agent Toolkit) | _(planned)_ | Bill the brand for the pay run     |
| `create_payout_batch`, `cancel_unclaimed_payout_item` | Payouts v1                   | _(planned)_ | Pay members; park unclaimed items  |
| Webhook receive and verify                            | Webhooks v1                  | _(planned)_ | Drive run and item states          |
| Slip read A/B, zoom                                   | Claude (claude-opus-5-5)     | _(planned)_ | Read handwritten weigh-slips       |
| Deduction classifier                                  | Claude (claude-sonnet-5-5)   | _(planned)_ | Match deductions to ratified rules |
| Injection screen, language check                      | Claude (claude-haiku-5-5)    | _(planned)_ | Quarantine instructions on paper   |

## Architecture

_Planned: diagram._ The dependency rule, enforced in CI by dependency-cruiser (`corepack pnpm deps:check`):

```text
contracts ← domain ← {seed, db} ← outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}
UI code (console, mobile, ui-*) imports only contracts, api-client, tokens, motion, seal, i18n, ui-*
```

Surfaces: the Console (treasurer web, with the Judge stage), the Fair Split app (Expo, Android first), and Proof
(public web). Hosting: Render.

## How to verify in 60 seconds

_Planned (G2, 29 Oct):_ open Judge Mode (`/judge` on the hosted API; no login, no PayPal account needed), mark the
invoice paid, resolve the holds, approve with two keys, and watch the payout fan-out land with verified webhooks.
Then open the run's Proof page and check its hash chain. Until then, `corepack pnpm test` is what you can run.

## What's real and what's simulated

_Planned._ Every row carries its provenance (`live`, `replay`, `simulated_rail`, `seeded`) and the UI labels it.
PayPal calls run live against the sandbox; Claude output in Judge Mode replays a recorded real run, labelled with
its date; "mark paid" uses PayPal's record-payment, labelled as a simulated rail.

## Known limitations

- Sandbox only. All PayPal sandbox accounts are US-country and USD; production to the Philippines is not shown.
- All co-op data, people, slips and documents are synthetic. Peso figures are display-only estimates.
- Cebuano and Filipino text is machine-translated, pending native review.
- Narration and member audio are synthetic voices (Gemini TTS), and are labelled as such.
- iOS is shown only as a short simulator clip.
- This list grows as the build finds limits; nothing here is hidden in the film.

## Built during the hackathon (1 Oct–12 Nov 2026)

Fair Split is a new project: the first commit is 22 Oct 2026, inside the PayPal AI Hackathon window
(1 Oct–12 Nov 2026). Work is in small daily commits from parallel workstreams; see the git history and
`docs/gates/`.

## Prior art

Ten projects in the same neighbourhood. The nearest (Clause-to-Cash, Tributary, SarafuPay and harambee) split
money people already agreed on. Fair Split turns paper into ratified rules and rows, binds the treasurer to a
hashed rate card, and proves each payment on the member's phone and the brand's Proof.

| Project            | What it does                                                                                     | How Fair Split differs                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Supplora Pay       | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| TipPool            | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| PayFlow            | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| Solar Co-op        | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| CoTreasury         | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| Routewell          | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| 555 Buku           | _To be summarised at the 26 Oct re-scan_                                                         | _Same_                                                                                        |
| Clause-to-Cash     | Invoicing v2 → webhook → Payouts behind a guard; freelancer revenue shares to 1–2 subcontractors | Reads paper into rules and rows; ratified, hashed rate card; holds on every unruled deduction |
| Tributary          | Integer-cent multi-party Payouts with property-tested conservation                               | Same money discipline, plus slip reading, holds and two-key approval                          |
| SarafuPay/harambee | Kenyan group treasurer with collections over WhatsApp                                            | Pays out an audited co-op season; members get a statement with audio                          |

## Repository

- Specs: [`docs/spec/`](docs/spec/); the [decision register](docs/decision-register.md) wins every conflict.
- Agent rules: [`AGENTS.md`](AGENTS.md). Ownership: [`docs/ownership.md`](docs/ownership.md).
- Pins: [`docs/versions.md`](docs/versions.md). Security: [`SECURITY.md`](SECURITY.md),
  [`docs/security.md`](docs/security.md).
- [Contributing](CONTRIBUTING.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · License: [MIT](LICENSE)
