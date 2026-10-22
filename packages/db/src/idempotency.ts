/**
 * Client-mutation idempotency (architecture §6.7, S3.10): `Idempotency-Key` on POSTs, kept 24 h per workspace.
 *
 *   const claim = await claimIdempotencyKey(db, scope, { key, method, route, requestSha256 });
 *   new       → do the work, then completeIdempotencyKey(…, {status, body}) (or release on a retryable failure)
 *   replay    → answer with the stored status and body
 *   in_flight → the first request with this key is still running (409)
 *   mismatch  → same key, different request: 422 IDEMPOTENCY_KEY_REUSED
 */
import { and, eq, lt, sql } from "drizzle-orm";
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

export type IdempotencyClaim =
  | { kind: "new" }
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
  const [inserted] = await db
    .insert(idempotencyKeys)
    .values({
      workspaceId: ws,
      key: req.key,
      method: req.method,
      route: req.route,
      requestSha256: req.requestSha256,
    })
    .onConflictDoNothing()
    .returning({ key: idempotencyKeys.key });
  if (inserted) return { kind: "new" };

  // an expired key may be reused as if new
  const [reused] = await db
    .update(idempotencyKeys)
    .set({
      method: req.method,
      route: req.route,
      requestSha256: req.requestSha256,
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
  if (reused) return { kind: "new" };

  const [row] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, ws), eq(idempotencyKeys.key, req.key)));
  if (!row) return claimIdempotencyKey(db, scope, req); // raced with a purge
  if (row.requestSha256 !== req.requestSha256 || row.method !== req.method || row.route !== req.route) {
    return { kind: "mismatch" };
  }
  if (row.responseStatus === null) return { kind: "in_flight" };
  return { kind: "replay", status: row.responseStatus, body: (row.responseBody ?? null) as JsonValue | null };
}

export async function completeIdempotencyKey(
  db: DbOrTx,
  scope: WorkspaceScope,
  key: string,
  response: { status: number; body: unknown },
): Promise<void> {
  await db
    .update(idempotencyKeys)
    .set({ responseStatus: response.status, responseBody: toJsonValue(response.body ?? null) })
    .where(and(eq(idempotencyKeys.workspaceId, scope.workspaceId), eq(idempotencyKeys.key, key)));
}

/** Forget an in-flight key after a failure the client may retry (e.g. a 503 before any effect). */
export async function releaseIdempotencyKey(db: DbOrTx, scope: WorkspaceScope, key: string): Promise<void> {
  await db
    .delete(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.workspaceId, scope.workspaceId),
        eq(idempotencyKeys.key, key),
        sql`${idempotencyKeys.responseStatus} is null`,
      ),
    );
}

/** Housekeeping for the hourly cron: drops keys past their 24 h. */
export async function purgeExpiredIdempotencyKeys(db: DbOrTx): Promise<number> {
  const rows = await db
    .delete(idempotencyKeys)
    .where(lt(idempotencyKeys.expiresAt, sql`now()`))
    .returning({ key: idempotencyKeys.key });
  return rows.length;
}
