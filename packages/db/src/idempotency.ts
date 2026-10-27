/**
 * Client-mutation idempotency (architecture §6.7, S3.10): `Idempotency-Key` on POSTs, kept 24 h per workspace.
 *
 *   const claim = await claimIdempotencyKey(db, scope, { key, method, route, requestSha256 });
 *   new       → do the work, then completeIdempotencyKey(db, scope, claim, {status, body})
 *               (or releaseIdempotencyKey(db, scope, claim) on a retryable failure)
 *   replay    → answer with the stored status and body
 *   in_flight → the first request with this key is still running (409)
 *   mismatch  → same key, different request: 422 IDEMPOTENCY_KEY_REUSED
 *
 * A `new` claim carries a random token, stored in the row: only the request holding that token completes or releases
 * the key, and only while it is in flight. A claim that outlived its key (24 h, then reclaimed by a retry) or was
 * released is dead: complete and release then return false and touch nothing, so a stale request can never overwrite
 * or delete the result of the request that holds the key now (security review, MEDIUM).
 */
import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import type { DbOrTx } from "./client.js";
import { type JsonValue, toJsonValue } from "./json.js";
import { idempotencyKeys } from "./schema/index.js";
import type { WorkspaceScope } from "./scope.js";

export interface IdempotencyRequest {
  key: string;
  method: string;
  route: string;
  /** sha256 hex of the request body (Content-Digest) */
  requestSha256: string;
}

/** The claimer's hold on a key: what `complete` and `release` must present. A `new` claim is one. */
export interface IdempotencyHold {
  key: string;
  /** random per claim; never sent to the client */
  token: string;
}

export type IdempotencyClaim =
  | ({ kind: "new" } & IdempotencyHold)
  | { kind: "replay"; status: number; body: JsonValue | null }
  | { kind: "in_flight" }
  | { kind: "mismatch" };

export async function claimIdempotencyKey(
  db: DbOrTx,
  scope: WorkspaceScope,
  req: IdempotencyRequest,
): Promise<IdempotencyClaim> {
  if (!req.key || req.key.length > 255) throw new TypeError("Idempotency-Key must be 1–255 characters");
  const ws = scope.workspaceId;
  const token = randomUUID();
  const [inserted] = await db
    .insert(idempotencyKeys)
    .values({
      workspaceId: ws,
      key: req.key,
      method: req.method,
      route: req.route,
      requestSha256: req.requestSha256,
      claimToken: token,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted) return { kind: "new", key: req.key, token };

  // an expired key may be reused as if new; the new token kills every earlier claim on it
  const [reused] = await db
    .update(idempotencyKeys)
    .set({
      method: req.method,
      route: req.route,
      requestSha256: req.requestSha256,
      claimToken: token,
      responseStatus: null,
      responseBody: null,
      createdAt: sql`now()`,
      expiresAt: sql`now() + interval '24 hours'`,
    })
    .where(
      and(
        eq(idempotencyKeys.workspaceId, ws),
        eq(idempotencyKeys.key, req.key),
        lt(idempotencyKeys.expiresAt, sql`now()`),
      ),
    )
    .returning({ key: idempotencyKeys.key });
  if (reused) return { kind: "new", key: req.key, token };

  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, ws), eq(idempotencyKeys.key, req.key)));
  if (!row) return claimIdempotencyKey(db, scope, req); // raced with a purge or a release
  if (row.requestSha256 !== req.requestSha256 || row.method !== req.method || row.route !== req.route) {
    return { kind: "mismatch" };
  }
  if (row.responseStatus === null) return { kind: "in_flight" };
  return { kind: "replay", status: row.responseStatus, body: (row.responseBody ?? null) as JsonValue | null };
}

/** The row this hold names, while it is still in flight. */
const heldInFlight = (scope: WorkspaceScope, hold: IdempotencyHold) =>
  and(
    eq(idempotencyKeys.workspaceId, scope.workspaceId),
    eq(idempotencyKeys.key, hold.key),
    eq(idempotencyKeys.claimToken, hold.token),
    isNull(idempotencyKeys.responseStatus),
  );

/**
 * Stores the response of the request that holds the key. False when the claim is dead (released, reclaimed after
 * expiry, or already completed): nothing is written, and the stored response, if any, stays as it was.
 */
export async function completeIdempotencyKey(
  db: DbOrTx,
  scope: WorkspaceScope,
  hold: IdempotencyHold,
  response: { status: number; body: unknown },
): Promise<boolean> {
  if (!Number.isInteger(response.status)) throw new TypeError("response status must be an integer");
  const rows = await db
    .update(idempotencyKeys)
    .set({ responseStatus: response.status, responseBody: toJsonValue(response.body ?? null) })
    .where(heldInFlight(scope, hold))
    .returning({ key: idempotencyKeys.key });
  return rows.length > 0;
}

/**
 * Forgets an in-flight key after a failure the client may retry (e.g. a 503 before any effect). Only the holder
 * releases it; false (and nothing deleted) when the claim is dead or the key already has its response.
 */
export async function releaseIdempotencyKey(
  db: DbOrTx,
  scope: WorkspaceScope,
  hold: IdempotencyHold,
): Promise<boolean> {
  const rows = await db
    .delete(idempotencyKeys)
    .where(heldInFlight(scope, hold))
    .returning({ key: idempotencyKeys.key });
  return rows.length > 0;
}

/** Housekeeping for the hourly cron: drops keys past their 24 h. */
export async function purgeExpiredIdempotencyKeys(db: DbOrTx): Promise<number> {
  const rows = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, sql`now()`))
    .returning({ key: idempotencyKeys.key });
  return rows.length;
}
