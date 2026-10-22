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
