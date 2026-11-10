# ADR 0020: Mark paid returns the invoice provenance

Status: Accepted, 11 November 2026.

## Context

A judge funding step can execute through the labelled replay rail. The invoice row and its events already record `replay`, but `MarkPaidResponse` required `simulated_rail` and the handler returned that literal. This made the API contradict the evidence it had just stored (I8).

## Decision

Use the existing `Provenance` schema for `MarkPaidResponse.provenance`. Return the invoice row's provenance after the outbox task completes, including `replay`. Preserve the response's other fields and idempotency behavior. The simulator remains labelled `simulated_rail`; no live PayPal integration is introduced.

Postman checks both the expected session provenance and whether an `INV2-RPLY-` invoice carries `replay`. Schema and API regression tests cover the recorded invoice provenance.

## Consequences

Clients must consume the existing Provenance union rather than assume every Mark paid response is simulated. Replayed invoice funding is visibly distinct from a fresh simulated PayPal sandbox payment. No stored rows or migrations change.
