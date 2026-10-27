/**
 * Applies the drizzle-kit migrations in ./migrations (generated schema plus the hand-written integrity SQL),
 * serialised across processes by an advisory lock so two deploys never migrate at once.
 * Runs as the owner (Render `preDeployCommand: pnpm --filter @fairsplit/db migrate`).
 */
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));
export const MIGRATIONS_TABLE = "__drizzle_migrations";
export const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATION_LOCK = "fs:migrations";

export async function runMigrations(url: string, opts: { migrationsFolder?: string } = {}): Promise<void> {
  const sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await sql`select pg_advisory_lock(hashtextextended(${MIGRATION_LOCK}, 0))`;
    try {
      await migrate(drizzle(sql), {
        migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_DIR,
        migrationsTable: MIGRATIONS_TABLE,
        migrationsSchema: MIGRATIONS_SCHEMA,
      });
    } finally {
      await sql`select pg_advisory_unlock(hashtextextended(${MIGRATION_LOCK}, 0))`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/**
 * Raises (never lowers) the floor of the global run sequence, so environments sharing one sandbox account do
 * not collide on invoice numbers and sender_batch_ids (S3.4: 1 for judge/prod, 100000 for dev,
 * 900000 + 10 × GITHUB_RUN_NUMBER for the nightly smoke). Returns the next value nextval() will hand out.
 */
export async function ensureRunSeqFloor(url: string, floor: number): Promise<number> {
  if (!Number.isSafeInteger(floor) || floor < 1) throw new RangeError(`run_seq floor must be ≥ 1: ${floor}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      await tx`lock table pay_runs in share row exclusive mode`;
      const [row] = await tx<{ next: string }[]>`
        select case when is_called then last_value + 1 else last_value end as next from fs_run_seq`;
      const next = Number(row?.next ?? 1);
      if (next >= floor) return next;
      await tx`select setval('fs_run_seq', ${floor}, false)`;
      return floor;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
