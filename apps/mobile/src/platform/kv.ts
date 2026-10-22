/**
 * Native storage. Preferences and secrets both live in SecureStore (Android Keystore-backed), which keeps the
 * device bearer token out of plain files; values are small.
 */
import * as SecureStore from "expo-secure-store";

export interface Kv {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  del(key: string): Promise<void>;
}

const opts: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function secureKv(): Kv {
  return {
    get: (k) => SecureStore.getItemAsync(k, opts),
    set: (k, v) => SecureStore.setItemAsync(k, v, opts),
    del: (k) => SecureStore.deleteItemAsync(k, opts),
  };
}

export const prefs: Kv = secureKv();
export const secrets: Kv = secureKv();
