/**
 * The clerk's offline outbox (M-CL-01 Scan and outbox). Every capture, a scanned weigh-slip page or the photo of a
 * member's signed "Nadawat" box on cash day, gets a UUIDv7 id that is also its Idempotency-Key, and a sha256 that is
 * unique on this phone and travels as its Content-Digest. Captures wait in SQLite until the phone is online, then
 * upload one at a time: cash receipts first (they change a member's line), then pages, oldest first. A retry is
 * always the same request, so nothing is filed twice, and nothing is dropped behind the clerk's back: a capture the
 * co-op refuses waits for a person, who sends it again ("Ipadala karon", under a new key when the old one can only
 * replay the refusal), files it again (a new scan, a new receipt for the line), or removes it from the phone.
 *
 * Once the co-op has a capture its state only moves forward (I5): `uploaded` never returns to the queue, and `read`
 * (`capture.synced`) is final, whichever of the 201 and the event arrives first.
 *
 * Pure: the store, uploader, clock, id source, network check and file deleter are injected, so the same engine runs
 * on expo-sqlite (Android), in memory (web frames) and under Vitest (node:sqlite).
 */
import { nextAttemptAt } from "./backoff";

export type CaptureState = "queued" | "uploading" | "uploaded" | "read" | "failed";
/** The system document scanner, the camera fallback, the phone's photos, a web file, or a labelled sample. */
export type CaptureSource = "scanner" | "camera" | "library" | "file" | "sample";
/** A weigh-slip page, or the photo of a member's signed "Nadawat" box (cash day). */
export type CaptureKind = "slip" | "nadawat";

export const CAPTURE_STATES = ["queued", "uploading", "uploaded", "read", "failed"] as const;
export const CAPTURE_SOURCES = ["scanner", "camera", "library", "file", "sample"] as const;

/** queued and failed share the bottom rung; nothing that reached the co-op goes back down (I5). */
export const CAPTURE_STATE_RANK: Readonly<Record<CaptureState, number>> = {
  queued: 0,
  failed: 0,
  uploading: 1,
  uploaded: 2,
  read: 3,
};

/** What a cash receipt attests: which line, how much (cents and the run's recorded rate, I1), and who pressed. */
export interface NadawatMeta {
  lineId: string;
  memberNo: string;
  /** The member's name as the cash list showed it, so the row reads right while offline. */
  memberName: string;
  cents: number;
  phpPerUsd: string;
  /** Initials for the ink stamp ("JD"). */
  attestedBy: string;
}

export interface CaptureRecord {
  /** UUIDv7: the Idempotency-Key of every attempt. */
  id: string;
  kind: CaptureKind;
  /** Lowercase hex sha256 of the exact bytes uploaded: the Content-Digest, and unique on this phone. */
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
  nadawat: NadawatMeta | null;
  createdAt: number;
  state: CaptureState;
  attempts: number;
  nextAttemptAt: number;
  /** A short code ("503", "NETWORK", "UNAUTHENTICATED"): screens word it, they never show it raw. */
  lastError: string | null;
  progress: number;
  documentId: string | null;
  duplicateOf: string | null;
  rowsRead: number | null;
  serial: string | null;
  uploadedAt: number | null;
}

/** The fields that change after a capture is filed; its bytes, kind and attestation never do. */
export type CapturePatch = Partial<
  Pick<
    CaptureRecord,
    | "state"
    | "attempts"
    | "nextAttemptAt"
    | "lastError"
    | "progress"
    | "documentId"
    | "duplicateOf"
    | "rowsRead"
    | "serial"
    | "uploadedAt"
  >
>;

type NewCaptureBase = Pick<
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

export type NewCapture = NewCaptureBase &
  ({ kind?: "slip"; nadawat?: null } | { kind: "nadawat"; nadawat: NadawatMeta });

export interface OutboxStore {
  init(): Promise<void>;
  /** Inserts unless a capture with the same sha256 (or a receipt for the same line) exists. */
  insert(rec: CaptureRecord): Promise<"inserted" | "duplicate">;
  get(id: string): Promise<CaptureRecord | null>;
  findBySha(sha256: string): Promise<CaptureRecord | null>;
  /** The cash receipt already filed for a member line, if any (one per line). */
  findNadawat(lineId: string): Promise<CaptureRecord | null>;
  /** Newest first. */
  list(): Promise<CaptureRecord[]>;
  /** Queued or failed captures whose next attempt is due: cash receipts first, then oldest first. */
  due(now: number, limit: number): Promise<CaptureRecord[]>;
  update(id: string, patch: CapturePatch): Promise<void>;
  /** Compare-and-set: applies `patch` only while the row is in one of `from`. */
  transition(id: string, from: readonly CaptureState[], patch: CapturePatch): Promise<boolean>;
  /** Puts interrupted uploads back in the queue (the Idempotency-Key makes re-sending safe). */
  requeueInterrupted(): Promise<number>;
  /** Deletes uploaded or read captures filed before `before`, returning them so their files can go too. */
  removeSettled(before: number): Promise<CaptureRecord[]>;
  /** Deletes a capture only while the co-op's refusal holds it (`isRefused`), returning it so its files can go. */
  removeRefused(id: string): Promise<CaptureRecord | null>;
  /**
   * Compare-and-set on a refusal: gives a refused capture a new id (its next Idempotency-Key) and applies `patch`.
   * False when the capture is gone or no longer refused.
   */
  rekeyRefused(id: string, newId: string, patch: CapturePatch): Promise<boolean>;
}

export type UploadOutcome =
  | {
      kind: "ok";
      documentId: string;
      duplicateOf: string | null;
      rowsRead: number | null;
      serial: string | null;
    }
  /** Network loss, a captive portal, 408, 429, 5xx: try again later with the same id. */
  | { kind: "retry"; error: string; retryAfterMs?: number | null }
  /** The co-op refused the request itself (4xx): only a person can send it again. */
  | { kind: "reject"; error: string };

export type Uploader = (rec: CaptureRecord, onProgress: (fraction: number) => void) => Promise<UploadOutcome>;

export interface OutboxDeps {
  store: OutboxStore;
  uploader: Uploader;
  now: () => number;
  newId: () => string;
  isOnline: () => boolean;
  onChange?: () => void;
  /** Deletes a pruned capture's file (best effort; a failure is never an error). */
  deleteFile?: (uri: string) => void | Promise<void>;
  /** Progress writes are throttled to keep SQLite quiet on cheap phones. */
  progressStep?: number;
}

export type AddResult =
  /** Filed. `replaced` is the refused capture this filing took the place of (the same page, or the same line). */
  | { outcome: "queued"; record: CaptureRecord; replaced: CaptureRecord | null }
  /** The same bytes were filed before: "Napadala na sa 09:12." */
  | { outcome: "duplicate-file"; existing: CaptureRecord }
  /** This member line already has a cash receipt on this phone, and the co-op has not refused it. */
  | { outcome: "already-attested"; existing: CaptureRecord };

export interface SyncReport {
  attempted: number;
  uploaded: number;
  retrying: number;
  rejected: number;
  skippedOffline: boolean;
}

/** Never retried automatically: a refusal waits for a person (`resendOf` says what a resend can be). */
export const MANUAL_ONLY = Number.MAX_SAFE_INTEGER;

/* ------------------------------------------------------------------ refusals */

/** The co-op refused the request itself (a 4xx): the capture waits for a person, never for a timer. */
export function isRefused(r: Pick<CaptureRecord, "state" | "nextAttemptAt">): boolean {
  return r.state === "failed" && r.nextAttemptAt === MANUAL_ONLY;
}

/** Refusals of the phone's pairing: once it is paired again, the same capture can go, under a new key. */
export const AUTH_REFUSALS: readonly string[] = ["UNAUTHENTICATED", "FORBIDDEN"];

/**
 * Refusals no resend can fix: the photo is gone from the phone or too large, Judge Mode takes samples only, or the
 * member line is no longer the one a receipt attests (`LINE_*`). The clerk scans or attests again instead, and
 * removes this one.
 */
export const FINAL_REFUSALS: readonly string[] = [
  "FILE_MISSING",
  "TOO_LARGE",
  "SAMPLES_ONLY",
  "JUDGE_SAMPLES_ONLY",
];

export function isFinalRefusal(code: string | null): boolean {
  return code !== null && (FINAL_REFUSALS.includes(code) || code.startsWith("LINE_"));
}

export type Resend =
  /** Waiting for its turn or its retry timer: sent again as the same request, under the same key (inv.i7). */
  | "same-key"
  /**
   * Refused. fs-api keeps the stored answer to an Idempotency-Key for 24 h (S3.10), so the same key could only get
   * the same refusal back; a resend is a new request under a new key. Nothing was filed under the old one, and the
   * Content-Digest still lets the co-op spot the same bytes.
   */
  | "new-key"
  /** On its way or settled, or refused for a reason no resend can fix. */
  | "none";

export function resendOf(r: Pick<CaptureRecord, "state" | "nextAttemptAt" | "lastError">): Resend {
  if (r.state === "queued") return "same-key";
  if (r.state !== "failed") return "none";
  if (!isRefused(r)) return "same-key";
  return isFinalRefusal(r.lastError) ? "none" : "new-key";
}

/** Settled captures stay on the phone for a month (the "Earlier" list), then their files are deleted. */
export const KEEP_SETTLED_MS = 30 * 24 * 3600_000;

/** One drain never loops forever, whatever a misbehaving store returns. */
const MAX_PASS = 10_000;

const SHA256_RE = /^[0-9a-f]{64}$/;
const RATE_RE = /^\d+(\.\d{1,2})?$/;

/** Rejects a capture the engine could never upload honestly (a bad digest, a negative size, an unbound receipt). */
export function assertNewCapture(input: NewCapture): void {
  if (!SHA256_RE.test(input.sha256)) throw new RangeError("sha256 must be 64 lowercase hex characters");
  if (!Number.isInteger(input.bytes) || input.bytes < 0) throw new RangeError("bytes must be a whole number");
  if (!(CAPTURE_SOURCES as readonly string[]).includes(input.source)) {
    throw new RangeError(`Unknown capture source: ${input.source}`);
  }
  if (!input.fileUri) throw new RangeError("A capture needs its file");
  if (input.kind === "nadawat") {
    const n = input.nadawat;
    if (!n?.lineId || !n.memberNo || !n.attestedBy) throw new RangeError("A cash receipt names its line");
    if (!Number.isInteger(n.cents) || n.cents < 0) throw new RangeError("Money is integer cents");
    if (!RATE_RE.test(n.phpPerUsd)) throw new RangeError(`Bad rate: ${n.phpPerUsd}`);
  }
}

export class Outbox {
  private running: Promise<SyncReport> | null = null;
  private again = false;
  private disposed = false;

  constructor(private readonly deps: OutboxDeps) {}

  /** Opens the store, requeues uploads a killed app left behind, and prunes old settled captures. */
  async init(opts: { keepSettledMs?: number } = {}): Promise<void> {
    await this.deps.store.init();
    const requeued = await this.deps.store.requeueInterrupted();
    const pruned = await this.prune(opts.keepSettledMs ?? KEEP_SETTLED_MS);
    if (requeued || pruned) this.changed();
  }

  /**
   * Files a capture on the phone, signal or not. The same bytes twice give "Already sent at 09:12" instead of a
   * second capture, and a member line takes one cash receipt. A refused capture is the exception: filing the same
   * page again, or a new receipt for the same line, takes its place under a new id (a person's fresh act; the
   * refusal dead-ends nowhere).
   */
  async add(input: NewCapture): Promise<AddResult> {
    assertNewCapture(input);
    const { store } = this.deps;
    let replaces: CaptureRecord | null = null;
    if (input.kind === "nadawat") {
      const prior = await store.findNadawat(input.nadawat.lineId);
      if (prior && !isRefused(prior)) return { outcome: "already-attested", existing: prior };
      replaces = prior;
    }
    const existing = await store.findBySha(input.sha256);
    if (existing && existing.id !== replaces?.id) {
      // Only a refused page is filed over by its own bytes; a photo already filed for anything else stays a duplicate.
      const refile = !replaces && existing.kind === "slip" && input.kind !== "nadawat" && isRefused(existing);
      if (!refile) return { outcome: "duplicate-file", existing };
      replaces = existing;
    }
    const now = this.deps.now();
    const record: CaptureRecord = {
      sha256: input.sha256,
      fileUri: input.fileUri,
      thumbUri: input.thumbUri,
      mime: input.mime,
      bytes: input.bytes,
      width: input.width,
      height: input.height,
      station: input.station,
      memberHint: input.memberHint,
      source: input.source,
      kind: input.kind ?? "slip",
      nadawat: input.kind === "nadawat" ? { ...input.nadawat } : null,
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
    let replaced: CaptureRecord | null = null;
    if (replaces) {
      replaced = await store.removeRefused(replaces.id);
      if (!replaced) {
        // Someone sent it again meanwhile ("Ipadala karon"): it is on its way, so this filing is the duplicate.
        const fresh = await store.get(replaces.id);
        if (fresh) {
          return fresh.kind === "nadawat"
            ? { outcome: "already-attested", existing: fresh }
            : { outcome: "duplicate-file", existing: fresh };
        }
      }
    }
    if ((await store.insert(record)) === "duplicate") {
      // Lost a race with a concurrent add of the same page, or of a receipt for the same line.
      const same = await store.findBySha(input.sha256);
      if (same) return { outcome: "duplicate-file", existing: same };
      const line = input.kind === "nadawat" ? await store.findNadawat(input.nadawat.lineId) : null;
      if (line) return { outcome: "already-attested", existing: line };
      throw new Error("The outbox refused a capture it could not find");
    }
    // The refused copy's photo goes with it, unless the new filing is the very same file.
    if (replaced) await this.deleteFiles(replaced, [record.fileUri, record.thumbUri]);
    this.changed();
    return { outcome: "queued", record, replaced };
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
        await this.drain(total);
      } while (this.again && !this.disposed);
      return total;
    })();
    this.running = run.finally(() => {
      this.running = null;
    });
    return this.running;
  }

  /**
   * "Ipadala karon": one capture goes now. A retry keeps its key; a refusal a resend can fix goes under a new key;
   * a refusal no resend can fix stays where it is (the screen offers "Tangtanga" instead).
   */
  async sendNow(id: string): Promise<SyncReport> {
    const r = await this.deps.store.get(id);
    if (r && (await this.resend(r))) this.changed();
    return this.sync();
  }

  /** "Ipadala tanan karon": every capture `sendNow` would send. */
  async sendAll(): Promise<SyncReport> {
    let n = 0;
    for (const r of await this.deps.store.list()) if (await this.resend(r)) n++;
    if (n) this.changed();
    return this.sync();
  }

  /**
   * The phone was paired again: every capture the co-op refused for the old pairing goes out again by itself, each
   * under a new key (the old key's stored answer is the refusal).
   */
  async afterPairing(): Promise<SyncReport> {
    let n = 0;
    for (const r of await this.deps.store.list()) {
      if (isRefused(r) && AUTH_REFUSALS.includes(r.lastError ?? "") && (await this.rekey(r.id))) n++;
    }
    if (n) this.changed();
    return this.sync();
  }

  /**
   * "Tangtanga sa telepono": removes a capture the co-op refused, and its photo. Only a refusal can be removed: a
   * capture still on its way, or already at the co-op, never leaves this way.
   */
  async discard(id: string): Promise<boolean> {
    const removed = await this.deps.store.removeRefused(id);
    if (!removed) return false;
    await this.deleteFiles(removed);
    this.changed();
    return true;
  }

  /**
   * `capture.synced`: the co-op has read the page ("4 ka linya nabasa"). Applies once; a redelivered event, a
   * capture from another phone, or a cash receipt changes nothing.
   */
  async markRead(
    id: string,
    info: { documentId: string; rowsRead?: number | null; serial?: string | null },
  ): Promise<boolean> {
    const { store } = this.deps;
    for (let i = 0; i < 3; i++) {
      const cur = await store.get(id);
      if (cur?.kind !== "slip" || cur.state === "read") return false;
      const ok = await store.transition(id, [cur.state], {
        state: "read",
        documentId: info.documentId,
        rowsRead: info.rowsRead ?? cur.rowsRead,
        serial: info.serial ?? cur.serial,
        uploadedAt: cur.uploadedAt ?? this.deps.now(),
        lastError: null,
        progress: 1,
      });
      if (ok) {
        this.changed();
        return true;
      }
    }
    return false;
  }

  list(): Promise<CaptureRecord[]> {
    return this.deps.store.list();
  }

  /** Deletes settled captures older than `keepMs` and their files. Returns how many went. */
  async prune(keepMs: number = KEEP_SETTLED_MS): Promise<number> {
    const removed = await this.deps.store.removeSettled(this.deps.now() - keepMs);
    for (const r of removed) await this.deleteFiles(r);
    return removed.length;
  }

  /** Stops syncing and change notifications (the clerk signed out, or the provider unmounted). */
  dispose(): void {
    this.disposed = true;
  }

  private changed(): void {
    if (!this.disposed) this.deps.onChange?.();
  }

  /** Makes one capture due now, as `resendOf` allows. True when something changed. */
  private async resend(r: CaptureRecord): Promise<boolean> {
    const how = resendOf(r);
    if (how === "new-key") return this.rekey(r.id);
    if (how === "none") return false;
    const now = this.deps.now();
    if (r.nextAttemptAt <= now) return false;
    return this.deps.store.transition(r.id, ["failed", "queued"], { nextAttemptAt: now });
  }

  /** A refused capture becomes a new request: a new id (its Idempotency-Key), back in the queue, due now. */
  private rekey(id: string): Promise<boolean> {
    return this.deps.store.rekeyRefused(id, this.deps.newId(), {
      state: "queued",
      attempts: 0,
      nextAttemptAt: this.deps.now(),
      lastError: null,
      progress: 0,
    });
  }

  /** Best effort: a file the OS already removed is not an error, and a file still in use (`keep`) stays. */
  private async deleteFiles(r: CaptureRecord, keep: readonly (string | null)[] = []): Promise<void> {
    for (const uri of new Set([r.fileUri, r.thumbUri])) {
      if (!uri || keep.includes(uri)) continue;
      try {
        await this.deps.deleteFile?.(uri);
      } catch {
        // Already gone.
      }
    }
  }

  private async drain(report: SyncReport): Promise<void> {
    const { store, now } = this.deps;
    for (let pass = 0; pass < MAX_PASS; pass++) {
      if (this.disposed) return;
      if (!this.deps.isOnline()) {
        report.skippedOffline = true;
        return;
      }
      const [next] = await store.due(now(), 1);
      if (!next) return;
      const claimed = await store.transition(next.id, ["queued", "failed"], {
        state: "uploading",
        progress: 0,
      });
      if (!claimed) continue;
      report.attempted++;
      this.changed();
      const outcome = await this.upload({ ...next, state: "uploading", progress: 0 });
      const attempts = next.attempts + 1;
      const at = now();
      if (outcome.kind === "ok") {
        await this.settle(next.id, attempts, at, outcome);
        report.uploaded++;
      } else if (outcome.kind === "retry") {
        await store.transition(next.id, ["uploading"], {
          state: "failed",
          attempts,
          progress: 0,
          lastError: outcome.error,
          nextAttemptAt: nextAttemptAt(at, attempts, outcome.retryAfterMs),
        });
        report.retrying++;
        this.changed();
        // The network or the co-op is struggling: stop this pass, and let the backoff decide when to return.
        return;
      } else {
        await store.transition(next.id, ["uploading"], {
          state: "failed",
          attempts,
          progress: 0,
          lastError: outcome.error,
          nextAttemptAt: MANUAL_ONLY,
        });
        report.rejected++;
      }
      this.changed();
    }
  }

  /** Runs the uploader; progress is clamped, never goes backwards, and is written in order before the outcome. */
  private async upload(rec: CaptureRecord): Promise<UploadOutcome> {
    const { store } = this.deps;
    const step = this.deps.progressStep ?? 0.1;
    let last = 0;
    let writes: Promise<void> = Promise.resolve();
    let outcome: UploadOutcome;
    try {
      outcome = await this.deps.uploader(rec, (p) => {
        const f = Math.min(1, Math.max(0, Number.isFinite(p) ? p : 0));
        if (f <= last || (f - last < step && f < 1)) return;
        last = f;
        writes = writes
          .then(() => store.transition(rec.id, ["uploading"], { progress: f }))
          .then(
            (ok) => {
              if (ok) this.changed();
            },
            () => {},
          );
      });
    } catch (e) {
      outcome = { kind: "retry", error: e instanceof Error ? e.message : String(e) };
    }
    await writes;
    return outcome;
  }

  /** The 201: uploaded, or read when the response already carries rows. Never moves a capture backwards. */
  private async settle(
    id: string,
    attempts: number,
    at: number,
    o: Extract<UploadOutcome, { kind: "ok" }>,
  ): Promise<void> {
    const { store } = this.deps;
    const target: CaptureState = o.rowsRead !== null ? "read" : "uploaded";
    for (let i = 0; i < 3; i++) {
      const cur = await store.get(id);
      if (!cur) return;
      if (CAPTURE_STATE_RANK[cur.state] >= CAPTURE_STATE_RANK[target]) {
        // capture.synced got here first: keep its state and rows, and add what the 201 knows.
        await store.update(id, {
          attempts,
          progress: 1,
          lastError: null,
          documentId: cur.documentId ?? o.documentId,
          duplicateOf: cur.duplicateOf ?? o.duplicateOf,
          uploadedAt: cur.uploadedAt ?? at,
        });
        return;
      }
      const ok = await store.transition(id, [cur.state], {
        state: target,
        attempts,
        progress: 1,
        lastError: null,
        documentId: o.documentId,
        duplicateOf: o.duplicateOf,
        rowsRead: o.rowsRead ?? cur.rowsRead,
        serial: o.serial ?? cur.serial,
        uploadedAt: at,
        nextAttemptAt: at,
      });
      if (ok) return;
    }
  }
}

/* ------------------------------------------------------------------ pure views over the records */

export interface OutboxSummary {
  total: number;
  /** Waiting for signal or for their turn. */
  queued: number;
  uploading: number;
  /** Failed and retrying on their own. */
  retrying: number;
  /** Refused by the co-op: waiting for a person. */
  refused: number;
  uploaded: number;
  read: number;
  /** Everything not yet at the co-op ("3 ka resibo natipigan sa telepono"). */
  onPhone: number;
  /** Everything the co-op has. */
  sent: number;
}

export function summarise(records: readonly CaptureRecord[]): OutboxSummary {
  const s: OutboxSummary = {
    total: records.length,
    queued: 0,
    uploading: 0,
    retrying: 0,
    refused: 0,
    uploaded: 0,
    read: 0,
    onPhone: 0,
    sent: 0,
  };
  for (const r of records) {
    if (r.state === "failed") {
      if (r.nextAttemptAt === MANUAL_ONLY) s.refused++;
      else s.retrying++;
    } else s[r.state]++;
  }
  s.onPhone = s.queued + s.uploading + s.retrying + s.refused;
  s.sent = s.uploaded + s.read;
  return s;
}

/** When the next automatic retry is due (to wake the outbox exactly then), or null if none is waiting. */
export function nextWakeAt(records: readonly CaptureRecord[], now: number): number | null {
  let at: number | null = null;
  for (const r of records) {
    if (r.state !== "failed" || r.nextAttemptAt === MANUAL_ONLY || r.nextAttemptAt <= now) continue;
    if (at === null || r.nextAttemptAt < at) at = r.nextAttemptAt;
  }
  return at;
}

/** The co-op keeps Philippine time (UTC+8, no daylight saving): "today" never depends on the phone's zone. */
const MANILA_OFFSET_MS = 8 * 3600_000;
const DAY_MS = 24 * 3600_000;

export function manilaDay(ms: number): number {
  return Math.floor((ms + MANILA_OFFSET_MS) / DAY_MS);
}

export function isSameManilaDay(a: number, b: number): boolean {
  return manilaDay(a) === manilaDay(b);
}
