// Test-only SqlDriver over Node's built-in SQLite, so the outbox's real SQL runs under Vitest.
import { DatabaseSync } from "node:sqlite";
import type { SqlDriver, SqlParam } from "../lib/outbox-stores";

export function nodeSqlite(path = ":memory:"): SqlDriver & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: readonly SqlParam[]) {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes) };
    },
    async all<T>(sql: string, params: readonly SqlParam[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    close: () => db.close(),
  };
}
