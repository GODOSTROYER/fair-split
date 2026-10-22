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

export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const store = new SQLiteStorage("fs-prefs.db");

export const prefs: Kv = {
  get: (k) => store.getItem(k).catch(() => null),
  set: (k, v) => store.setItem(k, v).catch(() => {}),
  del: (k) => store.removeItem(k).catch(() => {}),
};

const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secrets: Kv = {
  get: (k) => SecureStore.getItemAsync(k, opts).catch(() => null),
  set: (k, v) => SecureStore.setItemAsync(k, v, opts),
  del: (k) => SecureStore.deleteItemAsync(k, opts).catch(() => {}),
};
