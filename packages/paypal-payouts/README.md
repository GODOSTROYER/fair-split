# @fairsplit/paypal-payouts

The typed Payouts v1 tool in the Agent Toolkit `Tool` shape, with PR #107's names
(`create_payout_batch`, `get_payout_batch`, `get_payout_item`, `cancel_unclaimed_payout_item`), and
`PayoutsService`, the only caller of the two money-moving endpoints. zod 3.25.76. Parameters and
prompts are vendored from PR #107 under Apache-2.0 (see `NOTICE`); requests go through the injected
IC-05 `PayPalHttp`.

```ts
const payouts = new PayoutsService({
  http, // IC-05 PayPalHttp (WS-PPCORE's createPayPalHttp fits the port as is)
  auth, // IC-05 PayPalAuth: invalidate() on a 401
  repo, // IC-04 port
  batchDigest, // IC-02
  verifyApprovalSignature, // Ed25519 against the registered device_keys row
  killSwitch, // required: read fresh before every POST, retries included
  limits: { maxBatchTotalCents, maxItems, receiverAllowed }, // required: C-21 cap, 8 items, PP_RECEIVERS
});
await payouts.executeApproved(runId); // created | adopted | refused | rejected | unresolved
await payouts.cancelUnclaimed(itemId, actor, "cash"); // or "reroute"; actor and intent required
await payouts.reroute({ supersedesItemId, rerouteNo, receiver, approvals });
agentPayoutToolSchemas(); // get_payout_batch, get_payout_item only (checked-in JSON Schema)
await runAgentPayoutTool(http, name, input);
```

`executeApproved(runId)` (register §8, S3 §S3.6.4) trusts nothing the caller hands in: kill switch →
`repo.loadPosting(runId)` re-reads the LOCKED lines and the approvals → re-hash with the injected IC-02
`batchDigest` (I4) → every approval must sign exactly that batch (run, season, card, digest, item count,
total), be unexpired, carry its own nonce and verify against a registered key; the treasurer always
signs, the Chair too when R5 says so, and they are two people (I6) → guards → batch and item rows written
as SUBMITTED → `POST /v1/payments/payouts` with `sender_batch_id` `{season}-{rc8}-r{runSeq}`, items
`r{runSeq}-{memberNo}`, note "Fair Split 2026-A, batch {digest8}", `recipient_type: EMAIL`, USD, and
`PayPal-Request-Id: sha256(sender_batch_id)` → on 5xx or timeout, the same request again at 1 s, 3 s,
9 s, re-reading the kill switch first → on 400 "already exists", GET the batch from the HATEOAS link and
adopt it only if its items re-hash to the approved digest. A post left `unresolved` resumes later with
the same ids, its approvals judged as of the moment its rows were written.

**On WS-PPCORE's PayPalHttp** (IC-05, on `main` since 23 Oct). That client retries idempotent calls
itself, so the create and cancel POSTs go out with `idempotent: false`: their retries are the service's,
each after a fresh kill-switch read, never 4 × 4 POSTs. Its local refusals sent nothing and return at
once, rows left SUBMITTED for a resume with the same ids: the limiter window is `refused QUEUED`, the 429
circuit (or a 429) `refused CIRCUIT_OPEN`, no OAuth token `unresolved AUTH_FAILED`, a request it would
not send `refused INVALID_BATCH`. A timeout may have reached PayPal and is retried. Call purposes are
`paypal_calls`' own (`payouts.create`, `payouts.get`, `payouts.item.get`, `payouts.item.cancel`).
`test/service.ic05.test.ts` restates the real result types and assigns the client to this port.

`reroute` pays a RETURNED item's line again as `{sender_batch_id}-x{n}` / `r{runSeq}x{n}-{memberNo}`,
only after our own cancel with intent `reroute`, for the amount the database holds, at most once per
returned item (`n` is the returned item's own n + 1; a retry resumes the same ids).

`createPayoutBatch` and `cancelUnclaimedPayoutItem` are not exported: money moves only through the
service. Shims in `src/_shims/` stand in for `@fairsplit/paypal-core`, `domain` and `contracts`.
`zod-to-json-schema` is a dev dependency only: `scripts/gen-read-schemas.ts` regenerates
`src/agent-read-schemas.ts`, and a test fails if the checked-in schemas drift.
