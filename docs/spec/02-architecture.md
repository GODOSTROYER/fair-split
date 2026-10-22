**Input note.** The input contained only one architecture, service-first. The second was missing. To make the comparison, I set service-first against the positions the six research lenses take where they disagree with it. Together I call these the "lens composite": the agent in an ai@4 package, a plain background worker, a WebSocket per pay run, AG Studio as the main surface, and Rive plus a Fraunces display face. If the missing document turns up, score it on the same six criteria.

# Fair Split · co-op payroll: FINAL ARCHITECTURE

_Final, 2026-10-22. Service-first is the base, with ten grafts. Build window Oct 23 to Nov 11; the deadline is Nov 12, 12:00 PST._

## Verdict

Service-first is the base. It wins four of the six criteria outright and ties a fifth. The lens composite supplies ten grafts. They fix two correctness defects, one reliability gap and one contradiction in the money model, and they take three unfamiliar SDKs off the critical path.

| Criterion                                       | Service-first                                                                                                                                                                                                             | Lens composite                                                                                               | Final call                                                                                                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Speed to ship** (21 days, parallel subagents) | `contracts` frozen Oct 24, msw mocks from day 2, one owner per package. Drag: Render Workflows, Better Auth impersonation and AG Studio sit on the critical path                                                          | Fewer packages, but it carries the ai@4 temperature trap and puts a second surface (Studio) in the hero flow | Keep service-first's structure. Put the unfamiliar SDKs behind interfaces or gates (G2, G6, G9)              |
| **Judge reliability**, Dec 1-15                 | Postgres limiter, replay by default, hourly reset, deploy freeze. Gap: `startTask` runs after commit, so a crash loses work, and Workflows cold start is unmeasured                                                       | An always-on worker, with no cold start                                                                      | Transactional outbox plus a swappable executor (G2)                                                          |
| **PayPal correctness**                          | Nonce+digest batch id, re-hash before POST, forward-only state machines, re-GET before acting. Gap: the agent path goes through `handleToolCall`, whose token never refreshes and which costs one OAuth call per instance | The ai-sdk adapter returns 400 on every 5.5 model                                                            | One toolkit execution path that uses our token cache (G1)                                                    |
| **Contract clarity**                            | Leaf `contracts` package, dependency-cruiser, zod major split at package boundaries                                                                                                                                       | Mostly implicit                                                                                              | Service-first's approach, plus a frozen task registry and seed snapshot (§1)                                 |
| **Realtime and mobile**                         | NOTIFY → SSE with replay; push; web phone frames                                                                                                                                                                          | A WebSocket per run                                                                                          | SSE, because traffic is one-way. Keep the mobile lens's roles, offline outbox, Ed25519 co-sign and seal (G7) |
| **Test depth**                                  | ≥150 tests, Playwright replay, nightly sandbox run                                                                                                                                                                        | 50+ tests                                                                                                    | ≥150 tests, and every invariant gets a named property test                                                   |

**Grafts and changes.** Each one shows up in the sections below.
- **G1. One PayPal toolkit execution path.** Tool schemas come from the toolkit's `/openai` export. Both agent and deterministic calls execute through `/mcp`'s `PayPalAPI`, using our single-flight token. Nothing uses `/ai-sdk`, `ai` or `handleToolCall`.
- **G2. Transactional outbox.** A task is enqueued in the same transaction as the state change that requires it. A dispatcher hands it to an executor:
  - production: Render Workflows, so the sponsor sees runs and retries;
  - CI and local: inline;
  - production fallback: inline, automatically, if dispatch fails.
- **G3. The money model is fixed.** The brand funds an envelope approved by the co-op's General Assembly (GA). Code computes the invoice quote from that envelope before any slip is read. After funding, the engine splits the envelope across members. Service-first had the invoice deep-equal member lines that did not exist yet.
- **G4. Commodity.** A cacao co-op in Davao, Cebuano-speaking. EUDR is worded as "supports plot-level traceability". Coconut is dropped.
- **G5. Printed slip template.** Slips carry a serial number and numbered rows, so provenance crops are deterministic. Claude's bounding boxes are treated as UI-grade only.
- **G6. Judge personas use our own frame tokens.** Better Auth serves only real accounts.
- **G7. Mobile.** Clerk, board and member roles on Expo SDK 58 Android dev builds. The web export runs as phone frames for judges. iOS proof is P2.
- **G8. New line.** Retire "PayPal moves the money", which CoTreasury and Supplora already use. Lead with "Every peso, traced to the pencil mark." The name always appears as "Fair Split · co-op payroll".
- **G9. Sponsors.** AG Grid Community is mandatory (it is the Split Review). The AG Studio proof page is its own cuttable workstream: spike Oct 25, go/no-go Nov 1. APIMatic is always on.
- **G10. Visual system.** Dark ink background with one signature colour, ube violet. No cream, serif, stamps, green/gold or raw enums. Drop Rive, Fraunces and xstate.

## 0. Shape and invariants

There are four deployables on one pure domain core.
1. **`fs-api`** is the only door. It serves the web console, the Expo app (native and web export) and PayPal webhooks.
2. **`fs-tasks`** runs everything slow or irreversible as idempotent task functions dispatched from the outbox.
3. **`fs-cron`** handles schedules.
4. **`fs-db`** holds all state.

`@fs/domain` computes lines, holds, digests and state transitions with no IO. The append-only `run_events` table is the realtime feed, the audit timeline and the replay source.

Internal invariant line (this is not the tagline): _the model reads paper; code computes; humans approve; PayPal executes._

| #   | Invariant                                                                           | Mechanism                                                                                                                               | Named test                         |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| I1  | The model never writes a number into a line, invoice item, payout item or statement | Schemas have no amount fields; the invoice guard deep-equals the code quote; statements use placeholders                                | `inv.i1.no-model-numbers`          |
| I2  | Rules are frozen before facts                                                       | Rate card and GA resolution are JCS-canonicalized and sha256-hashed; a trigger forbids UPDATE; no slip is accepted before `ratified_at` | `inv.i2.rules-before-facts`        |
| I3  | Money is conserved                                                                  | distribution = Σ net on-rail + Σ net off-rail + Σ deductions retained + Σ held/excluded carried, all in integer minor units             | `inv.i3.conservation` (fast-check) |
| I4  | The approved digest is the payout                                                   | Lines are re-hashed from the DB immediately before POST; a mismatch is refused                                                          | `inv.i4.digest-is-payout`          |
| I5  | State only moves forward                                                            | Rank-monotonic state machines; `UPDATE … WHERE state=$expected`                                                                         | `inv.i5.forward-only`              |
| I6  | A human approves the irreversible step                                              | Treasurer always; an Ed25519 board co-signature above the threshold                                                                     | `inv.i6.human-gate`                |
| I7  | Every effect is enqueued in the transaction that requires it, and is idempotent     | `task_outbox` plus optimistic transitions                                                                                               | `inv.i7.outbox`                    |
| I8  | Nothing simulated goes unlabelled                                                   | Every row carries `provenance: live \| replay \| simulated_rail \| seeded`, rendered as a label                                         | `inv.i8.labels`                    |

**Money model (G3).** Before the season:
- The GA approves a distribution (e.g. a Fairtrade Premium allocation or a second payment) and a formula: a pro-rata share by eligible net kg × grade multiplier, minus ratified deductions.
- The board ratifies the rate card containing that formula and deductions, and it is hashed.

At pay time:
- Code computes the invoice quote: distribution + payout-fee reserve + audit fee.
- The agent drafts the invoice and the brand pays it.
- The verified PAID event starts extraction, the engine splits the envelope, the treasurer approves and Payouts posts.
- Off-rail shares stay in the co-op's PayPal balance, are withdrawn, and are paid in cash at the station with a clerk attestation, all on the same statement.

We never claim certification, an individual entitlement to the Premium, or EUDR compliance.

## 1. Repo layout (Turborepo + pnpm)

```
fair-split/            MIT · public from commit 1
├─ apps/
│  ├─ api/             Hono: /v1 (typed RPC + OpenAPI), SSE, /webhooks/paypal, auth, outbox dispatcher; serves console + /m
│  ├─ console/         Vite 8 SPA: treasurer (hero), brand, /ops, Judge shell with phone frames
│  ├─ mobile/          Expo SDK 58: clerk / board / member; web export → /m
│  └─ tasks/           Workflows entry (registers every TaskName) + cron.ts
├─ packages/
│  ├─ contracts/       zod 4 DTOs, routes, RunEvent union, TaskName registry, error codes, enum→label maps (leaf)
│  ├─ domain/          pure: money, FX, envelope split, canon/hash, engine, holds, state machines, policy lattice, digests
│  ├─ db/              Drizzle schema + migrations, WorkspaceScope repos, event log, ledger chain, limiter
│  ├─ tasks/           enqueue(tx,…), dispatcher, executors (workflow | inline | worker), backoff
│  ├─ paypal-core/     OAuth single-flight, PayPalHttp, webhook self-verify, event→status map        (zod 3.25.76)
│  ├─ paypal-payouts/  PR #107-shaped Tool: parameters / prompts / functions / tools               (zod 3.25.76)
│  ├─ paypal-toolkit/  the only importer of @paypal/agent-toolkit: allowlist, schemas, tk() runner (zod 3.25.76)
│  ├─ ai/              ClaudeGateway, extraction, rate-card reader, audit agent, explainer
│  ├─ proof-studio/    W13 only: AG Studio widgets + Claude AgLlmAdapter (deleted on a Nov 1 no-go)
│  ├─ eval/ api-client/ seal/ tokens/ ui-web/ ui-native/ i18n/
│  └─ test-kit/        generated msw handlers, recorded fixtures, webhook test CA, seed snapshot, factories
└─ tools/ (tsx: setup-webhooks, bulk-accounts, seed, tts, verify, verify-proof) · render.yaml · eas.json · AGENTS.md · docs/
```

**Dependency rule** (enforced by dependency-cruiser in CI): `contracts ← domain ← db ← tasks ← {paypal-*, ai} ← {api, apps/tasks}`.
- UI packages import only `contracts`, `api-client`, `tokens`, `seal` and `i18n`.
- `domain` has no IO.
- Exports maps forbid deep imports.
- The `paypal-*` packages pin zod 3.25.76, which keeps them toolkit-compatible and lets the Payouts tool drop into upstream. Everything else uses zod 4.6.7.
- Only plain data and JSON Schema cross the zod boundary, never schema objects.

**Workstreams.** Each package has one owner, listed in `docs/ownership.md`.

| WS  | Owns                                      | Green by Oct 29 (minimum lovable demo, MLD)                                            |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------- |
| W1  | contracts, domain                         | Contracts frozen Oct 24; engine, envelope split and state machines with property tests |
| W2  | db, tasks                                 | Schema, ledger chain, outbox with inline executor, Postgres limiter                    |
| W3  | paypal-core, webhook route                | OAuth cache, PayPalHttp, self-verify, setup-webhooks                                   |
| W4  | paypal-payouts, paypal-toolkit            | Invoice create → send → rule → record payment; batch POST with adopt-on-exists         |
| W5  | ai/extraction, eval                       | Reads A/B and agreement scoring on 10 slips; replay cache                              |
| W6  | ai/agent, explainer                       | Tool runner behind the policy lattice; placeholder statements                          |
| W7  | api, auth, judge                          | Routes, SSE, Judge workspace clone, frame tokens                                       |
| W8  | apps/tasks, cron, render.yaml             | Workflows executor, judgeReset, reconcile                                              |
| W9  | console                                   | Treasurer flow, Split Review grid, /ops                                                |
| W10 | mobile                                    | Capture → outbox; member statement; board co-sign                                      |
| W11 | tokens, ui-web, ui-native, seal, i18n     | Token pipeline, seal function, motion primitives                                       |
| W12 | CI, test-kit, docs, Postman, APIMatic doc | ci.yml green; generated mocks; README skeleton                                         |
| W13 | proof-studio (gated)                      | Oct 25 spike verdict only                                                              |

**Contract artefacts frozen Oct 24** (changed only by an ADR PR the human approves):
- the `contracts` package;
- the TaskName registry (name → args schema → idempotency key);
- the RunEvent catalogue;
- the seed snapshot (`test-kit/seed`, a 212-member showcase season), so every UI workstream renders realistic data from day 2.

CI generates `/openapi.json` (Scalar at `/docs`), the msw handlers and the Postman collection from `contracts`.

**Operating rules for subagents:**
- one worktree and branch per workstream;
- a PR may touch only owned paths (a CI path check reads `ownership.md`);
- every PR carries tests;
- `AGENTS.md` lists the exact pins and a never-bump list;
- CI runs `--frozen-lockfile`, `npx expo install --check` and dependency-cruiser;
- the human reviews and merges daily.

**Milestones:**
- Oct 23-24: spikes S1-S9 (§19), then the contracts freeze.
- Oct 25: AG Studio spike.
- Oct 29: MLD. The hosted loop runs end to end, Judge Mode posts its batch and resets, and the approval and statement screens work.
- Oct 30: smoke test of the release APK.
- Nov 1: AG Studio go/no-go and trial-key request.
- Nov 5: Devpost draft submitted for the eligibility pre-check; sandbox evidence posted on PR #107.
- Nov 6: feature freeze.
- Nov 7-10: polish, video, README.
- Nov 11: clean-clone verify, then submit.

**Human-only steps:**
- create sandbox accounts and bulk-upload payees;
- create the dev and judge REST apps;
- set up Firebase/FCM and EAS credentials;
- enter Render secrets;
- get the AG Studio key;
- hand-write 10 slips and review the eval labels;
- run pilot outreach;
- record the video narration.

**Experience contract (W11), consumed by every UI workstream:**
- **Tokens.** `tokens.ts` holds OKLCH colours, space, radii, a type scale and spring presets. It generates `theme.web.css`, `theme.native.css` and `tokens.native.ts` (hex). The AG Grid theme params read the same `var(--fs-*)`.
- **Palette.** Dark ink base and one signature colour, ube violet, used for the primary action and focus. Status is always shown as icon + word + colour, never colour alone. Light "paper" mode is reserved for clerks outdoors.
- **Type and motion.** Inter variable with tabular numerals, plus JetBrains Mono for hashes. One spring set drives Motion on web and Reanimated on native. Reduce Motion is honoured. Lottie files are shared across platforms.
- **Four signature moments, each with one owner:**
  - the _two-reader lock_ (W9): a field locks when both reads agree;
  - the _provenance zoom_ (W9/W10): tap any peso to zoom to its pencil mark;
  - the _Batch Seal_ (W11): a guilloché pattern derived from the hash, stamped on approval and identical on every surface;
  - the _payout constellation_ (W9, R3F lazy-loaded): 212 dots, each labelled by provenance, under a counter reading "on-rail 8 · off-rail 204".
- **Copy and states.** No raw enums (`contracts` ships label maps in en, tl and ceb). Every list designs its empty, loading, error, declined and webhook-pending states. Approve has a keyboard path and visible focus.

## 2. Runtime services on Render

| Service    | Type / plan                | Responsibility                                                                                                                                                                         |
| ---------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fs-api`   | web, Starter, always on    | API, SSE, webhooks, auth, outbox dispatcher, static console and `/m`, all from one origin (SameSite=Lax cookies, no CORS); `/healthz`, `/readyz`                                       |
| `fs-tasks` | workflow                   | Every TaskName: `extract`, `readRateCard`, `processWebhook`, `postPayoutBatch`, `settleBatch`, `agentTurn`, `explain`, `reconcile`, `judgeReset`, `warmCaches`. Arguments are ids only |
| `fs-cron`  | cron, hourly at :07        | Enqueues `judgeReset`; nightly `reconcile` and `warmCaches`                                                                                                                            |
| `fs-db`    | Postgres basic-256mb, paid | All state, including slip bytes. The free tier would expire before Dec 1                                                                                                               |

**Execution model (G2).**
1. `enqueue(tx, name, args, dedupeKey)` inserts a `task_outbox` row, and `pg_notify` fires on commit.
2. The dispatcher in `fs-api` claims rows with `FOR UPDATE SKIP LOCKED` and calls `startTask('fs-tasks/<name>', [id])`.
3. If `startTask` throws, or the task has not reported `running` within 20 s, the dispatcher runs the same function inline (concurrency 2).
4. Tasks load state by id and transition optimistically, so running a task twice is a no-op.
5. A sweeper re-dispatches rows that have been `dispatched` for more than 5 minutes without finishing.

CI and local use `executor=inline`. If spike S6 fails, one env var swaps `workflow` for `worker`, which is a Render background worker running the same loop.

**Request path:**
1. Client → `fs-api`, which authenticates, validates and commits the command, a `run_event` and an outbox row.
2. The task does the PayPal and Claude IO.
3. One transaction writes the state, `run_events`, `ledger_entries` and the notify.
4. The `fs-api` LISTEN connection picks up the notify and pushes it over SSE.

Every service sends PayPal traffic from the same regional egress IP, so the PayPal limiter lives in Postgres.

## 3. Data model

**Conventions:**
- every table has `workspace_id`;
- money is `bigint` minor units plus `char(3)`;
- ids are UUIDv7;
- repositories require a `WorkspaceScope` derived from the session, never from the request body.

**Tenancy and identity:**
- `workspaces(kind showcase|judge|real, seeded_from, expires_at)`
- Better Auth tables
- `memberships(user, ws, role brand|treasurer|board|clerk|member|judge)`, UNIQUE
- `frame_tokens(hash, ws, persona, expires_at)`
- `device_keys(user, ed25519_pub, platform, biometric_class, revoked_at)`
- `push_tokens`
- `pairing_tokens(token_hash, role, expires_at, used_at)`

**Co-op and rules:**
- `coops(name, region, commodity='cacao')`
- `members(member_no, display_name, lang tl|ceb|en, plot_ha, paypal_email NULL, rail GENERATED)`
- `seasons(code, opens_on, closes_on, threshold_minor)`
- `ga_resolutions(season, distribution_minor PHP, formula jsonb, doc_sha, ratified_at)`
- `rate_cards(season UNIQUE, canonical_json, rate_card_hash UNIQUE, ratified_at)`
- `rate_rules(rule_id, kind SHARE|DEDUCTION, category, basis PER_KG|PCT_OF_GROSS|FLAT_PER_DELIVERY|FLAT_PER_SEASON, value, grade_bp, source_page, source_bbox, source_quote)`
- `ratifications(user, signature)`

Triggers reject UPDATE/DELETE after ratification and reject `slip_rows` inserted before `ratified_at` (I2).

**Evidence:**
- `documents(kind slip_photo|rate_card_pdf|ga_minutes, sha256, phash, bytes, capture_id UNIQUE NULL, template_serial)`
- `extraction_reads(variant A|B|ZOOM, model, model_served, effort, prompt_v, schema_v, cache_key UNIQUE, raw_content, stop_reason, cost_micros)`
- `slip_rows(serial, row_no, member_id, date, net_grams, grade, confidence, state AUTO_ACCEPTED|NEEDS_HUMAN|CONFIRMED|REJECTED, crop_rect)`
- `slip_fields(read_a, read_b, zoom, legibility, final_value, decided_by)`
- `deduction_marks(text_verbatim, rule_id NULL, written_minor)`

**Runs:**
- `pay_runs(run_nonce UNIQUE, state, distribution_minor, fee_reserve_minor, audit_fee_minor, fx_num, fx_den, fx_source, quote_digest, ledger_digest, sender_batch_id UNIQUE, version)`, with a CHECK that a digest exists at or beyond POSTING
- `invoices(run UNIQUE, paypal_invoice_id UNIQUE, invoice_number UNIQUE, status, amount_minor, due_minor, recipient_view_url)`
- `member_lines(run, member UNIQUE, state, share_minor, deductions jsonb, net_minor, payout_usd_minor NULL, rail, line_hash, provenance)`
- `holds(kind, evidence, raised_by, resolved_by, resolution)`
- `approvals(run, role UNIQUE, digest, signature, key_id)`

**PayPal mirror:**
- `payout_batches(sender_batch_id UNIQUE, paypal_batch_id UNIQUE NULL, request_id, status)`
- `payout_items(sender_item_id UNIQUE, payout_item_id UNIQUE NULL, receiver, amount_minor, transaction_status, status_rank, errors, fee_minor, supersedes_item_id)`
- `webhook_events(paypal_event_id UNIQUE, event_type, resource_key, verified self|postback|dev_mock, raw, status received|applied|orphan|rejected)`
- `paypal_calls(at, purpose, path, status, debug_id, request_id, ms)`, which doubles as the limiter window
- `reconciliation_reports`

**Infrastructure:**
- `task_outbox(name, args, dedupe_key UNIQUE, state queued|dispatched|running|done|dead, attempts, run_after, executor, last_error)`
- `run_events(id bigserial, run_id, type, payload, at)`; the app role has no UPDATE/DELETE grant
- `ledger_entries(ws, seq, kind, actor_kind human|agent|system|paypal, actor_id, impersonated_by, payload, prev_hash, entry_hash)` and `ledger_heads`
- `agent_sessions(raw_messages)`, append-only
- `llm_calls(cache_key UNIQUE, replay_timeline)`
- `idempotency_keys`
- `system_flags`

## 4. State machines

Both machines are pure tables in `@fs/domain/fsm`: `(state, event) → state | Reject`, with numeric ranks. Persistence uses `UPDATE … SET state=$next, version=version+1 WHERE id=$id AND state=$expected`.

**Pay run**
```
DRAFT ─envelope quote─▶ QUOTED ─invoice created+sent─▶ INVOICED ─GET: PAID|MARKED_AS_PAID ∧ due=0.00─▶ FUNDED
FUNDED ─▶ EXTRACTING ─rows settled─▶ COMPUTED ─▶ IN_REVIEW ─treasurer signs digest─▶ TREASURER_APPROVED
TREASURER_APPROVED ─total ≤ threshold─▶ APPROVED │ > threshold ─▶ AWAITING_BOARD ─Ed25519 co-sign─▶ APPROVED
APPROVED ─▶ POSTING ─201 | 400 already-exists (adopt)─▶ POSTED ─PAYOUTSBATCH.PROCESSING─▶ SETTLING
SETTLING ─all items terminal─▶ SETTLED │ NEEDS_FOLLOW_UP ─re-routes done─▶ SETTLED ─▶ CLOSED
exits: INVOICED→CANCELLED · POSTED→DENIED · any state < POSTING → HALTED (kill switch) · line edit ≥ TREASURER_APPROVED → IN_REVIEW (approvals voided)
```
**Guards:**
- **FUNDED** needs a fresh GET of the invoice (never the webhook body) and the unique `invoices.run_id`.
- **APPROVED** needs zero open holds on included on-rail lines. A held line can be EXCLUDED and carried to the next run, but never paid silently.
- **POSTING** needs `kill_payouts` off, both approval digests equal to the recomputed digest, and a limiter token.

In real mode, extraction runs as captures arrive. EXTRACTING reads only documents not yet read; in Judge Mode that is all of them, which is the on-camera sequence.

**Member line**
```
COMPUTED ─▶ READY │ HELD(kind) ─resolve (rule cited | reason)─▶ READY | EXCLUDED
READY ─rail OFF─▶ OFF_RAIL_DUE ─clerk attests cash─▶ OFF_RAIL_PAID
READY ─rail ON ∧ in digest─▶ LOCKED ─item row written─▶ SUBMITTED ─▶ PAYPAL_PENDING ─SUCCEEDED─▶ PAID
PAYPAL_PENDING ─UNCLAIMED─▶ UNCLAIMED ─cancel─▶ RETURNED ─new 1-item batch─▶ REROUTED ─▶ SUBMITTED…
               ├─HELD─▶ PAYPAL_HELD ├─FAILED|BLOCKED─▶ NEEDS_ACTION └─REFUNDED|REVERSED─▶ REVERSED (flagged on proof)
```
**Event names map to statuses before ranking:** SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED.

**Ranks:**

| Status              | Rank |
| ------------------- | ---- |
| PENDING             | 10   |
| ONHOLD              | 20   |
| UNCLAIMED           | 30   |
| RETURNED            | 40   |
| FAILED / BLOCKED    | 50   |
| SUCCESS             | 60   |
| REFUNDED / REVERSED | 70   |

An event applies only if its rank is higher than the current one. The single exception is UNCLAIMED→RETURNED, which only our own cancel produces.

## 5. Core domain types

```ts
// @fs/contracts (zod 4; inferred types shown)
export type Minor = bigint & { readonly __minor: unique symbol };
export type Sha256 = string & { readonly __sha: unique symbol };
export interface Money {
  minor: Minor;
  currency: "PHP" | "USD";
}
export interface Fx {
  num: bigint;
  den: bigint;
  source: string;
  at: string;
} // rational, fixed per run

export interface RateRule {
  ruleId: string;
  kind: "SHARE" | "DEDUCTION";
  category: string;
  basis: "PER_KG" | "PCT_OF_GROSS" | "FLAT_PER_DELIVERY" | "FLAT_PER_SEASON";
  value: { minorPerKg?: Minor; bp?: number; flat?: Minor; gradeBp?: Record<string, number> };
  source: { page: number; bbox: [number, number, number, number]; quote: string };
}
export interface RatifiedRateCard {
  seasonId: string;
  rules: RateRule[];
  hash: Sha256;
  ratifiedAt: string;
}

export interface EnvelopeQuote {
  runId: string;
  distribution: Money;
  feeReserve: Money;
  auditFee: Money;
  total: Money;
  fx: Fx;
  rateCardHash: Sha256;
  gaResolutionSha: Sha256;
  onRailCount: number;
  digest: Sha256;
}

export interface SlipRow {
  id: string;
  documentSha: Sha256;
  serial: string;
  rowNo: number;
  memberNo: string | null;
  netGrams: bigint;
  grade: string;
  confidence: number;
  decidedBy: "agreement" | "human";
  deductionMarks: { text: string; ruleId: string | "NO_MATCH"; writtenMinor?: Minor }[];
}
export type HoldKind =
  | "NO_RULE"
  | "DUPLICATE_SLIP"
  | "IMPLAUSIBLE_YIELD"
  | "LOW_CONFIDENCE"
  | "SUSPECTED_INJECTION"
  | "RATE_MISMATCH";
export interface MemberLine {
  runId: string;
  memberNo: string;
  rail: "ON" | "OFF";
  state: LineState;
  share: Money;
  deductions: { ruleId: string; amount: Money; slipRowId: string }[];
  net: Money;
  payout: Money | null;
  holds: Hold[];
  lineHash: Sha256;
  provenance: Provenance;
  trace: string[];
} // "share R1 × 412.0 kg A-grade · slip 14 row 3 · agreement 0.97"
export type RunEvent =
  | {
      type: "extract.field";
      docId: string;
      row: number;
      field: string;
      bbox?: number[];
      value?: string;
      locked: boolean;
    }
  | { type: "line.state" | "run.state"; id: string; from: string; to: string; cause: Cause }
  | { type: "webhook"; eventId: string; eventType: string; verified: "self" | "postback"; duplicate: boolean }
  | { type: "agent.delta"; sessionId: string; block: "text" | "thinking" | "tool"; text: string }
  | { type: "policy"; tool: string; verdict: "ALLOW" | "REQUIRE_APPROVAL" | "DENY"; reasons: string[] };

// @fs/domain (pure)
export declare function quoteEnvelope(
  ga: GaResolution,
  card: RatifiedRateCard,
  members: Member[],
  fx: Fx,
  fees: FeeTable,
): EnvelopeQuote;
export declare function computeLines(
  card: RatifiedRateCard,
  rows: SlipRow[],
  members: Member[],
  q: EnvelopeQuote,
): { lines: MemberLine[]; conservation: ConservationProof };
export declare function payoutDigest(items: PayoutItemSpec[], run: PayRun): Sha256; // JCS → sha256
export const senderBatchId = (season: string, nonce: string, d: Sha256) =>
  `fs:${season}:${nonce}:${d.slice(0, 8)}`;
export const senderItemId = (nonce: string, memberNo: string) => `${nonce}:${memberNo}`; // ≤ 63 chars
```
**Engine rules:**
- **Integer arithmetic only.** Each member's share is the PHP distribution × (eligible net grams × grade bp) ÷ Σ of the same, rounded half-even, with a largest-remainder pass so shares sum exactly. Ratified deductions apply next.
- **On-rail conversion.** On-rail nets convert to USD at the run's rational FX, with a second largest-remainder pass so that Σ items equals the funded on-rail portion.
- **Duplicates.** The union of sha256, pHash distance ≤8, serial number, member+date+weight, and the model's `duplicates[]`.
- **Implausible yield.** Season kg greater than `plot_ha` × the co-op's p95 yield.
- **Fee reserve.** On-rail items × the published fee for the receiver's country ($0.25 US; 2% capped at $20 international). Actual fees come from `payout_item_fee` and are labelled sandbox.

## 6. PayPal integration

### 6.1 Auth, HTTP, limiter

Each process keeps one `PayPalAuth` single-flight cache.
- It refreshes 5 minutes before expiry. On a 401 it invalidates the token and retries once.
- At boot it asserts that the token scope covers payouts, invoicing, reporting/search and webhooks. The result feeds the "PayPal capabilities" panel and `/readyz`.
- The server SDK's `oAuthTokenProvider` and the toolkit runner (G1) share the same cache, so token calls never eat into the 50-per-minute budget.

`PayPalHttp.request({method, path, body, requestId, purpose})` returns `{ok:true, status, body, debugId} | {ok:false, status, name, message, debugId, links, retryable}`. It does four things:
1. takes a token from the Postgres limiter (40/min across all services);
2. attaches `PayPal-Request-Id` where PayPal supports it;
3. logs `debug_id`, status and latency into `paypal_calls`;
4. on a 429, opens a 6-minute circuit that switches the UI to labelled replay.

### 6.2 Invoicing v2 via @paypal/agent-toolkit 1.11.0 (G1)

`@fs/paypal-toolkit` is the only package that imports the toolkit. It uses an exact pin, zod 3.25.76 and no npm overrides.

```ts
import { PayPalAgentToolkit as OpenAIKit } from "@paypal/agent-toolkit/openai";
import { PayPalAPI, PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
export const AGENT_ACTIONS = {
  invoices: { create: true, send: true, get: true, generateQRC: true, createConditionalRules: true },
};
export const agentToolSchemas = () =>
  // declared to Claude; lazily tokened, so no network at build
  new OpenAIKit({
    clientId: "-",
    clientSecret: "-",
    configuration: { actions: AGENT_ACTIONS, context: { sandbox: true } },
  })
    .getTools()
    .map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
const zod = schemasFrom(
  new PayPalMCPToolkit({
    accessToken: "-",
    configuration: { actions: { invoices: ALL_INVOICE_KEYS }, context: { sandbox: true } },
  }),
);
export async function tk<T>(method: ToolkitMethod, args: unknown, requestId?: string): Promise<T> {
  // agent AND deterministic path
  await limiter.take("toolkit:" + method);
  const out = JSON.parse(
    await new PayPalAPI((await auth.token()).v, { sandbox: true, request_id: requestId }).run(
      method,
      zod[method].parse(args),
    ),
  );
  if (out?.ok === false || out?.error) throw new ToolkitError(method, out); // run() never throws and drops debug_id
  return out as T;
}
```

- **Allowlist.** The agent gets `invoices.{create, send, get, generateQRC, createConditionalRules}`. `recordPayment` and `cancel` are server-only. A boot assertion and a contract test check the key set against the real 1.11.0 package, because `isToolAllowed` silently drops unknown keys.
- **Invoice fields.**
  - `invoice_number = FS-{season}-{nonce}` (≤25 chars) is the idempotency key. On a duplicate, we call `search_invoicing` and adopt the existing invoice.
  - `reference = rc:{hash16}`; the payer-visible note carries the rate-card hash.
  - `invoicer_email_address = PP_BUSINESS_EMAIL`.
  - There are three items (distribution, fee reserve, audit fee), and they must deep-equal the `EnvelopeQuote`.
- **Rule.** `AUTO_CANCEL` with `SPECIFIC_DATE`, sent with `PayPal-Request-Id: cr-{invoiceId}`. Whether a rule can be created before or after sending is decided in spike S2.
- **Paying the invoice.**
  - Video: the US sandbox brand pays `recipient_view_url` on the hosted page (status PAID, a real event).
  - Judge Mode: `record_payment_for_invoice`, labelled _simulated rail_ (status MARKED_AS_PAID).
  - The JS SDK v6 button is not used; its capture is not linked to the invoice.
- **Funding.** A run is funded only when a GET shows PAID or MARKED_AS_PAID and `due_amount.value==='0.00'`. A 60-second GET fallback covers a webhook that never arrives.

### 6.3 Typed Payouts tool (toolkit Tool shape, compatible with PR #107)

```ts
// @fs/paypal-payouts mirrors typescript/src/shared/{parameters,prompts,functions,tools}.ts (zod 3.25.76)
export const createPayoutBatchParameters = (_: Context) =>
  z.object({
    sender_batch_header: z.object({
      sender_batch_id: z.string().max(256),
      recipient_type: z.literal("EMAIL"),
      email_subject: z.string().max(255).optional(),
      note: z.string().max(1000).optional(),
    }),
    items: z
      .array(
        z.object({
          receiver: z.string().email().max(127),
          amount: z.object({ currency: z.literal("USD"), value: z.string().regex(/^\d+\.\d{2}$/) }), // `currency`, not currency_code
          sender_item_id: z.string().max(63),
          note: z.string().max(4000).optional(),
          purpose: z
            .enum([
              "GOODS",
              "SERVICES",
              "AWARDS",
              "PRIZES",
              "DONATIONS",
              "REBATES",
              "CASHBACK",
              "DISCOUNTS",
              "NON_GOODS_OR_SERVICES",
            ])
            .optional(),
        }),
      )
      .min(1)
      .max(15000),
  });
export const payoutTools: Tool[] = [
  /* create_payout_batch {payouts.create} · get_payout_batch {payouts.get}
  · get_payout_item {payouts.getItem} · cancel_unclaimed_payout_item {payouts.cancelItem} */
];
export interface PayoutsService {
  // Fair Split guard; the ONLY caller of createPayoutBatch
  executeApproved(runId: string): Promise<BatchOutcome>; // kill switch → approvals → re-hash from DB (I4) → limiter
  cancelUnclaimed(payoutItemId: string, by: Actor): Promise<"RETURNED" | "NOT_UNCLAIMED">;
  reroute(lineId: string, newReceiver: string, approval: Approval): Promise<BatchOutcome>; // new 1-item batch
}
```
**`executeApproved`:**
1. Write the batch and item rows as SUBMITTED **before** the POST.
2. POST with `PayPal-Request-Id = sha256(sender_batch_id)`.
3. On a 5xx or timeout, retry up to three times with the same id.
4. On 400 "already exists", follow the HATEOAS GET link and adopt the original batch.

The model sees only `get_payout_batch` and `get_payout_item`. Create and cancel are never agent tools, matching how #107 leaves them out of ALL_TOOLS_ENABLED.

**Upstream:**
- post sandbox evidence on #107: UNCLAIMED → cancel → RETURNED, plus the webhook mapping;
- open a separate small PR fixing the toolkit's token expiry, with a jest test;
- file the ai@4 temperature incompatibility as an issue;
- never write "merged".

### 6.4 Webhook ingestion

Dev and judge each have their own sandbox REST app and URL. `tools/setup-webhooks.ts` is idempotent: GET → POST or PATCH `event_types` → `webhooks-lookup`. It registers:
- `INVOICING.INVOICE.{PAID,CANCELLED,UPDATED,REFUNDED}`
- `PAYMENT.PAYOUTSBATCH.{PROCESSING,SUCCESS,DENIED}`
- `PAYMENT.PAYOUTS-ITEM.{SUCCEEDED,UNCLAIMED,FAILED,RETURNED,CANCELED,BLOCKED,HELD,REFUNDED}`

```
POST /webhooks/paypal
 1 raw = await c.req.text()                       // before any parse
 2 verifyPayPal(raw, headers, PP_WEBHOOK_ID)      // https cert-url on allowlisted PayPal host + /v1/notifications/certs/,
                                                  // cached cert with validTo check; RSA-SHA256 over id|time|webhookId|crc32(raw)
                                                  // literal WEBHOOK_ID accepted in dev only → 'dev_mock'
 3 tx: INSERT webhook_events ON CONFLICT (paypal_event_id) DO NOTHING
       inserted ? enqueue(tx,'processWebhook',[id]) : append run_event {webhook, duplicate:true}
 4 return 200 well inside 30 s · bad signature → 400 + 'rejected' row
```
Self-verification costs no API calls. The postback `verify-webhook-signature` call runs once per live run, splicing in the raw string, to produce the on-camera "PayPal: SUCCESS" badge.

### 6.5 Dedup and tolerance for out-of-order events

- **Dedup** is on `paypal_event_id`. The honest on-camera duplicate is a real resend through `POST /v1/notifications/webhooks-events/{id}/resend`.
- **Re-GET before transitioning.**
  - Invoice events always re-GET the invoice.
  - Non-success item events GET the item, because item webhooks carry no errors.
  - A verified SUCCEEDED applies directly.
  - One batch GET after PAYOUTSBATCH.SUCCESS reconciles everything.
- **Our keys exist before the POST**, so an item event that beats the POST response still joins.
  - Unknown keys are marked `orphan`.
  - Orphans are retried with backoff.
  - Whatever is still unmatched is left for the catch-up job.
- **Invoice id** is read as `resource.invoice?.id ?? resource.id`.
- **Catch-up after downtime** uses `GET /v1/notifications/webhooks-events?start_time=` from the last applied event.

### 6.6 Reconciliation

1. **Hot.** One batch GET on PAYOUTSBATCH.SUCCESS, or after a 60-second fallback. We never poll.
2. **UNCLAIMED sweep.** In Judge Mode, items still UNCLAIMED after 15 minutes are cancelled, which returns the sandbox money. In real mode they wait for the treasurer to re-route.
3. **Nightly.** `TransactionSearchController` from `@paypal/paypal-server-sdk` 2.5.0 (APIMatic-generated), using our auth provider.
   - It pulls T0001 payouts, T0104/T0107 fees and inflows, in windows of 31 days or less.
   - The brand sees ledger figures immediately. Numbers backed by Transaction Search are labelled "reporting lags ~3 h", and fees are labelled sandbox.

### 6.7 Idempotency map

| Operation              | Key                                                              | On replay                                                           |
| ---------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| Create invoice         | `FS-{season}-{nonce}` + UNIQUE `invoices.run_id`                 | Duplicate → `search_invoicing`, adopt                               |
| Conditional rule       | `PayPal-Request-Id: cr-{invoiceId}`                              | PayPal replays                                                      |
| Record payment (Judge) | GET first; skip if already paid                                  | PayPal offers no key                                                |
| Payout batch           | `fs:{season}:{nonce}:{digest8}` + `PayPal-Request-Id sha256(id)` | 400 already-exists → adopt via HATEOAS                              |
| Payout item            | `{nonce}:{memberNo}` UNIQUE                                      | The webhook joins without a GET                                     |
| Webhook                | `paypal_event_id` UNIQUE                                         | `DO NOTHING`                                                        |
| Tasks                  | `task_outbox.dedupe_key` + optimistic transitions                | No-op if the state already moved                                    |
| Client mutations       | `Idempotency-Key` header                                         | Stored response returned                                            |
| Mobile capture         | UUIDv7 + `Content-Digest` sha256                                 | Same id → 200 no-op; same sha under a new id → `exact_duplicate_of` |

Each Judge Mode run gets a fresh `run_nonce`, so a reset never collides with the 30-day uniqueness of `sender_batch_id`. A retry of the same approved ledger cannot produce a second batch.

## 7. AI pipeline

| Stage                   | Where                                                | Model / mode                                                                                                                         | Contract                                                                                                                                                            | Gate                                                                                                 |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Image prep              | `extract`                                            | sharp: EXIF rotate and strip, sha256, pHash, resize to `resizedSize(w,h,2576,4784)`, variant B (grey + CLAHE); Files API upload once | `file_id`                                                                                                                                                           | `oversized_image:'error'`                                                                            |
| Reads A + B             | `extract`, fan-out                                   | `claude-opus-5-5` at effort low, structured output, streamed                                                                         | `Extraction` schema: bbox first, all fields required, no amount or instruction fields                                                                               | `stop_reason==='end_turn'`, otherwise the human queue                                                |
| Agreement               | `domain`                                             | none                                                                                                                                 | 0.97 when A=B and clear · 0.88 when one is smudged · 0.60 when overwritten · 0.40 when A≠B (triggers zoom) · 0.80 when zoom agrees with one read · 0 when illegible | ≥0.85 auto-accepts; overwritten always goes to a human                                               |
| Zoom re-read            | `extract`                                            | Opus 5.5 at medium, on the template cell crop                                                                                        | field + tighter box                                                                                                                                                 | none                                                                                                 |
| Injection screen        | `extract`                                            | `claude-haiku-5-5`; a refusal counts as suspected                                                                                    | `{injection_suspected}`                                                                                                                                             | SUSPECTED_INJECTION hold carrying the crop                                                           |
| Rate card and GA reader | `readRateCard`, before the season                    | Opus 5.5 at medium, on pages we rasterize ourselves                                                                                  | rules + verbatim quotes                                                                                                                                             | Quote must appear in the text layer; value is re-parsed; the board ratifies                          |
| Deduction classifier    | `extract`                                            | `claude-sonnet-5-5` at low                                                                                                           | enum of ratified rule ids + NO_MATCH                                                                                                                                | NO_MATCH or an amount mismatch → hold                                                                |
| Audit agent             | `agentTurn`, streamed                                | Opus 5.5 at medium, adaptive thinking, tool runner (≤10 iterations), server-side fallbacks                                           | Drafts the invoice, investigates holds, `propose_resolution`, `request_payout_batch` (opens an approval only)                                                       | Policy lattice                                                                                       |
| Explainer               | `explain` (Batch API in real mode; cached for Judge) | Opus 5.5 at low; Haiku for language ID                                                                                               | Words with `{{PLACEHOLDERS}}`; code renders the numbers                                                                                                             | Reject any digit, a wrong placeholder set, or SMS > 160 GSM-7 characters                             |
| Audio                   | offline `tools/tts.ts`                               | gemini-3.8-flash-tts, free tier, dev machine only                                                                                    | 24 clips keyed sha256(text+voice+model)                                                                                                                             | Labelled synthetic                                                                                   |
| Eval                    | `packages/eval`                                      | Replay on PRs; live nightly ($3 cap, Batches API)                                                                                    | `latest.json` → tile in the product                                                                                                                                 | Row exact ≥0.85, unsafe accepts 0, injection catch 1.0, duplicate F1 ≥0.9, plus an OCR-only baseline |

**Extraction streaming.** Partial JSON streams out as `extract.field` events: the box, then the value, then `locked`. These drive the two-reader lock and the mobile scan beam. Provenance crops come from the printed template's serial and row grid (G5), so they do not depend on box accuracy.

**ClaudeGateway** is the only path to Claude. It:
- keys the replay cache on `sha256({imageSha, variant, promptV, schemaV, model, effort})`;
- records the SSE timeline;
- meters spend against a daily cap;
- honours `kill_ai_live`;
- records `model_served`.

It never sends sampling params, `budget_tokens`, `thinking.disabled` or a forced `tool_choice` to the 5.5 models. It always sets `effort` and checks `stop_reason`.

**Agent sessions** are append-only and persist the raw blocks, because the preserved-thinking check rejects edited history. All tools are declared up front. Phases are enforced by policy, never by editing the tool list.

```ts
type Verdict = 0 | 1 | 2; // ALLOW < REQUIRE_APPROVAL < DENY
export const decide = (c: ToolCall, ctx: PolicyCtx): Verdict =>
  Math.max(0, ...POLICIES.map((p) => p(c, ctx))) as Verdict;
export const POLICIES = [
  killSwitch,
  sandboxOnly,
  allowlist,
  phaseGate,
  invoiceEqualsQuote,
  invoicerIsBusinessEmail,
  recipientInBrandAllowlist,
  referenceCarriesHash,
  dueWithin30Days,
  budgetCap,
]; // adding a policy only tightens (fast-check)
```
The on-camera beat: the agent proposes an invoice whose items differ from the quote, gets `DENY · invoiceEqualsQuote`, and the timeline shows the refusal.

## 8. Realtime transport

**Write path.** Each state change commits its `run_events` row and `pg_notify('run_events','<ws>:<id>')` in one transaction. The payload is ids only (under 8,000 B) and is delivered on commit.

**Read path.**
- `fs-api` holds one direct, non-pooled postgres.js `LISTEN` connection feeding an in-memory bus.
- `streamSSE` serves `GET /v1/workspaces/:ws/events` and `/v1/runs/:id/events`. Each first replays rows with `id > Last-Event-ID`, then streams, with a `: ping` every 15 s.

**Client.** `@fs/api-client` exports one `subscribe(scope, onEvent)` built on `fetch` + `EventSourceParserStream`; native uses `expo/fetch`.
- It reconnects with backoff, sending `Last-Event-ID`.
- While the stream is down, TanStack Query polls every 5 s.
- Deploys and Render's 100-minute request cap drop streams; the replay makes those drops invisible.

**Background.** Expo push over FCM V1 carries:
- board co-sign requests (the `cosign` category, with the seal PNG rendered by sharp from SVG);
- the member's "Bayad na" on PAYOUTS-ITEM.SUCCEEDED;
- batch progress, through Android tag replacement.

The AG Grid Split Review flashes cells on `line.state` events.

## 9. Auth and roles

**Real accounts** use Better Auth 1.7.12 with `emailAndPassword`, `admin({ac, roles})`, `bearer()` and `expo()`. Roles are scoped per workspace and checked in two places: the `requireRole` middleware, and repositories whose scope comes from the session.

| Role      | Surface                            | Can                                                                                                    | Cannot                                                                 |
| --------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| brand     | console`/brand`, proof page        | Request a run, view the invoice and proof                                                              | See member PII                                                         |
| treasurer | console (hero)                     | Resolve holds by citing a rule or reason, approve the digest, re-route UNCLAIMED, flip the kill switch | Edit a ratified card, or add an "other" deduction (409 cites the hash) |
| board     | mobile                             | Ratify, co-sign with Ed25519 above the threshold                                                       | Approve alone                                                          |
| clerk     | mobile                             | Capture slips offline, attest off-rail cash                                                            | Touch amounts                                                          |
| member    | mobile or signed link `/s/{token}` | Read and listen to their own statement, flag a dispute                                                 | Anything else                                                          |
| judge     | Judge Mode                         | Act as personas in its own workspace                                                                   | Reach another workspace                                                |

**Judge personas (G6).** `/v1/judge/sessions` mints a frame token per persona: bearer, 2 hours, hash stored, scoped to one workspace. The console persona switcher and each phone frame carry their own token. Ledger entries record `actor_id = persona` and `impersonated_by = judge session`, so the timeline reads "Judge as Treasurer approved". Better Auth impersonation is never on the judge path.

**Member links** are Ed25519-signed, scoped to one line and valid for 30 days.

**Mobile pairing** uses a single-use QR (`fairsplit://pair?t=…`, 10-minute TTL, hash stored) that binds device, role and workspace. The bearer token lives in SecureStore and is also sent on SSE requests.

**Board keys** are generated on the device with `@noble/curves` and stored in SecureStore with `requireAuthentication`. The server verifies the signature over this JCS payload: `{v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role, approverId, nonce, exp}`. Web phone frames use a server-held demo key, labelled as such.

## 10. Judge Mode and the reset job

`POST /v1/judge/sessions` needs no login and is rate-limited per IP. One SQL function clones the showcase snapshot into `workspaces(kind='judge', expires_at=now()+24h)`. The judge lands on the treasurer console with the run FUNDED and slips queued.

The showcase season has 212 members:
- 16 slip photos cover the 8 hero members, including a duplicate pair and an injection slip;
- 7 of the 8 have sandbox personal accounts, and 1 uses a never-registered address;
- the other 204 lines are seeded and labelled `seeded · off-rail`.

**Replay (the default).** Claude outputs and SSE timelines replay at the recorded pace, labelled "replay of run #n (date)". PayPal rows replay from the last live run, also labelled.

**Run live.** A live run joins a single-flight lane (a Postgres advisory lock); the judge sees their queue position and ETA. One run costs about 9 limiter tokens:
1. create invoice
2. send
3. conditional rule
4. record payment
5. GET invoice
6. POST the 8-item payout
7. GET batch
8. GET the UNCLAIMED item
9. cancel it

One more postback verify produces the badge.

**Beats:**
- The negative beat is a separate 1-item batch to `payouts-simulator-receiver@paypal.com` with `ERRPYO005`. It is rejected synchronously, and we show it that way.
- The duplicate beat is a real resend.

**Guards:**
- each batch totals ≤ $120;
- at most 100 live runs a day;
- an alert fires if the sandbox balance drops below $5k.

**Real vs simulated** (this table appears both in the UI and in the README):

| Element                      | Status                                               |
| ---------------------------- | ---------------------------------------------------- |
| Invoicing, Payouts, webhooks | Real sandbox                                         |
| Brand payment                | Real (video) or simulated rail (Judge Mode)          |
| Claude reads                 | Live or replay                                       |
| Off-rail cash                | Attested, not moved by PayPal                        |
| 204 lines                    | Seeded                                               |
| Audio                        | Synthetic voice                                      |
| Slips                        | Synthetic images, plus 10 handwritten by the builder |

**`judgeReset`** runs hourly and from each workspace's own Reset button:
1. Take the live-lane lock; skip the pass if a live run is in flight.
2. Cancel UNCLAIMED items older than 15 minutes, at most 5 per pass.
3. Delete expired workspaces and re-clone, issuing fresh nonces.
4. Run health checks:
   - token scope;
   - webhook registration, re-PATCHed if it has drifted;
   - webhook catch-up;
   - AG Studio key expiry;
   - Claude budget;
   - sandbox balance.
5. Every 23 hours, make one tiny structured-output call per schema to keep the grammar cache warm.

Each pass makes at most 10 PayPal calls.

## 11. Kill switch

`system_flags` holds `kill_payouts`, `kill_paypal_live`, `kill_ai_live` and `kill_studio_agent`. The env var `FS_KILL` can also force them on.

The flags are read fresh, never cached, at four points:
1. the policy lattice;
2. `executeApproved`, immediately before the POST;
3. every task entry;
4. the Claude and Studio proxies.

A run below POSTING moves to HALTED. Batches already posted keep settling. A treasurer flip requires a fresh approval, is written to the ledger and shows a global banner. The demo beat: Approve → "Refused: kill switch on (set by Treasurer 14:02)".

## 12. Attribution ledger and hash chain

These acts each append a ledger entry:
- ratification;
- accepting a row;
- raising or resolving a hold;
- an approval or co-sign;
- a payout call;
- applying a webhook;
- a kill-switch flip;
- every agent tool call, together with its policy verdict.

There is one writer per workspace. It locks `ledger_heads` and computes `entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actor_kind, actor_id, impersonated_by, payload, at}))` in the same transaction as the state change.

The public proof page `/p/{runId}` needs no auth and shows member numbers and masked emails only. For each member it renders this chain:
1. rate-card hash
2. GA resolution hash
3. slip sha256, with the crop
4. slip row
5. `line_hash`
6. treasurer approval
7. board signature
8. payout digest
9. `sender_batch_id`
10. `payout_item_id`
11. webhook `event_id`

The browser re-verifies the chain with WebCrypto, and `pnpm verify-proof <url>` checks it from a clone. PayPal's own records anchor us twice: the invoice reference/note carries the rate-card hash, and `sender_batch_id` carries the digest prefix.

## 13. Observability

- **Logs.** pino JSON carrying `runId`, `workspaceId`, `eventId`, `paypalDebugId` and `requestId`, with secrets redacted.
- **Traces.** OpenTelemetry covers Anthropic SDK spans (built in), Hono middleware, and a manual span per PayPal call and per task. The OTLP endpoint is set by env.
- **`/ops` page.** It shows:
  - the capabilities panel;
  - the limiter gauge (calls per minute against 40) and circuit state;
  - the outbox depth and the executor in use;
  - the webhook timeline with each event's verify mode;
  - Claude spend against the cap and the replay hit rate;
  - the eval tile;
  - the last reconciliation;
  - the kill switches.
- **Health.** `/healthz` reports liveness. `/readyz` checks the DB, the LISTEN connection, token scope, webhook registration, flags and the dispatcher heartbeat.

## 14. Testing pyramid (≥150 tests; count badge in the README)

| Layer             | Tooling                                               | Covers                                                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property and unit | Vitest 5 + fast-check 4                               | I1-I8 by name; FX and largest remainder; envelope split; canonical-hash stability; state-machine and policy monotonicity; id length limits; placeholder validator; seal determinism                             |
| Recorded response | msw 3 + `test-kit`                                    | PayPal bodies (invoice, payout, ERRPYO, already-exists HATEOAS); Claude streams; webhooks re-signed with a test CA (allowlist override in tests only)                                                           |
| Contract          | Vitest                                                | Toolkit allowlist and schemas against the real 1.11.0 package; Payouts schemas against #107; toolkit JSON Schemas accepted by the Anthropic API (recorded); OpenAPI snapshot; Postman run against the local API |
| Integration       | Vitest + Postgres service                             | Webhook → outbox → task → state → SSE; duplicate and reordered events; a crash between commit and dispatch (I7); kill switch at POSTING; digest-mismatch refusal                                                |
| E2E web           | Playwright 1.64                                       | Judge Mode replay on every PR (inline executor); nightly live sandbox smoke, ≤12 calls                                                                                                                          |
| E2E mobile        | Maestro 2.11 (Android) + Playwright on the web export | Offline capture → sync; co-sign; statement with audio                                                                                                                                                           |
| Eval              | `packages/eval`                                       | 40 synthetic labelled cases + 10 handwritten; Claude against an OCR-only baseline                                                                                                                               |

## 15. CI (GitHub Actions on Ubuntu, actions pinned by SHA)

- **`ci.yml`:** frozen install → Biome → `tsc -b` → dependency-cruiser + ownership path check → `expo install --check` → unit, recorded, contract and integration tests → build → Playwright replay → test-count badge.
- **`secrets.yml`:** gitleaks over full history, plus a fixture scan for `A21AA`, `sk-ant-` and `access_token`.
- **`eval-live.yml`:** runs on dispatch, nightly, and on prompt or schema changes; uses a protected environment and a $3 cap.
- **`sandbox-smoke.yml`:** nightly from GitHub's egress, not Render's. Invoice → record payment → 1-item payout → wait for the webhook.
- **`mobile.yml`:** on tags, an EAS Android `preview` APK becomes a GitHub Release with its SHA-256, then Maestro runs.
- **`ios-sim.yml`** (P2): EAS simulator build + Maestro on `macos-26`, recording a clip.
- **Deploys:** Render with `autoDeployTrigger: checksPass`. Deploys are frozen Dec 1-15; a hotfix goes out by manual promotion.

## 16. Deployment

```yaml
envVarGroups: [
    {
      name: fs-secrets,
      envVars:
        [
          PP_CLIENT_ID,
          PP_CLIENT_SECRET,
          PP_WEBHOOK_ID,
          PP_BUSINESS_EMAIL,
          ANTHROPIC_API_KEY,
          STATEMENT_SIGNING_KEY,
          FRAME_TOKEN_KEY,
          EXPO_ACCESS_TOKEN,
          AG_STUDIO_LICENSE_KEY,
        ],
    },
  ] # sync:false
services:
  - {
      type: web,
      name: fs-api,
      runtime: node,
      plan: starter,
      healthCheckPath: /readyz,
      buildCommand: "corepack enable && pnpm i --frozen-lockfile && pnpm turbo build --filter=@fs/api... --filter=@fs/console --filter=@fs/mobile",
      preDeployCommand: "pnpm --filter @fs/db migrate",
      startCommand: "node apps/api/dist/index.js",
      maxShutdownDelaySeconds: 60,
      autoDeployTrigger: checksPass,
    }
  - { type: workflow, name: fs-tasks, runtime: node, startCommand: "node apps/tasks/dist/index.js" }
  - { type: cron, name: fs-cron, schedule: "7 * * * *", startCommand: "node apps/tasks/dist/cron.js" }
databases: [{ name: fs-db, plan: basic-256mb }] # one region; ≈ $15–20/month, kept up through Dec 15
```
Plan names and the workflow block are checked against Render's Blueprint spec in spike S6.

**Mobile builds.** `eas.json` defines four profiles: `development` (Android dev client), `preview` (internal APK), `e2e` (APK without credentials) and `ios-sim`. The inner loop is a local `npx expo run:android`. About 6 cloud builds are budgeted from EAS Free.

**How judges reach mobile:**
1. **Phone frames in the console, zero installs.** The Expo web export (`web.output:"single"`) is served at `/m`, with a frame token per frame. Native-only parts are substituted and labelled:
   - the scanner becomes sample slips;
   - the biometric becomes hold-to-sign with the demo key;
   - push becomes an in-frame banner marked "simulated".
2. **The APK** on GitHub Releases, with its SHA-256 in the README, paired through the console QR.
3. **The video**, for the native-only beats: the document scanner, haptics, FCM push and lock-screen audio.

Skia effects are gated behind `Platform.OS !== 'web'`. iOS proof is P2, and the $99 Apple program waits until P0 and P1 are green.

**Submission artefacts:**
- Hero GIF opening on the member's Android statement flipping to "Bayad na".
- Devpost tags: `vite` replaces `nextjs`.
- The prior-art table names ten entries: Supplora Pay, TipPool, PayFlow, Solar Co-op, CoTreasury, Routewell, 555 Buku, Clause-to-Cash, Tributary, SarafuPay/harambee.
- AI tools listed:
  - the Claude runtime models;
  - Claude Code;
  - OpenAI's image model via Codex CLI (synthetic slips);
  - Gemini 3.8 Flash TTS;
  - the APIMatic Context Plugin;
  - the PayPal AI-Toolkit plugin.
- The Gemini narration (a user constraint) is disclosed in the description and in an on-screen caption, and presented as the product's own voice.
- `docs/apimatic-context-plugin.md` records at least three dated fixes.

## 17. Secrets in a public repo

- **Env only.**
  - `@t3-oss/env-core` validates server env at boot.
  - Clients may read only `VITE_PUBLIC_*` and `EXPO_PUBLIC_*`.
  - CI fails if a variable whose name contains KEY, SECRET or TOKEN carries a public prefix.
  - Mobile never calls PayPal, Claude or Gemini.
- **Scanning.** GitHub push protection from the first commit; gitleaks in a lefthook pre-commit hook and in CI.
- **Git exclusions.** `.gitignore` covers `.env*` (except the example), `google-services.json`, keystores and credential JSONs.
  - The FCM service account lives only in `eas credentials`.
  - The AG Studio key lives only in Render env.
- **Fixtures** are recorded through a scrubber that turns tokens into `REDACTED` and emails into sandbox aliases, and CI re-checks them.
- **Credentials.** Dev and judge use separate sandbox REST apps.
- **Leak playbook** (`docs/security.md`): rotate first, then `git filter-repo`, then re-run gitleaks.

## 18. Windows development

- **Repo location.** Clone to `C:\fs` or a Dev Drive, never a mapped drive. Keep the pnpm store on the same volume, with `nodeLinker: hoisted`.
- **Long paths.** Set `LongPathsEnabled=1` in the registry (Windows 11 Home has no gpedit) and `git config core.longpaths true`.
- **Line endings.** `.gitattributes` holds `* text=auto eol=lf`.
- **Scripts.** All tsx, nothing bash-only. Ubuntu CI catches import-path casing bugs that NTFS hides.
- **Android toolchain.**
  - Pin CMake through `expo-build-properties` `android.cmakeVersion: "3.31.6"`, with JDK 17.
  - Use two AVDs: API 36 with Google Play (push, ML Kit) and API 34 (Maestro).
  - Run `adb reverse tcp:8081 tcp:8081` and record with scrcpy.
- **Local services.**
  - Postgres: native installer or Docker Desktop.
  - Webhooks: a Cloudflare quick tunnel registered on the dev REST app.
  - Executor: inline.
  - Blocked ports: check `netsh int ipv4 show excludedportrange tcp`.
- **Subagent tooling.** `npx @expo/agent-cli@latest agents:setup` gives subagents emulator screenshots and taps by testID.

## 19. Top risks, mitigations, and day-1 spikes

| #   | Risk                                                                             | Mitigation                                                                                                                                  |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Render's shared egress IP trips the sandbox's 50-per-minute block during judging | Postgres limiter at 40/min; single-flight live lane; no polling; 6-minute circuit that falls back to labelled replay; replay is the default |
| 2   | Extraction falls short and the AI reads as veneer                                | Spike S3 kill criterion; agreement gating; template crops; eval tile with N and an OCR-only baseline                                        |
| 3   | Toolkit incompatible with Claude 5.5                                             | G1 path; toolkit isolated in one package; fallback is raw REST validated by the toolkit's own zod schemas                                   |
| 4   | A task is lost or runs twice                                                     | Outbox in the same transaction; dedupe keys; optimistic transitions; sweeper; inline fallback                                               |
| 5   | Double payment                                                                   | Nonce + digest batch id; rows written before the POST; adopt on already-exists; I4 re-hash                                                  |
| 6   | A webhook is missing or out of order                                             | webhooks-lookup; 60-second GET fallback; re-GET before transitions; rank-monotonic state machines; catch-up                                 |
| 7   | The demo decays Dec 1-15                                                         | Paid always-on plans; deploy freeze; hourly health checks; webhook drift repair; Studio key and balance checks                              |
| 8   | Parallel subagents drift                                                         | Frozen contracts; path ownership check; exact pins and catalogs; dependency-cruiser                                                         |
| 9   | Overclaims (EUDR, Fairtrade, GCash, "live", "merged")                            | Real-vs-simulated table; MARKED_AS_PAID labelled; members receive a PayPal balance that can be withdrawn to GCash (1% fee, ₱500 minimum)    |
| 10  | Read as "Supplora for co-ops"                                                    | Ten-entry prior-art table; differences in kind: paper→rules, rules that bind the operator, three-surface proof chain, member voice          |
| 11  | The UNCLAIMED beat fails                                                         | Spike S4 tests alternative domains; otherwise show the UNCLAIMED path from a labelled recorded run                                          |
| 12  | AG Studio eats days                                                              | W13 is isolated and the Nov 1 gate is hard; on a no-go, the proof page ships as our own React components and APIMatic becomes primary       |

**Spikes, Oct 23-24**, each with a decision date:
- **S1. Sandbox setup (human).** US business account plus bulk payees; dev and judge REST apps with Transaction Search ticked; webhook registered.
- **S2. Toolkit path.** `/openai` schemas accepted by the Anthropic tool runner on Opus 5.5, and `PayPalAPI.run` with our token: create → send → rule → get → record → PAID webhook. Fallbacks: convert the `/mcp` zod schemas, or call raw REST.
- **S3. Extraction bar.** 10 slips must reach row exact ≥0.85 with 0 unsafe accepts. Box center-in-box must reach ≥95%; otherwise add PP-OCR snapping. Kill: below 0.70 on Oct 24 means switching to ShiftPay, as the memo already decided.
- **S4. Payouts.** 201 → SUCCEEDED; a never-registered email → UNCLAIMED → cancel → RETURNED; ERRPYO005 rejected synchronously.
- **S5. Hosted-page payment.** Confirm the webhook arrives; otherwise rely on the 60-second GET fallback.
- **S6. Render Workflows.** Blueprint deploy and `startTask` p50 latency. If p50 exceeds 10 s or the Blueprint fails, switch to the `worker` executor.
- **S7. Expo SDK 58 on Android.** Dev build, `scanDocumentAsync`, `expo/fetch` SSE, and Uniwind's OKLCH conversion. Fallback by Oct 25: SDK 57 plus a document-scanner plugin.
- **S8. AG Studio.** Spike Oct 25; go/no-go Nov 1.
- **S9. Better Auth with Drizzle.** Schema generation, given the CLI/core version mismatch. Fallback: a hand-written Drizzle schema for the auth tables.

---

## Final pinned stack

Exact versions everywhere. `pnpm-workspace.yaml` uses catalogs plus a React override, and `allowBuilds` covers esbuild and sharp. For native packages, `npx expo install --check` is authoritative: the lenses differ by a patch on expo-camera, expo-audio and expo-router, and Expo's own pin wins.
- **Root:**
  - node 24.22.1
  - pnpm 11.28.6 (not 12)
  - turbo 2.11.10
  - typescript 6.0.3 (not 7)
  - @biomejs/biome 2.6.2
  - tsx 4.23.15
  - tsdown 0.23.1
- **Web console:**
  - vite 8.3.5 · @vitejs/plugin-react 6.1.2
  - react / react-dom 19.3.0
  - @tanstack/react-router 1.170.45 · @tanstack/router-plugin 1.168.47 · @tanstack/react-query 5.104.5
  - tailwindcss + @tailwindcss/vite 4.3.3
  - shadcn CLI 4.22.1 (`-b base`) · @base-ui/react 1.9.0 · cn 0.5.0 · tw-animate-css 1.4.0 · sonner 2.0.8
  - motion 14.5.0 · @number-flow/react 0.6.2
  - ag-grid-community + ag-grid-react 36.2.0
  - recharts 3.10.1 · lucide-react 1.61.0
  - @react-three/fiber 9.8.2 · @react-three/drei 10.7.9 · three 0.186.1
  - @lottiefiles/dotlottie-react 0.20.0
  - Gated (W13): ag-studio + ag-studio-react 3.0.0, which pulls ag-grid-enterprise ~36.2.0
- **Native:**
  - expo 58.0.17 · react-native 0.88.0 · expo-router ~58.0.25 · react-native-web ~0.21.4
  - react-native-reanimated 4.7.1 · react-native-worklets 0.13.0 · @shopify/react-native-skia 2.14.0 · react-native-gesture-handler ~3.3.0
  - react-native-screens ~4.30.0 · react-native-safe-area-context ~5.10.1 · react-native-svg 15.16.0
  - expo-camera ~58.0.12 · expo-image ~58.0.16 · expo-audio ~58.0.10 · expo-haptics ~58.0.7 · expo-blur ~58.0.5 · expo-glass-effect ~58.0.4
  - expo-secure-store ~58.0.2 · expo-crypto ~58.0.7 · expo-localization ~58.0.5 · expo-font ~58.0.9
  - expo-notifications ~58.1.5 · expo-sqlite ~58.0.13 · expo-file-system ~58.0.10 · expo-local-authentication ~58.0.2 · expo-background-task ~58.0.11
  - @react-native-community/netinfo 12.0.1
  - lottie-react-native ~7.5.0 · uniwind 1.13.0 · lucide-react-native 1.61.0
  - @noble/curves 2.4.0
  - react-native-pulsar 1.7.0 (dev builds only; P1)
  - eas-cli 25.3.0
  - expo-dev-client, expo-build-properties and expo-image-manipulator via `expo install`
- **Server:**
  - hono 4.13.13 · @hono/node-server 2.1.5 · @hono/zod-openapi 1.6.3 · @scalar/hono-api-reference 0.12.13
  - drizzle-orm 0.45.4 · drizzle-kit 0.31.11 · postgres 3.4.9
  - better-auth + @better-auth/expo 1.7.12
  - @renderinc/sdk 1.3.0
  - pino 10.4.0 · @t3-oss/env-core 0.13.11
  - expo-server-sdk 7.2.0
- **AI:**
  - @anthropic-ai/sdk 0.137.0 (hold 1.0.0 until a smoke test)
  - sharp 0.35.5 (also renders the seal PNG from SVG)
  - partial-json 0.1.7
  - ppu-paddle-ocr 6.6.1 (only if S3's box check fails)
  - @google/genai 2.30.0 (offline `tools/tts.ts` only; never deployed)
  - Models: claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5; gemini-3.8-flash-tts offline
- **PayPal:**
  - @paypal/agent-toolkit 1.11.0
  - @paypal/paypal-server-sdk 2.5.0
  - zod 3.25.76 (paypal-* packages only)
  - context-plugins 0.12.0 (dev tool)
- **Shared:**
  - zod 4.6.7 · eventsource-parser 4.1.2 · canonicalize 5.1.0 · ts-pattern 5.9.2
  - i18next 26.5.4 · react-i18next 17.1.0
- **Test:**
  - vitest + @vitest/coverage-v8 5.0.5 · @playwright/test 1.64.1 · msw 3.0.3 · fast-check 4.10.2 · @faker-js/faker 10.6.0
  - Maestro 2.11.0 · Render CLI 2.30.0
- **CI:** actions/checkout@v7 · pnpm/action-setup@v6 · actions/setup-node@v7 · actions/upload-artifact@v7 · reactivecircus/android-emulator-runner v2.38.0, all SHA-pinned.
- **Machine:** JDK 17 · CMake 3.31.6 · scrcpy 5.0.1 · AVDs: API 36 with Google Play, and API 34.
- **No version yet:** dependency-cruiser, gitleaks, lefthook, and @opentelemetry/sdk-node + OTLP exporter. Pin exact on first install, choosing releases at least 14 days old, and record them in `docs/versions.md`.
- **Excluded on purpose:**
  - `ai` / `@ai-sdk/*`: ai@4 sends temperature 0, which the 5.5 models reject with a 400.
  - Next.js
  - NativeWind, Unistyles, MMKV 4
  - Rive, Fraunces, xstate
  - `@paypal/mcp` (stale 1.8.1)
  - zod-to-json-schema (S2 fallback only)
  - TS 7, Drizzle 1.0 RC, pnpm 12, @anthropic-ai/sdk 1.0.0
  - Render free plans
  - the JS SDK v6 invoice button
