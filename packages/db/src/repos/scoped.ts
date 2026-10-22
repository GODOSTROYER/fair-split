/**
 * Scoped table access: every read and write is filtered by, or stamped with, the WorkspaceScope's workspace.
 * A row id from a request can never reach another workspace's row, and an insert can never choose its own
 * workspace (the scope overwrites workspace_id). Writes take the workspace lock first (tx.ts lock order).
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../client.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";

export type WsTable = PgTable & { workspaceId: PgColumn; id: PgColumn };

export type ScopedInsert<T extends WsTable> = Omit<T["$inferInsert"], "workspaceId">;
export type ScopedPatch<T extends WsTable> = Partial<Omit<T["$inferInsert"], "workspaceId" | "id">>;

export interface ScopedTable<T extends WsTable> {
  readonly table: T;
  insert(db: DbOrTx, scope: WorkspaceScope, values: ScopedInsert<T>): Promise<T["$inferSelect"]>;
  insertMany(db: DbOrTx, scope: WorkspaceScope, values: ScopedInsert<T>[]): Promise<T["$inferSelect"][]>;
  get(db: DbOrTx, scope: WorkspaceScope, id: string): Promise<T["$inferSelect"] | null>;
  /** like get, but throws NotFoundError (the API's 404) */
  require(db: DbOrTx, scope: WorkspaceScope, id: string): Promise<T["$inferSelect"]>;
  list(
    db: DbOrTx,
    scope: WorkspaceScope,
    where?: SQL,
    opts?: { limit?: number },
  ): Promise<T["$inferSelect"][]>;
  update(
    db: DbOrTx,
    scope: WorkspaceScope,
    id: string,
    patch: ScopedPatch<T>,
  ): Promise<T["$inferSelect"] | null>;
}

export class NotFoundError extends Error {
  override readonly name = "NotFoundError";
  constructor(
    readonly table: string,
    readonly id: string,
  ) {
    super(`${table} ${id} not found in this workspace`);
  }
}

// Drizzle's builders are typed per concrete table; inside this generic helper the table is erased to `any`
// once, and the public signatures above restore the precise row types.
// biome-ignore lint/suspicious/noExplicitAny: generic over Drizzle tables
type AnyDb = any;

export function scopedTable<T extends WsTable>(table: T, name: string): ScopedTable<T> {
  const where = (scope: WorkspaceScope, extra?: SQL) =>
    extra ? and(eq(table.workspaceId, scope.workspaceId), extra) : eq(table.workspaceId, scope.workspaceId);

  const api: ScopedTable<T> = {
    table,
    async insert(db, scope, values) {
      const [row] = await api.insertMany(db, scope, [values]);
      if (!row) throw new Error(`${name}: insert returned no row`);
      return row;
    },
    async insertMany(db, scope, values) {
      if (values.length === 0) return [];
      const rows = values.map((v) => ({ ...v, workspaceId: scope.workspaceId }));
      return withWorkspaceTx(db, scope, (tx) => (tx as AnyDb).insert(table).values(rows).returning());
    },
    async get(db, scope, id) {
      const rows = await (db as AnyDb)
        .select()
        .from(table)
        .where(where(scope, eq(table.id, id)))
        .limit(1);
      return rows[0] ?? null;
    },
    async require(db, scope, id) {
      const row = await api.get(db, scope, id);
      if (!row) throw new NotFoundError(name, id);
      return row;
    },
    async list(db, scope, extra, opts = {}) {
      const q = (db as AnyDb).select().from(table).where(where(scope, extra));
      return opts.limit ? q.limit(opts.limit) : q;
    },
    async update(db, scope, id, patch) {
      const { workspaceId: _ws, id: _id, ...safe } = patch as Record<string, unknown>;
      const rows: T["$inferSelect"][] = await withWorkspaceTx(db, scope, (tx) =>
        (tx as AnyDb)
          .update(table)
          .set(safe)
          .where(where(scope, eq(table.id, id)))
          .returning(),
      );
      return rows[0] ?? null;
    },
  };
  return api;
}
