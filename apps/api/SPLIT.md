# apps/api: how the API is split

> **Integrated (28 Oct).** `ws/api-judge`, `ws/api-runs` and `ws/api-proof` are merged into `ws/api`; every IC-01
> command is filled in and `pnpm --filter @fairsplit/api smoke` drives all of them against a booted server. The
> shell changes the slices asked for are in: the registry test tells filled-in commands from placeholders;
> OpenAPI documents a 501 only on a placeholder; `appCredentialStore(db)` (src/lib/credential-store.ts) wires
> link revocation into the shared resolver (the `isLinkRevoked` callback is now required, never defaulted); the
> run, workspace and line streams take `STREAM_READERS` (= the runs slice's `CAN.readRuns`); and the typed client
> has `judgeRoutes(api)` plus msw mocks for the judge and auth routes, parity-tested against the server
> (src/routes/client-routes.test.ts). Still open across slices: `extract` has no inline handler in fs-api, and an
> operator logout is enforced only in the browser (a server-side session epoch needs a WS-DATA table).

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

> **Quota on resume (28 Oct; the `[ws/api] SECURITY` review of e026049).** A judge post whose batch is written live
> is never replayed (I8) and never goes live without a quota slot held for its run. `beginLiveStep({ resume })`
> (money/rail.ts `railForStep`, for a written primary batch) no longer turns a quota replay into live: it posts
> under the run's held reservation, else `reserveLivePost` takes a new one under the quota lock when the quotas
> allow (same ids; it sets aside the batch's own total and is counted from then), else the post WAITS
> (`queued`, `waitingFor` the reason, `resumeWaitMs`: the circuit's 6 min, the next clock hour, 15 min for the
> other quotas), re-queued by `deferTask`; a switch, the simulator, the circuit or a full lane wait the same way.
> A live post without a reservation throws (nothing sent). The root cause: a reservation was settled `not_posted`
> by refusals after `writeSubmitted` (the kill switch read by a resumed `executeApproved`, the limiter's
> `QUEUED`, PayPalHttp's `invalid_request`, a resumed post's re-checks: digest, approvals, guards), freeing the
> slot while the rows waited. Now `settlementOf` keeps `QUEUED` open, and `settleLivePost` (under the quota lock)
> never settles `not_posted` once the run's batch is written live: the slot stays held until PayPal posts or
> denies it (rows DENIED settle `denied`). `countPosts` counts a written judge batch whose run holds no slot (rows
> an older build freed). Cancel and re-route (`railForItem`) take no reservation by design (not quota steps; a
> re-route repays an item its run's counted post already paid, under the service's C-21 and floor guard) and have
> no override. Tests: `money/quota-resume.test.ts`.
>
> **A held slot ages out with the count (28 Oct, round 2).** A reservation is counted in the rolling 24 h from when
> it was taken, so it carries a post only while it is younger than `JUDGE_QUOTA.heldSlotMaxAgeMs` (23 h: an hour's
> margin for the burst). `heldReservation` (and so `reserveLivePost`'s fast path and `holdsLivePost`'s peek) ignores
> an older one: a batch that stalled longer (a kill switch kept on, an outage the catch-up resumes) is decided like
> a new post, a NEW slot under the quota lock (same ids, its total, counted from then) or a wait, never live on the
> old slot and never a replay. The old slot is left unsettled; it is in no count and `liveSpend` takes each run once.
> Because the service checks C-21 only at the first write, such a resume on the sandbox rail must also fit C-21's 40
> live batches a day (every workspace, its own batch aside), and C-21's count (`postsInLast24h`, via
> `liveBatchesInLast24h`) counts a judge batch from its run's newest live slot as well as from its write, so a late
> post weighs on every post after it (including a co-op's own: the one shared ceiling). `countPosts`' safety net
> counts a written judge batch whose run has no slot in the window. The hourly cap still counts a slot in the clock
> hour it was taken. Tests: `judge/quota.pg.test.ts` (held-ttl, C-21), `money/quota-resume.test.ts` (S1, catch-up).

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
| `slips`                                       | RUNS  | `capture`                                                   | extraction dispatch (`extract` task)                                                                                                                   |
| `runs`                                        | RUNS  | `markPaid`, `setFlag`                                       | run reads, quote → invoice → funding, settle GETs, `ensureInvoice`/`recordPayment`/`postPayoutBatch`/`settleBatch`/`processWebhook`/`computeRun` tasks |
| `holds`                                       | RUNS  | `resolveHold`                                               |                                                                                                                                                        |
| `fields`                                      | RUNS  | `enterField`                                                |                                                                                                                                                        |
| `approvals`                                   | RUNS  | `approvalPayload`, `submitApproval`, `declineApproval`      |                                                                                                                                                        |
| `lines`                                       | RUNS  | `payCash`, `resend`                                         | `cancelUnclaimed`, `reroute` tasks                                                                                                                     |
| `season`                                      | RUNS  | none                                                        | W-TR-01..04 reads                                                                                                                                      |
| `proof`                                       | PROOF | `proof`, `proofJson`, `proofExport`                         | public Proof SSE (`/v1/proof/:runSlug/events`)                                                                                                         |
| `statements`                                  | PROOF | `createReviewRequest`                                       | statement reads, `explain` task                                                                                                                        |
| `wellknown`, `brand`, `print`, `ops`, `media` | PROOF | none                                                        | `/.well-known/fairsplit-keys.json`, brand view and CSV, 80 mm print data, `/ops`, dynamic media                                                        |
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
  transmission ids (paypal-core keeps them in memory), no `webhook_events.delivery` column.
