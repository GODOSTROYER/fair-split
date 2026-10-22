/**
 * Scoped table access: every read and write is filtered by, or stamped with, the WorkspaceScope's workspace.
 * A row id from a request can never reach another workspace's row, and an insert can never choose its own
 * workspace (the scope overwrites workspace_id). Writes take the workspace lock first (tx.ts lock order).
 *
 * Lifecycle columns are "guarded" (I5): a table names the columns only its dedicated helper may write — a run's
 * `state` and `version` move only through `runs.transition()`, an item's `status` only through
 * `items.applyStatus()`, and so on. The generic patch type omits them, and `update` refuses them at runtime
 * (GuardedColumnError, nothing written); migrations/0006 refuses the same writes in SQL for every role.
 */
import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { DbOrTx } from "../client.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";

export type WsTable = PgTable & { workspaceId: PgColumn; id: PgColumn };

export type ScopedInsert<T extends WsTable> = Omit<T["$inferInsert"], "workspaceId">;
/**
 * What `update` may write: any column except the scope's, the id and the table's guarded lifecycle columns `G`
 * (typed `never`, so naming one is a compile error even where nothing else is patchable).
 */
export type ScopedPatch<T extends WsTable, G extends string = never> = Partial<
  Omit<T["$inferInsert"], "workspaceId" | "id" | G>
> & { readonly [K in G]?: never };

/** A generic `update` tried to write a column that only a lifecycle helper may write (I5). */
export class GuardedColumnError extends TypeError {
  override readonly name = "GuardedColumnError";
  constructor(
    readonly table: string,
    readonly columns: readonly string[],
    readonly use: string,
  ) {
    super(`${table}.update cannot write ${columns.join(", ")}: use ${use}`);
  }
}

export interface ScopedTableOptions<G extends string> {
  /** lifecycle columns only a dedicated helper may write: omitted from the patch type and refused at runtime */
  guarded?: readonly G[];
  /** the helper to use instead, named in the error */
  use?: string;
}

export interface ScopedTable<T extends WsTable, G extends string = never> {
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
  /** writes the patch (undefined members are skipped, as in Drizzle); an empty patch only reads the row */
  update(
    db: DbOrTx,
    scope: WorkspaceScope,
    id: string,
    patch: ScopedPatch<T, G>,
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

export function scopedTable<T extends WsTable, G extends keyof T["$inferInsert"] & string = never>(
  table: T,
  name: string,
  options: ScopedTableOptions<G> = {},
): ScopedTable<T, G> {
  const where = (scope: WorkspaceScope, extra?: SQL) =>
    extra ? and(eq(table.workspaceId, scope.workspaceId), extra) : eq(table.workspaceId, scope.workspaceId);
  const guarded = new Set<string>(options.guarded ?? []);
  const use = options.use ?? "its lifecycle helper";

  const api: ScopedTable<T, G> = {
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
      const entries = Object.entries(patch as Record<string, unknown>).filter(([, v]) => v !== undefined);
      const refused = entries.map(([k]) => k).filter((k) => guarded.has(k));
      if (refused.length > 0) throw new GuardedColumnError(name, refused, use);
      // the scope decides the workspace and the id addresses the row: neither is ever written
      const safe = Object.fromEntries(entries.filter(([k]) => k !== "workspaceId" && k !== "id"));
      if (Object.keys(safe).length === 0) return api.get(db, scope, id);
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
