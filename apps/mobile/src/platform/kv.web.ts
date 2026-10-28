/**
 * Web export (judge phone frames). Preferences persist per viewer in localStorage, guarded because storage can be
 * blocked or empty. Secrets never persist: frame tokens live in memory for the tab's life and are never put in a URL.
 */
import type { Kv } from "./kv";

export type { Kv, KvRead } from "./kv";

function local(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const prefs: Kv = {
  async get(k) {
    try {
      return local()?.getItem(k) ?? null;
    } catch {
      return null;
    }
  },
  async read(k) {
    try {
      return { ok: true, value: local()?.getItem(k) ?? null };
    } catch {
      return { ok: false };
    }
  },
  async set(k, v) {
    try {
      local()?.setItem(k, v);
    } catch {
      // Private windows and blocked storage: the app still works, it just forgets.
    }
  },
  async del(k) {
    try {
      local()?.removeItem(k);
    } catch {
      // ignore
    }
  },
};

const memory = new Map<string, string>();
export const secrets: Kv = {
  get: async (k) => memory.get(k) ?? null,
  read: async (k) => ({ ok: true, value: memory.get(k) ?? null }),
  set: async (k, v) => {
    memory.set(k, v);
  },
  del: async (k) => {
    memory.delete(k);
  },
};
