# Cloud T1: security audit of the money path

Branch `cloud/security-audit`, cut from `origin/main` at `3e1ec11`. Status: **done**. Every bullet of the handoff
is marked "holds" or has a finding with a test. Two findings were confirmed (S1 medium, S2 low). Each has a failing
test followed by a fix on this branch. One more test pins two properties of the policy lattice that hold.

## What was run

- Node v24.22.1, pnpm 11.28.6 (`corepack pnpm`), Vitest 5.0.5, Biome from the workspace catalog. No new
  dependencies and no `npx` tools.
- **Postgres workaround.** The embedded test cluster refuses to run as root here (`initdb: cannot be run as
  root`). The coordinator started a dedicated Postgres 17.10 server for this task (same binaries and options as
  the harness, run as user `postgres`, trust auth). Every db-backed run used
  `export FS_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55431/postgres`. `packages/db`'s
  `test/harness-global-setup.test.ts` still fails as root because it tests the embedded path. That failure comes
  from the environment and is not a finding.
- Single files: `corepack pnpm exec vitest run <file>` inside the package. Full API suite:
  `cd apps/api && corepack pnpm exec vitest run --maxWorkers=2`. Load averages were 12 to 35 because six agents
  share 4 cores.
  - Before the S1 fix, with only the posting-side re-hash: 1,064 of 1,065 tests passed in 636 s. The one failure
    was `money/digest.test.ts` "signing again binds the batch as it now is". That result led to the final
    version of the fix, which re-hashes on both sides.
  - With the final fix (`e098999`): 117 files, 1,065 of 1,065 tests passed in 943 s (load average 27 to 48).
- `packages/domain` (`vitest run`): 16 files, 267 of 267 passed. `packages/db` (`vitest run --maxWorkers=2`):
  28 of 29 files passed, 244 tests passed and 5 skipped. The one failing file is `test/harness-global-setup.test.ts`
  (root-only, see above).
- Read-only differential check of the console's hand-written browser SHA-256 (`apps/console/src/lib/sha256.ts`)
  against `node:crypto`. It covered 2,012 strings, including astral characters and lone surrogates, with
  0 mismatches. The script lives only in the scratch dir; nothing was committed under `apps/console`.

## Verdicts

| Bullet                    | Sub-bullet                                         | Verdict                | Evidence                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approvals                 | keys only from `device_keys` for the role          | holds                  | `packages/domain/src/approval.test.ts:238-283`, `:482`, `:515` (property); `apps/api/src/approvals/approvals.test.ts:176-236`                                                                                                                                                                                                                                           |
| Approvals                 | approvers and keys distinct                        | holds                  | `approval.test.ts:324-371`; `approvals.test.ts:285`; Proof side `chain.test.ts:985`                                                                                                                                                                                                                                                                                     |
| Approvals                 | nonces never reused                                | holds                  | `approval.test.ts:395`, `:440`; `approvals.test.ts:285`; `approvals.nonce` is globally UNIQUE (`packages/db/src/schema/runs.ts:276`)                                                                                                                                                                                                                                    |
| Approvals                 | `exp` window                                       | holds                  | `approval.test.ts:420` (expired, and more than 30 min ahead); `approvals.test.ts:229`                                                                                                                                                                                                                                                                                   |
| `executeApproved`         | both digests re-hashed from the DB (I4)            | **finding S1** (fixed) | `apps/api/src/money/cash-line-tamper.pg.test.ts:56`                                                                                                                                                                                                                                                                                                                     |
| `executeApproved`         | receiver, amount, item-count guards                | holds                  | `packages/paypal-payouts/test/service.execute.test.ts:938`, `:953`, `:567`                                                                                                                                                                                                                                                                                              |
| `executeApproved`         | daily cap and balance                              | holds                  | `packages/paypal-payouts/test/service.guards.test.ts:89-225`                                                                                                                                                                                                                                                                                                            |
| `executeApproved`         | "already exists" adoption rebuilds the signed hash | holds                  | `service.execute.test.ts:306`, `:327`, `:353`, `:409-435`                                                                                                                                                                                                                                                                                                               |
| Webhooks                  | cert URL pattern                                   | holds                  | `packages/paypal-core/src/webhook/cert-url.test.ts:30-50` (scheme, credentials, port, look-alike hosts, trailing dot, live hosts)                                                                                                                                                                                                                                       |
| Webhooks                  | transmission freshness                             | holds                  | `verify.replay.test.ts:71`, `:106`                                                                                                                                                                                                                                                                                                                                      |
| Webhooks                  | `transmission_id` replay                           | holds                  | `verify.replay.test.ts:159-271`, `:241` (concurrent copies), `:319-386`                                                                                                                                                                                                                                                                                                 |
| Webhooks                  | 64 KB cap                                          | holds                  | `apps/api/src/webhooks/paypal.test.ts:257`, `:691` (declared or streamed)                                                                                                                                                                                                                                                                                               |
| Webhooks                  | cert-fetch budgets                                 | holds                  | `verify.budget.test.ts:115-227`; `verify.test.ts:403`, `:503`, `:569`                                                                                                                                                                                                                                                                                                   |
| Policy lattice            | `invoiceEqualsQuote` with unknown keys             | holds (pinned)         | new `packages/domain/src/policy.audit.test.ts:72` (own `__proto__`, `constructor`, `toString`, … at five depths); `policy.test.ts:312`, `:1277`                                                                                                                                                                                                                         |
| Policy lattice            | strict date parsing                                | holds                  | `policy.test.ts:219-233`, `:921`                                                                                                                                                                                                                                                                                                                                        |
| Policy lattice            | `sendNeedsTreasurer`                               | holds                  | `policy.test.ts:1041`, `:1093`. Both send paths also refuse without a recorded approval: `apps/api/src/agent/executor.ts:180`, `money/funding.ts:213`; only the treasurer or judge writes `invoice.send_approved` (`runs/invoice.ts:95`)                                                                                                                                |
| Policy lattice            | monotonicity (only tightens)                       | holds (pinned)         | `policy.test.ts:1239`; new `policy.audit.test.ts:92` (any subset of the policies is never stricter than all of them)                                                                                                                                                                                                                                                    |
| Credentials               | judge cookie; workspace from the credential        | holds                  | `apps/api/src/credentials/verify/resolve.test.ts:53`, `:105`, `:134`, `:147`; `codec.test.ts:78-106`. A reset judge workspace can never be claimed again (`claimJudgeWorkspace` takes only `expires_at IS NULL`; migration 0013 never clears an expiry), so an old cookie cannot reach a new judge's workspace                                                          |
| Credentials               | scoped tokens                                      | holds                  | `resolve.test.ts:53-94`; `routes/auth/auth.pg.test.ts:129`                                                                                                                                                                                                                                                                                                              |
| Credentials               | single-use pairing                                 | holds                  | `auth.pg.test.ts:197`, `:230`. The claim is a compare-and-set (`credentials/issue/pairing.ts:198`, `used_at IS NULL AND expires_at > now`)                                                                                                                                                                                                                              |
| Credentials               | member and brand link tokens                       | holds                  | `resolve.test.ts:176`, `:226-241`; `codec.test.ts:131-141`; `auth.pg.test.ts:454`, `:512`, `:861`, `:914`; per-line scope `statements/access.ts:23`, `sse/routes.ts:169`                                                                                                                                                                                                |
| IC-12 FrameBridge         | origin and source checks                           | holds                  | frame side `apps/mobile/src/services/frame-protocol.ts:54` (`e.origin === self.origin && e.source === parent`), test `frame-protocol.test.ts:48`; stage side `apps/console/src/stage/bridge.ts:245` (own origin and a registered `contentWindow` only), test `bridge.test.ts:95`; posts never use `"*"`                                                                 |
| Proof in-browser verify   |                                                    | holds                  | `packages/domain/src/chain.test.ts:939-1252` (re-chained bundle, re-signed checkpoint, truncation, revoked or unpublished keys, sample keys); the browser crypto is strict Ed25519 (`zip215: false`) plus a SHA-256 that matches node on 2,012 samples (above)                                                                                                          |
| Immutability              | `run_events` and ledger, role privileges           | holds                  | triggers in `packages/db/migrations/0002_fs_integrity.sql:108-147`, REVOKE at `:303`; `packages/db/test/app-role.test.ts`                                                                                                                                                                                                                                               |
| Immutability              | boot refusal                                       | **finding S2** (fixed) | `packages/db/test/app-role-columns.test.ts:21`                                                                                                                                                                                                                                                                                                                          |
| Slip-injection quarantine |                                                    | holds                  | `packages/ai/src/read/extract.test.ts:650-918`, `:1004`; the screen fails closed (`packages/ai/src/read/calls.ts:231-240`, `screenFallout` at `extract.ts:1103`); `packages/domain/src/engine.test.ts:384`. In this build the API reads seed stand-ins only, and quarantined text is stored as an anomaly, never a field or prompt (`apps/api/src/runs/extract.ts:286`) |

## Findings

### S1 · Medium · A cash line's amount can change after both keys and the batch is still posted

**What.** `linesDigest` binds every member line, cash lines included: "a cash line changed after signing no longer
matches either key" (`packages/domain/src/approval.ts`). `PayoutsService` recomputes it from the
`{memberNo, lineSha256}` pairs its repository hands it. `apps/api/src/money/payouts.ts` handed it the stored
`member_lines.line_sha256`, read back as is (WS-DATA's `memberLineHashes`), and never re-hashed the line's
columns. On-rail lines are safe because `batchSha256` re-hashes their amounts and receivers. A cash line's amount is
bound only through its hash.

**Attack.** This assumes the insider-with-database-write model that the product's own "change one payout after
both keys" tamper demonstrates. The insider edits a cash line's `credits_cents` and `net_cents` by +1 (the line
CHECK still holds) and leaves `line_sha256` alone. Both signatures still verify and the PayPal batch is posted. The
clerk then pays the edited cash amount, and only Proof plate 4 notices, after the fact.

**Repro and test.** `apps/api/src/money/cash-line-tamper.pg.test.ts`, test
`inv.i4.lines-digest: a cash line's amount changed after both keys …`. On `9f2ca3b` the test fails with
`expected [ 'create_payout_batch' ] to not include 'create_payout_batch'`. The existing test at
`posting-cas.pg.test.ts:403` only rewrote the stored hash, which was already caught.

**Fix.** New `apps/api/src/money/line-hash.ts` adds `lineHashNow`. It rebuilds each line's canonical from its
columns and engine trace with Proof's own `resolveLineCanonical` (imported, not edited), and it never trusts a
canonical stored inside `trace`. If the rebuild matches, the stored hash is used. Otherwise the line is handed on
as `sha256("fairsplit.line-hash-mismatch:{stored}:{rebuilt}")`, a value that matches neither hash.

The same function now feeds three places:
- signing: `approvals/batch.ts` `runBatch`;
- posting: `money/payouts.ts` `loadPosting` and `loadRun`;
- a re-route's payload: `runs/reroute.ts`.

The effects:
- A line changed after signing is refused (DIGEST_MISMATCH, approvals voided, run back to IN_REVIEW). This holds
  whether the columns or the stored hash were changed.
- Officers who knowingly sign again over the line as it now is still pay it. This keeps
  `money/digest.test.ts:78` green, and Proof plate 4 still reports that the line does not recompute.

The fix stays outside the off-limits areas: it imports from `proof/bundle.ts` and edits nothing there.

**Commits.** Test `9f2ca3b`, fix `e098999`.

### S2 · Low · The boot role check misses column-level UPDATE on history tables

**What.** `inspectAppRole` (`packages/db/src/roles.ts`) lists writable history with
`has_table_privilege(current_user, t, 'UPDATE')`. That function answers only for table-level grants. A stray
`GRANT UPDATE (col) ON run_events TO fs_app` therefore left `writableHistory` empty, and `assertAppRole` let fs-api
boot as append-only. The append-only triggers still stop the write, so this is defence in depth, not an open hole.

**Test.** `packages/db/test/app-role-columns.test.ts` covers all three history tables. On `5e1302f` it fails with
`expected [] to include 'run_events:UPDATE'`.

**Fix.** For UPDATE, the check now also asks `has_any_column_privilege`. TRUNCATE and DELETE have no column form.

**Commits.** Test `5e1302f`, fix `8d98d26`.

## What changed (commits)

| SHA       | Scope | What                                |
| --------- | ----- | ----------------------------------- |
| `acb8038` | qa    | skeleton report                     |
| `9f2ca3b` | api   | S1 failing test                     |
| `5e1302f` | data  | S2 failing test                     |
| `8d98d26` | data  | S2 fix                              |
| `d6ae6ec` | core  | policy lattice pinning test (holds) |
| `e098999` | api   | S1 fix                              |
| (last)    | qa    | this report                         |

## Rejected hypotheses

- **Ed25519 malleability or a presented key.** The server verifies only against the registry's key
  (`expectedSigner`), and nonce reuse is keyed on the payload nonce, not the signature bytes. Node's `verify`
  rejects non-canonical S.
- **Judge signs both roles.** By design (Judge Mode, labelled demo keys). Two distinct `web_demo` keys and
  approvers are still required, and Proof reads such a run as "Sample", never "Verified".
- **Any board member co-signs as "Chair".** `approvalRoleOfApprover("board:*")` maps to `chair`. I6 says "a board
  co-signature", so this matches the spec.
- **Resumed post checks approvals as of `submitted.at`.** Intended: the rows and digest were authorised then, and
  the same ids and digest are re-sent.
- **Spend guards in simulator or replay mode.** The ceiling and floor are relaxed on purpose and documented
  (`money/payouts.ts` `spendGuardsFor`). The per-batch cap, item cap and known-receiver guards still bind.
- **Re-route to another member's receiver.** It needs a fresh human signature over a one-item batch whose digest
  includes the receiver, and only PP_RECEIVERS are allowed. That is I6 by design.
- **Webhook `opts.postback` FAILURE ignored after a valid self-signature.** The route never asks for a postback,
  and the expired-certificate path does honour FAILURE.
- **`bodyUsed` path in `honoPayPalWebhook` reads an unbounded body.** No middleware consumes the body before
  `/webhooks/paypal`, so the bounded reader is the one used.
- **Prototype keys in invoice drafts.** Denied at every depth (pinned in `policy.audit.test.ts`).
- **Browser `fromHex` accepts uppercase hex.** The bytes are the same, so trust is unaffected.
- **Proof keys come from the same origin as the bundle.** This is a stated design limit
  (`/.well-known/fairsplit-keys.json` is "fetched apart from this record"). A fully compromised server can serve
  both. Pinning keys out of band would be a product decision, not a bug.
- **Operator cookie is not revocable server-side before its 8 h expiry.** Rotating `FS_COOKIE_SECRET` ends it
  (docs/security.md). Noted only.

## Open items

- Off-limits areas (console, mobile, judge admission, rate limits, Proof cache and export): nothing confirmed
  there. The FrameBridge and in-browser Proof code holds as written. No repro needed.
- S1 follow-up for WS-DATA: `memberLineHashes` (`packages/db/src/repos/posting.ts`) still returns stored hashes
  and no longer has a caller in the API. It could be retired or made to re-hash.
