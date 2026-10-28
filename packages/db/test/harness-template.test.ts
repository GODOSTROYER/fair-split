/**
 * The test harness's template cleanup (src/testing/template.ts) against this run's real Postgres.
 *
 * At the ws/api trial merge, turbo killed a test run in the middle of a DROP DATABASE, which leaves the database
 * INVALID (PG 17: pg_database.datconnlimit = -2). The next run's cleanup sent `ALTER DATABASE … is_template false`
 * to it; Postgres answers that with a FATAL ("cannot alter invalid database") that ends the session, and with it the
 * session-level advisory lock the cleanup holds. The cleanup swallowed the error and sent its DROP into the dead
 * connection, where postgres.js never settled it.
 *
 * Each test cleans up only its own suite's leftovers (fs_t_<suite>_…), never this run's template or the
 * databases the other test files are using.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createTestDatabase, prepareTemplate, suitePrefix } from "../src/testing/template.js";
import { sleep } from "./helpers.js";

const { adminUrl, template } = inject("fsPg");
let admin: postgres.Sql;

beforeAll(() => {
  admin = postgres(adminUrl, { max: 2, onnotice: () => {} });
});
afterAll(async () => {
  await admin?.end({ timeout: 5 });
});

/** Creates a database and marks it INVALID, as an interrupted DROP DATABASE leaves it. */
async function invalidDatabase(name: string, opts: { template?: boolean } = {}): Promise<void> {
  await removeDatabase(name);
  await admin.unsafe(`create database "${name}"`);
  await admin`update pg_database set datconnlimit = -2, datistemplate = ${opts.template ?? false}
               where datname = ${name}`;
}

/** Removes a database in any state, as a superuser can (an earlier, failed run may have left it behind). */
async function removeDatabase(name: string): Promise<void> {
  await admin`update pg_database set datistemplate = false where datname = ${name}`;
  await admin.unsafe(`drop database if exists "${name}" with (force)`);
}

async function databaseState(name: string): Promise<{ invalid: boolean; template: boolean } | undefined> {
  const [row] = await admin<{ invalid: boolean; template: boolean }[]>`
    select datconnlimit = -2 as invalid, datistemplate as template from pg_database where datname = ${name}`;
  return row;
}

/** Sessions on the `postgres` database that a FATAL error ended (the admin connections all use it). */
async function fatalSessions(): Promise<number> {
  await admin`select pg_stat_clear_snapshot()`;
  const [row] = await admin<{ n: string }[]>`
    select sessions_fatal::text as n from pg_stat_database where datname = current_database()`;
  return Number(row?.n ?? 0);
}

async function poll<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`);
    await sleep(25);
  }
}

describe("prepareTemplate's cleanup of databases an interrupted run left behind", () => {
  it("drops a leftover marked INVALID without ever ALTERing it, so its session survives", async () => {
    const suite = "harnessinvalid";
    const leftover = `${suitePrefix(suite)}left0ver`;
    await invalidDatabase(leftover);
    expect(await databaseState(leftover)).toEqual({ invalid: true, template: false });
    const fatalBefore = await fatalSessions();

    await expect(prepareTemplate(adminUrl, suite)).resolves.toBe(template);

    expect(await databaseState(leftover)).toBeUndefined();
    // an ALTER on the invalid database would have ended the admin session with a FATAL
    expect(await fatalSessions()).toBe(fatalBefore);
  }, 60_000);

  it("clears the template flag of a valid stale template before dropping it", async () => {
    const stale = "fs_tpl_0000000dead0";
    await removeDatabase(stale);
    await admin.unsafe(`create database "${stale}" is_template true`);
    expect(await databaseState(stale)).toEqual({ invalid: false, template: true });

    await expect(prepareTemplate(adminUrl, "harnessstale")).resolves.toBe(template);

    expect(await databaseState(stale)).toBeUndefined();
  }, 60_000);

  it("refuses, loudly, a leftover that is both INVALID and a template: neither ALTER nor DROP can remove it", async () => {
    const suite = "harnessstuck";
    const stuck = `${suitePrefix(suite)}stuck`;
    await invalidDatabase(stuck, { template: true });
    try {
      await expect(prepareTemplate(adminUrl, suite)).rejects.toThrow(
        new RegExp(`"${stuck}" is invalid .* and still marked as a template`),
      );
    } finally {
      await removeDatabase(stuck);
    }
  }, 60_000);
});

describe("the advisory lock prepareTemplate holds", () => {
  const LOCK = "pg_advisory_lock(hashtextextended('fs:test-template', 0))";

  it("is lost with its session: prepareTemplate then fails loudly instead of reconnecting without it", async () => {
    // Three sessions opened now: while the catalog lock below is held, a new connection could not start.
    const holder = postgres(adminUrl, { max: 1, onnotice: () => {} });
    const catalog = postgres(adminUrl, { max: 1, onnotice: () => {} });
    const watcher = postgres(adminUrl, { max: 1, onnotice: () => {} });
    try {
      await Promise.all([holder`select 1`, catalog`select 1`, watcher`select 1`]);
      const [own] = await holder<{ pid: number }[]>`select pg_backend_pid() as pid`;
      await holder.unsafe(`select ${LOCK}`);

      const prepared = prepareTemplate(adminUrl, "harnesslockloss");
      prepared.catch(() => {}); // asserted below
      // prepareTemplate's session queues behind the holder for the advisory lock
      const pid = await poll("prepareTemplate waits for the template lock", async () => {
        const [row] = await watcher<{ pid: number }[]>`
          select pid from pg_stat_activity
           where wait_event_type = 'Lock' and pid <> ${own?.pid ?? 0}
             and query like ${`%${LOCK}%`}`;
        return row?.pid;
      });

      await catalog.begin(async (tx) => {
        // its next statement after taking the lock reads pg_database: hold it there, lock in hand
        await tx`lock table pg_catalog.pg_database in access exclusive mode`;
        await holder.unsafe(`select pg_advisory_unlock(hashtextextended('fs:test-template', 0))`);
        // pg_locks only: pg_stat_activity reads pg_database, which this transaction now locks
        await poll("prepareTemplate holds the lock and waits on pg_database", async () => {
          const [row] = await watcher<{ locked: boolean; waiting: boolean }[]>`
            select bool_or(locktype = 'advisory' and granted) as locked,
                   bool_or(locktype = 'relation' and relation = 1262 and not granted) as waiting
              from pg_locks where pid = ${pid}`;
          return row?.locked && row.waiting ? true : undefined;
        });
        await watcher`select pg_terminate_backend(${pid})`;
        await poll("the session is gone", async () => {
          const rows = await watcher`select 1 from pg_locks where pid = ${pid}`;
          return rows.length === 0 ? true : undefined;
        });
      });

      await expect(prepared).rejects.toThrow(
        /lost the admin session \(pid \d+\) that holds the "fs:test-template" lock/,
      );
    } finally {
      await Promise.allSettled([
        holder.end({ timeout: 5 }),
        catalog.end({ timeout: 5 }),
        watcher.end({ timeout: 5 }),
      ]);
    }
  }, 60_000);
});

describe("createTestDatabase's drop", () => {
  it("drops its database even after an interrupted drop left it INVALID", async () => {
    const t = await createTestDatabase(adminUrl, template, "harnessdrop");
    await admin`update pg_database set datconnlimit = -2 where datname = ${t.name}`;
    await t.drop();
    expect(await databaseState(t.name)).toBeUndefined();
  }, 60_000);
});
