/**
 * Two OutboxStore implementations with identical semantics (one shared test suite runs against both):
 * - `SqliteOutboxStore` over a tiny async driver, so it runs on expo-sqlite (Android) and node:sqlite (tests);
 * - `MemoryOutboxStore` for the web frames, whose captures are Judge Mode samples or demo photos.
 *
 * The SQLite schema is versioned with `PRAGMA user_version`. Version 2 adds cash receipts ("Nadawat" photos) and the
 * library and file sources; a phone still on the first build's table is migrated in one transaction, keeping every
 * capture (a capture is never lost, not even to an upgrade).
 */
import {
  CAPTURE_SOURCES,
  CAPTURE_STATES,
  type CapturePatch,
  type CaptureRecord,
  type CaptureState,
  type NadawatMeta,
  type OutboxStore,
} from "./outbox";

export type SqlParam = string | number | null;

export interface SqlDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly SqlParam[]): Promise<{ changes: number }>;
  all<T>(sql: string, params: readonly SqlParam[]): Promise<T[]>;
}

export const OUTBOX_SCHEMA_VERSION = 2;

const list = (xs: readonly string[]) => xs.map((x) => `'${x}'`).join(",");

/** Version 2: one row per capture; a cash receipt carries its line, amount, rate and attester (one per line). */
export const OUTBOX_TABLE_V2 = (name: string) => `
CREATE TABLE ${name} (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'slip' CHECK (kind IN ('slip','nadawat')),
  sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64),
  file_uri TEXT NOT NULL,
  thumb_uri TEXT,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  width INTEGER,
  height INTEGER,
  station TEXT NOT NULL,
  member_hint TEXT,
  source TEXT NOT NULL CHECK (source IN (${list(CAPTURE_SOURCES)})),
  line_id TEXT,
  member_no TEXT,
  member_name TEXT,
  cents INTEGER,
  php_per_usd TEXT,
  attested_by TEXT,
  created_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (${list(CAPTURE_STATES)})),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  progress REAL NOT NULL DEFAULT 0,
  document_id TEXT,
  duplicate_of TEXT,
  rows_read INTEGER,
  serial TEXT,
  uploaded_at INTEGER,
  CHECK (kind = 'slip' OR (line_id IS NOT NULL AND member_no IS NOT NULL AND cents IS NOT NULL
    AND php_per_usd IS NOT NULL AND attested_by IS NOT NULL))
);`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS captures_due ON captures (state, next_attempt_at);
CREATE UNIQUE INDEX IF NOT EXISTS captures_nadawat_line ON captures (line_id) WHERE kind = 'nadawat';`;

/** The columns version 1 had (the first build), in order, for the copy into version 2. */
const V1_COLUMNS = [
  "id",
  "sha256",
  "file_uri",
  "thumb_uri",
  "mime",
  "bytes",
  "width",
  "height",
  "station",
  "member_hint",
  "source",
  "created_at",
  "state",
  "attempts",
  "next_attempt_at",
  "last_error",
  "progress",
  "document_id",
  "duplicate_of",
  "rows_read",
  "serial",
  "uploaded_at",
] as const;

interface Row {
  id: string;
  kind: CaptureRecord["kind"];
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
  line_id: string | null;
  member_no: string | null;
  member_name: string | null;
  cents: number | null;
  php_per_usd: string | null;
  attested_by: string | null;
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

/** Patchable fields → columns. Bytes, kind and attestation are written once, on insert. */
const PATCH_COLUMNS: Readonly<Record<keyof CapturePatch, keyof Row>> = {
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

const num = (v: number | bigint | null): number | null => (v === null ? null : Number(v));

function fromRow(r: Row): CaptureRecord {
  const nadawat: NadawatMeta | null =
    r.kind === "nadawat"
      ? {
          lineId: r.line_id ?? "",
          memberNo: r.member_no ?? "",
          memberName: r.member_name ?? "",
          cents: Number(r.cents ?? 0),
          phpPerUsd: r.php_per_usd ?? "0",
          attestedBy: r.attested_by ?? "",
        }
      : null;
  return {
    id: r.id,
    kind: r.kind,
    sha256: r.sha256,
    fileUri: r.file_uri,
    thumbUri: r.thumb_uri,
    mime: r.mime,
    bytes: Number(r.bytes),
    width: num(r.width),
    height: num(r.height),
    station: r.station,
    memberHint: r.member_hint,
    source: r.source,
    nadawat,
    createdAt: Number(r.created_at),
    state: r.state,
    attempts: Number(r.attempts),
    nextAttemptAt: Number(r.next_attempt_at),
    lastError: r.last_error,
    progress: Number(r.progress),
    documentId: r.document_id,
    duplicateOf: r.duplicate_of,
    rowsRead: num(r.rows_read),
    serial: r.serial,
    uploadedAt: num(r.uploaded_at),
  };
}

function toRow(rec: CaptureRecord): Row {
  const n = rec.nadawat;
  return {
    id: rec.id,
    kind: rec.kind,
    sha256: rec.sha256,
    file_uri: rec.fileUri,
    thumb_uri: rec.thumbUri,
    mime: rec.mime,
    bytes: rec.bytes,
    width: rec.width,
    height: rec.height,
    station: rec.station,
    member_hint: rec.memberHint,
    source: rec.source,
    line_id: n?.lineId ?? null,
    member_no: n?.memberNo ?? null,
    member_name: n?.memberName ?? null,
    cents: n?.cents ?? null,
    php_per_usd: n?.phpPerUsd ?? null,
    attested_by: n?.attestedBy ?? null,
    created_at: rec.createdAt,
    state: rec.state,
    attempts: rec.attempts,
    next_attempt_at: rec.nextAttemptAt,
    last_error: rec.lastError,
    progress: rec.progress,
    document_id: rec.documentId,
    duplicate_of: rec.duplicateOf,
    rows_read: rec.rowsRead,
    serial: rec.serial,
    uploaded_at: rec.uploadedAt,
  };
}

function setClause(patch: CapturePatch): { sql: string; params: SqlParam[] } {
  const parts: string[] = [];
  const params: SqlParam[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = PATCH_COLUMNS[k as keyof CapturePatch];
    if (!col) throw new RangeError(`Not a patchable capture field: ${k}`);
    parts.push(`${col} = ?`);
    params.push(v as SqlParam);
  }
  return { sql: parts.join(", "), params };
}

/** Cash receipts first (they change a member's line), then the oldest page. */
const DUE_ORDER = "CASE kind WHEN 'nadawat' THEN 0 ELSE 1 END, created_at ASC, id ASC";

export class SqliteOutboxStore implements OutboxStore {
  constructor(private readonly db: SqlDriver) {}

  async init() {
    const [v] = await this.db.all<{ user_version: number }>("PRAGMA user_version", []);
    if (Number(v?.user_version ?? 0) >= OUTBOX_SCHEMA_VERSION) return;
    const cols = await this.db.all<{ name: string }>("PRAGMA table_info(captures)", []);
    const stamp = `PRAGMA user_version = ${OUTBOX_SCHEMA_VERSION};`;
    if (cols.length === 0) {
      await this.transaction(`${OUTBOX_TABLE_V2("captures")}\n${INDEXES}\n${stamp}`);
    } else if (cols.some((c) => c.name === "kind")) {
      await this.transaction(`${INDEXES}\n${stamp}`);
    } else {
      // The first build's table (no `kind`): rebuild it as version 2, keeping every row as a slip.
      const copy = V1_COLUMNS.join(", ");
      await this.transaction(`DROP TABLE IF EXISTS captures_v2;
${OUTBOX_TABLE_V2("captures_v2")}
INSERT INTO captures_v2 (${copy}, kind) SELECT ${copy}, 'slip' FROM captures;
DROP TABLE captures;
ALTER TABLE captures_v2 RENAME TO captures;
${INDEXES}
${stamp}`);
    }
  }

  /** Schema statements (constants only, never user input) in one transaction: all of it or none of it. */
  private async transaction(sql: string) {
    await this.db.exec("BEGIN;");
    try {
      await this.db.exec(sql);
      await this.db.exec("COMMIT;");
    } catch (e) {
      await this.db.exec("ROLLBACK;").catch(() => {});
      throw e;
    }
  }

  async insert(rec: CaptureRecord) {
    const row = toRow(rec);
    const cols = Object.keys(row);
    try {
      const r = await this.db.run(
        `INSERT OR IGNORE INTO captures (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
        Object.values(row) as SqlParam[],
      );
      return r.changes === 1 ? ("inserted" as const) : ("duplicate" as const);
    } catch (e) {
      // OR IGNORE covers UNIQUE; a partial unique index can still raise on some SQLite builds.
      if (/UNIQUE/i.test(e instanceof Error ? e.message : String(e))) return "duplicate" as const;
      throw e;
    }
  }

  async get(id: string) {
    const [r] = await this.db.all<Row>("SELECT * FROM captures WHERE id = ?", [id]);
    return r ? fromRow(r) : null;
  }

  async findBySha(sha256: string) {
    const [r] = await this.db.all<Row>("SELECT * FROM captures WHERE sha256 = ?", [sha256]);
    return r ? fromRow(r) : null;
  }

  async findNadawat(lineId: string) {
    const [r] = await this.db.all<Row>("SELECT * FROM captures WHERE kind = 'nadawat' AND line_id = ?", [
      lineId,
    ]);
    return r ? fromRow(r) : null;
  }

  async list() {
    const rows = await this.db.all<Row>("SELECT * FROM captures ORDER BY created_at DESC, id DESC", []);
    return rows.map(fromRow);
  }

  async due(now: number, limit: number) {
    const rows = await this.db.all<Row>(
      `SELECT * FROM captures WHERE state IN ('queued','failed') AND next_attempt_at <= ?
       ORDER BY ${DUE_ORDER} LIMIT ?`,
      [now, limit],
    );
    return rows.map(fromRow);
  }

  async update(id: string, patch: CapturePatch) {
    const { sql, params } = setClause(patch);
    if (!sql) return;
    await this.db.run(`UPDATE captures SET ${sql} WHERE id = ?`, [...params, id]);
  }

  async transition(id: string, from: readonly CaptureState[], patch: CapturePatch) {
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

  async removeSettled(before: number) {
    const rows = await this.db.all<Row>(
      "SELECT * FROM captures WHERE state IN ('uploaded','read') AND created_at < ?",
      [before],
    );
    if (rows.length) {
      await this.db.run("DELETE FROM captures WHERE state IN ('uploaded','read') AND created_at < ?", [
        before,
      ]);
    }
    return rows.map(fromRow);
  }
}

const clone = (r: CaptureRecord): CaptureRecord => ({ ...r, nadawat: r.nadawat ? { ...r.nadawat } : null });

function dueRank(r: CaptureRecord): number {
  return r.kind === "nadawat" ? 0 : 1;
}

export class MemoryOutboxStore implements OutboxStore {
  private rows = new Map<string, CaptureRecord>();

  async init() {}

  async insert(rec: CaptureRecord) {
    if (this.rows.has(rec.id)) return "duplicate" as const;
    for (const r of this.rows.values()) {
      if (r.sha256 === rec.sha256) return "duplicate" as const;
      if (rec.kind === "nadawat" && r.kind === "nadawat" && r.nadawat?.lineId === rec.nadawat?.lineId) {
        return "duplicate" as const;
      }
    }
    this.rows.set(rec.id, clone(rec));
    return "inserted" as const;
  }

  async get(id: string) {
    const r = this.rows.get(id);
    return r ? clone(r) : null;
  }

  async findBySha(sha256: string) {
    for (const r of this.rows.values()) if (r.sha256 === sha256) return clone(r);
    return null;
  }

  async findNadawat(lineId: string) {
    for (const r of this.rows.values())
      if (r.kind === "nadawat" && r.nadawat?.lineId === lineId) return clone(r);
    return null;
  }

  async list() {
    return [...this.rows.values()]
      .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
      .map(clone);
  }

  async due(now: number, limit: number) {
    return [...this.rows.values()]
      .filter((r) => (r.state === "queued" || r.state === "failed") && r.nextAttemptAt <= now)
      .sort((a, b) => dueRank(a) - dueRank(b) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map(clone);
  }

  async update(id: string, patch: CapturePatch) {
    const r = this.rows.get(id);
    if (r) this.rows.set(id, { ...r, ...defined(patch) });
  }

  async transition(id: string, from: readonly CaptureState[], patch: CapturePatch) {
    const r = this.rows.get(id);
    if (!r || !from.includes(r.state) || from.length === 0) return false;
    this.rows.set(id, { ...r, ...defined(patch) });
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

  async removeSettled(before: number) {
    const out: CaptureRecord[] = [];
    for (const r of [...this.rows.values()]) {
      if ((r.state === "uploaded" || r.state === "read") && r.createdAt < before) {
        this.rows.delete(r.id);
        out.push(clone(r));
      }
    }
    return out;
  }
}

/** Drops undefined values, so a patch never erases a field it did not name (as the SQL store behaves). */
function defined(patch: CapturePatch): CapturePatch {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!(k in PATCH_COLUMNS)) throw new RangeError(`Not a patchable capture field: ${k}`);
    out[k] = v;
  }
  return out as CapturePatch;
}
