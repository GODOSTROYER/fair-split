/**
 * Database client: one pooled postgres.js connection set wrapped by Drizzle, plus the raw `sql` handle that
 * LISTEN, advisory locks and COPY need.
 *
 * Roles. Migrations run as the owner. Application code should run as `fs_app`, which has no UPDATE, DELETE or
 * TRUNCATE grant on run_events, ledger_entries and agent_sessions (register §7). The owner login is a member of
 * fs_app, so `createDb(url, { role: "fs_app" })` sends `role=fs_app` in the startup packet and every pooled
 * connection starts as fs_app — no second credential to manage.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema/index.js";

export type Schema = typeof schema;
export type Db = PostgresJsDatabase<Schema>;
/** A Drizzle transaction handle (the argument of `db.transaction(async (tx) => …)`). */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything that can run a query: the database or an open transaction. */
export type DbOrTx = Db | Tx;

export const APP_ROLE = "fs_app";

export interface CreateDbOptions {
  /** Assume this role on every connection (use "fs_app" for application code). */
  role?: typeof APP_ROLE;
  /** Pool size (default 10). */
  max?: number;
  /** Shown in pg_stat_activity, e.g. "fs-api" or "fs-tasks". */
  applicationName?: string;
  /** Seconds a connection may idle before it is closed (default 30). */
  idleTimeout?: number;
}

export interface Database {
  db: Db;
  sql: Sql;
  close(): Promise<void>;
}

export function createDb(url: string, opts: CreateDbOptions = {}): Database {
  const connection: Record<string, string> = { application_name: opts.applicationName ?? "fairsplit" };
  if (opts.role) connection.role = opts.role;
  const sql = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: opts.idleTimeout ?? 30,
    connect_timeout: 10,
    onnotice: () => {},
    connection,
  });
  const db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}
