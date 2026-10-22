/**
 * Two OutboxStore implementations with identical semantics:
 * - `SqliteOutboxStore` over a tiny async driver, so it runs on expo-sqlite (Android) and node:sqlite (tests);
 * - `MemoryOutboxStore` for the web export, whose captures are Judge Mode samples and never outlive the tab.
 */
import type { CaptureRecord, CaptureState, OutboxStore } from "./outbox";

export type SqlParam = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params: readonly SqlParam[]): Promise<T[]>;
}

export const OUTBOX_SCHEMA = `
CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  file_uri TEXT NOT NULL,
  thumb_uri TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  station TEXT NOT NULL,
  member_hint TEXT,
  source TEXT NOT NULL CHECK (source IN ('scanner','camera','sample')),
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued','uploading','uploaded','read','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  progress REAL NOT NULL DEFAULT 0,
  document_id TEXT,
  duplicate_of TEXT,
  rows_read INTEGER,
  serial TEXT,
  uploaded_at INTEGER
);
CREATE INDEX IF NOT EXISTS captures_due ON captures (state, next_attempt_at);
`;

interface Row {
  id: string;
  sha256: string;
  file_uri: string;
  thumb_uri: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  station: string;
  member_hint: string | null;
  source: CaptureRecord["source"];
  created_at: number;
  state: CaptureState;
  attempts: number;
  next_attempt_at: number;
  last_error: string | null;
  progress: number;
  document_id: string | null;
  duplicate_of: string | null;
  rows_read: number | null;
  serial: string | null;
  uploaded_at: number | null;
}

const COLUMNS: Readonly<Record<keyof Omit<CaptureRecord, "id">, keyof Row>> = {
  sha256: "sha256",
  fileUri: "file_uri",
  thumbUri: "thumb_uri",
  mime: "mime",
  bytes: "bytes",
  width: "width",
  height: "height",
  station: "station",
  memberHint: "member_hint",
  source: "source",
  createdAt: "created_at",
  state: "state",
  attempts: "attempts",
  nextAttemptAt: "next_attempt_at",
  lastError: "last_error",
  progress: "progress",
  documentId: "document_id",
  duplicateOf: "duplicate_of",
  rowsRead: "rows_read",
  serial: "serial",
  uploadedAt: "uploaded_at",
};

function fromRow(r: Row): CaptureRecord {
  return {
    id: r.id,
    sha256: r.sha256,
    fileUri: r.file_uri,
    thumbUri: r.thumb_uri,
    mime: r.mime,
    bytes: Number(r.bytes),
    width: r.width === null ? null : Number(r.width),
    height: r.height === null ? null : Number(r.height),
    station: r.station,
    memberHint: r.member_hint,
    source: r.source,
    createdAt: Number(r.created_at),
    state: r.state,
    attempts: Number(r.attempts),
    nextAttemptAt: Number(r.next_attempt_at),
    lastError: r.last_error,
    progress: Number(r.progress),
    documentId: r.document_id,
    duplicateOf: r.duplicate_of,
    rowsRead: r.rows_read === null ? null : Number(r.rows_read),
    serial: r.serial,
    uploadedAt: r.uploaded_at === null ? null : Number(r.uploaded_at),
  };
}

function setClause(patch: Partial<CaptureRecord>): { sql: string; params: SqlParam[] } {
  const parts: string[] = [];
  const params: SqlParam[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (k === "id" || v === undefined) continue;
    const col = COLUMNS[k as keyof typeof COLUMNS];
    if (!col) throw new RangeError(`Unknown capture field: ${k}`);
    parts.push(`${col} = ?`);
    params.push(v as SqlParam);
  }
  return { sql: parts.join(", "), params };
}

export class SqliteOutboxStore implements OutboxStore {
  constructor(private readonly db: SqlDriver) {}

  async init() {
    await this.db.exec(OUTBOX_SCHEMA);
  }

  async insert(rec: CaptureRecord) {
    const cols = ["id", ...Object.values(COLUMNS)];
    const values: SqlParam[] = [
      rec.id,
      ...Object.keys(COLUMNS).map((k) => rec[k as keyof typeof COLUMNS] as SqlParam),
    ];
    const r = await this.db.run(
      `INSERT OR IGNORE INTO captures (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      values,
    );
    return r.changes === 1 ? "inserted" : "duplicate";
  }

  async get(id: string) {
    const [r] = await this.db.all<Row>("SELECT * FROM captures WHERE id = ?", [id]);
    return r ? fromRow(r) : null;
  }

  async findBySha(sha256: string) {
    const [r] = await this.db.all<Row>("SELECT * FROM captures WHERE sha256 = ?", [sha256]);
    return r ? fromRow(r) : null;
  }

  async list() {
    const rows = await this.db.all<Row>("SELECT * FROM captures ORDER BY created_at DESC, id DESC", []);
    return rows.map(fromRow);
  }

  async due(now: number, limit: number) {
    const rows = await this.db.all<Row>(
      `SELECT * FROM captures WHERE state IN ('queued','failed') AND next_attempt_at <= ?
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      [now, limit],
    );
    return rows.map(fromRow);
  }

  async update(id: string, patch: Partial<CaptureRecord>) {
    const { sql, params } = setClause(patch);
    if (!sql) return;
    await this.db.run(`UPDATE captures SET ${sql} WHERE id = ?`, [...params, id]);
  }

  async transition(id: string, from: readonly CaptureState[], patch: Partial<CaptureRecord>) {
    const { sql, params } = setClause(patch);
    if (!sql || from.length === 0) return false;
    const r = await this.db.run(
      `UPDATE captures SET ${sql} WHERE id = ? AND state IN (${from.map(() => "?").join(", ")})`,
      [...params, id, ...from],
    );
    return r.changes === 1;
  }

  async requeueInterrupted() {
    const r = await this.db.run(
      "UPDATE captures SET state = 'queued', progress = 0 WHERE state = 'uploading'",
      [],
    );
    return r.changes;
  }
}

export class MemoryOutboxStore implements OutboxStore {
  private rows = new Map<string, CaptureRecord>();

  async init() {}

  async insert(rec: CaptureRecord) {
    for (const r of this.rows.values()) if (r.sha256 === rec.sha256) return "duplicate" as const;
    if (this.rows.has(rec.id)) return "duplicate" as const;
    this.rows.set(rec.id, { ...rec });
    return "inserted" as const;
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? { ...r } : null;
  }

  async findBySha(sha256: string) {
    for (const r of this.rows.values()) if (r.sha256 === sha256) return { ...r };
    return null;
  }

  async list() {
    return [...this.rows.values()]
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .map((r) => ({ ...r }));
  }

  async due(now: number, limit: number) {
    return [...this.rows.values()]
      .filter((r) => (r.state === "queued" || r.state === "failed") && r.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async update(id: string, patch: Partial<CaptureRecord>) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...patch, id: r.id, sha256: r.sha256 });
  }

  async transition(id: string, from: readonly CaptureState[], patch: Partial<CaptureRecord>) {
    const r = this.rows.get(id);
    if (!r || !from.includes(r.state)) return false;
    this.rows.set(id, { ...r, ...patch, id: r.id, sha256: r.sha256 });
    return true;
  }

  async requeueInterrupted() {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.state === "uploading") {
        this.rows.set(r.id, { ...r, state: "queued", progress: 0 });
        n++;
      }
    }
    return n;
  }
}
