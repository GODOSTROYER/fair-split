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

| Export                                                                         | What it does                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createDb(url, {role})`, `detectAppRole(url)`                                  | postgres.js pool + Drizzle. `role: "fs_app"` makes every connection run as the restricted app role; `detectAppRole` returns it only if the login may assume it (if the database user could not create roles, the triggers alone guard history).       |
| `runMigrations(url)`, `ensureRunSeqFloor(url, n)`                              | Applies `migrations/` under an advisory lock; raises (never lowers) `fs_run_seq`. CLI: `pnpm --filter @fairsplit/db migrate` (`FS_RUN_SEQ_FLOOR` optional).                                                                                           |
| `workspaceScope()`, `systemScope()`                                            | The only way to build a scope. Derive it from the credential, never from a body.                                                                                                                                                                      |
| `repos(scope)`                                                                 | Every workspace table bound to the scope (`get/require/list/insert/insertMany/update`), plus `runs.transition`, `lines.transition`, `holdStates.transition`, `items.applyStatus`, `items.requestCancel`, `events.append`, `ledger.append`, `flags.*`. |
| `appendEvent(tx, event)`                                                       | Inserts a `run_events` row; `NOTIFY run_events '<ws>:<id>'` is delivered on commit. Per-workspace lock ⇒ ids in commit order. `toEnvelope()` gives the S3.7 SSE shape.                                                                                |
| `appendLedger(tx, scope, entry)`, `verifyChain(db, ws)`, `verifyEntries(rows)` | sha256 hash chain per workspace: `sha256(prev ‖ JCS{seq, kind, actorKind, actorId, impersonatedBy, payload, at})`, genesis = 64 zeros.                                                                                                                |
| `createLimiter(db)`                                                            | `take({purpose, priority})` → grant (with `callId`) or `{reason, retryAfterMs}`; `record(callId, {status, debugId, ms})`; `acquire()` waits; `state()` for /ops. 40/min, 20 background, 6-min circuit after a 429.                                    |
| `createBus({url, db})`                                                         | `start()`, `subscribe({workspaceId, runId?, lineId?}, cb, {afterId?, maxReplay?, filter?})`, `ping()` for /readyz. Gap-free, catches up after reconnect.                                                                                              |
| `readFlags`, `isKilled`, `setFlag`                                             | Kill switches, read fresh; `FS_KILL=payouts,paypal_live,ai_live` (or `all`) forces them on. A flip writes the ledger and emits `flag.changed`.                                                                                                        |
| `claimIdempotencyKey` & co.                                                    | `new` / `replay` / `in_flight` / `mismatch` (422 `IDEMPOTENCY_KEY_REUSED`), 24 h.                                                                                                                                                                     |
| `asDbError(e)`                                                                 | Maps trigger errors to `FairSplitDbError {code, subject, httpStatus}` — e.g. `RATE_CARD_RATIFIED` with the card sha256 for MM-4's 409.                                                                                                                |

## What the database itself enforces

- **I2** `rate_cards`: once `ratified_at` is set, UPDATE/DELETE of the card and any INSERT/UPDATE/DELETE of its
  `rate_rules` raise `FS409 RATE_CARD_RATIFIED:<sha256>`; `sha256` must equal sha256(`canonical_jcs`).
  `slip_rows` need a ratified card, cannot be written before `ratified_at`, and cannot be dated before the
  ratification day in the season's zone (`FS422 RULES_BEFORE_FACTS`).
- **History**: `fs_app` has no UPDATE/DELETE/TRUNCATE on `run_events`, `ledger_entries`, `agent_sessions`; triggers refuse
  those for every role unless `fs_purge_workspace()` is purging an expired judge workspace.
- **Ledger**: an entry must extend `ledger_heads` (seq + 1, prev hash) or it is refused (`LEDGER_FORK`); heads move only by appending.
- **I5** payout items: `status_rank` must match the status and only rise; RETURNED needs `cancel_requested_at`.
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
