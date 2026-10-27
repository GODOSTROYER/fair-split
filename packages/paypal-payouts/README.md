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
  batchDigest, // IC-02
  verifyApprovalSignature, // Ed25519 against the registered device_keys row
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
`repo.loadPosting(runId)` re-reads the LOCKED lines and the approvals → re-hash with the injected IC-02
`batchDigest` (I4) → every approval must sign exactly that batch (run, season, card, digest, item count,
total), be unexpired, carry its own nonce and verify against a registered key; the treasurer always
signs, the Chair too when R5 says so, and they are two people (I6) → guards: receivers, total, items,
and for a new batch the daily cap and the balance → batch and item rows written as SUBMITTED →
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
written yet for the run's batch, `repo.voidApprovals` voids the run's approvals and moves it back to
IN_REVIEW in one transaction, so both keys sign what the database holds now; the outcome is still
`refused DIGEST_MISMATCH` (or `APPROVALS_MISSING`). A resumed post voids nothing (its rows are SUBMITTED
and PayPal may hold the batch: HALT), nor does a refused re-route (its approvals are its own). Nonces:
`executeApproved` reads approvals only from the database, where `approvals.nonce` is UNIQUE (S3 data
model), and refuses a set that repeats one; a re-route's approvals must be stored the same way before
`reroute` is called, and can only ever re-authorise the identical batch, whose ids PayPal dedupes.

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
for 30 days, would answer the second with the first's batch. This extends register §8's "a re-route
adds `-x{n}`" (the security review asked for it; it needs the register amended).

**The rows are the batch** (I4 at the write). `writeSubmitted` never overwrites or merges the rows under
a sender_batch_id; it returns the mark of the rows stored there, and the service posts only if that mark
carries the digest it is about to send. Two re-routes of one item racing to two receivers share the ids:
the second write gets the first's digest and is `refused ALREADY_REROUTED`, so PayPal pays the receiver
the database holds. `supersedes_item_id` is UNIQUE, so a write that would add a second re-route of one
item fails and sends nothing. `markPosted` and `markRejected` are compare-and-set on the digest posted.

`createPayoutBatch` and `cancelUnclaimedPayoutItem` are not exported: money moves only through the
service. IC-05 types come from `@fairsplit/paypal-core`; shims in `src/_shims/` still stand in for
`domain` and `contracts` until WS-CORE merges.
The agent's two read-tool schemas are checked in (`src/agent-read-schemas.ts`); `scripts/gen-read-schemas.ts`
regenerates them with `scripts/zod-json-schema.ts`, a dev-only converter for exactly the zod those two
schemas use, and a test fails on drift. `zod-to-json-schema` (pinned for the S2 fallback only) is not a
dependency.
