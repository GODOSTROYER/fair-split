/**
 * Migrated template databases: the migrations run once per migration-set hash into `fs_tpl_<hash>`, and every
 * test file gets its own `CREATE DATABASE … TEMPLATE` copy, so tests see the real schema, triggers and grants
 * in full isolation and in a fraction of a second.
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

/** Test databases are named fs_t_<suite>_<random>; a suite only ever cleans up its own leftovers. */
export function suitePrefix(suite: string): string {
  const s = suite.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `fs_t_${s || "x"}_`;
}

/** Ensures a migrated template exists and returns its name; drops stale templates and this suite's leftovers. */
export async function prepareTemplate(adminUrl: string, suite: string): Promise<string> {
  const prefix = suitePrefix(suite);
  const name = `fs_tpl_${migrationsHash()}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin`select pg_advisory_lock(hashtextextended('fs:test-template', 0))`;
    try {
      const stale = await admin<{ datname: string }[]>`
        select datname from pg_database
         where (datname like 'fs\\_tpl\\_%' and datname <> ${name}) or starts_with(datname, ${prefix})`;
      for (const { datname } of stale) {
        if (!SAFE_NAME.test(datname)) continue;
        await admin.unsafe(`alter database "${datname}" is_template false`).catch(() => {});
        await admin.unsafe(`drop database if exists "${datname}" with (force)`);
      }
      const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
      if (!exists) {
        const building = `${name}_building`;
        await admin.unsafe(`drop database if exists "${building}" with (force)`);
        await admin.unsafe(`create database "${building}"`);
        await runMigrations(withDatabase(adminUrl, building));
        await admin.unsafe(`alter database "${building}" rename to "${name}"`);
        await admin.unsafe(`alter database "${name}" is_template true`);
      }
    } finally {
      await admin`select pg_advisory_unlock(hashtextextended('fs:test-template', 0))`;
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
  return name;
}

export interface TestDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

export async function createTestDatabase(
  adminUrl: string,
  template: string,
  suite: string,
): Promise<TestDatabase> {
  if (!SAFE_NAME.test(template)) throw new Error(`unsafe template name ${template}`);
  const name = `${suitePrefix(suite)}${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database "${name}" template "${template}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  return {
    name,
    url: withDatabase(adminUrl, name),
    drop: async () => {
      const a = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await a.unsafe(`drop database if exists "${name}" with (force)`);
      } finally {
        await a.end({ timeout: 5 });
      }
    },
  };
}
