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
 * PROPOSED for WS-DATA (not in architecture §3 or S3.4 yet): one nullable column
 * `webhook_events.delivery jsonb` holding how this copy of the event reached us. It replaces the four
 * extra columns an earlier draft used (resource_type, transmission_id, reject_reason, received_at):
 * resource type is in `raw`, and the arrival time is the row's own created-at default.
 *
 * What depends on it: processWebhook's postback step (it replays these headers to
 * verify-webhook-signature after the 200), the boot-time certificate pre-warm (newest `certUrl`), and
 * /ops reject reasons. A repository that drops it degrades those three; ingestion is unaffected.
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
  /** Accepted although PayPal's certificate had expired (CERT_EXPIRED_CONFIRMED | CERT_EXPIRED_ACCEPTED). */
  certWarning: string | null;
}
