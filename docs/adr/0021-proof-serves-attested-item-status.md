# ADR-0021: Proof serves each payout item at the status its verified notices attest

- **Status:** Accepted (HD7 builder brief); pending merger review
- **Date:** 11 Nov 2026 (IST)
- **Touches:** ADR-0013 (stored webhook delivery), ADR-0015 (labelled replay), S3.6.5, S3.12, Proof plate 6,
  invariants I5 and I8
- **Consumers:** WS-API (`proof/bundle.ts`, `money/settle.ts`), WS-CONSOLE and WS-APP (the Proof page and its
  in-browser check), WS-QA and WS-MEDIA (the film opens Proof right after MM-6)

## Context

Plate 6 accepts an item's status only when the forward-only fold of the chain's verified `webhook.applied` entries
reaches it. That check is right and is not changed. The server could still serve a bundle that failed it
("An item status does not rest on a verified event", five of six):
1. **A window.** The settle GET and our own cancel write an item's status from PayPal's answer before the item's
   signed notice is processed. The run can be SETTLED inside that window, and the bundle carried the held status.
   A judge who opened Proof straight after "settled" saw a failed check until a reload.
2. **A late UNCLAIMED notice.** Read after "Pay in cash", its fresh GET says RETURNED. It was dropped (`NO_APPLY`),
   so the chain never held the UNCLAIMED step that RETURNED folds from. The check failed for good.
3. **The same notice inside our cancel**, between PayPal accepting it and our RETURNED write. It was chained as
   `eventType UNCLAIMED, status RETURNED`, an entry the verifier rejects, and the signed CANCELED was then refused.

## Decision

1. **The bundle serves what the chain attests.** `ProofItem.status` and `eventId` are the fold of the item's
   verified notices (`proof/item-fold.ts`, the same fold plate 6 replays). With no notice chained an item is served
   SUBMITTED (or PENDING, which needs none) with `eventId: null`. A status held ahead of its notice is not served.
   If the chain ever attests more than the row holds, the held status goes out with no event and plate 6 refuses
   it. A labelled replay (ADR-0015) is unchanged. The `ProofBundle` schema is unchanged.
2. **A `webhook.applied` item entry names the status its own event type names**, never the status a GET returned
   for a different step.
3. **Stored notices are chained in fold order** (`money/corroborate.ts`). Whenever an item or one of its notices
   is processed, and after each settle GET, the server chains the stored notices the held status still lacks,
   lowest status first. A notice qualifies only if it is stored and verified (never `dev_mock`, never replay),
   `processWebhook` already resolved it to that item and checked it against PayPal, and it names a status the item
   holds or went through to get there (UNCLAIMED for an item now RETURNED). A CANCELED that was chained before the
   UNCLAIMED step is entered again after it: the same verified event, in the order the fold needs.
4. Item rows, member lines, run states, `item.updated` events and the verifier are unchanged. A run still reaches
   SETTLED from PayPal's answers; Proof follows as the signed notices are chained.

## Consequences

- Proof opened at any moment of a settlement passes plate 6 and shows no status a verified notice does not back.
  Inside the window it reads behind the run: Rhea is UNCLAIMED on Proof for the moment between "Pay in cash" and
  PayPal's CANCELED being processed. This is design direction "In progress: plate 6 reads Waiting for PayPal".
- A notice that never arrives leaves its item at the last attested step on Proof. It never becomes a failed check
  and never a false confirmation.
- The judge's own Proof page verifies the bundle it fetched on load and shows item statuses from its run stream, so
  it needs no change. A bundle fetched inside the window verifies; a later fetch carries the later notices.
- Metrics and the brand export keep reading held statuses and count an item as verified only when its held status
  rests on an event, as before.
- All of this is the in-process simulator (ADR-0010), labelled **Simulated PayPal sandbox**. No live PayPal
  behaviour is claimed.
