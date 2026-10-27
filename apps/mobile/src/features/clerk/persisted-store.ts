/**
 * The web export's outbox store: the memory store answers every read, and each change is written through to a
 * durable sink (IndexedDB in the browser) before the call returns, so a reload or a closed tab never loses a
 * capture. If the browser refuses storage (private browsing, quota), captures keep working for the tab's life.
 *
 * Captures are kept per workspace (`storeKey`): a phone paired to another co-op, or a fresh judge session, starts
 * with its own outbox, and nothing filed for one workspace is ever uploaded with another's credentials.
 *
 * Pure (tested in Node with an in-memory sink).
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { CapturePatch, CaptureRecord, CaptureState, OutboxStore } from "../../lib/outbox";
import { MemoryOutboxStore } from "../../lib/outbox-stores";

export interface RecordSink {
  loadAll(): Promise<CaptureRecord[]>;
  put(rec: CaptureRecord): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

/** A short, file-name-safe key for a workspace's outbox (database file or IndexedDB name). */
export function storeKey(workspaceId: string): string {
  return bytesToHex(sha256(utf8ToBytes(`fair-split-outbox:${workspaceId}`))).slice(0, 16);
}

export class PersistedOutboxStore implements OutboxStore {
  private readonly mem = new MemoryOutboxStore();
  /** False once the sink has refused a write: the screen can say captures live only in this tab. */
  durable = true;

  constructor(private readonly sink: RecordSink) {}

  async init() {
    let rows: CaptureRecord[] = [];
    try {
      rows = await this.sink.loadAll();
    } catch {
      this.durable = false;
    }
    for (const r of rows) await this.mem.insert(r);
  }

  async insert(rec: CaptureRecord) {
    const r = await this.mem.insert(rec);
    if (r === "inserted") await this.write(() => this.sink.put(rec));
    return r;
  }

  get(id: string) {
    return this.mem.get(id);
  }

  findBySha(sha256Hex: string) {
    return this.mem.findBySha(sha256Hex);
  }

  findNadawat(lineId: string) {
    return this.mem.findNadawat(lineId);
  }

  list() {
    return this.mem.list();
  }

  due(now: number, limit: number) {
    return this.mem.due(now, limit);
  }

  async update(id: string, patch: CapturePatch) {
    await this.mem.update(id, patch);
    await this.flush(id);
  }

  async transition(id: string, from: readonly CaptureState[], patch: CapturePatch) {
    const ok = await this.mem.transition(id, from, patch);
    if (ok) await this.flush(id);
    return ok;
  }

  async requeueInterrupted() {
    const interrupted = (await this.mem.list()).filter((r) => r.state === "uploading").map((r) => r.id);
    const n = await this.mem.requeueInterrupted();
    for (const id of interrupted) await this.flush(id);
    return n;
  }

  async removeSettled(before: number) {
    const removed = await this.mem.removeSettled(before);
    if (removed.length) await this.write(() => this.sink.remove(removed.map((r) => r.id)));
    return removed;
  }

  private async flush(id: string) {
    const r = await this.mem.get(id);
    if (r) await this.write(() => this.sink.put(r));
  }

  private async write(op: () => Promise<void>) {
    try {
      await op();
    } catch {
      this.durable = false;
    }
  }
}
