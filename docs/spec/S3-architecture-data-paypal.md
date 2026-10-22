## S3. Architecture, Data and PayPal Integration

_Build-ready as of 22 Oct 2026. The PayPal facts here were checked that day against four sources: PayPal's OpenAPI specs, developer.paypal.com, the `@paypal/agent-toolkit` 1.11.0 source (gitHead `a3aa963`) and PR #107. Anything that cannot be settled by reading docs and source is marked UNVERIFIED, together with the spike that will settle it. Names, IDs, states, routes and dates follow the register. Departures from it are listed at the end._

### S3.1 Shape

- **Deployment.** One TypeScript monorepo runs as four Render services on one Postgres 18 database.
- **One door.** `fs-api` serves the console SPA, the Expo web export at `/app`, `/v1` with SSE, and `/webhooks/paypal`.
- **Effects.** Every slow or irreversible effect is a `task_outbox` row, committed in the same transaction as the change that needs it. The task then runs either inline in `fs-api` or on Render Workflows (`fs-tasks`).
- **Domain.** `@fairsplit/domain` is pure: money, holds, digests and transitions, with no IO.
- **Events.** `run_events` is append-only. It is the realtime feed, the replay source and the timeline. `ledger_entries` is its hash-chained, attributed subset.

**Invariants.** Each has a named property test.
- **I1.** The model writes no number into any line, invoice, payout or statement (`inv.i1.no-model-numbers`).
- **I2.** Rules are frozen before the facts arrive: the card is JCS-hashed and protected by triggers (`inv.i2.rules-before-facts`).
- **I3.** Money is conserved to the cent (`inv.i3.conservation`).
- **I4.** The signed digest is the payout; it is re-hashed before the POST (`inv.i4.digest-is-payout`).
- **I5.** States only move forward (`inv.i5.forward-only`).
- **I6.** A person signs every irreversible step (`inv.i6.human-gate`).
- **I7.** Effects are enqueued in the same transaction and are idempotent (`inv.i7.outbox`).
- **I8.** Every row carries `provenance: live|replay|simulated_rail|seeded` (`inv.i8.labels`).

### S3.2 Monorepo

```
apps/api       @fairsplit/api      Hono: /v1, SSE, /webhooks/paypal, auth, outbox dispatcher; serves console + /app
apps/console   @fairsplit/console  Vite SPA: Judge stage, Console, Proof, /ops, /prototype
apps/mobile    @fairsplit/mobile   Expo SDK 58 (member, clerk, board); web export → /app
apps/tasks     @fairsplit/tasks    Render Workflows entry + cron.ts
packages/      contracts domain seed db outbox paypal-core paypal-toolkit paypal-payouts ai eval
               api-client tokens motion seal ui-web ui-native i18n test-kit      (@fairsplit/<dir>)
media/ video/ e2e/ tools/ docs/ postman/ assets/{fonts,glyphs}/ render.yaml eas.json AGENTS.md
```

**Dependency rule.** dependency-cruiser enforces `contracts ← domain ← {seed, db} ← outbox ← {paypal-*, ai} ← {apps/api, apps/tasks}`.
- UI code imports only `contracts`, `api-client`, `tokens`, `motion`, `seal`, `i18n` and `ui-*`.
- `api-client` re-exports the pure `@fairsplit/domain/verify` and `/format`, so the Proof page can verify in the browser.
- `exports` maps forbid deep imports.
- zod 3.25.76 is used only in `paypal-*`; everything else uses zod 4.6.7. Only plain data crosses between the two.

**Workspace config.**
- `pnpm-workspace.yaml` sets `nodeLinker: hoisted`, catalogs, React 19.3.0 overrides, `allowBuilds: {esbuild: true, sharp: true}` and `minimumReleaseAge: 1440`.
- The package manager is `pnpm@11.28.6`.
- `.node-version` is `24.22.1`.

**Pins.** Each was confirmed on npm on 22 Oct.
- **Server:** hono 4.13.13, @hono/node-server 2.1.5, @hono/zod-openapi 1.6.3, drizzle-orm 0.45.4, drizzle-kit 0.31.11, postgres 3.4.9.
- **Auth and platform:** better-auth and @better-auth/expo 1.7.12, @renderinc/sdk 1.3.0, pino 10.4.0, @t3-oss/env-core 0.13.11, expo-server-sdk 7.2.0.
- **PayPal:** @paypal/agent-toolkit 1.11.0, @paypal/paypal-server-sdk 2.5.0.
- **Shared:** canonicalize 5.1.0, eventsource-parser 4.1.2, @noble/curves 2.4.0, @anthropic-ai/sdk 0.137.0.
- **Still to pin** (newest release at least 14 days old): dependency-cruiser 18.5.0, lefthook 2.2.1, @opentelemetry/sdk-node 0.223.0, gitleaks 8.30.1.

### S3.3 Render services and execution

| Service    | Blueprint                                         | Role                                                                                                              |
| ---------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `fs-api`   | `web`, `0.5c-512mb`, one instance, always on      | API, SSE, webhooks, dispatcher, inline executor, LISTEN bus, static console, `/app`, `/media`                     |
| `fs-tasks` | `workflow`, no plan key (tasks default to `flex`) | Workflow tasks, slug `fs-tasks/<name>`                                                                            |
| `fs-cron`  | `cron` `7 * * * *`, `0.5c-512mb`                  | Hourly: `judgeReset` and `reconcile{catchup}`. Also `reconcile{nightly}` at 02:07 UTC and `warmCaches` every 23 h |
| `fs-db`    | Postgres `"18"`, `0.1c-256mb`                     | All state                                                                                                         |

**Region.** All services run in `virginia`, not the default `oregon`. Render shares outbound IPs within a region, and the sandbox throttle counts per IP, so a quieter region means fewer other tenants using up our quota. The plan IDs above are Render's current names; `starter` and `basic-256mb` are legacy. S6 confirms both the region and the plans.

**Paths.** Everything is served from one origin, which gives SameSite=Lax cookies, no CORS, and same-origin phone frames.
- `/v1/*`: the API and SSE.
- `/webhooks/paypal`.
- `/healthz`, `/readyz`, `/openapi.json`, `/docs`.
- `/app/*`: the Expo web export. It uses `web.output: "single"`, and `app.config.ts` sets `experiments.baseUrl: "/app"` for web builds.
- `/media/*`: IC-11 synthetic photos and audio, served as immutable.
- Everything else goes to the console SPA: `/judge`, `/p/:runId`, `/s/:token`, `/ops`, `/prototype`.

**Execution (IC-04).**
1. **Enqueue.** `enqueue(tx, name, args, dedupeKey)` inserts with `ON CONFLICT (dedupe_key) DO NOTHING` and sends `NOTIFY fs_outbox` on commit. Args are IDs only, because Workflows caps arguments at 4 MB.
2. **Dispatch.** The dispatcher claims rows with `FOR UPDATE SKIP LOCKED`. It then either calls `new Render().workflows.startTask('fs-tasks/<name>', [outboxId])`, which needs `RENDER_API_KEY`, or runs the task inline, two at a time.
3. **Claim.** Every handler starts with `UPDATE task_outbox SET state='running', claimed_by=$me WHERE id=$id AND state IN ('queued','dispatched') RETURNING *`. A duplicate gets no row back and exits.
4. **Fallback and recovery.**
   - If `startTask` throws, or the task is not `running` within 20 s, it runs inline.
   - A sweeper re-queues anything stuck for more than 5 minutes.
   - After 8 attempts the task is marked `dead`.
5. **Executor setting.** CI and local runs use `EXECUTOR=inline`. `EXECUTOR=worker` is the fallback if S6 fails.

| Tasks                                                                                                                            | Executor                             | Why                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `ensureInvoice`, `recordPayment`, `processWebhook`, `postPayoutBatch`, `settleBatch`, `cancelUnclaimed`, `reroute`, `pushNotify` | Inline in `fs-api`                   | Warm OAuth cache, so no per-instance token calls; money steps complete in under a second |
| `extract`, `readRateCard`, `computeRun`, `explain`, `agentTurn`                                                                  | Workflow when live; inline in replay | Heavy fan-out; Render keeps history and retries                                          |
| `reconcile`, `judgeReset`, `warmCaches`                                                                                          | Workflow, started by `fs-cron`       | Scheduled; one OAuth call per pass                                                       |

### S3.4 Data model

**Conventions.**
- Every table has `workspace_id`. The exceptions are listed under deviations.
- IDs are `uuid default uuidv7()`, native in Postgres 18.
- Money is `*_cents bigint` plus `currency char(3)`. Weights are `*_g bigint`, in grams.
- States are `text` with a CHECK constraint.
- `pay_runs.run_seq` comes from `fs_run_seq`, which is never reset. It starts at 1 for judge and prod, 100000 for dev, and 900000 + 10 × `GITHUB_RUN_NUMBER` for the nightly smoke run. All environments share one sandbox account, so these offsets keep their invoice numbers and `sender_batch_id`s from colliding.

**Roles.**
- Migrations run as `fs_owner`. The app runs as `fs_app`, with `REVOKE UPDATE, DELETE ON run_events, ledger_entries, agent_sessions`.
- Expired Judge workspaces can be deleted only by `fs_purge_workspace(ws)`. It is `SECURITY DEFINER` and refuses anything that is not an expired `judge` workspace.
- If Render's database user cannot `CREATE ROLE` (UNVERIFIED, S6), `BEFORE UPDATE OR DELETE` triggers enforce the same rule. They raise unless `fs.purge` is set, and only the purge function sets it.

**Triggers.**
- Any write to a ratified card or its rules raises `FS409 RATE_CARD_RATIFIED:<sha256>`. The API returns this as a 409 that cites the hash (MM-4).
- A `slip_rows` row dated before `ratified_at` raises `FS422 RULES_BEFORE_FACTS`.

| Group           | Tables and key columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity        | `workspaces`: kind showcase/judge/real; `seeded_from`, `claimed_at`, `expires_at`<br>Better Auth tables (S9)<br>`memberships`: `user_id` or `persona`; role brand/treasurer/board/clerk/member/judge/operator<br>`frame_tokens`: `token_sha256`, `persona`, `role`, `expires_at` (+2 h)<br>`pairing_tokens`: `token_sha256`, `code6_sha256`, `expires_at` (+10 min), `used_at`<br>`device_keys`: `key_id`, `persona`, `public_key`, kind app/web_demo, `revoked_at`<br>`push_tokens`                                                                                                                                                                                                                                    |
| Co-op and rules | `coops`<br>`members`: `member_no`, `honorific`, lang ceb/fil/en, `receiver_ref`, generated `rail`<br>`plots`: `trees`, `area_ha`, `lat`/`lon` (never public)<br>`seasons`: `cosign_batch_cents` 30000, `cosign_line_cents` 15000, `mass_balance_tol_bp` 200, `kg_per_tree_max_g` 1600<br>`lots`: `shipped_g`, `grade1_shipped_g`<br>`rate_cards`: 'BR 2026-04', `canonical_jcs`, `sha256`, `ratified_at`<br>`rate_rules`: R0–R4, integer `params`, `source_quote`<br>`ratifications`                                                                                                                                                                                                                                    |
| Evidence        | `documents`: `sha256`, `phash`, storage static/db, `bytes`, `capture_id`, `exact_duplicate_of`, `copy_color`<br>`extraction_reads`: variant A/B/ZOOM, `llm_call_id`, `model_served`, `stop_reason`<br>`slip_rows`: `serial`, `row_no`, `member_id`, `slip_date`, gross/tare/net (g), `grade`, `min_confidence`, state AUTO_ACCEPTED/NEEDS_HUMAN/CONFIRMED/REJECTED, fixture `crop_rect`<br>`slip_fields`: reads A, B and zoom; `agreement`, `final_value`, `decided_by`<br>`deduction_marks`: `text_verbatim`, `rule_id`, `written_cents` (PHP)<br>`slip_anomalies`                                                                                                                                                     |
| Runs            | `pay_runs`: `run_seq`, slug `2026A-r37`, `state`, `version`, `quote_sha256`, `rate_card_sha256`, `batch_sha256` (required from POSTING), `sender_batch_id`<br>`invoices`: `run_id`, `paypal_invoice_id` and `invoice_number`, each unique; `status`, `due_cents`, `payer_view_url`, `auto_cancel_on`, checkpoints<br>`member_lines`: `rail`, premium/bonus/credits/net cents, `deductions`, `line_sha256`, `trace`<br>`holds`: `line_id` (null when season-level), `kind`, `gate`, `state`, `engine_params`, `claude_line` (no digits), `evidence`, `resolution`<br>`approvals`: `role`, `payload_jcs`, `signature`, `key_id`, `nonce` (unique), `exp`, `voided_at`<br>`statements`, `cash_receipts`, `review_requests` |
| PayPal mirror   | `payout_batches`: `sender_batch_id`, `request_id`, `paypal_batch_id`, `batch_sha256`, kind primary/reroute, `status`<br>`payout_items`: `sender_item_id`, `payout_item_id`, `receiver`, `amount_cents`, `status`, `status_rank`, `fee_cents`, `errors`, `cancel_requested_at`, `cancel_intent`, `supersedes_item_id`<br>`webhook_events`: `paypal_event_id` (unique); verified self/postback/dev_mock/fetched; `raw` text; status received/applied/orphan/rejected<br>`paypal_calls`: `at`, `purpose`, priority live/background, `status`, `debug_id`, `request_id`, `ms`; also the limiter window<br>`reconciliation_reports`                                                                                          |
| Infrastructure  | `task_outbox`: `dedupe_key`; state queued/dispatched/running/done/dead; `executor`, `attempts`, `run_after`, `claimed_by`<br>`run_events`: bigserial `id`, `type`, actor, `impersonated_by`, `provenance`, `payload`<br>`ledger_entries`: `seq`; actor human/agent/engine/paypal/system; `prev_hash`, `entry_hash`<br>`ledger_heads`, `agent_sessions`, `llm_calls`, `idempotency_keys` (24 h), `system_flags` (per workspace)                                                                                                                                                                                                                                                                                          |

**Seed.**
- `seed.loadSnapshot` (IC-03) builds the showcase workspace and every Judge clone, tagged `provenance 'seeded'`.
- Photos are static files, so a clone copies about 3,500 rows and no image bytes.
- `canonical.test.ts` checks US$4,273.50 gross, US$4,218.17 net, 8 items totalling US$368.39, and shrink of 2.05% → 1.62%.

### S3.5 State machines

The machines live in `domain/fsm` as pure, ranked tables. Every write is `UPDATE … SET state=$next, version=version+1 WHERE id=$id AND state=$expected`. If zero rows match, reload.

**Pay run** (register, and architecture §4)

| Transition                                   | Guard                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| DRAFT → QUOTED → INVOICED                    | Card ratified; invoice created and sent; AUTO_CANCEL rule stored                               |
| INVOICED → FUNDED                            | A fresh GET shows PAID or MARKED_AS_PAID, with `due_amount.value === '0.00'`                   |
| FUNDED → EXTRACTING → COMPUTED → IN_REVIEW   | Every queued document read; conservation holds                                                 |
| IN_REVIEW → TREASURER_APPROVED               | No open BLOCKS_APPROVAL hold; the signed `batchSha256` equals the recomputed one               |
| → APPROVED (directly, or via AWAITING_BOARD) | The Chair signs if the batch is over US$300, any line is over US$150, or there is any override |
| APPROVED → POSTING                           | `kill_payouts` is off (read fresh); both digests match; a limiter token is held                |
| POSTING → POSTED → SETTLING                  | A 201 or an adopted "already exists"; then PROCESSING or the first item event                  |
| → (NEEDS_FOLLOW_UP) → SETTLED → CLOSED       | Every item terminal and handled; for CLOSED, every line terminal                               |

**Exits.**
- **CANCELLED**, from INVOICED, when a GET shows the invoice cancelled.
- **DENIED**, from POSTING through SETTLING, on a synchronous 4xx or a confirmed DENIED batch.
- **HALTED**, from TREASURER_APPROVED, AWAITING_BOARD or APPROVED, when the kill switch is on.

Editing a line at TREASURER_APPROVED or AWAITING_BOARD voids both approvals and sends the run back to IN_REVIEW.

**Member line** (states per the register).
- At APPROVED, each line moves READY → LOCKED (PayPal) or READY → OFF_RAIL_DUE (cash).
- It moves LOCKED → SUBMITTED in the transaction that writes the item rows, before the POST.
- It moves SUBMITTED → PAYPAL_PENDING on the 201.
- A new edge, SUBMITTED → NEEDS_ACTION, covers a synchronous rejection.

**Item status → line state:**

| Item status          | Line state     |
| -------------------- | -------------- |
| PENDING              | PAYPAL_PENDING |
| ONHOLD               | PAYPAL_HELD    |
| UNCLAIMED            | UNCLAIMED      |
| RETURNED             | RETURNED       |
| FAILED or BLOCKED    | NEEDS_ACTION   |
| SUCCESS              | PAID           |
| REFUNDED or REVERSED | REVERSED       |

**Item statuses** (register ranks).
- `toItemStatus` first maps event names to statuses: SUCCEEDED→SUCCESS, HELD→ONHOLD, CANCELED→RETURNED.
- A status applies only if it outranks the current one.
- RETURNED also needs `cancel_requested_at`. Without it, the event is stored and the run moves to NEEDS_FOLLOW_UP.

**Holds.**
- **Block approval:** DUPLICATE_SLIP, IMPLAUSIBLE_YIELD, LOW_CONFIDENCE on kilos, MASS_BALANCE.
- **Reserve the line:** NO_RULE, RATE_MISMATCH, SUSPECTED_INJECTION.
- **States:** OPEN → (ASKED_CHAIR) → RESOLVED or EXCLUDED.
- **MASS_BALANCE** is season-level. Only the engine raises or clears it.
- **Reserved lines** stay HELD, out of the batch, and their money is never redistributed. Approval proceeds without them.
- **Labels** come from the `contracts` label maps.

### S3.6 PayPal integration

#### S3.6.1 Accounts and scopes

**Sandbox setup** (S1, done by the user):
- One business account, which both invoices and pays out.
- Seven personal accounts for on-rail members, plus one for Lantern Bay.
- Rhea's address, which belongs to no PayPal account.
- REST apps `fs-dev` and `fs-judge`, both with Transaction Search ticked.

**Environment.** `PP_RECEIVERS` (member number → email), `PP_PAYER_EMAIL` and `PP_BUSINESS_EMAIL` live only in env, never in the repo.

**Boot check.** The token must carry `…/services/invoicing`, `…/payments/payouts` and `…/services/applications/webhooks`.
- If `…/reporting/search/read` is missing, it is reported as lagging, because it takes about 9 h to propagate.
- `…/reporting/balances/read` is optional, and whether we have it is UNVERIFIED.

#### S3.6.2 Core (IC-05)

```ts
export interface PayPalAuth {
  // one per process; PayPalHttp, tk() and the server SDK share it
  token(): Promise<{ v: string; exp: number; scopes: string[] }>; // single-flight; refresh at exp − 300 s
  invalidate(): void; // on a 401; the caller retries once
}
export type PayPalResult<T> =
  | { ok: true; status: number; body: T; debugId: string | null; ms: number }
  | {
      ok: false;
      status: number;
      name: string;
      message: string;
      details: unknown[];
      links: { href: string; rel: string; method: string }[];
      debugId: string | null;
      retryable: boolean;
      ms: number;
    };
export interface PayPalHttp {
  request<T>(r: {
    method: "GET" | "POST" | "PATCH";
    path: string;
    body?: unknown;
    requestId?: string;
    purpose: CallPurpose;
    priority: "live" | "background";
  }): Promise<PayPalResult<T>>;
}
export function verifyPayPal(
  raw: Buffer,
  h: Headers,
  webhookId: string,
  opts?: { postback?: boolean },
): Promise<"self" | "postback" | "dev_mock" | false>;
export function toItemStatus(eventType: string): ItemStatus | null;
```

**`PayPalHttp`**
- It targets `https://api-m.sandbox.paypal.com`. Boot refuses to start unless `PP_ENV=sandbox`.
- Every call takes a limiter token, times out after 15 s, and records `paypal-debug-id` in its `paypal_calls` row.
- `links` merges the top-level `links` with every `details[].link`, because Payouts puts the original batch link inside `details`.
- The server SDK gets the same token through `oAuthTokenProvider`.

**Limiter.** `limiter.take({purpose, priority})` runs under `pg_advisory_xact_lock` and counts `paypal_calls` over the last 60 s, across all services. It denies a call in three cases:
- there are already 40 calls in the window;
- there are already 20 background calls in the window;
- a 429 arrived in the last 6 minutes. This is the circuit; it is derived from the table, not stored.

A denial returns `retryAfterMs`, which the UI shows as "PayPal's sandbox is pacing us. You're next, about 40 s." While the circuit is open, PayPal steps play a labelled replay instead. Nothing polls PayPal.

#### S3.6.3 Invoicing v2 through Agent Toolkit 1.11.0

**From the 1.11.0 source.** `/mcp` exports `PayPalAPI`, `PayPalMCPToolkit` and `Tool`. Three behaviours shape the code below:
- `run()` never throws. It returns `{ok:false,status,code,message}` (capped at 200 characters, no `debug_id`) or `{error}`.
- `context.request_id` is attached to every call.
- Unknown action keys are silently ignored.

```ts
import { PayPalAgentToolkit as OpenAIKit } from "@paypal/agent-toolkit/openai";
import { PayPalAPI, PayPalMCPToolkit } from "@paypal/agent-toolkit/mcp";
export const AGENT_ACTIONS = {
  invoices: { create: true, send: true, get: true, createConditionalRules: true },
};
export const SERVER_ACTIONS = { invoices: { ...AGENT_ACTIONS.invoices, recordPayment: true, search: true } };
const zod = Object.fromEntries(
  new PayPalMCPToolkit({
    accessToken: "-",
    configuration: { actions: SERVER_ACTIONS, context: { sandbox: true } },
  })
    .getTools()
    .map((t) => [t.method, t.parameters]),
);
export const agentToolSchemas = () =>
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
export async function tk<T>(method: ToolkitMethod, args: unknown, requestId?: string): Promise<T> {
  await limiter.take({ purpose: `toolkit:${method}`, priority: callContext.get().priority });
  const api = new PayPalAPI((await auth.token()).v, {
    sandbox: true,
    ...(requestId && { request_id: requestId }),
  });
  const out = JSON.parse(await api.run(method, zod[method].parse(args)));
  if (out?.ok === false || out?.error) throw new ToolkitError(method, out);
  return out as T;
}
export type ToolkitMethod =
  | "create_invoice"
  | "send_invoice"
  | "get_invoice"
  | "create_conditional_rules_for_invoice"
  | "record_payment_for_invoice"
  | "search_invoicing";
export declare const Invoices: {
  ensureForRun(runId: string, draft?: CreateInvoiceArgs): Promise<{ invoiceId: string; adopted: boolean }>;
  recordPayment(runId: string, by: Actor): Promise<void>;
  confirmFunding(runId: string): Promise<"FUNDED" | "NOT_YET">;
};
```

**How the code above works.**
- **A fresh instance per call.** The toolkit's client caches its first token forever. Building a new instance for every call sidesteps that, and stops request IDs leaking from one call into another.
- **Recovering `debug_id`.** An interceptor on the toolkit's own axios instance (`createRequire(require.resolve('@paypal/agent-toolkit/mcp'))('axios')`) captures `debug_id`. S2 confirms this works. If it does not, `/ops` shows `debugId` as null.
- **Pinned tool sets.** A boot assertion and a contract test pin both sets: the four agent tools, plus `record_payment_for_invoice` and `search_invoicing` on the server.
- **Schema check (S2).** S2 also checks that Opus 5.5 accepts the `/openai` schemas. If it does not, convert the `/mcp` zod schemas instead.

**Create arguments.** Code builds these, and any agent draft must deep-equal them (`invoiceEqualsQuote`).

| Field                           | Value                                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `currency_code`, `invoice_date` | `USD`; today (UTC)                                                                                                   |
| `invoice_number`                | `FS-{runSlug}`, e.g. `FS-2026A-r37` (spec max 25)                                                                    |
| `reference`                     | `rc:{rateCardSha16}` (spec max 120)                                                                                  |
| `note`                          | "Season 2026-A, RC 7f3a 91c2, lot LB-PH-2026-03"                                                                     |
| `invoicer_email_address`        | `PP_BUSINESS_EMAIL`                                                                                                  |
| `primary_recipients`            | Lantern Bay Chocolate Co. (synthetic) at `PP_PAYER_EMAIL`                                                            |
| `items`                         | Quantity `'1'`, unit `AMOUNT`: Premium 2,887.50; Quality bonus 1,386.00; Disbursement costs 60.00. Total US$4,333.50 |

**`ensureInvoice{target:'SENT'}`** is checkpointed, so a retry resumes where it stopped.
1. **`create_invoice`.**
   - The 201 carries only `{rel:'self', href}`; the invoice ID is the last path segment.
   - On any failure or timeout, run `search_invoicing` by `invoice_number` and adopt the match.
   - Never parse the duplicate error; its text is UNVERIFIED.
2. **`send_invoice {send_to_recipient:false}`.**
   - Store the payer-view link.
   - `sendNeedsTreasurer` applies. In Judge Mode, starting the session counts as Analyn's approval, recorded as "Judge as Treasurer approved send".
3. **`create_conditional_rules_for_invoice`** with request ID `cr-{invoiceId}`.
   - Add AUTO_CANCEL on a SPECIFIC_DATE: today + 7 days in Judge Mode, and never later than today + 30 (`dueWithin30Days`).
   - Whether a rule can still be added after send is checked in S2.

**Funding.**
1. In Judge Mode, `recordPayment` calls `record_payment_for_invoice` with `BANK_TRANSFER`, today's date, 4333.50 USD and the note "Sandbox: marked as paid (simulated rail)".
2. It then enqueues `ensureInvoice{target:'FUNDED'}` under the key `fund:{invoiceId}:1`, due in 60 s.
3. A verified PAID webhook enqueues the same key immediately. The key is shared, so exactly one GET runs.
4. Anything other than PAID or MARKED_AS_PAID with 0.00 due returns `NOT_YET`. Only the next PAID advances the key.
5. UPDATED events are mirrored without a GET.

The S5 video take pays on the payer-view page, which produces a real PAID.

#### S3.6.4 The typed Payouts tool and `PayoutsService` (IC-06)

`packages/paypal-payouts/src/{parameters,prompts,functions,tools}.ts` mirrors PR #107, which is open and unmerged. Its schemas and prompts are vendored under Apache-2.0, keeping the header and adding a NOTICE.

```ts
import type { Tool } from "@paypal/agent-toolkit/mcp";
export const payoutTools: Tool[] = [
  // verbatim from PR #107
  {
    method: "create_payout_batch",
    name: "Create Batch Payout",
    description: createPayoutBatchPrompt({}),
    parameters: createPayoutBatchParameters({}),
    actions: { payouts: { create: true } },
  },
  // get_payout_batch {payouts.get} · get_payout_item {payouts.getItem} · cancel_unclaimed_payout_item {payouts.cancelItem}
];
export const AGENT_PAYOUT_ACTIONS = { payouts: { get: true, getItem: true } }; // create and cancel stay server-only
export type BatchOutcome =
  | { kind: "created" | "adopted"; senderBatchId: string; payoutBatchId: string; debugId: string | null }
  | {
      kind: "refused";
      code:
        | "KILL_SWITCH_ON"
        | "DIGEST_MISMATCH"
        | "APPROVALS_MISSING"
        | "SANDBOX_GUARD"
        | "QUEUED"
        | "CIRCUIT_OPEN";
    }
  | { kind: "rejected"; name: string; status: number; debugId: string | null }; // synchronous 4xx; nothing sent
export interface PayoutsService {
  executeApproved(runId: string): Promise<BatchOutcome>;
  cancelUnclaimed(
    payoutItemId: string,
    by: Actor,
    then: "cash" | "reroute",
  ): Promise<"RETURNED" | "NOT_UNCLAIMED">;
  reroute(lineId: string, newReceiver: string, approval: ApprovalRef): Promise<BatchOutcome>;
}
```

**Schema** (PR #107 matches spec 1.9).

| Field             | Limit            |
| ----------------- | ---------------- |
| `sender_batch_id` | 256 characters   |
| `receiver`        | 127 characters   |
| `sender_item_id`  | 63 characters    |
| `note`            | 4,000 characters |
- `recipient_type` goes on the header or on every item.
- `amount` is `{currency, value}`, not `currency_code`, and must be positive.
- A batch holds 1–15,000 items.

**`executeApproved`** is the only caller of create.
1. **Kill switches.** Read `kill_payouts`, `kill_paypal_live` and `FS_KILL` fresh.
2. **Digest.**
   - Map the LOCKED lines to `{senderItemId:'r37-M-014', receiver, amountCents, currency}` items and sort them.
   - Compute `batchSha256 = sha256(JCS{runId, senderBatchId, rateCardSha256, items})`.
3. **Approvals.** Each approval needs:
   - a matching `payload.batchSha256`;
   - a valid signature against `device_keys`;
   - an `exp` in the future;
   - an unused nonce.

   On any failure, return `DIGEST_MISMATCH`, void the approvals, send the run back to IN_REVIEW, and show "The batch changed after it was signed. Nothing was sent."
4. **Guards.** If any guard fails, play a labelled replay instead.
   - Every receiver is in `PP_RECEIVERS`.
   - The total is at most US$400.
   - Judge Mode posts at most 8 items.
   - There are no more than 60 live posts per 24 h.
5. **One transaction.**
   - The run moves APPROVED → POSTING.
   - Batch and item rows are written as SUBMITTED.
   - Lines move LOCKED → SUBMITTED.
   - The ledger records `payout.submitting`.
6. **POST `/v1/payments/payouts`** with `PayPal-Request-Id: sha256(sender_batch_id)`. `createPayoutBatchParameters({})` parses the body.
   - Header: `sender_batch_id` `2026A-7f3a91c2-r37`, `recipient_type` `EMAIL`, and the note "Fair Split 2026-A, batch {digest8}".
   - Items: `{receiver, amount:{currency:'USD', value:'64.45'}, sender_item_id:'r37-M-014', purpose:'GOODS'}`.
7. **Outcomes.**
   - **201.** The run goes to POSTED and the lines to PAYPAL_PENDING. Enqueue `settleBatch` for +90 s (`settle:{batchId}:1`).
   - **5xx or timeout.** Retry the same request at 1 s, 3 s and 9 s; the spec says a 5nn is safe to retry with the same `sender_batch_id`. After that, the sweeper owns it.
   - **400 `USER_BUSINESS_ERROR`** ("Batch with given sender_batch_id already exists"). GET the `details[].link` href and adopt that batch only if it matches our digest. Otherwise HALT and alert.
   - **Any other 4xx** (ERRPYO005 INSUFFICIENT_FUNDS, ERRPYO002 SENDER_EMAIL_UNCONFIRMED, 403).
     - The run goes to DENIED and the lines to NEEDS_ACTION.
     - "Post again" starts a successor run with a new runSeq and fresh keys.
     - Whether a rejected request uses up its ID is UNVERIFIED; the new runSeq makes the question moot.

**`PayPal-Request-Id`.** PR #107's sandbox probe showed that this header does not replay: the same ID sent with a new `sender_batch_id` created a second batch. The real guard is `sender_batch_id`, which PayPal keeps unique for 30 days. We still send the header, as the register requires. The PR-shaped `functions.ts` omits it.

**`cancelUnclaimed`.**
1. The item must be UNCLAIMED. Set `cancel_requested_at` and the intent.
2. `POST /v1/payments/payouts-item/{id}/cancel`.
3. On 200, the item is RETURNED. With `then: 'cash'`, the line moves to OFF_RAIL_DUE.
4. On a 400 ("Only items in Unclaimed status can be cancelled."), GET the item and return `NOT_UNCLAIMED`.

**`reroute`.**
- The line must be RETURNED.
- It needs a fresh one-item signature, plus the Chair's above the thresholds.
- It posts batch `{senderBatchId}-x{n}` with item `r{runSeq}x{n}-{memberNo}` and sets `supersedes_item_id`.
- From there it follows `executeApproved`.

#### S3.6.5 Webhooks: self-verification, dedup and ordering

**Registration.** `tools/setup-webhooks.ts --app dev|judge --url …`:
1. GETs the existing hooks.
2. POSTs the register's 15 event types, or PATCH-replaces `/url` and `/event_types` on an existing hook.
3. Creates a `webhooks-lookup`. Whether hosted-page payments need it is UNVERIFIED (S5).
4. Prints `PP_WEBHOOK_ID`.

In dev, re-run it for each new tunnel URL.

```ts
app.post("/webhooks/paypal", async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer()); // before any parse
  const v = await verifyPayPal(raw, c.req.raw.headers, env.PP_WEBHOOK_ID);
  const evt = JSON.parse(raw.toString("utf8"));
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(webhookEvents)
      .values({
        paypalEventId: v ? evt.id : `rejected:${transmissionId(c)}`,
        eventType: evt.event_type,
        verified: v || null,
        raw: raw.toString("utf8"),
        status: v ? "received" : "rejected",
      })
      .onConflictDoNothing()
      .returning({ id: webhookEvents.id });
    if (row && v) await enqueue(tx, "processWebhook", { webhookEventId: row.id }, `wh:${evt.id}`);
    if (!row && v) await appendEvent(tx, duplicateDelivery(evt.id)); // "Delivery repeated, already applied."
  });
  return c.body(null, v ? 200 : 400); // a 400 makes PayPal retry (up to 25× over 3 days)
});
```

**`verifyPayPal`** follows PayPal's documented self-verification.
- **Algorithm.** `paypal-auth-algo` must be `SHA256withRSA`.
- **Certificate.** The cert URL must be HTTPS, on `api.sandbox.paypal.com` or `api-m.sandbox.paypal.com`, under `/v1/notifications/certs/`. Live hosts are refused. The PEM is cached and its `validTo` checked.
- **Signature.** Verify `${transmissionId}|${transmissionTime}|${webhookId}|${zlib.crc32(raw)}` with `crypto.verify('RSA-SHA256')` against the base64 signature. The CRC is decimal, computed over the raw bytes.
- **Dev mocks.** Only when `PP_DEV_MOCKS=1`, which is never set on `fs-judge`, simulator events signed with the literal `WEBHOOK_ID` return `'dev_mock'`.
- **Postback.** Once per live run, on the first verified INVOICE.PAID, also call `verify-webhook-signature`. Splice the raw body in after `"webhook_event":` rather than re-serialising it. A SUCCESS sets `verified='postback'` and lights the badge.

**`processWebhook`** runs inline, in `apps/api/src/webhooks/process.ts`.
- **Resolution.**
  - Invoices resolve by `resource.invoice?.id ?? resource.id`.
  - Items resolve by `sender_item_id`, then `payout_item_id`.
  - Batches resolve by `payout_batch_id`.
  - An unknown resource is marked `orphan`, retried at 1, 5 and 30 minutes, then left to catch-up.
- **Invoice events.**
  - PAID → `ensureInvoice{FUNDED}`, under the shared key.
  - CANCELLED → GET → CANCELLED, if the run is not yet FUNDED. Whether auto-cancel emits this event is UNVERIFIED; the GET covers it either way.
  - UPDATED and REFUNDED are only mirrored. REFUNDED also flags the operator.
- **Item events.**
  - A verified SUCCEEDED applies directly.
  - Any other status triggers a fresh `GET /v1/payments/payouts-item/{id}`, because item webhooks carry no errors.
- **Batch events.**
  - PROCESSING → SETTLING.
  - SUCCESS → `settleBatch` at once, under the fallback's key. One `GET /v1/payments/payouts/{id}?page_size=100&total_required=true` then moves every item forward.
  - DENIED → GET → DENIED.
- **Duplicate beat.** After a live run's first applied SUCCEEDED, call `POST /v1/notifications/webhooks-events/{id}/resend {webhook_ids:[PP_WEBHOOK_ID]}` once.
- **Every applied event:**
  - advances state;
  - writes `run_events` (`webhook.received`, `item.updated`, `line.state`, `run.state`);
  - appends a `webhook.applied` ledger entry with actor `paypal`;
  - calls `pushNotify`, if the event is a SUCCEEDED.

**Ordering.** Item rows exist before the POST, so an item event that arrives early still joins on `sender_item_id`. Ranks make arrival order irrelevant.

**Catch-up.** Each hour, `reconcile{catchup}` GETs `/v1/notifications/webhooks-events?start_time={last applied − 10 min}&end_time={now}` and inserts any missing events as `verified='fetched'`.

#### S3.6.6 Reconciliation

1. **Hot.** One `settleBatch` GET runs on SUCCESS or at +90 s. A second runs at +10 min only if items are still open.
2. **Sweep.** In Judge Mode, items still UNCLAIMED after 15 minutes are cancelled, at most 5 per pass. In real mode, a person decides.
3. **Nightly, 02:07 UTC.** `TransactionSearchController.searchTransactions({startDate, endDate, fields:'all', pageSize:500})`, from the APIMatic-generated SDK 2.5.0, over windows of 31 days or less.
   - Items are matched to T0001 (mass payment), fees to T0104 and T0107, and invoices to inflows.
   - A MARKED_AS_PAID invoice has no PayPal transaction behind it, and the report says so.
   - Results are labelled as lagging: data runs up to 3 h behind, and scope propagation takes about 9 h.
4. **Balance.** `searchBalances({currencyCode:'USD'})` when the scope allows; otherwise a ledger estimate, labelled as such.

#### S3.6.7 A live Judge run costs 11 calls

| Call | Action                                                | Trigger          |
| ---- | ----------------------------------------------------- | ---------------- |
| 1–3  | Create the invoice, send it, add the AUTO_CANCEL rule | Session start    |
| 4    | Record the payment                                    | "Mark paid"      |
| 5    | GET the invoice                                       | PAID, or 60 s    |
| 6    | POST the batch                                        | Second key       |
| 7    | GET Rhea's item                                       | Her UNCLAIMED    |
| 8    | Cancel Rhea's item                                    | "Pay in cash"    |
| 9    | GET the batch                                         | SUCCESS, or 90 s |
| 10   | One resend                                            | Duplicate beat   |
| 11   | One postback verify                                   | Funding badge    |

OAuth calls come on top. A token lasts about 9 h, so that is about 3 calls per process per day.

#### S3.6.8 Upstream (the user posts by 5 Nov)

1. **Evidence on #107.** The PR says its cancel path "is not verified against a real UNCLAIMED item". We post sandbox evidence of UNCLAIMED → cancel → RETURNED, with the event mapping and debug IDs.
2. **A small fix PR.** `PayPalClient.getHeaders()` keeps `this._accessToken || await this.getAccessToken()` forever and ignores `expires_in`. The fix stores the expiry, refreshes 5 minutes early and retries once on a 401. It comes with a jest test; jest 29 is already configured.
3. **An issue.** `/ai-sdk` pins `ai@^4`, whose default temperature the 5.5 models reject.

None of these existed upstream on 22 Oct. Cite the URLs, and never write "merged".

### S3.7 Realtime

**Write path.** `appendEvent(tx, e)` inserts into `run_events` and calls `pg_notify('run_events', ws||':'||id)` in the same transaction. The payload is IDs only, under 8,000 bytes, and is delivered on commit.

**Server.** `fs-api` keeps one direct (non-pooled) postgres.js `sql.listen` connection, which feeds an in-memory bus. Hono `streamSSE` serves four streams:
- `/v1/workspaces/:ws/events`
- `/v1/runs/:runId/events`
- `/v1/lines/:lineId/events` (one member's line)
- `/v1/proof/:runId/events` (public, redacted to member number and status)

Each stream replays everything after `Last-Event-ID` (scoped, at most 500 events), then streams live, with a `: ping` every 15 s.

**Envelope.** `{id, ws, runId, type, at, actor:{kind,id,impersonatedBy?}, provenance, payload}`, using the IC-01 event types. Where the design says "WebSocket", read SSE (IC-08).

**Client.** `api-client.subscribe(scope, onEvent)` uses `fetch` with `EventSourceParserStream` and a bearer token. Native uses `expo/fetch` (S7).
- It reconnects with backoff from 0.5 s to 8 s, sending `Last-Event-ID`.
- While it is disconnected, TanStack Query refetches every 5 s.
- Deploys, and Render's 100-minute request cap, drop streams; the replay on reconnect hides this.

**Carbon-through.** A committed item event reaches the console, the phone frames and Proof within 100 ms at p95, measured from commit to `writeSSE` in an integration test.

**Push.** `pushNotify` sends co-sign requests and "Bayad na" via `expo-server-sdk`. The phone frames show a labelled banner instead.

**Presence.** The co-signer posts `POST /v1/presence {view}` every 10 s. This becomes a `presence` event, throttled to one per 5 s and expiring after 25 s: "Ernesto, reviewing hold 2 on his phone".

### S3.8 Auth and the Judge Mode persona switcher

Repositories take a `WorkspaceScope` derived from the credential, never from the request body.

**Real accounts** use Better Auth 1.7.12 (`emailAndPassword`, `admin({ac, roles})`, `bearer()`, `expo()`).
- Web uses cookies; mobile keeps a bearer token in SecureStore.
- `requireRole` checks `memberships`.
- Better Auth never serves Judge Mode.

| Role      | Can                                               |
| --------- | ------------------------------------------------- |
| brand     | View Proof; export                                |
| treasurer | Handle holds; sign; re-route; use the kill switch |
| board     | Ratify; co-sign                                   |
| clerk     | Capture; attest cash                              |
| member    | View their own line                               |
| judge     | Act as personas in their own workspace            |
| operator  | Use `/ops` (env-listed)                           |

**Frame tokens.** Each is `fst_` plus 32 random bytes, stored only as a sha256. It lasts 2 h and is scoped to `{workspace, persona, role, memberId}`.

| Route                                           | Effect                                                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/judge/sessions`                       | No login; at most 5 per IP per hour. Claims a pooled workspace, gives it a new runSeq, runs session start, and returns `{sessionId, workspaceId, runId, consoleToken}` for `treasurer:analyn` |
| `POST /v1/judge/sessions/:sid/frames {persona}` | Issues a token for `member:M-014`, `board:ernesto` or `clerk:jessie`. It is sent by `postMessage` once the frame posts `fs.ready`, and is never put in a URL                                  |
| `POST /v1/pairing-tokens {persona}`             | Returns `{url:'https://<origin>/app/pair#t=…', code6}`. Single use, valid 10 minutes, with the token in the URL fragment                                                                      |
| `POST /v1/pair/redeem`                          | Returns a frame token (web) or a device bearer token (APK)                                                                                                                                    |

**Persona switcher.**
- The console acts as Analyn.
- The dock tabs choose which frame is visible, and each frame keeps its own token.
- Every write records `actor_id` (the persona) and `impersonated_by` (`judge_session:{sid}`, plus `/device:{keyId}` when the judge acts from their own phone).

**Keys.** Signing uses Ed25519, via `@noble/curves`. Key IDs follow `fs-{persona}-{a|w}{n}`.
- **`a` keys** are generated in the app and kept in SecureStore behind `requireAuthentication`. The showcase Chair key is `fs-ernesto-a1`.
- **`w` keys** are generated in the browser for one session, never leave it, and are labelled "Demo key".
- **Server keys.** The server only verifies. Its only signing key is `STATEMENT_SIGNING_KEY`.

**Approvals.**
1. `GET /v1/runs/:id/approval-payload?role=` returns the register's JCS payload `{v, runId, seasonId, rateCardSha256, batchSha256, itemCount, totalCents, currency, role, approverId, nonce, exp}`.
2. The client sends `POST /v1/runs/:id/approvals {role, keyId, payload, signature}`. The server recomputes the batch hash, then checks the signature, that the nonce is unique, and that `exp` is no more than 30 minutes away.
3. Instead of signing, the Chair may call `…/decline {reason}`.

**Member links.** `/s/{token}` signs `{lineId, exp}` for 30 days. The link is read-only and scoped to that one line.

### S3.9 Judge Mode lifecycle and reset under the throttle

**Throttle budget.** The sandbox blocks an IP for 5 minutes once it exceeds 50 calls a minute.
- We cap all our traffic at 40 a minute, and background work at 20, so live judges always keep at least 20.
- A 429 opens a 6-minute circuit, longer than the block.
- A live run spends 11 calls spread over several minutes. Its biggest burst is 3 calls, at session start.

**Session flow.**
- **Pool.** `judgeReset` keeps 3 pre-cloned, unclaimed Judge workspaces. Cloning is database work only.
- **Start.**
  1. Claim a workspace with `SKIP LOCKED` and set `expires_at` to 24 h out.
  2. Assign a new runSeq.
  3. Run `ensureInvoice{SENT}` at live priority.
  - If the limiter queues the call, show the queued state with an ETA.
  - If the circuit is open, the kill switch is on, the balance is low, or the cap is hit, the PayPal lane plays a labelled replay of hero run r37 (29 Oct), with its real IDs.
- **Reset button** ("About 10 s"), at most 5 calls:
  1. Cancel any parked UNCLAIMED item (2 calls).
  2. Expire the workspace.
  3. Claim a fresh one and start again (3 calls).

**Hourly `judgeReset`.** Runs at background priority, with at most 10 PayPal calls.
1. Take `pg_try_advisory_lock`.
2. Cancel Judge items that have been UNCLAIMED for more than 15 minutes, at most 5.
3. Purge expired workspaces. Skip any with a POSTING run, or with PENDING or UNCLAIMED items.
4. Refill the pool.
5. Run health checks and write the results to `reconciliation_reports{health}`:
   - webhook registration (re-PATCH on drift);
   - token scope;
   - balance (1 call);
   - the Claude budget.

**Money guards.**
- **Volume.** At most 5 live posts per IP per day, and 60 per 24 h overall.
- **Balance.** Below US$5,000, posts switch to replay ("Sandbox balance low"). To top up, pay an `FS-TOPUP-{n}` invoice as Lantern Bay.
- **Cost per run.** A live run nets about US$341.74 out: US$368.39 posted, minus Rhea's US$26.65 returned, plus fees.
- **Fees.** Screens show PayPal's `payout_item_fee`. PR #107 saw US$0.02 on a US$1 item.

### S3.10 Idempotency

| Operation        | Key                                                      | On replay                                                           |
| ---------------- | -------------------------------------------------------- | ------------------------------------------------------------------- |
| Create invoice   | `FS-{runSlug}` + UNIQUE `run_id`                         | Search, then adopt                                                  |
| Send invoice     | `sent_at`                                                | GET on error                                                        |
| AUTO_CANCEL rule | Request ID `cr-{invoiceId}`                              | PayPal replays                                                      |
| Record payment   | `payment_recorded_at`                                    | A retry GETs first                                                  |
| Funding GET      | `fund:{invoiceId}:{n}`                                   | One GET per PAID, or the fallback                                   |
| Payout batch     | `{season}-{rc8}-r{runSeq}`; rows written before the POST | 5xx: same ID. "Exists": adopt                                       |
| Payout item      | `r{runSeq}-{memberNo}` UNIQUE                            | Webhooks join without a GET                                         |
| Cancel           | `cancel_requested_at`                                    | 400 → GET                                                           |
| Re-route         | `-x{n}` suffixes                                         | As for a batch                                                      |
| Webhook          | `paypal_event_id` UNIQUE                                 | DO NOTHING + "already applied"                                      |
| Task             | `dedupe_key` + claim                                     | No-op                                                               |
| Client POST      | `Idempotency-Key`                                        | Stored response; a different body gets 422 `IDEMPOTENCY_KEY_REUSED` |
| Capture          | UUIDv7 + `Content-Digest`                                | No-op, or `exact_duplicate_of`                                      |
| Approval         | UNIQUE `nonce` + `exp`                                   | Refused                                                             |

### S3.11 Kill switch

**Flags.** `system_flags` holds `kill_payouts`, `kill_paypal_live` and `kill_ai_live` for each workspace, so a judge can only stop their own demo. `FS_KILL=payouts,paypal_live,ai_live` forces them on everywhere.

**Where they are read.** Always fresh, never cached:
- in the `killSwitch` policy;
- in `executeApproved`, `cancelUnclaimed` and `reroute`, just before PayPal is called;
- at every task's entry point;
- in ClaudeGateway;
- in the approval route.

**Effects.**
- **`kill_payouts`:**
  - signing returns 423 `KILL_SWITCH_ON` ("Refused: kill switch on (set by Treasurer 14:02)");
  - runs at TREASURER_APPROVED, AWAITING_BOARD or APPROVED become HALTED, and their approvals are voided;
  - posted batches keep settling, but cancel and re-route are refused;
  - the slab is bolted: "Payouts paused by the co-op."
- **`kill_paypal_live`:** labelled replay in Judge Mode; refused in real mode.
- **`kill_ai_live`:** replay only.

Every flip writes to the ledger and emits `flag.changed`, which raises a banner. Turning `kill_payouts` off needs a fresh treasurer action.

### S3.12 Attribution ledger and hash chain

**What is recorded.** Each of the following appends a ledger entry, in the transaction that causes it:
- ratifications and refused edits;
- accepted rows and fields entered by hand;
- holds;
- approvals signed, declined or voided;
- PayPal writes;
- applied webhooks;
- flag flips;
- agent tool calls, with their verdicts.

**The chain.** There is one writer per workspace, which locks `ledger_heads` with `FOR UPDATE`.
- Each entry stores `entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))`.
- The genesis entry's `prev_hash` is 64 zeros.

**Proof bundle.** `GET /v1/proof/:runId` is public. It shows member numbers and masked receivers, never names (RA 10173). It contains:
- the invoice;
- the rate-card JCS and its ratifications;
- slip and line hashes;
- both approvals, each with payload, signature and public key;
- the batch, with its items, their `payout_item_id`s and the webhook event IDs;
- the ledger segment.

**Verification.** `verifyChain` checks every chain link, then the six Proof plates:
1. **Paid.** PAID or MARKED_AS_PAID, 0.00 due, and `reference` = `rc:{sha16}`.
2. **Ratified.** The card's sha256 matches, and it was ratified before the first slip.
3. **Read.** Every slip document hash is in the chain.
4. **Computed.** Line hashes recompute and are conserved against the pools.
5. **Two keys.** Both signatures verify against a single `batchSha256`.
6. **Payout items.** The items recompute to that hash, and every status rests on a verified event.

The browser's Verify button and `pnpm verify-proof <url>` share this code. PayPal's own records anchor the chain twice: through the invoice `reference`, and through `sender_batch_id`, which carries rc8 and the runSeq.

### S3.13 Secrets in a public repo

**Boot check.** `@t3-oss/env-core` validates env at boot. The server refuses to start on a missing key, or if `PP_ENV` is not `sandbox`.

**Render group `fs-secrets`** (all `sync: false`):
- **PayPal:** `PP_CLIENT_ID`, `PP_CLIENT_SECRET`, `PP_WEBHOOK_ID`, `PP_BUSINESS_EMAIL`, `PP_PAYER_EMAIL`, `PP_RECEIVERS`
- **Other:** `ANTHROPIC_API_KEY`, `RENDER_API_KEY`, `BETTER_AUTH_SECRET`, `STATEMENT_SIGNING_KEY`, `EXPO_ACCESS_TOKEN`, `FS_KILL`

`DATABASE_URL` comes from `fromDatabase`. Gemini and Codex credentials never leave the dev machine.

**Client exposure.** Clients read only `VITE_PUBLIC_*` (Vite's `envPrefix`) and `EXPO_PUBLIC_*`. CI fails if any public name contains KEY, SECRET or TOKEN. The app never calls PayPal, Claude or Gemini.

**Scanning.**
- GitHub push protection is on from the first commit.
- gitleaks runs in the lefthook pre-commit hook, and in CI over the full history.
- A fixture scan checks for `A21AA`, `sk-ant-`, `access_token` and `rnd_`.

**Hygiene.**
- `.gitignore` covers `.env*` (except `.env.example`), `google-services.json`, keystores and credential JSON.
- FCM credentials live only in `eas credentials`.
- Fixtures pass through `test-kit/scrub()`.
- Dev and Judge use separate REST apps.
- After a leak, `docs/security.md` gives the order: rotate, run `git filter-repo`, then re-scan.

### S3.14 Deployment

```yaml
envVarGroups:
  - name: fs-secrets # one {key: <NAME>, sync: false} entry per key listed in S3.13
    envVars: [{ key: PP_CLIENT_ID, sync: false }, { key: PP_CLIENT_SECRET, sync: false }] # …and the other ten
services:
  - type: web
    name: fs-api
    runtime: node
    region: virginia
    plan: 0.5c-512mb
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm turbo build --filter=@fairsplit/api... --filter=@fairsplit/console --filter=@fairsplit/mobile
    preDeployCommand: pnpm --filter @fairsplit/db migrate
    startCommand: node apps/api/dist/index.js
    healthCheckPath: /readyz
    maxShutdownDelaySeconds: 60
    autoDeployTrigger: checksPass
    buildFilter:
      { paths: [apps/**, packages/**, media/**, pnpm-lock.yaml], ignoredPaths: [video/**, docs/**] }
    envVars:
      [
        { fromGroup: fs-secrets },
        { key: DATABASE_URL, fromDatabase: { name: fs-db, property: connectionString } },
        { key: PP_ENV, value: sandbox },
        { key: EXECUTOR, value: workflow },
      ]
  - type: workflow
    name: fs-tasks
    runtime: node
    region: virginia
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm turbo build --filter=@fairsplit/tasks...
    startCommand: node apps/tasks/dist/index.js
    envVars:
      [
        { fromGroup: fs-secrets },
        { key: DATABASE_URL, fromDatabase: { name: fs-db, property: connectionString } },
        { key: PP_ENV, value: sandbox },
      ]
  - type: cron
    name: fs-cron
    runtime: node
    region: virginia
    plan: 0.5c-512mb
    schedule: "7 * * * *"
    buildCommand: corepack enable && pnpm install --frozen-lockfile && pnpm turbo build --filter=@fairsplit/tasks...
    startCommand: node apps/tasks/dist/cron.js
    envVars: [{ key: DATABASE_URL, fromDatabase: { name: fs-db, property: connectionString } }]
databases:
  - { name: fs-db, region: virginia, plan: 0.1c-256mb, postgresMajorVersion: "18" }
```

**Blueprint notes.**
- Workflows take neither `preDeployCommand` nor `plan`, so only `fs-api` migrates. Migrations are expand-then-contract.
- `fs-api` binds `0.0.0.0:$PORT`; Render's default port is 10000.
- UNVERIFIED (S6):
  - whether a workflow accepts `fromGroup`;
  - whether a workflow can reach `fs-db` over the private network (if not, use the external URL);
  - whether the `startTask` p50 is 10 s or less.
- From 1 to 15 Dec, set `autoDeployTrigger: off` and ship any hotfix manually.

**Expo and EAS.** The web export is built inside `fs-api`'s build with `EXPO_WEB_BASE=/app`. `app.config.ts` sets `experiments.baseUrl` only when that variable is set.

```json
{
  "cli": { "version": ">= 25.3.0", "appVersionSource": "remote" },
  "build": {
    "base": {
      "node": "24.22.1",
      "pnpm": "11.28.6",
      "env": { "EXPO_PUBLIC_API_ORIGIN": "https://fs-api.onrender.com" }
    },
    "development": {
      "extends": "base",
      "developmentClient": true,
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "preview": { "extends": "base", "distribution": "internal", "android": { "buildType": "apk" } },
    "e2e": { "extends": "base", "withoutCredentials": true, "android": { "buildType": "apk" } },
    "ios-sim": { "extends": "base", "ios": { "simulator": true } }
  }
}
```

- `preview` builds the signed APK for judges. `mobile.yml` publishes it to GitHub Releases, and the README gives its SHA-256.
- Budget about 6 EAS builds. The inner loop is `npx expo run:android`.
- Record the real `onrender.com` subdomain after the first deploy, because Render may add a suffix.

**Windows.**
- Work in `C:\fs`, not `Z:`, with the pnpm store on the same volume.
- Set `LongPathsEnabled=1`, `core.longpaths` and `eol=lf`.
- Run Postgres 18 locally with `EXECUTOR=inline`.
- Use a Cloudflare quick tunnel, and re-run `setup-webhooks` after each restart.
- If a port is blocked, check `netsh int ipv4 show excludedportrange tcp`.

### S3.15 Observability

**Logs.** pino writes JSON carrying `service`, `ws`, `runId`, `task`, `eventId`, `paypalDebugId`, `requestId` and `persona`. Authorization headers, tokens, `PP_*` values and raw webhook bodies over 2 KB are redacted.

**Traces.** OpenTelemetry is enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Spans:
- Hono requests;
- `paypal.call` (purpose, path, status, `debug_id`, `request_id`, `limiter_wait_ms`);
- `task.run` (name, executor, attempt);
- `webhook.verify` (mode);
- `sse.fanout` (`lag_ms`).

The Anthropic SDK adds its own spans.

**`/ops`.** The operator sees everything; a judge sees their own workspace, read-only. Panels:
- scopes;
- the limiter (against 40 and 20) and its circuit;
- outbox, executor and dispatcher heartbeat;
- the webhook timeline, with verify modes and duplicates;
- Claude spend and replay hits;
- the eval tile;
- the last reconciliation and balance;
- flags.

**Health.**
- `/healthz` means the process is up.
- `/readyz` requires all of:
  - a DB ping;
  - a LISTEN round-trip under 2 s, checked every 30 s;
  - a valid token scope;
  - a matching webhook registration, checked within the last 2 h;
  - readable flags;
  - a dispatcher heartbeat within the last 30 s.

**December targets.**
- `/readyz` stays green.
- Fan-out stays under 100 ms at p95.
- The median time from a judge's first press to the batch POST is under 60 s.
- No unverified event is applied.

### S3.16 Testing pyramid

| Layer             | Tooling                              | Target    | Covers                                                                                                                                                                            |
| ----------------- | ------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Property and unit | Vitest 5.0.5, fast-check 4.10.2      | ≥ 95      | I1–I8; largest remainder; FSM and policy monotonicity; JCS vectors; ID formats; limiter; placeholders; tampered proofs                                                            |
| Recorded response | msw 3.0.3, `test-kit`                | ≥ 30      | Invoice calls; payouts 201; "already exists"; ERRPYO002/005; 5xx; 429; cancel; webhooks re-signed by a test CA                                                                    |
| Contract          | Vitest                               | ≥ 15      | Allowlists against the real 1.11.0; PR #107 schemas; `/openai` schemas on Anthropic; OpenAPI; Postman; dependency-cruiser and ownership rules                                     |
| Integration       | Vitest, Postgres 18                  | ≥ 25      | Webhook → outbox → task → SSE; duplicate, reordered and orphan events; crash between commit and dispatch; triggers; grants; kill switch; digest mismatch; limiter; reset; fan-out |
| E2E web           | Playwright 1.64.1                    | ≥ 12      | Judge replay; two-context hero take that refuses a tampered hash; `data-moment-phase` for MM-1 to MM-7; Proof verify; axe                                                         |
| E2E mobile        | Maestro 2.11.0; Playwright on `/app` | ≥ 6       | Pairing; offline capture; co-sign; statement audio; paid flip; tap a peso                                                                                                         |
| Live sandbox      | `sandbox-smoke.yml`                  | 1 nightly | Invoice → record → one-item payout → verified SUCCEEDED, in at most 12 calls                                                                                                      |

The target is at least 184 tests by G5, and at least 100 by G3 (1 Nov). The 40-case eval is reported separately.

### S3.17 CI

| Workflow            | Trigger                           | Steps                                                                                                                                                                                               |
| ------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`            | PR, main                          | Frozen install → Biome → `tsc -b` → dependency-cruiser and ownership check → `expo install --check` → unit, recorded, contract and integration tests → build → Playwright replay → test-count badge |
| `secrets.yml`       | PR, main                          | gitleaks over the full history; fixture scan                                                                                                                                                        |
| `eval-live.yml`     | Dispatch, nightly, prompt changes | Protected environment; US$3 cap                                                                                                                                                                     |
| `sandbox-smoke.yml` | Nightly                           | GitHub egress; runSeq from 900000                                                                                                                                                                   |
| `mobile.yml`        | Tags                              | EAS `preview` APK → Release with SHA-256 → Maestro on API 34                                                                                                                                        |
| `ios-sim.yml`       | P2                                | EAS simulator build; Maestro on `macos-26`                                                                                                                                                          |

Actions are pinned by SHA. Versions as of 22 Oct: checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2, pnpm/action-setup v6.1.0 and android-emulator-runner v2.38.0. Render deploys on `checksPass`.

### Register deviations

1. **Rhea's item.**
   - The design calls it "the labelled ERRPYO002 test case". But ERRPYO002 rejects the whole POST synchronously, so it cannot park a single item.
   - We follow register §8/S4 instead: her no-account address goes UNCLAIMED → cancel → RETURNED, and the copy follows `transaction_status`.
   - ERRPYO002 and ERRPYO005 appear only in recorded tests and in an `/ops` probe, outside the 11 calls.
   - The "What's real" sheet should name the UNCLAIMED item.
2. **No polling.** C8's 5 s poll is replaced by one-shot GETs at +90 s and +10 min.
3. **Per-task executors.** Money and webhook tasks run inline; live AI and scheduled tasks run on Workflows. This refines architecture G2.
4. **`workspace_id` exceptions.**
   - `webhook_events.workspace_id` is null until the event is resolved.
   - Better Auth tables keep their own schema.
   - `llm_calls` is read across workspaces.
5. **New `verified` value:** `fetched`.
6. **HALTED** is narrowed to TREASURER_APPROVED, AWAITING_BOARD and APPROVED. A synchronous 4xx gives DENIED, plus the new line edge SUBMITTED → NEEDS_ACTION.
7. **Key IDs** use `fs-{persona}-{a|w}{n}`, which keeps `fs-ernesto-a1`. The server holds no persona keys.
8. **The UI reaches `domain`** only through `api-client`.
9. **runSeq is offset per environment.** ID formats are unchanged.
10. **`PayPal-Request-Id` is kept**, although PR #107 shows it does not replay.
11. **The batch cap is US$400**, not architecture §10's US$120, because the hero batch is US$368.39.
12. **Region and plans:** `virginia`, `0.5c-512mb` and `0.1c-256mb`, with no plan for the workflow. S6 verifies.
13. **The auto-cancel date is computed.** "30 Nov" is showcase copy only.

### Sources

**PayPal developer docs**
- https://developer.paypal.com/api/rest/webhooks/rest/
- https://developer.paypal.com/docs/api/webhooks/v1/
- https://developer.paypal.com/api/payouts/standard/test-go-live
- https://developer.paypal.com/docs/transaction-search/transaction-event-codes/

**PayPal source and specs**
- https://github.com/paypal/paypal-rest-api-specifications
- https://github.com/paypal/agent-toolkit/tree/a3aa963960caf32912691a759879a8ce7a6018b2/typescript/src
- https://github.com/paypal/agent-toolkit/pull/107
- https://github.com/paypal/PayPal-TypeScript-Server-SDK
- https://github.com/plutov/paypal/blob/v2.0.5/unit_test.go (duplicate-batch body)

**Render, Expo, pnpm, PostgreSQL**
- https://render.com/docs/blueprint-spec
- https://render.com/docs/workflows-defining
- https://render.com/docs/workflows-running
- https://docs.expo.dev/versions/latest/config/app
- https://docs.expo.dev/guides/publishing-websites/
- https://pnpm.io/settings
- https://www.postgresql.org/docs/release/18.0/
