// The treasurer's browser key (S3.8): `fs-analyn-w1` is a non-extractable WebCrypto Ed25519 key made once in the
// treasurer's browser and kept in IndexedDB, where only this origin can use it to sign; the private half can never
// be read out, copied or sent. Its public half is registered once from /ops (the operator's step). Where IndexedDB
// is unavailable (a private window, tests) the key lives for this page only, and the page says so.
//
// Shared change requested: W-TR-07 signs with this key, so this module should move to `src/lib/keystore.ts`
// (reported). Until then the database and record shapes below are the contract between the two slices.

import { sha256Hex, toHex } from "../../lib/sha256.js";

export const TREASURER_KEY_ID = "fs-analyn-w1";
export const TREASURER_APPROVER = "treasurer:analyn";
export const KEY_DB = "fairsplit-keys";
export const KEY_STORE = "keys";

export interface StoredKey {
  readonly keyId: string;
  readonly approverId: string;
  readonly publicKeyHex: string;
  readonly createdAt: string;
  /** When Fair Split's server accepted the public key; null until then. */
  readonly registeredAt: string | null;
  readonly keys: CryptoKeyPair;
}

export interface KeyStore {
  /** True when the key survives a reload (IndexedDB); false for a page-only key. */
  readonly durable: boolean;
  get(keyId: string): Promise<StoredKey | null>;
  put(record: StoredKey): Promise<void>;
}

/** WebCrypto's Ed25519 (Chrome and Edge 137+, Firefox 129+, Safari 17+), probed by making a throwaway key. */
export async function ed25519Supported(
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<boolean> {
  if (!subtle) return false;
  try {
    await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    return true;
  } catch {
    return false;
  }
}

/** Makes the key: the private half non-extractable, the public half read out as 32 raw bytes in hex. */
export async function makeKey(
  keyId: string,
  approverId: string,
  now: () => Date = () => new Date(),
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
): Promise<StoredKey> {
  if (!subtle) throw new Error("This browser has no WebCrypto.");
  const keys = (await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await subtle.exportKey("raw", keys.publicKey));
  return {
    keyId,
    approverId,
    publicKeyHex: toHex(raw),
    createdAt: now().toISOString(),
    registeredAt: null,
    keys,
  };
}

/** The public key's fingerprint, in groups of four, to compare by eye with what the server registered. */
export function fingerprint(publicKeyHex: string): string {
  const digest = sha256Hex(publicKeyHex);
  return (digest.slice(0, 16).match(/.{4}/g) ?? []).join(" ");
}

export function memoryKeyStore(): KeyStore {
  const records = new Map<string, StoredKey>();
  return {
    durable: false,
    async get(keyId) {
      return records.get(keyId) ?? null;
    },
    async put(record) {
      records.set(record.keyId, record);
    },
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = factory.open(KEY_DB, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(KEY_STORE))
        open.result.createObjectStore(KEY_STORE, { keyPath: "keyId" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB did not open"));
    open.onblocked = () => reject(new Error("IndexedDB is blocked by another tab"));
  });
}

export function indexedDbKeyStore(factory: IDBFactory): KeyStore {
  let db: Promise<IDBDatabase> | null = null;
  const database = () => {
    db ??= openDb(factory);
    return db;
  };
  return {
    durable: true,
    async get(keyId) {
      const store = (await database()).transaction(KEY_STORE, "readonly").objectStore(KEY_STORE);
      return ((await request(store.get(keyId))) as StoredKey | undefined) ?? null;
    },
    async put(record) {
      const store = (await database()).transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE);
      await request(store.put(record));
    },
  };
}

/** IndexedDB where the browser offers it, else a page-only store (labelled on screen). */
export function openKeyStore(factory: IDBFactory | undefined = globalThis.indexedDB): KeyStore {
  try {
    return factory ? indexedDbKeyStore(factory) : memoryKeyStore();
  } catch {
    return memoryKeyStore();
  }
}
