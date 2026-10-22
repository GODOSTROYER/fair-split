/** Android/iOS: the outbox lives in SQLite (expo-sqlite, WAL) so captures survive restarts and dead batteries. */
import * as SQLite from "expo-sqlite";
import type { OutboxStore } from "../lib/outbox";
import { type SqlDriver, SqliteOutboxStore } from "../lib/outbox-stores";

export async function openOutboxStore(): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync("fairsplit-outbox.db");
  await db.execAsync("PRAGMA journal_mode = WAL;");
  const driver: SqlDriver = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params) => {
      const r = await db.runAsync(sql, params as SQLite.SQLiteBindParams);
      return { changes: r.changes };
    },
    all: (sql, params) => db.getAllAsync(sql, params as SQLite.SQLiteBindParams),
  };
  return new SqliteOutboxStore(driver);
}
