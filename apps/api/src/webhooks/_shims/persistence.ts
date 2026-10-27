// TEMPORARY SHIM: replace with @fairsplit/outbox|db after WS-DATA merges.
//
// Mirrors IC-04 (register §11): `enqueue(tx, name, args, dedupeKey)` inserts a task_outbox row in the
// caller's transaction (ON CONFLICT (dedupe_key) DO NOTHING, NOTIFY on commit), and a transaction
// runner that commits when the callback resolves and rolls back when it throws.

import type { ProcessWebhookArgs, TaskName } from "./contracts.js";

export type Enqueue<Tx> = (
  tx: Tx,
  name: TaskName,
  args: ProcessWebhookArgs,
  dedupeKey: string,
) => Promise<void>;

export type RunInTransaction<Tx> = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/**
 * PROPOSED for WS-DATA: the replay record behind paypal-core's `TransmissionStore`, a table
 * `webhook_transmissions (transmission_id text PRIMARY KEY, expires_at timestamptz NOT NULL,
 * claim_token uuid)`; the claim/release SQL is in packages/paypal-core/src/webhook/transmission.ts
 * (expiry judged by the app's `now`, release by claim token). Separate from `webhook_events` on
 * purpose: an id is recorded before the event row and released if storing fails.
 */

/**
 * PROPOSED for WS-DATA (not in architecture §3 or S3.4 yet): one nullable column
 * `webhook_events.delivery jsonb` holding how this copy of the event reached us. It replaces the four
 * extra columns an earlier draft used (resource_type, transmission_id, reject_reason, received_at):
 * resource type is in `raw`, and the arrival time is the row's own created-at default.
 *
 * REQUIRED for MM-1, not optional. Store it exactly as the route passes it, every key kept, null-valued
 * ones included (jsonb keeps them; no jsonb_strip_nulls, no mapper that drops null or undefined), and
 * hand the stored value back to webhookApplyRule. Only an explicit `certWarning: null` says the
 * certificate was in date: a null or missing `delivery`, or one without the `certWarning` key, is
 * DELIVERY_NOT_RECORDED, so every PAYOUTS-ITEM.SUCCEEDED waits for the settle GET at +25 s / +90 s and
 * console and Proof never follow within 100 ms. That fails closed (no money risk), but MM-1 is off.
 *
 * Also read from it: processWebhook's postback step (replays these headers to verify-webhook-signature
 * after the 200), the boot-time certificate pre-warm (newest `certUrl`) and /ops reject reasons. A
 * dedicated `cert_warning` column cannot replace it on its own: it restores none of those three, and a
 * NULL there would mean both "in date" and "never written", of which only the first may apply at once.
 * Values are PayPal's public header values, clipped; never secrets.
 */
export interface WebhookDelivery {
  transmissionId: string | null;
  transmissionTime: string | null;
  transmissionSig: string | null;
  certUrl: string | null;
  authAlgo: string | null;
  /** Rejected rows: the verifier's reason (and detail), or MALFORMED_EVENT. */
  rejectReason: string | null;
  /**
   * CERT_EXPIRED: accepted although PayPal's certificate had expired (PayPal's postback confirmed this
   * delivery); webhookApplyRule then requires a fresh GET before any state change. null: in date, and
   * written as an explicit null, which is what lets an in-date SUCCEEDED apply at once (MM-1). A
   * missing key means "not recorded" and fails closed.
   */
  certWarning: string | null;
}
