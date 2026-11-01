# ADR-0015: Proof distinguishes labelled payout replay from verified notices

- **Status:** Accepted (E1b builder brief)
- **Date:** 1 Nov 2026 (IST)
- **Touches:** ADR-0002, ADR-0010 decision 9, IC-02 Proof contracts

## Context

Judge Mode replays PayPal steps when the per-cookie live-post quota is exhausted or the replay
circuit is open. Replay applies recorded item outcomes without simulator-signed webhook notices.
Proof previously required every terminal outcome to rest on a verified webhook and therefore
reported an honest quota fallback as a mismatch. Inventing verified notices for replay would break
invariant I8 and incorrectly increase the verified-event count.

## Decision

1. The transaction that applies a replay item status appends the strict Proof ledger kind
   `payout.item.replayed`, carrying `runId`, `senderItemId`, nullable `payoutItemId`, `from`, `status`,
   `provenance: "replay"`, and `source` (`post_response`, `status_check`, `cancel` or `webhook`). It
   carries no webhook event ID and no verification claim. Its checkpoint anchors what our application
   recorded; it does not authenticate a PayPal notice.
2. `ProofItem` accepts an optional `provenance: "replay"` marker. Its `eventId` remains null for replay.
   The marker alone proves nothing: missing or inconsistent replay records still fail. A valid replay
   record itself forces labelled replay even if the item marker is omitted.
3. Plate 6 retains every existing batch, line, digest, approval and order check. It folds replay
   records in chain order, requires the recorded prior status and exact run/item identity, and applies
   the same forward-only status rules. A null recorded item ID is allowed only for PENDING before
   the replay response identifies the item; identified and terminal outcomes require the matching
   non-null ID. Malformed replay evidence for this run or its items fails closed. RETURNED still
   requires our preceding cancellation. A
   `webhook.applied` record with replay provenance never qualifies as a verified notice. Before any
   replay status is applied, an unchanged SUBMITTED item with a null event ID may show replay only
   when the chain records this run's `judge.step.replayed` post intent before `payout.submitting`.
   That intent never attests a PENDING or terminal status.
4. A consistent plate with replay outcomes returns `ok: true`, distinct optional `state: "replay"`,
   and the exact reason: "Replayed (labelled): these statuses come from a recorded run, not from
   verified simulator notices". Here `ok` means the recorded outcomes are consistent. It does not mean
   verified. Every other plate retains its existing result shape.
5. A consistent Proof with that plate returns the new `ProofStatus` `replay`, overall `ok: false`, and
   an optional `verdict`: "five of six match; one replayed, labelled". A broken chain, checkpoint or
   plate always returns `failed`. Existing verified and sample behavior is unchanged. Renderers must
   display the replay state and reason rather than treating it as either a verified match or a
   mismatch. All PayPal-derived values remain labelled "Simulated PayPal sandbox" (ADR-0002).

## Consequences

The shared contracts change additively: a strict replay ledger payload, optional Proof item marker,
optional plate state and verdict, and one explicit Proof status with localized labels. Consumers
that exhaustively render `ProofStatus` must handle `replay`. The browser and API use the same pure
verifier, so they count identical evidence. Replay never fabricates simulator webhook evidence or
contributes to verified-event metrics.

Old replay runs without item ledger evidence fail closed; this decision does not invent a historical
record for them. New replay runs record each applied transition transactionally. No production quota
default changes and no live cloud calls are introduced.
