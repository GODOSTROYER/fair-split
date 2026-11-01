# ADR-0013: persist verified webhook delivery and apply validated SUCCEEDED without a GET

- **Status:** Accepted by the W1 work package; pending merger review
- **Date:** 1 Nov 2026 (IST)
- **Touches:** IC-04 persistence, IC-05 webhook application, S3.6.5, MM-1, invariants I5, I7 and I8
- **Consumers:** WS-DATA (`webhook_events`), WS-PPCORE (verification and apply rule), WS-API
  (`processWebhook`, outbox and SSE), WS-CONSOLE and WS-APP (`item.updated`), WS-QA and WS-MEDIA (claims)

## Context

The verifier already returns the delivery headers, reject reason and certificate warning. The P1 database
adapter drops that record, and `processWebhook` supplies `delivery: null` to the apply rule. Consequently
even a verified SUCCEEDED waits for a status GET. An explicit `certWarning: null` must remain distinguishable
from evidence that was never stored. The current rail is exclusively the in-process simulator (ADR-0002,
ADR-0010); every resulting value remains labelled **Simulated PayPal sandbox**.

## Decision

Add nullable `webhook_events.delivery jsonb` through a new forward-only migration. Preserve the verifier's
whole delivery object, including null-valued keys, in the same transaction as the event and its
`processWebhook` outbox task. Existing and fetched rows retain NULL; do not backfill authentication claims.
Rejected deliveries retain only the existing clipped public headers, rejection metadata and body hash.
No grants change: the application still cannot UPDATE or DELETE `run_events` or `ledger_entries`.

Only `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, verified as `self` or `postback`, may apply SUCCESS immediately.
Before using stored evidence, validate the delivery's complete header shape, explicit null certificate
warning and rejection reason, and transmission freshness against receipt time. Validate the raw envelope,
its ID and type against the stored row, SUCCESS transaction status, and its batch, sender and item identities
against the resolved item. Resolve through the batch first; conflicting identities never select another item.
The stored record is evidence of prior verification, not permission to trust arbitrary JSON fields.
The production processor uses paypal-core's `storedWebhookApplyRule`; the old partial-delivery shim
alone is insufficient to authorize an immediate apply. The item identity is checked again under its lock.

Every other status and every legacy or invalid delivery requires a fresh GET before any state change.
Rank only rises, duplicates and reordered events do not repeat item transitions, and RETURNED still requires
our own cancel. Later scheduled GETs may corroborate SUCCESS but cannot lower its rank. This decision does
not authorize the legacy apply-contract comment's proposed downward correction.

The canonical fs-api adapter (`apps/api/src/paypal/webhooks.ts`) persists delivery and receipt time.
It retains transactional outbox execution and the commit-triggered LISTEN/SSE path.
The Postgres simulator regression measures commit-to-`item.updated` SSE latency across repeated deliveries;
four full signed deliveries warm the path before the 24 measured samples. MM-1 keeps p95 at or below
100 ms. This is local simulator evidence, not a hosted or live PayPal measurement.

## Round 2 safety checks

A `payout.stranded` boot record blocks both stored delivery application and fresh GETs, including a
second check under the workspace lock. Record the notice without changing any item, line or run.
The immediate path also requires the locked item's current status and an explicit absence of a cancel
request: RETURNED, FAILED, BLOCKED and cancellation in flight require a fresh GET. A fresh item GET
must name the expected sender, batch and requested item ID before it can bind or apply anything.
An item ID already bound to another item is refused at resolution and again under the workspace lock.

No schema status is added: consumed notices that cannot apply use `orphan` with a fixed error reason
and NULL `appliedAt`. Identity mismatches and missing item IDs defer to the settle GET through the
outbox; stranded batches queue nothing. `applied` is reserved for actual application or verified
held-status corroboration. These records preserve the distinction between receipt and application
for Proof plate 6.

## Claims enabled when W1 is merged and its checks are green

- README: "Signed webhooks and status checks move each payout; in this build both come from the simulated PayPal sandbox".
- Film: "A verified simulated PayPal webhook applies SUCCESS; the statement follows within 100 ms in our local simulator test."
- Console / statement: "Verified simulated PayPal webhook applied this payout."
- Proof plate 6: "our record of the simulator's signed, verified notices; no nightly reconciliation in this build".

Keep the visible rail label **Simulated PayPal sandbox**. These claims describe the simulated rail and do
not claim real PayPal execution, a live Claude reading, an AI-drafted invoice, or hosted latency evidence.
