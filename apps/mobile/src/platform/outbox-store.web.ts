/**
 * Web export: the outbox persists in IndexedDB, one database per workspace, through the write-through
 * `PersistedOutboxStore` (expo-sqlite on the web needs SharedArrayBuffer and cross-origin isolation headers that the
 * same-origin judge frames do not set). Where the browser refuses storage, the outbox keeps working in memory.
 */
import { PersistedOutboxStore, type RecordSink, storeKey } from "../features/clerk/persisted-store";
import type { CaptureRecord, OutboxStore } from "../lib/outbox";
import { MemoryOutboxStore } from "../lib/outbox-stores";

const STORE = "captures";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
}

function idbSink(db: IDBDatabase): RecordSink {
  const store = (mode: IDBTransactionMode) => db.transaction(STORE, mode).objectStore(STORE);
  return {
    loadAll: () => request(store("readonly").getAll() as IDBRequest<CaptureRecord[]>),
    async put(rec) {
      await request(store("readwrite").put(rec));
    },
    async remove(ids) {
      const s = store("readwrite");
      await Promise.all(ids.map((id) => request(s.delete(id))));
    },
  };
}

const opened = new Map<string, Promise<OutboxStore>>();

export function openOutboxStore(workspaceId: string): Promise<OutboxStore> {
  const name = `fairsplit-outbox-${storeKey(workspaceId)}`;
  let p = opened.get(name);
  if (!p) {
    p = (async () => {
      try {
        if (typeof indexedDB === "undefined") throw new Error("no IndexedDB");
        return new PersistedOutboxStore(idbSink(await openDb(name)));
      } catch {
        return new MemoryOutboxStore();
      }
    })();
    opened.set(name, p);
  }
  return p;
}
