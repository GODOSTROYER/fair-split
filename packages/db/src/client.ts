/**
 * Database client: one pooled postgres.js connection set wrapped by Drizzle, plus the raw `sql` handle that
 * LISTEN, advisory locks and COPY need.
 *
 * Roles (S3.4, ./roles.ts). Migrations run as the owner. Application code runs as `fs_app`, which has no UPDATE,
 * DELETE or TRUNCATE grant on run_events, ledger_entries and agent_sessions (register §7), no DELETE on
 * workspaces and no access to purge tickets. In production fs_app logs in with its own password (the migrate CLI
 * sets it from FS_APP_DB_PASSWORD) and DATABASE_URL is fs_app's URL. Without that, the owner login is a member of
 * fs_app and `createDb(url, { role: "fs_app" })` sends `role=fs_app` in the startup packet: every pooled
 * connection starts as fs_app, which stops bugs but not a compromised app (session_user is still the owner).
 * Boot calls `assertAppRole(db)`, which reports the mode and refuses a connection that could rewrite history.
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

/**
 * "fs_app" when the role exists and this login may assume it (or is fs_app itself); undefined when the database
 * user could not create it (Render, UNVERIFIED in S6) — the append-only triggers then still guard history. Boot:
 *   const { db } = createDb(url, { role: await detectAppRole(url) });
 *   const report = await assertAppRole(db); // log report.mode, never the URL
 */
export async function detectAppRole(url: string): Promise<typeof APP_ROLE | undefined> {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    const [row] = await sql<{ ok: boolean }[]>`
      select case when exists (select 1 from pg_roles where rolname = ${APP_ROLE})
                  then pg_has_role(current_user, ${APP_ROLE}, 'MEMBER') else false end as ok`;
    return row?.ok ? APP_ROLE : undefined;
  } finally {
    await sql.end({ timeout: 5 });
  }
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
