/**
 * Android/iOS: the outbox lives in SQLite (expo-sqlite), one database per workspace, in WAL mode with full
 * synchronous commits, so a capture the clerk was told is "saved" survives a crash, a restart or a dead battery.
 */
import * as SQLite from "expo-sqlite";
import { storeKey } from "../features/clerk/persisted-store";
import type { OutboxStore } from "../lib/outbox";
import { type SqlDriver, SqliteOutboxStore } from "../lib/outbox-stores";

const opened = new Map<string, Promise<OutboxStore>>();

async function open(name: string): Promise<OutboxStore> {
  const db = await SQLite.openDatabaseAsync(name);
  await db.execAsync("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
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

export function openOutboxStore(workspaceId: string): Promise<OutboxStore> {
  const name = `fairsplit-outbox-${storeKey(workspaceId)}.db`;
  let p = opened.get(name);
  if (!p) {
    p = open(name);
    opened.set(name, p);
    p.catch(() => opened.delete(name)); // a failed open can be retried
  }
  return p;
}
