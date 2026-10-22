/**
 * The clerk's offline outbox (M-CL-01, M-CK-02). Every scanned page becomes one capture with a UUIDv7 id that is
 * also its Idempotency-Key, and a sha256 that is unique on this phone. Captures wait in SQLite until the phone is
 * online, then upload one at a time. A retry is always the same request, so nothing is ever filed twice.
 *
 * Pure: the store, uploader, clock, id source and network check are injected, so the same engine runs on
 * expo-sqlite (Android), in memory (web frames) and under Vitest (node:sqlite).
 */
import { retryDelayMs } from "./backoff";

export type CaptureState = "queued" | "uploading" | "uploaded" | "read" | "failed";
export type CaptureSource = "scanner" | "camera" | "sample";

export interface CaptureRecord {
  id: string;
  sha256: string;
  fileUri: string;
  thumbUri: string | null;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  station: string;
  memberHint: string | null;
  source: CaptureSource;
  createdAt: number;
  state: CaptureState;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  progress: number;
  documentId: string | null;
  duplicateOf: string | null;
  rowsRead: number | null;
  serial: string | null;
  uploadedAt: number | null;
}

export type NewCapture = Pick<
  CaptureRecord,
  | "sha256"
  | "fileUri"
  | "thumbUri"
  | "mime"
  | "bytes"
  | "width"
  | "height"
  | "station"
  | "memberHint"
  | "source"
>;

export interface OutboxStore {
  init(): Promise<void>;
  /** Inserts unless a capture with the same sha256 exists. */
  insert(rec: CaptureRecord): Promise<"inserted" | "duplicate">;
  get(id: string): Promise<CaptureRecord | null>;
  findBySha(sha256: string): Promise<CaptureRecord | null>;
  /** Newest first. */
  list(): Promise<CaptureRecord[]>;
  /** Queued or failed captures whose next attempt is due, oldest first. */
  due(now: number, limit: number): Promise<CaptureRecord[]>;
  update(id: string, patch: Partial<Omit<CaptureRecord, "id" | "sha256">>): Promise<void>;
  /** Compare-and-set: applies `patch` only while the row is in one of `from`. */
  transition(id: string, from: readonly CaptureState[], patch: Partial<CaptureRecord>): Promise<boolean>;
  /** Puts interrupted uploads back in the queue (the Idempotency-Key makes re-sending safe). */
  requeueInterrupted(): Promise<number>;
}

export type UploadOutcome =
  | {
      kind: "ok";
      documentId: string;
      duplicateOf: string | null;
      rowsRead: number | null;
      serial: string | null;
    }
  /** Network loss, 5xx, 429: try again later with the same id. */
  | { kind: "retry"; error: string }
  /** The server refused the request itself (4xx): only a person can send it again. */
  | { kind: "reject"; error: string };

export type Uploader = (rec: CaptureRecord, onProgress: (fraction: number) => void) => Promise<UploadOutcome>;

export interface OutboxDeps {
  store: OutboxStore;
  uploader: Uploader;
  now: () => number;
  newId: () => string;
  isOnline: () => boolean;
  onChange?: () => void;
  /** Progress writes are throttled to keep SQLite quiet on cheap phones. */
  progressStep?: number;
}

export type AddResult =
  | { outcome: "queued"; record: CaptureRecord }
  | { outcome: "duplicate-file"; existing: CaptureRecord };

export interface SyncReport {
  attempted: number;
  uploaded: number;
  retrying: number;
  rejected: number;
  skippedOffline: boolean;
}

/** Never retried automatically; "Ipadala karon" (send now) clears it. */
export const MANUAL_ONLY = Number.MAX_SAFE_INTEGER;

export class Outbox {
  private running: Promise<SyncReport> | null = null;
  private again = false;

  constructor(private readonly deps: OutboxDeps) {}

  async init(): Promise<void> {
    await this.deps.store.init();
    const n = await this.deps.store.requeueInterrupted();
    if (n) this.deps.onChange?.();
  }

  /** Files a scanned page. The same bytes twice give "Already sent at 09:12" instead of a second capture. */
  async add(input: NewCapture): Promise<AddResult> {
    const existing = await this.deps.store.findBySha(input.sha256);
    if (existing) return { outcome: "duplicate-file", existing };
    const now = this.deps.now();
    const record: CaptureRecord = {
      ...input,
      id: this.deps.newId(),
      createdAt: now,
      state: "queued",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      progress: 0,
      documentId: null,
      duplicateOf: null,
      rowsRead: null,
      serial: null,
      uploadedAt: null,
    };
    const inserted = await this.deps.store.insert(record);
    if (inserted === "duplicate") {
      const again = await this.deps.store.findBySha(input.sha256);
      if (again) return { outcome: "duplicate-file", existing: again };
    }
    this.deps.onChange?.();
    return { outcome: "queued", record };
  }

  /** Single-flight: concurrent calls share one run, and a call during a run schedules one more pass. */
  sync(): Promise<SyncReport> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = (async () => {
      const total: SyncReport = {
        attempted: 0,
        uploaded: 0,
        retrying: 0,
        rejected: 0,
        skippedOffline: false,
      };
      do {
        this.again = false;
        const r = await this.drain();
        total.attempted += r.attempted;
        total.uploaded += r.uploaded;
        total.retrying += r.retrying;
        total.rejected += r.rejected;
        total.skippedOffline ||= r.skippedOffline;
      } while (this.again);
      return total;
    })();
    this.running = run.finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /** "Ipadala karon": makes a failed capture due now and syncs. */
  async sendNow(id: string): Promise<SyncReport> {
    await this.deps.store.transition(id, ["failed", "queued"], { nextAttemptAt: this.deps.now() });
    this.deps.onChange?.();
    return this.sync();
  }

  /** `capture.synced` from the server: the slip has been read. */
  async markRead(id: string, info: { documentId: string; rowsRead?: number | null; serial?: string | null }) {
    const ok = await this.deps.store.transition(id, ["uploaded", "read", "uploading", "queued", "failed"], {
      state: "read",
      documentId: info.documentId,
      rowsRead: info.rowsRead ?? null,
      serial: info.serial ?? null,
    });
    if (ok) this.deps.onChange?.();
    return ok;
  }

  list(): Promise<CaptureRecord[]> {
    return this.deps.store.list();
  }

  private async drain(): Promise<SyncReport> {
    const report: SyncReport = { attempted: 0, uploaded: 0, retrying: 0, rejected: 0, skippedOffline: false };
    const { store, uploader, now } = this.deps;
    for (;;) {
      if (!this.deps.isOnline()) {
        report.skippedOffline = true;
        return report;
      }
      const [next] = await store.due(now(), 1);
      if (!next) return report;
      const claimed = await store.transition(next.id, ["queued", "failed"], {
        state: "uploading",
        progress: 0,
      });
      if (!claimed) continue;
      report.attempted++;
      this.deps.onChange?.();
      const step = this.deps.progressStep ?? 0.1;
      let lastReported = 0;
      let outcome: UploadOutcome;
      try {
        outcome = await uploader({ ...next, state: "uploading" }, (p) => {
          if (p - lastReported >= step || p >= 1) {
            lastReported = p;
            void store
              .update(next.id, { progress: Math.min(1, Math.max(0, p)) })
              .then(() => this.deps.onChange?.());
          }
        });
      } catch (e) {
        outcome = { kind: "retry", error: e instanceof Error ? e.message : String(e) };
      }
      const attempts = next.attempts + 1;
      if (outcome.kind === "ok") {
        await store.update(next.id, {
          state: outcome.rowsRead !== null ? "read" : "uploaded",
          attempts,
          progress: 1,
          lastError: null,
          documentId: outcome.documentId,
          duplicateOf: outcome.duplicateOf,
          rowsRead: outcome.rowsRead,
          serial: outcome.serial,
          uploadedAt: now(),
        });
        report.uploaded++;
      } else if (outcome.kind === "retry") {
        await store.update(next.id, {
          state: "failed",
          attempts,
          progress: 0,
          lastError: outcome.error,
          nextAttemptAt: now() + retryDelayMs(attempts),
        });
        report.retrying++;
        this.deps.onChange?.();
        // Stop this pass: the network or the server is struggling, and the backoff decides when to return.
        return report;
      } else {
        await store.update(next.id, {
          state: "failed",
          attempts,
          progress: 0,
          lastError: outcome.error,
          nextAttemptAt: MANUAL_ONLY,
        });
        report.rejected++;
      }
      this.deps.onChange?.();
    }
  }
}

/** Counts for the scan screen's offline line ("3 ka resibo natipigan sa telepono"). */
export function summarise(records: readonly CaptureRecord[]) {
  let waiting = 0;
  let sent = 0;
  let failed = 0;
  for (const r of records) {
    if (r.state === "queued" || r.state === "uploading") waiting++;
    else if (r.state === "failed") failed++;
    else sent++;
  }
  return { total: records.length, waiting, sent, failed, onPhone: waiting + failed };
}
