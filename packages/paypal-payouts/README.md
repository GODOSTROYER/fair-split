# @fairsplit/paypal-payouts

The typed Payouts v1 tool in the Agent Toolkit `Tool` shape, with PR #107's names
(`create_payout_batch`, `get_payout_batch`, `get_payout_item`, `cancel_unclaimed_payout_item`), and
`PayoutsService`, the only caller of the two money-moving endpoints. zod 3.25.76. Parameters and
prompts are vendored from PR #107 under Apache-2.0 (see `NOTICE`); requests go through the injected
IC-05 `PayPalHttp`.

```ts
const payouts = new PayoutsService({ http, auth, repo, batchDigest, killSwitch, limits });
await payouts.executeApproved(run); // created | adopted | refused | rejected | unresolved
await payouts.cancelUnclaimed(itemId, { intent: "cash" });
await payouts.reroute({ ...run, rerouteNo: 1, supersedesItemId, line, approvals });
agentPayoutToolSchemas(); // get_payout_batch, get_payout_item only
await runAgentPayoutTool(http, name, input);
```

`executeApproved` (register §8): kill switch → treasurer approval present → re-hash with the injected
IC-02 `batchDigest` and refuse unless every approval signed that digest (I4) → guards → batch and item
rows written as SUBMITTED → `POST /v1/payments/payouts` with `sender_batch_id`
`{season}-{rc8}-r{runSeq}`, items `r{runSeq}-{memberNo}`, note "Fair Split 2026-A, batch {digest8}",
`recipient_type: EMAIL`, USD, and `PayPal-Request-Id: sha256(sender_batch_id)` → on 5xx or timeout,
the same request again at 1 s, 3 s, 9 s → on 400 "already exists", GET the batch from the HATEOAS
link and adopt it only if its items re-hash to the approved digest. A re-route posts
`{sender_batch_id}-x{n}` with item `r{runSeq}x{n}-{memberNo}`.

`createPayoutBatch` and `cancelUnclaimedPayoutItem` are not exported: money moves only through the
service. Shims in `src/_shims/` stand in for `@fairsplit/paypal-core` and `@fairsplit/domain`.
