# @fairsplit/db

Persistence for Fair Split (IC-04): the Drizzle schema for every table group in register §7, the migrations
(generated + hand-written integrity SQL), WorkspaceScope repositories, the run-event log, the attribution ledger,
the PayPal limiter, the LISTEN bus, kill switches and Idempotency-Key storage.

## Using it

```ts
import { createDb, detectAppRole, repos, workspaceScope } from "@fairsplit/db";

const url = process.env.DATABASE_URL!;
const { db, sql, close } = createDb(url, { role: await detectAppRole(url), applicationName: "fs-api" });
const scope = workspaceScope({
  workspaceId,
  actor: { kind: "human", id: "treasurer:analyn", impersonatedBy },
  via: "frame_token",
});
const r = repos(scope);

await db.transaction(async (tx) => {
  const res = await r.runs.transition(tx, {
    id: runId,
    from: "APPROVED",
    to: "POSTING",
    cause: "post",
    provenance: "live",
    patch: { batchSha256, senderBatchId },
  });
  if (!res.ok) return res; // ILLEGAL | STALE (reload `current`) | NOT_FOUND
  await r.ledger.append(tx, { kind: "payout.submitting", runId, payload: { runId, batchSha256 } });
  // enqueue(tx, "postPayoutBatch", { runId }, `post:${runId}`) from @fairsplit/outbox, same transaction (I7)
});
```

| Export                                                                         | What it does                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDb(url, {role})`, `detectAppRole(url)`                                  | postgres.js pool + Drizzle. `role: "fs_app"` makes every connection run as the restricted app role; `detectAppRole` returns it only if the login may assume it (if the database user could not create roles, the triggers alone guard history).                                 |
| `assertAppRole(db)`, `inspectAppRole(db)`, `enableAppLogin(ownerUrl, pw)`      | Boot check (S3.4): reports `login` (fs_app's own login, production), `assumed` (owner login + `role=fs_app`: stops bugs, not a compromised app) or `owner`, and refuses any connection that could rewrite history. `enableAppLogin` sends a SCRAM verifier, never the password. |
| `runMigrations(url)`, `ensureRunSeqFloor(url, n)`                              | Applies `migrations/` under an advisory lock; raises (never lowers) `fs_run_seq`. CLI: `pnpm --filter @fairsplit/db migrate` (`FS_RUN_SEQ_FLOOR` optional).                                                                                                                     |
| `workspaceScope()`, `systemScope()`                                            | The only way to build a scope. Derive it from the credential, never from a body.                                                                                                                                                                                                |
| `repos(scope)`                                                                 | Every workspace table bound to the scope (`get/require/list/insert/insertMany/update`), plus `runs.transition`, `lines.transition`, `holdStates.transition`, `items.applyStatus`, `items.requestCancel`, `approvals.void`, `events.append`, `ledger.append`, `flags.*`.         |
| `appendEvent(tx, event)`                                                       | Inserts a `run_events` row; `NOTIFY run_events '<ws>:<id>'` is delivered on commit. Per-workspace lock ⇒ ids in commit order. `toEnvelope()` gives the S3.7 SSE shape.                                                                                                          |
| `appendLedger(tx, scope, entry)`, `verifyChain(db, ws)`, `verifyEntries(rows)` | sha256 hash chain per workspace: `sha256(prev ‖ JCS{seq, kind, actorKind, actorId, impersonatedBy, payload, at})`, genesis = 64 zeros.                                                                                                                                          |
| `createLimiter(db)`                                                            | `take({purpose, priority})` → grant (with `callId`) or `{reason, retryAfterMs}`; `record(callId, {status, debugId, ms})`; `acquire()` waits; `state()` for /ops. 40/min, 20 background, 6-min circuit after a 429.                                                              |
| `createBus({url, db})`                                                         | `start()`, `subscribe({workspaceId, runId?, lineId?}, cb, {afterId?, maxReplay?, filter?})`, `ping()` for /readyz. Gap-free, catches up after reconnect.                                                                                                                        |
| `readFlags`, `isKilled`, `setFlag`                                             | Kill switches, read fresh; `FS_KILL=payouts,paypal_live,ai_live` (or `all`) forces them on. A flip writes the ledger and emits `flag.changed`.                                                                                                                                  |
| `claimIdempotencyKey` & co.                                                    | `new` / `replay` / `in_flight` / `mismatch` (422 `IDEMPOTENCY_KEY_REUSED`), 24 h.                                                                                                                                                                                               |
| `asDbError(e)`                                                                 | Maps trigger errors to `FairSplitDbError {code, subject, httpStatus}` — e.g. `RATE_CARD_RATIFIED` with the card sha256 for MM-4's 409.                                                                                                                                          |

`lines.followItem({itemId})` moves a line to the state its payout item's status maps to, in the caller's transaction:
an item notice that beats our 201 (SUCCESS while the line is still SUBMITTED) walks it SUBMITTED → PAYPAL_PENDING →
PAID at once, and the late 201's own edge then finds the line STALE. Stale notices are no-ops; a superseded item
(re-route) no longer moves its line.

Lifecycle columns are guarded (I5): `repos(scope).*.update` cannot write a run's or line's `state`/`version`, a hold's
state or resolution, an item's `status`, rank or cancel stamp, or any column of an approval — a compile error, and
`GuardedColumnError` at runtime. The database refuses the same writes for every role (below).

## What the database itself enforces

- **I2** `rate_cards`: once `ratified_at` is set, UPDATE/DELETE of the card and any INSERT/UPDATE/DELETE of its
  `rate_rules` raise `FS409 RATE_CARD_RATIFIED:<sha256>`; `sha256` must equal sha256(`canonical_jcs`). The moment a
  card becomes ratified the row stores the database's `now()`, whatever instant the app wrote, so a ratification
  cannot be backdated. Only a seeded snapshot keeps its historical instant: `openSeedWindow(tx, ws)` (fresh showcase
  or judge workspaces only, `FS409 SEED_REFUSED` otherwise) lets rows labelled `seeded` keep it, for that transaction.
  `slip_rows` need a ratified card, cannot be written before `ratified_at`, and cannot be dated before the
  ratification day in the season's zone (`FS422 RULES_BEFORE_FACTS`).
- **History**: `fs_app` has no UPDATE/DELETE/TRUNCATE on `run_events`, `ledger_entries`, `agent_sessions`; triggers refuse
  those for every role unless `fs_purge_workspace()` is purging an expired judge workspace. The purge holds an owner-only
  ticket for (workspace, transaction) that the SECURITY DEFINER guards check; no setting the app can change opens them.
  `fs_app` cannot DELETE workspaces, and a workspace's id, kind and creation time never change. Its `expires_at` only
  moves later: never earlier, never back to NULL and never into the past (0009), so nothing the app writes brings a
  purge forward. A judge's Reset ends the session; the hourly purge takes the workspace once it has expired.
- **Ledger**: an entry must extend `ledger_heads` (seq + 1, prev hash) or it is refused (`LEDGER_FORK`); heads move only by appending.
- **I5** runs, lines and holds: a state change must be an edge of its machine (`fs_private.state_edges`, the same
  tables as the transition policy) and must set `version = version + 1`; version never moves otherwise
  (`FS409 ILLEGAL_TRANSITION` / `VERSION_MISMATCH`, for every role). Inserts are free, so seeded clones can place rows.
- **I5** payout items: `status_rank` must match the status and only rise; our cancel is stamped once, on an UNCLAIMED
  item, and RETURNED needs that stamp from an earlier statement.
- **I4/I6** approvals: a signed approval never changes; it can be voided once (`approvals.void`, recorded in the ledger).
- **Kept rows**: `paypal_calls` (the limiter's window and 429 circuit), `webhook_events` (event-id dedupe) and
  `llm_calls` (the Claude spend meter) reference workspaces `ON DELETE SET NULL`, so a Judge purge or Reset cannot
  reopen the circuit or the day's budget; `fs_app` cannot delete them.
- **Tenancy**: every intra-workspace reference is a composite `(workspace_id, x_id)` foreign key.
- **I3/I1/I8 at rest**: `member_lines.net = premium + bonus − deductions + credits`; `holds.claude_line` has no digit;
  data rows carry `provenance` (NOT NULL, no default).

## Tests and the test harness

`pnpm --filter @fairsplit/db test` runs against a real Postgres 17 from `embedded-postgres` (no system install), kept in
`.cache/pg/` (gitignored); set `FS_TEST_DATABASE_URL` to use an external server instead (CI). Migrations run once into a
template; each test file gets its own copy. Other packages reuse it:

```ts
// vitest.config.ts → test.globalSetup: ["./test/global-setup.ts"], where that file is
export { default } from "@fairsplit/db/testing/global-setup";
// in a test
import { openTestDb, fixtureWorkspace } from "@fairsplit/db/testing";
const t = await openTestDb(); // t.owner (migration role), t.app (fs_app), t.url, t.close()
```

## Migrations

Only WS-DATA writes migrations. Change `src/schema/*`, then `pnpm --filter @fairsplit/db generate`; integrity SQL goes in a
`drizzle-kit generate --custom` file. Never edit a migration that has merged.

## Temporary shims

`src/_shims/contracts.ts` and `src/_shims/domain.ts` mirror the register's names (states, ranks, event types, task names,
JCS/sha256, the ledger hash, transition tables) until WS-CORE merges `@fairsplit/contracts` and `@fairsplit/domain`; the swap
is an import change. `repos(scope, policy)` accepts WS-CORE's `fsm` as the transition policy.

## Better Auth

`auth_user`, `auth_session`, `auth_account`, `auth_verification` are a hand-written placeholder of Better Auth 1.7.12's core
schema (plus the admin plugin columns) until spike S9; map them with `drizzleAdapter(db, { provider: "pg", schema: { user:
authUser, session: authSession, account: authAccount, verification: authVerification } })`.
