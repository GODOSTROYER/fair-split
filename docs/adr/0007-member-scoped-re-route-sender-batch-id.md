# ADR-0007: A re-route's sender_batch_id names its member

- **Status:** Accepted (user, on merge)
- **Date:** 27 Oct 2026 (IST)
- **Author:** WS-PPMONEY
- **Touches:** register §8 (field table, `sender_batch_id`), S3.6.4 (`reroute`: "a new batch
  `{senderBatchId}-x{n}`"), S3's re-route row ("`-x{n}` suffixes"), IC-02 domain `senderBatchId` (WS-CORE),
  the `payout_batches.sender_batch_id` comment (WS-DATA), `packages/paypal-payouts` (`senderBatchId`,
  `PayoutsService.reroute`)

## Context

- Register §8 builds `sender_batch_id` as `{season}-{rc8}-r{runSeq}`, and "a re-route adds `-x{n}`". Its
  `sender_item_id` is `r{runSeq}-{memberNo}`, and a re-route uses `r{runSeq}x{n}-{memberNo}`. S3.6.4 says a
  re-route posts "a new batch `{senderBatchId}-x{n}` with item `r{runSeq}x{n}-{memberNo}` and
  `supersedes_item_id` set".
- `n` counts the re-routes of one returned item. The next re-route of an item is that item's own n + 1:
  an item of the primary batch goes to x1, and an x1 item that comes back goes to x2. So a retry always
  resumes the same ids, and one returned item can never be paid by two different batches (I3).
- One run can return several items for a re-route, for example two members whose items went UNCLAIMED.
  Both first re-routes are x1, so under a bare `-x{n}` both batches would be `2026A-7f3a91c2-r37-x1`.
  Only their `sender_item_id`s differ, because those carry the member.
- PayPal keeps a `sender_batch_id` unique for 30 days (S3.6.4; PR #107's sandbox capture). It answers
  the second POST with 400 "Batch with given sender_batch_id already exists" and a link to the first
  batch. `PayoutsService` adopts a linked batch only if its items rebuild the approved digest (I4). So the
  second member's re-route ends `refused ADOPT_FAILED` (HALT), and that member can never be paid on
  PayPal. `PayPal-Request-Id = sha256(sender_batch_id)` collides too.
- The automated security review of ws/ppmoney named this collision and asked for the superseded item or
  the member number in the re-route id (research `STATE.md`, "reroute path", 2 MEDIUM). Commit `1b10fcc`
  on `ws/ppmoney` built `{season}-{rc8}-r{runSeq}-x{n}-{memberNo}`. The verifier of 27 Oct confirmed the
  change was needed, but noted that it departs from register §8 and S3.6.4 without an ADR. Only an ADR the
  user approves can change the register. This ADR is that record.

## Decision

1. A re-route's `sender_batch_id` is `{season}-{rc8}-r{runSeq}-x{n}-{memberNo}`, for example
   `2026A-7f3a91c2-r37-x1-M-031`. The primary batch stays `{season}-{rc8}-r{runSeq}`.
2. `n` keeps its meaning: the superseded item's own n + 1. The `memberNo` is the member whose RETURNED
   item the batch re-routes, which is the member in that item's `sender_item_id`. A primary batch's id
   never names a member, and a re-route's id always does.
3. `sender_item_id` (`r{runSeq}x{n}-{memberNo}`), `PayPal-Request-Id = sha256(sender_batch_id)`, the batch
   note and the `batchSha256` definition do not change. The digest hashes whatever `senderBatchId` the
   batch carries, so a re-route's digest binds the member-scoped id.
4. Ids stay within PayPal's limits: `sender_batch_id` ≤ 256 characters, and a member number of at most 40
   characters keeps it far under (`packages/paypal-payouts` tests the longest case).
5. Register §8's field table reads, after this ADR: "`{season}-{rc8}-r{runSeq}`; a re-route adds
   `-x{n}-{memberNo}`". S3.6.4's `reroute` reads: "a new batch `{senderBatchId}-x{n}-{memberNo}`".

## Consequences

- **WS-PPMONEY:** already built this way (`senderBatchId({…, rerouteNo, memberNo})` refuses a re-route
  without its member and a primary batch with one). `test/ids.test.ts` and
  `test/service.cancel-reroute.test.ts` prove the property: two members' first re-routes in one run get
  their own batches, and PayPal pays both.
- **WS-CORE:** domain `senderBatchId(seasonCode, rateCardSha256, runSeq, rerouteN?)` builds `${base}-x${n}`.
  It must take the member for a re-route, and so must any Proof or verifier code that rebuilds a re-route
  batch id. The primary batch id, the only one `verify-core` rebuilds today, is unchanged.
- **WS-DATA:** only the comment on `payout_batches.sender_batch_id` changes. The column already holds up to
  256 characters.
- **WS-PPSIM, WS-API, WS-CONSOLE, WS-APP:** they treat the id as opaque, so nothing changes. Screens that
  show a re-route batch id show the longer form.
- **Migration:** none. No re-route has been posted (re-route is P1, behind a flag).
- **What gets worse:** a re-route's id is a few characters longer, and it repeats the member already in its
  item id. We accept that: the alternative is a member's re-route that can never be paid.

## Alternatives considered

| Option                                                                    | Why not                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep `-x{n}` and make `n` a run-wide counter                              | The id would depend on the order in which re-routes are posted, not on the item. A retry could mint a new `n` and a second batch for the same returned item (I3), and two re-routes racing for the next `n` need a lock that no other id needs. |
| `-x{n}-{supersededPayoutItemId}`                                          | PayPal's id would sit inside our own id. Ours are derived from our own facts (register §8: "All are derived; none is ever typed"). The member number already makes the id unique, and it reads better on screen.                                |
| One batch carrying every re-route of a run                                | It ties the items of different members to one signature, one guard check and one outcome. A member's re-route would wait for, or fail with, another member's.                                                                                   |
| Keep the register text and let PayPal's "already exists" answer settle it | The second member's batch would be refused ADOPT_FAILED and halt, because its items do not rebuild the first batch's digest. That member could never be paid on PayPal.                                                                         |
