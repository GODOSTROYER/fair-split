# @fairsplit/paypal-payouts

The typed Payouts v1 tool in the Agent Toolkit `Tool` shape, with PR #107's names
(`create_payout_batch`, `get_payout_batch`, `get_payout_item`, `cancel_unclaimed_payout_item`), and
`PayoutsService`, the only caller of the two money-moving endpoints. zod 3.25.76. Parameters and
prompts are vendored from PR #107 under Apache-2.0 (see `NOTICE`); requests go through the injected
IC-05 `PayPalHttp`.

```ts
const payouts = new PayoutsService({
  http, // IC-05 PayPalHttp: WS-PPCORE's createPayPalHttp (it owns the 401 token refresh)
  repo, // IC-04 port
  officerKeys, // (runId) => the officer key registry (device_keys joined with roles); throws on a fault
  killSwitch, // required: read fresh before every POST, retries included
  limits: {
    maxBatchTotalCents, // C-21: US$400
    maxItems, // 8 in Judge Mode
    receiverAllowed, // PP_RECEIVERS (or PP_UNCLAIMED_RECEIVER)
    maxPostsPer24h, // C-21: 40 live batches a day
    postsInLast24h, // (now) => batches written as SUBMITTED in the 24 h before now
    balanceCents, // () => estimated sandbox balance, or null
    minBalanceCents, // the floor the balance keeps after the batch (plan: US$10,000)
  }, // every one required: a missing guard is a boot error
});
await payouts.executeApproved(runId); // created | adopted | refused | rejected | unresolved
await payouts.cancelUnclaimed(itemId, actor, "cash"); // or "reroute"; actor and intent required
await payouts.reroute({ supersedesItemId, rerouteNo, receiver, approvals });
agentPayoutToolSchemas(); // get_payout_batch, get_payout_item only (checked-in JSON Schema)
// The session run's own payout_batch_ids and payout_item_ids, from the database; pages of at most 100.
await runAgentPayoutTool({ http, payoutBatchIds, payoutItemIds }, name, input);
```

`executeApproved(runId)` (register §8, S3 §S3.6.4) trusts nothing the caller hands in: kill switch →
`repo.loadPosting(runId)` re-reads the LOCKED lines, every member line of the run (`memberLines`,
`{memberNo, lineSha256}`, on and off rail), the run's holds, its spent nonces and the approvals → both
digests recomputed with WS-CORE's own functions (I4; the plan's "both digests recomputed from the
database"): domain `batchDigest` over the PayPal items and domain `linesDigest` over exactly
`{memberNo, lineSha256}` of every member line → domain `checkApprovals`, against one
`ApprovalExpectation` per role: the signer the officer key registry holds for it (domain
`expectedSigner`: the presented key ID only selects a row; an unregistered, revoked or seeded key, a key
of the other role or a row whose kind does not fit its ID is an unknown signer) and the batch as
re-hashed now (run, season, card, `batchSha256`, `linesDigest`, item count, total). So every approval
must sign exactly that batch and those lines (a cash line changed after both keys signed is refused: "A
line changed after it was signed. Nothing was sent."), be unexpired, carry its own nonce that the
database does not hold as spent, and verify against the registry's key; the treasurer always signs, the
Chair too when R5 says so (`requiresChair`, its overrides counted by domain `overrideCount` over the
run's holds), and they are two people with two keys: distinct key IDs, public keys and approvers (I6).
The outcome's `check` names the `checkApprovals` refusal (`KEY_NOT_REGISTERED`, `SIGNERS_NOT_DISTINCT`,
`NONCE_REUSED`, …) behind S3's `DIGEST_MISMATCH` (`APPROVALS_MISSING` for a missing or second-person
co-signature) → guards: receivers, total, items, and for a new batch the daily cap and the balance →
batch and item rows written as SUBMITTED, only while the approvals checked are still live →
`POST /v1/payments/payouts` with `sender_batch_id` `{season}-{rc8}-r{runSeq}`, items `r{runSeq}-{memberNo}`,
note "Fair Split 2026-A, batch {digest8}", `recipient_type: EMAIL`, USD, and
`PayPal-Request-Id: sha256(sender_batch_id)` → on 5xx or timeout, the same request again at 1 s, 3 s,
9 s, re-reading the kill switch first → on 400 "already exists", GET the batch from the HATEOAS link and
adopt it only if every item it lists re-hashes to the approved digest. Never on the header total: dev, CI
and the judge share one sandbox business account, so a run_seq collision can show our id and our total
with another split. While PayPal lists no items (or the GET goes unanswered) the outcome is `unresolved
ADOPT_PENDING` with the batch's id, nothing is marked POSTED, and the rows stay SUBMITTED; a batch whose
items differ, or under another sender_batch_id, is `refused ADOPT_FAILED` (HALT). A post left
`unresolved` resumes later with the same ids, its approvals judged as of the moment its rows were
written.

**A failed approval check** (S3.6.4 step 3; the plan's "Change one payout after both keys"). With nothing
written yet for the run's batch, `repo.voidApprovals({runId, nonces, …})` voids exactly the approvals the
service checked, named by their nonces (`approvals.nonce` is UNIQUE), and moves the run back to IN_REVIEW
in one transaction, so both keys sign what the database holds now; the outcome is still `refused
DIGEST_MISMATCH` (or `APPROVALS_MISSING`). The void takes its turn in the service's write queue, and the
repository applies it only while the run is APPROVED and every live approval of the run is one it names:
an executor whose read went stale never voids a set signed after its read, nor the approvals another
executor's rows were written under (the run is POSTING then). A resumed post voids nothing (its rows are
SUBMITTED and PayPal may hold the batch: HALT), nor does a refused re-route (its approvals are its own).
`officerKeys(runId)` answers the registry's rows; an infrastructure fault must throw, and the post then
rejects with nothing voided, written or sent (an answer that is not a list is treated the same way).
Nonces: `executeApproved` reads approvals only from the database, where `approvals.nonce` is UNIQUE (S3
data model), refuses a set that repeats one, and passes the run's `spentNonces` (every voided approval's)
to `checkApprovals`, so a voided approval never signs again; a re-route's approvals must be stored the
same way before `reroute` is called, and can only ever re-authorise the identical batch, whose ids PayPal
dedupes.

**Daily cap and balance** (S3 §S3.6.4 step 4). A new batch, primary or re-route, goes out only while
`postsInLast24h(now)` is under `maxPostsPer24h` (else `refused DAILY_CAP`) and the estimated balance less
the batch stays at or above `minBalanceCents` (else `refused SANDBOX_GUARD`; an unknown balance refuses
too). Both are read in the same turn of the service's queue as the rows' write, so two posts racing for
the day's last slot cannot pass on one count; across processes, live posts share the one lane (S3.9). A
resumed post was counted and funded when its rows were written and is not checked again. The judge
lane's own quotas (S3.9, the plan's balance formula) sit above this ceiling and turn a post into a
labelled replay before `executeApproved` is called.

**On WS-PPCORE's PayPalHttp** (IC-05, on `main` since 23 Oct). That client retries idempotent calls
itself, so the create and cancel POSTs go out with `idempotent: false`: their retries are the service's,
each after a fresh kill-switch read, never 4 × 4 POSTs. Its local refusals sent nothing and return at
once, rows left SUBMITTED for a resume with the same ids: the limiter window is `refused QUEUED`, the 429
circuit (or a 429) `refused CIRCUIT_OPEN`, no OAuth token `unresolved AUTH_FAILED`, a request it would
not send `refused INVALID_BATCH`. A timeout may have reached PayPal and is retried. Call purposes are
`paypal_calls`' own (`payouts.create`, `payouts.get`, `payouts.item.get`, `payouts.item.cancel`).
The client also owns the 401: it drops the stale shared token and resends once, so a 401 that still
reaches the service is final (`unresolved AUTH_FAILED`). The tests run the service on the real client
over msw (`test/support/http.ts`); `test/service.ic05.test.ts` also drives it into each local refusal.

`reroute` pays a RETURNED item's line again as `{sender_batch_id}-x{n}-{memberNo}` /
`r{runSeq}x{n}-{memberNo}`, only after our own cancel with intent `reroute`, for the amount the database
holds, at most once per returned item (`n` is the returned item's own n + 1; a retry resumes the same
ids). The member is in the batch id because `n` counts one item's re-routes: under a bare `-x{n}` two
members' first re-routes of one run would share `-x1`, and PayPal, which keeps a sender_batch_id unique
for 30 days, would answer the second with the first's batch. This amends register §8's "a re-route adds
`-x{n}`" and S3.6.4's `{senderBatchId}-x{n}`: `docs/adr/0007-member-scoped-re-route-sender-batch-id.md`
records it for the user's approval (accepted when merged). A re-route's approvals carry the run's
`linesDigest` too, recomputed from `loadRun`'s member lines.

**The rows are the batch** (I4 at the write). `writeSubmitted` never overwrites or merges the rows under
a sender_batch_id; it returns the mark of the rows stored there, and the service posts only if that mark
carries the digest it is about to send. Two re-routes of one item racing to two receivers share the ids:
the second write gets the first's digest and is `refused ALREADY_REROUTED`, so PayPal pays the receiver
the database holds. `supersedes_item_id` is UNIQUE, so a write that would add a second re-route of one
item fails and sends nothing. `markPosted` and `markRejected` are compare-and-set on the digest posted.
A primary batch's write names the approvals it was checked under (`approvalNonces`) and is itself a
compare-and-set: the run moves APPROVED → POSTING only while every one of them is live, else nothing is
written, `writeSubmitted` returns null and the post is `refused INVALID_BATCH`. So an executor that read
the run, stalled while a check voided those approvals, a line was edited and both keys signed again,
cannot post the old lines although the run is APPROVED again.

`createPayoutBatch` and `cancelUnclaimedPayoutItem` are not exported: money moves only through the
service. IC-05 types come from `@fairsplit/paypal-core`, the approval and hold shapes from
`@fairsplit/contracts`, and the digests and the approval check from `@fairsplit/domain`.
The agent's two read-tool schemas are checked in (`src/agent-read-schemas.ts`); `scripts/gen-read-schemas.ts`
regenerates them with `scripts/zod-json-schema.ts`, a dev-only converter for exactly the zod those two
schemas use, and a test fails on drift. `zod-to-json-schema` (pinned for the S2 fallback only) is not a
dependency.

**Downstream** (what the other workstreams build against this port; the tests' `MemoryPayoutsRepo` in
`test/support/repo.ts` is the reference behaviour):
- **WS-DATA (IC-04).** `loadPosting` and `loadRun` return `memberLines`: `{memberNo, lineSha256}` for every
  `member_lines` row of the run, on and off rail, with `line_sha256` NOT NULL (a null hash is refused as
  an invalid batch); and `spentNonces`: the nonce of every approval of the run with `voided_at` set.
  `loadPosting` also returns `holds`: every hold of the run as `{kind, resolution}` (contracts
  `EngineHold`; `resolution` null while open), from which the service counts R5's overrides with domain
  `overrideCount` (it no longer reads an `overrides` number). `writeSubmitted` for a primary batch, in its
  one transaction: `UPDATE pay_runs SET state = 'POSTING' WHERE id = $run AND state = 'APPROVED'` guarded
  by every `$approvalNonces` row being the run's with `voided_at IS NULL`; no row updated and no rows
  under the sender_batch_id → write nothing, return null. `voidApprovals`, in one transaction: move the
  run `APPROVED → IN_REVIEW` only if `NOT EXISTS (live approval of the run whose nonce <> ALL($nonces))`;
  if it moved, `UPDATE approvals SET voided_at = $at, void_reason = $reason WHERE run_id = $run AND
  nonce = ANY($nonces) AND voided_at IS NULL`; otherwise write nothing.
- **WS-API and WS-OPS (whoever wires the service).** Every approval payload, the re-route's too, is built
  with domain `buildApprovalPayload`, its `linesDigest` computed by domain `linesDigest` from the same
  member lines the repository returns. `officerKeys(runId)` reads the run's workspace registry from
  `device_keys` joined with each officer's role, as contracts `OfficerKey` rows (revoked ones included,
  with `revokedAt`), and throws on a fault. The `batchDigest`, `linesDigest` and
  `verifyApprovalSignature` dependencies are gone: the service computes and checks with domain itself.
