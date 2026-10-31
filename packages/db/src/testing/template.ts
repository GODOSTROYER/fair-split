/**
 * Migrated template databases: the migrations run once per migration-set hash into `fs_tpl_<hash>`, and every
 * test file gets its own `CREATE DATABASE … TEMPLATE` copy, so tests see the real schema, triggers and grants
 * in full isolation and in a fraction of a second.
 *
 * Cleanup has to cope with whatever an interrupted run left behind. A DROP DATABASE that is cut short (turbo
 * aborting a test task, say) leaves the database INVALID: PG 17 marks it `datconnlimit = -2` and answers any
 * ALTER DATABASE on it with a FATAL error that ends the session ("Use DROP DATABASE to drop invalid databases").
 * So an invalid database is dropped directly, and only a valid template has its template flag cleared first.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { MIGRATIONS_DIR, runMigrations } from "../migrate.js";

export function migrationsHash(dir: string = MIGRATIONS_DIR): string {
  const h = createHash("sha256");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) h.update(f).update(readFileSync(path.join(dir, f)));
  h.update(readFileSync(path.join(dir, "meta", "_journal.json")));
  return h.digest("hex").slice(0, 12);
}

export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

const SAFE_NAME = /^[a-z0-9_]+$/;
const TEMPLATE_LOCK = "fs:test-template";

/** Test databases are named fs_t_<suite>_<random>; a suite only ever cleans up its own leftovers. */
export function suitePrefix(suite: string): string {
  const s = suite.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `fs_t_${s || "x"}_`;
}

/** Runs one statement; `what` names it in errors. */
type Run = <T>(what: string, statement: (sql: postgres.Sql) => Promise<T>) => Promise<T>;

interface DatabaseState {
  datname: string;
  /** an interrupted DROP DATABASE left it unusable (pg_database.datconnlimit = -2) */
  invalid: boolean;
  template: boolean;
}

const DATABASE_STATE = "datname, datconnlimit = -2 as invalid, datistemplate as template";

/** Drops a database whatever state an interrupted run left it in; never ALTERs an invalid one. */
async function dropDatabase(run: Run, db: DatabaseState): Promise<void> {
  if (!SAFE_NAME.test(db.datname)) throw new Error(`refusing to drop database ${JSON.stringify(db.datname)}`);
  if (db.template) {
    if (db.invalid) {
      throw new Error(
        `database "${db.datname}" is invalid (a DROP DATABASE was cut short) and still marked as a template: ` +
          "Postgres refuses to ALTER an invalid database and to DROP a template, so the harness cannot remove it. " +
          `As a superuser: update pg_database set datistemplate = false where datname = '${db.datname}'; ` +
          `drop database "${db.datname}"; or delete the package's .cache/pg directory.`,
      );
    }
    await run(`clearing the template flag of ${db.datname}`, (sql) =>
      sql.unsafe(`alter database "${db.datname}" is_template false`),
    );
  }
  await run(`dropping ${db.datname}`, (sql) =>
    sql.unsafe(`drop database if exists "${db.datname}" with (force)`),
  );
}

/** An error that ended only the statement: Postgres said ERROR, and the session lives on with its locks. */
function endedOnlyTheStatement(e: unknown): boolean {
  return e instanceof postgres.PostgresError && e.severity === "ERROR";
}

/**
 * Runs `work` while one admin session holds the session-level advisory lock that serialises template work across
 * suites sharing a cluster, with every statement of `work` on that session.
 *
 * When that session ends, the lock ends with it, so nothing more may run on it. postgres.js would reconnect
 * quietly for the next statement (without the lock), and a statement sent after a socket error but before the
 * socket's close event is never settled at all: postgres.js 3.4.9 queues it behind the failed statement on the
 * dead connection (see global-setup.ts for how that ended the ws/api trial merge's run with exit code 0). So the
 * first error that is more than a statement error (a FATAL, a reset or closed socket), or any close of the
 * connection, fails the whole operation loudly, and the release at the end checks that the lock was still held.
 */
async function withTemplateLock<T>(adminUrl: string, work: (run: Run) => Promise<T>): Promise<T> {
  let closed = false;
  let lost = false;
  let pid: number | undefined;
  const sql = postgres(adminUrl, {
    max: 1,
    onnotice: () => {},
    onclose: () => {
      closed = true;
    },
    connection: { application_name: "fs-test-template" },
  });
  const lostSession = (what: string, cause?: unknown) => {
    lost = true;
    const why = cause instanceof Error ? `: ${cause.message}` : "";
    return new Error(
      `test template: lost the admin session (pid ${pid}) that holds the "${TEMPLATE_LOCK}" lock while ${what}${why}; ` +
        "stopping rather than going on without the lock",
      { cause },
    );
  };
  const run: Run = async (what, statement) => {
    if (closed || lost) throw lostSession(what);
    try {
      return await statement(sql);
    } catch (e) {
      if (endedOnlyTheStatement(e) && !closed) throw e;
      throw lostSession(what, e);
    }
  };
  try {
    const [held] = await sql<{ pid: number }[]>`
      select pg_backend_pid() as pid, pg_advisory_lock(hashtextextended('fs:test-template', 0))`;
    pid = held?.pid;
    const result = await work(run);
    const [released] = await run(
      "releasing the lock",
      (q) => q<{ ok: boolean }[]>`select pg_advisory_unlock(hashtextextended('fs:test-template', 0)) as ok`,
    );
    if (!released?.ok) throw lostSession("releasing it (this session no longer held it)");
    return result;
  } finally {
    // after a failure, ending the session releases the lock; a lost session is torn down at once
    await sql.end({ timeout: lost || closed ? 0 : 5 });
  }
}

/**
 * Ensures a migrated template exists and returns its name. First drops the stale templates (other migration sets,
 * a build cut short, an invalid or unfinished one) and this suite's leftover test databases.
 */
export async function prepareTemplate(adminUrl: string, suite: string): Promise<string> {
  const prefix = suitePrefix(suite);
  const name = `fs_tpl_${migrationsHash()}`;
  return withTemplateLock(adminUrl, async (run) => {
    // `${name}_building`, from a build cut short, is one of the other names
    const stale = await run(
      "listing stale databases",
      (sql) =>
        sql<DatabaseState[]>`
        select ${sql.unsafe(DATABASE_STATE)} from pg_database
         where (datname like 'fs\\_tpl\\_%' and (datname <> ${name} or datconnlimit = -2 or not datistemplate))
            or starts_with(datname, ${prefix})`,
    );
    for (const db of stale) {
      if (SAFE_NAME.test(db.datname)) await dropDatabase(run, db);
    }
    const [exists] = await run(
      "looking for the template",
      (sql) => sql`select 1 from pg_database where datname = ${name}`,
    );
    if (!exists) {
      const building = `${name}_building`;
      await run(`creating ${building}`, (sql) => sql.unsafe(`create database "${building}"`));
      await runMigrations(withDatabase(adminUrl, building));
      // flagged before the rename, so a database under the final name is always a finished template
      await run(`marking ${building} as a template`, (sql) =>
        sql.unsafe(`alter database "${building}" is_template true`),
      );
      await run(`renaming ${building} to ${name}`, (sql) =>
        sql.unsafe(`alter database "${building}" rename to "${name}"`),
      );
    }
    return name;
  });
}

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

/** Runs statements on a short-lived admin connection of its own (no lock: errors simply propagate). */
async function withAdmin<T>(adminUrl: string, fn: (run: Run) => Promise<T>): Promise<T> {
  const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn((_what, statement) => statement(sql));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function createTestDatabase(
  adminUrl: string,
  template: string,
  suite: string,
): Promise<TestDatabase> {
  if (!SAFE_NAME.test(template)) throw new Error(`unsafe template name ${template}`);
  const name = `${suitePrefix(suite)}${randomBytes(6).toString("hex")}`;
  await withAdmin(adminUrl, (run) =>
    run(`creating ${name}`, (sql) => sql.unsafe(`create database "${name}" template "${template}"`)),
  );
  return {
    name,
    url: withDatabase(adminUrl, name),
    drop: () =>
      withAdmin(adminUrl, async (run) => {
        const [db] = await run(
          `looking up ${name}`,
          (sql) =>
            sql<
              DatabaseState[]
            >`select ${sql.unsafe(DATABASE_STATE)} from pg_database where datname = ${name}`,
        );
        if (db) await dropDatabase(run, db);
      }),
  };
}
