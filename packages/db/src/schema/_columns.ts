/**
 * Column and constraint helpers shared by every table group (register §7 conventions):
 * - ids are UUIDv7 (app-side generator, `fs_uuidv7()` as the SQL default);
 * - every table has `workspace_id`, and every reference between workspace tables is a composite
 *   (workspace_id, x_id) foreign key, so a row can never point into another workspace;
 * - money is `*_cents bigint` plus `currency char(3)`; weights are `*_g bigint`;
 * - states are text with a CHECK constraint.
 */
import { type SQL, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  char,
  check,
  customType,
  foreignKey,
  integer,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { PROVENANCES } from "../_shims/contracts.js";
import { uuidv7 } from "../ids/uuidv7.js";

export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`fs_uuidv7()`)
    .$defaultFn(() => uuidv7());

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
export const createdAt = () => tstz("created_at").notNull().defaultNow();
export const updatedAt = () => tstz("updated_at").notNull().defaultNow();

export const cents = (name: string) => bigint(name, { mode: "bigint" });
export const grams = (name: string) => bigint(name, { mode: "bigint" });
export const currency = (name = "currency") => char(name, { length: 3 });
export const sha256 = (name: string) => text(name);
export const version = () => integer("version").notNull().default(0);
export const provenance = () => text("provenance", { enum: PROVENANCES }).notNull();

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/** `col in ('A', 'B', ...)`. Values come from frozen enumerations, never from user input. */
export function inList(col: AnyPgColumn, values: readonly string[]): SQL {
  for (const v of values) {
    if (!/^[A-Za-z0-9_.-]+$/.test(v)) throw new Error(`inList: unsafe literal ${v}`);
  }
  return sql`${col} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;
}

export const checkIn = (name: string, col: AnyPgColumn, values: readonly string[]) =>
  check(name, inList(col, values));

export const checkProvenance = (table: string, col: AnyPgColumn) =>
  checkIn(`${table}_provenance_ck`, col, PROVENANCES);

export const checkSha = (name: string, col: AnyPgColumn, nullable = false) =>
  check(name, nullable ? sql`${col} is null or ${col} ~ '^[0-9a-f]{64}$'` : sql`${col} ~ '^[0-9a-f]{64}$'`);

export const checkCurrency = (name: string, col: AnyPgColumn) => check(name, sql`${col} ~ '^[A-Z]{3}$'`);

/** UNIQUE (workspace_id, id): the target of composite workspace foreign keys. */
export const wsIdUnique = (table: string, t: { workspaceId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_ws_id_uq`).on(t.workspaceId, t.id);

/** FOREIGN KEY (workspace_id, col) REFERENCES target (workspace_id, id): same-workspace references only. */
export function wsFk(
  name: string,
  t: { workspaceId: AnyPgColumn },
  col: AnyPgColumn,
  target: { workspaceId: AnyPgColumn; id: AnyPgColumn },
) {
  return foreignKey({ name, columns: [t.workspaceId, col], foreignColumns: [target.workspaceId, target.id] });
}
