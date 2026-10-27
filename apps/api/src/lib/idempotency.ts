// Client-mutation idempotency (S3.10): a POST carrying `Idempotency-Key` runs once per workspace and key;
// a retry with the same body gets the stored response (`Idempotent-Replayed: true`), the same key with a
// different body gets 422 IDEMPOTENCY_KEY_REUSED, and a retry while the first is still running gets 409.
// Backed by WS-DATA's `idempotency_keys` (24 h); a memory store serves the no-database test harness.
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type Db,
  type IdempotencyClaim,
  type IdempotencyRequest,
  releaseIdempotencyKey,
  type WorkspaceScope,
} from "@fairsplit/db";

export interface IdempotencyStore {
  claim(scope: WorkspaceScope, req: IdempotencyRequest): Promise<IdempotencyClaim>;
  complete(scope: WorkspaceScope, key: string, response: { status: number; body: unknown }): Promise<void>;
  release(scope: WorkspaceScope, key: string): Promise<void>;
}

export function dbIdempotencyStore(db: Db): IdempotencyStore {
  return {
    claim: (scope, req) => claimIdempotencyKey(db, scope, req),
    complete: (scope, key, response) => completeIdempotencyKey(db, scope, key, response),
    release: (scope, key) => releaseIdempotencyKey(db, scope, key),
  };
}

export function memoryIdempotencyStore(): IdempotencyStore {
  const rows = new Map<string, { req: IdempotencyRequest; status: number | null; body: unknown }>();
  const id = (scope: WorkspaceScope, key: string) => `${scope.workspaceId}\u0000${key}`;
  return {
    async claim(scope, req) {
      const row = rows.get(id(scope, req.key));
      if (!row) {
        rows.set(id(scope, req.key), { req, status: null, body: null });
        return { kind: "new" };
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
    async complete(scope, key, response) {
      const row = rows.get(id(scope, key));
      if (row) {
        row.status = response.status;
        row.body = response.body;
      }
    },
    async release(scope, key) {
      const row = rows.get(id(scope, key));
      if (row && row.status === null) rows.delete(id(scope, key));
    },
  };
}

/** A safe key: 1–255 visible ASCII characters (UUIDv7 capture ids are typical). */
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7e]{1,255}$/;
