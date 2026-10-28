/**
 * Native key-value storage, in two tiers:
 * - `prefs`: non-secret preferences and offline copies (the statement's "Katapusang kopya"), in SQLite
 *   (expo-sqlite/kv-store), which takes values of any size;
 * - `secrets`: the device bearer token and nothing else, in SecureStore (Android Keystore-backed), readable only
 *   while the phone is unlocked and never backed up to another device.
 * Signing keys are not here: they live in the key vault behind biometrics.
 */

import * as SecureStore from "expo-secure-store";
import { SQLiteStorage } from "expo-sqlite/kv-store";

/**
 * A read that says whether the store could be read at all. `get` maps a failed read to null (nothing stored), which
 * is right for preferences; a caller that must not mistake "could not read" for "nothing there" (the stored pairing)
 * uses `read`.
 */
export type KvRead = { readonly ok: true; readonly value: string | null } | { readonly ok: false };

export interface Kv {
  get(key: string): Promise<string | null>;
  read(key: string): Promise<KvRead>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const store = new SQLiteStorage("fs-prefs.db");

export const prefs: Kv = {
  get: (k) => store.getItem(k).catch(() => null),
  read: (k) =>
    store.getItem(k).then(
      (value) => ({ ok: true, value: value ?? null }) as const,
      () => ({ ok: false }) as const,
    ),
  set: (k, v) => store.setItem(k, v).catch(() => {}),
  del: (k) => store.removeItem(k).catch(() => {}),
};

const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secrets: Kv = {
  get: (k) => SecureStore.getItemAsync(k, opts).catch(() => null),
  read: (k) =>
    SecureStore.getItemAsync(k, opts).then(
      (value) => ({ ok: true, value: value ?? null }) as const,
      () => ({ ok: false }) as const,
    ),
  set: (k, v) => SecureStore.setItemAsync(k, v, opts),
  del: (k) => SecureStore.deleteItemAsync(k, opts).catch(() => {}),
};
