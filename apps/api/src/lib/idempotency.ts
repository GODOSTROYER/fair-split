// Client-mutation idempotency (S3.10): a POST carrying `Idempotency-Key` runs once per workspace and key;
// a retry with the same body gets the stored response (`Idempotent-Replayed: true`), the same key with a
// different body gets 422 IDEMPOTENCY_KEY_REUSED, and a retry while the first is still running gets 409.
// Backed by WS-DATA's `idempotency_keys` (24 h); a memory store serves the no-database test harness.
//
// A `new` claim is a hold (`{key, token}`): only the request holding it completes or releases the key, and only
// while it is in flight. A claim that outlived its key (24 h, then reclaimed by a retry) or was released is dead:
// `complete` and `release` answer false and touch nothing, so a stale request never overwrites or deletes the
// result of the request that holds the key now.
import { randomUUID } from "node:crypto";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type Db,
  type IdempotencyClaim,
  type IdempotencyHold,
  type IdempotencyRequest,
  releaseIdempotencyKey,
  type WorkspaceScope,
} from "@fairsplit/db";

export type { IdempotencyHold };

export interface IdempotencyStore {
  claim(scope: WorkspaceScope, req: IdempotencyRequest): Promise<IdempotencyClaim>;
  /** Stores the holder's response; false when the hold is dead (nothing written). */
  complete(
    scope: WorkspaceScope,
    hold: IdempotencyHold,
    response: { status: number; body: unknown },
  ): Promise<boolean>;
  /** Forgets the holder's in-flight key so a retry may run; false when the hold is dead. */
  release(scope: WorkspaceScope, hold: IdempotencyHold): Promise<boolean>;
}

export function dbIdempotencyStore(db: Db): IdempotencyStore {
  return {
    claim: (scope, req) => claimIdempotencyKey(db, scope, req),
    complete: (scope, hold, response) => completeIdempotencyKey(db, scope, hold, response),
    release: (scope, hold) => releaseIdempotencyKey(db, scope, hold),
  };
}

export function memoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<
    string,
    { req: IdempotencyRequest; token: string; status: number | null; body: unknown }
  >();
  const id = (scope: WorkspaceScope, key: string) => `${scope.workspaceId}\u0000${key}`;
  /** The row this hold names, while it is still in flight. */
  const held = (scope: WorkspaceScope, hold: IdempotencyHold) => {
    const row = rows.get(id(scope, hold.key));
    return row && row.token === hold.token && row.status === null ? row : null;
  };
  return {
    async claim(scope, req) {
      const row = rows.get(id(scope, req.key));
      if (!row) {
        const token = randomUUID();
        rows.set(id(scope, req.key), { req, token, status: null, body: null });
        return { kind: "new", key: req.key, token };
      }
      if (
        row.req.requestSha256 !== req.requestSha256 ||
        row.req.method !== req.method ||
        row.req.route !== req.route
      ) {
        return { kind: "mismatch" };
      }
      if (row.status === null) return { kind: "in_flight" };
      return { kind: "replay", status: row.status, body: row.body as never };
    },
    async complete(scope, hold, response) {
      const row = held(scope, hold);
      if (!row) return false;
      row.status = response.status;
      row.body = response.body;
      return true;
    },
    async release(scope, hold) {
      if (!held(scope, hold)) return false;
      rows.delete(id(scope, hold.key));
      return true;
    },
  };
}

/** A safe key: 1–255 visible ASCII characters (UUIDv7 capture ids are typical). */
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;
